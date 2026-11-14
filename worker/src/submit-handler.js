import {
  cleanText,
  submissionData,
  submissionMarkdown,
  validateImageBuffer,
  validateSubmission,
} from '../../src/domain.js';

const MAX_REQUEST_BYTES = 12 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 24_000_000;
const EXT_BY_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const DEFAULT_ALLOWED_ORIGINS = ['https://blue-chubby-whale.cyou', 'https://www.blue-chubby-whale.cyou', 'https://fightingshine.github.io'];
const DEFAULT_TURNSTILE_HOSTS = ['blue-chubby-whale.cyou', 'www.blue-chubby-whale.cyou', 'fightingshine.github.io', '127.0.0.1', 'localhost'];

function splitCsv(value, fallback = []) {
  const items = String(value || '').split(',').map(s => s.trim()).filter(Boolean);
  return items.length ? items : fallback;
}

export function isOriginAllowed(origin, allowedConfig) {
  if (!origin) return false;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  const rules = splitCsv(allowedConfig, DEFAULT_ALLOWED_ORIGINS);
  return rules.some(rule => {
    if (rule.endsWith(':*')) {
      const prefix = rule.slice(0, -2);
      return `${parsed.protocol}//${parsed.hostname}` === prefix;
    }
    return parsed.origin === rule;
  });
}

export function isTurnstileHostAllowed(hostname, allowedConfig) {
  if (!hostname) return false;
  const normalized = String(hostname).trim().toLowerCase();
  const allowed = splitCsv(allowedConfig, DEFAULT_TURNSTILE_HOSTS).map(s => s.toLowerCase());
  return allowed.includes(normalized);
}

function corsHeaders(origin, allowedConfig) {
  const headers = {
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
  if (isOriginAllowed(origin, allowedConfig)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function jsonResponse(payload, status, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}

function bytesToBase64(bytes) {
  // Prefer runtime C++/V8 native Uint8Array.toBase64 when available (Cloudflare Workers) to stay within the 10ms Free CPU budget.
  if (typeof bytes.toBase64 === 'function') return bytes.toBase64();
  return Buffer.from(bytes).toString('base64');
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}

function asciiSlug(value) {
  const slug = String(value || '').toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 24);
  return slug || 'skin';
}

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'blue-whale-wardrobe-worker',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

async function verifyTurnstile({ token, secret, remoteIp, allowedHosts, fetchImpl }) {
  if (!token) return { ok: false, error: '请先完成人机验证后再提交。' };
  const form = new URLSearchParams({ secret, response: token });
  if (remoteIp && remoteIp !== 'unknown') form.set('remoteip', remoteIp);
  const res = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form,
  });
  if (!res.ok) return { ok: false, error: '人机验证服务暂时不可用，请稍后重试或改用 GitHub 手动投稿。' };
  const outcome = await res.json();
  if (!outcome.success) return { ok: false, error: '人机验证未通过，请重新勾选验证后再试。' };
  if (!isTurnstileHostAllowed(outcome.hostname, allowedHosts)) {
    return { ok: false, error: '验证来源域名未获授权，请通过官方图鉴页面提交。' };
  }
  return { ok: true };
}

async function ensureSubmissionsBranch({ repo, branch, token, fetchImpl }) {
  const refUrl = `https://api.github.com/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`;
  const headers = githubHeaders(token);
  const existing = await fetchImpl(refUrl, { headers });
  if (existing.ok) return;
  if (existing.status !== 404) {
    throw new Error(`检查投稿暂存分支失败（HTTP ${existing.status}）。`);
  }

  // Create an isolated orphan branch with an initial README so GitHub's git/trees API accepts the root tree.
  const treeRes = await fetchImpl(`https://api.github.com/repos/${repo}/git/trees`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      tree: [
        {
          path: 'README.md',
          mode: '100644',
          type: 'blob',
          content: '# 皮肤投稿暂存分支\n\n此分支仅用于暂存网页直传投稿的设定图原图，与主分支源码相互独立。\n',
        },
      ],
    }),
  });
  if (!treeRes.ok) throw new Error(`初始化暂存目录树失败（HTTP ${treeRes.status}）。`);
  const { sha: treeSha } = await treeRes.json();

  const commitRes = await fetchImpl(`https://api.github.com/repos/${repo}/git/commits`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message: '初始化皮肤投稿暂存分支', tree: treeSha, parents: [] }),
  });
  if (!commitRes.ok) throw new Error(`初始化暂存提交失败（HTTP ${commitRes.status}）。`);
  const { sha: commitSha } = await commitRes.json();

  const createRefRes = await fetchImpl(`https://api.github.com/repos/${repo}/git/refs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commitSha }),
  });
  if (!createRefRes.ok && createRefRes.status !== 422) {
    throw new Error(`创建暂存分支失败（HTTP ${createRefRes.status}）。`);
  }
}

async function parseAndValidateSubmission(formData) {
  let formFields;
  try {
    formFields = JSON.parse(String(formData.get('payload') || ''));
    if (!formFields || typeof formFields !== 'object') throw new Error('invalid');
  } catch {
    return { error: '投稿文字资料解析失败，请检查表单内容。' };
  }

  const file = formData.get('image');
  if (!file || typeof file.arrayBuffer !== 'function') {
    return { error: '请先选择一张设定图原图后再提交。' };
  }
  if (file.size > MAX_UPLOAD_BYTES || file.size < 24) {
    return { error: '图片需为有效文件，且大小不超过 10 MB。' };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  let dims;
  try {
    dims = validateImageBuffer(bytes, {
      maxUploadBytes: MAX_UPLOAD_BYTES,
      maxPixels: MAX_PIXELS,
      mimeType: cleanText(file.type, 40),
    });
  } catch (err) {
    return { error: err.message };
  }

  const sha256 = await sha256Hex(bytes);
  const ext = EXT_BY_MIME[dims.mimeType] || 'png';
  const imageMeta = {
    name: cleanText(file.name || `reference.${ext}`, 120),
    size: bytes.length,
    width: dims.width,
    height: dims.height,
    sha256,
  };

  const problem = validateSubmission(formFields, imageMeta);
  if (problem) return { error: problem };

  const data = submissionData(formFields, imageMeta);
  data.name = data.name.replace(/[\r\n]+/gu, ' ');
  data.author = data.author.replace(/[\r\n]+/gu, ' ');
  return { data, bytes, ext, sha256 };
}

async function publishSubmissionToGithub({ repo, branch, token, data, bytes, ext, sha256, fetchImpl, now }) {
  await ensureSubmissionsBranch({ repo, branch, token, fetchImpl });

  const ym = now.toISOString().slice(0, 7).replace('-', '');
  const stamp = now.getTime().toString(36);
  const filePath = `submissions/${ym}/${stamp}-${sha256.slice(0, 8)}-${asciiSlug(data.name)}/reference.${ext}`;
  const headers = githubHeaders(token);

  const uploadRes = await fetchImpl(`https://api.github.com/repos/${repo}/contents/${filePath}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message: `暂存共创皮肤投稿：${data.name}`,
      content: bytesToBase64(bytes),
      branch,
    }),
  });
  if (!uploadRes.ok) {
    throw new Error(`上传原图到暂存分支失败（HTTP ${uploadRes.status}）。`);
  }
  const uploadJson = await uploadRes.json();
  const commitSha = uploadJson.commit?.sha || branch;
  const rawUrl = `https://raw.githubusercontent.com/${repo}/${commitSha}/${filePath}`;

  const issueRes = await fetchImpl(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: `[皮肤投稿] ${data.name}`,
      body: submissionMarkdown(data, { imageUrl: rawUrl }),
      labels: ['皮肤投稿'],
    }),
  });
  if (!issueRes.ok) {
    throw new Error(`创建投稿 Issue 失败（HTTP ${issueRes.status}）。`);
  }
  const issueJson = await issueRes.json();
  return {
    ok: true,
    issueNumber: issueJson.number,
    issueUrl: issueJson.html_url,
    imageUrl: rawUrl,
    name: data.name,
  };
}

export async function handleSubmitRequest(request, env, { fetchImpl = fetch, now = new Date() } = {}) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin') || '';
  const allowedOrigins = env.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(',');
  const cors = corsHeaders(origin, allowedOrigins);

  if (request.method === 'GET' && url.pathname === '/health') {
    return jsonResponse({ ok: true, service: 'blue-whale-wardrobe-submit' }, 200, cors);
  }
  if (origin && !isOriginAllowed(origin, allowedOrigins)) {
    return jsonResponse({ ok: false, error: '当前页面来源未获得直传接口授权。' }, 403, cors);
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  if (request.method !== 'POST' || url.pathname !== '/api/submit') {
    return jsonResponse({ ok: false, error: '不支持的请求方式或接口路径。' }, 405, cors);
  }

  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > MAX_REQUEST_BYTES) {
    return jsonResponse({ ok: false, error: '上传内容过大，请确保原图不超过 10 MB。' }, 413, cors);
  }

  const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (env.RATE_LIMITER && typeof env.RATE_LIMITER.limit === 'function') {
    const { success } = await env.RATE_LIMITER.limit({ key: clientIp });
    if (!success) {
      return jsonResponse({ ok: false, error: '提交太频繁啦，请稍等一分钟后再试。' }, 429, { ...cors, 'Retry-After': '60' });
    }
  }

  if (!env.GITHUB_TOKEN || !env.TURNSTILE_SECRET_KEY) {
    return jsonResponse({ ok: false, error: '直传服务尚未配置完成，请改用 GitHub 手动附图投稿。' }, 503, cors);
  }
  const repository = env.GITHUB_REPOSITORY || 'Fightingshine/blue-whale-wardrobe';
  if (!/^[\w.-]+\/[\w.-]+$/u.test(repository)) {
    return jsonResponse({ ok: false, error: '仓库配置格式异常。' }, 500, cors);
  }

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return jsonResponse({ ok: false, error: '投稿表单格式无效，请刷新页面重试。' }, 400, cors);
  }

  const verify = await verifyTurnstile({
    token: String(formData.get('cf-turnstile-response') || '').trim(),
    secret: env.TURNSTILE_SECRET_KEY,
    remoteIp: clientIp,
    allowedHosts: env.TURNSTILE_ALLOWED_HOSTS || DEFAULT_TURNSTILE_HOSTS.join(','),
    fetchImpl,
  });
  if (!verify.ok) {
    return jsonResponse({ ok: false, error: verify.error }, 403, cors);
  }

  const parsed = await parseAndValidateSubmission(formData);
  if (parsed.error) {
    return jsonResponse({ ok: false, error: parsed.error }, 400, cors);
  }

  try {
    const result = await publishSubmissionToGithub({
      repo: repository,
      branch: env.SUBMISSIONS_BRANCH || 'submissions',
      token: env.GITHUB_TOKEN,
      ...parsed,
      fetchImpl,
      now,
    });
    return jsonResponse(result, 201, cors);
  } catch (err) {
    return jsonResponse({
      ok: false,
      error: `${err.message || '直传处理失败'} 你也可以点击下方按钮改用 GitHub 手动投稿。`,
    }, 502, cors);
  }
}
