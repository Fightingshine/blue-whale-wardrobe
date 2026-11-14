import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractImageUrls, extractSubmissionJson } from '../scripts/sync-approved-issues.mjs';
import { handleSubmitRequest, isOriginAllowed, isTurnstileHostAllowed } from '../worker/src/submit-handler.js';

const pngBytes = readFileSync(new URL('../public/skins/original/reference.png', import.meta.url));
const baseEnv = {
  GITHUB_REPOSITORY: 'Fightingshine/blue-whale-wardrobe',
  SUBMISSIONS_BRANCH: 'submissions',
  GITHUB_TOKEN: 'test-github-token',
  TURNSTILE_SECRET_KEY: 'test-turnstile-secret',
  ALLOWED_ORIGINS: 'https://blue-chubby-whale.cyou,https://www.blue-chubby-whale.cyou,https://fightingshine.github.io,http://127.0.0.1:*,http://localhost:*',
  TURNSTILE_ALLOWED_HOSTS: 'blue-chubby-whale.cyou,www.blue-chubby-whale.cyou,fightingshine.github.io,127.0.0.1,localhost',
};

function makeSubmitRequest({
  origin = 'https://blue-chubby-whale.cyou',
  token = 'ok-token',
  bytes = pngBytes,
  fileName = 'campus.png',
  mimeType = 'image/png',
  payload = {
    name: '学院风大肥鱼',
    author: '共创同学',
    keywords: '学院风、校园装',
    designStyles: ['campus'],
    designDetails: ['hair'],
    description: '深蓝水手服与白色百褶裙。',
    sourceType: 'original',
    usageScopes: ['gallery'],
    sourceNote: '',
    rotation: true,
    confirmed: true,
  },
  contentLength,
} = {}) {
  const form = new FormData();
  if (bytes !== null) form.set('image', new File([bytes], fileName, { type: mimeType }));
  if (payload !== null) form.set('payload', typeof payload === 'string' ? payload : JSON.stringify(payload));
  if (token !== null) form.set('cf-turnstile-response', token);
  const headers = new Headers({ Origin: origin, 'CF-Connecting-IP': '203.0.113.10' });
  if (contentLength !== undefined) headers.set('Content-Length', String(contentLength));
  return new Request('https://submit.example.workers.dev/api/submit', { method: 'POST', headers, body: form });
}

test('Origin 与 Turnstile 主机名白名单校验', () => {
  assert.equal(isOriginAllowed('https://blue-chubby-whale.cyou', baseEnv.ALLOWED_ORIGINS), true);
  assert.equal(isOriginAllowed('https://www.blue-chubby-whale.cyou', baseEnv.ALLOWED_ORIGINS), true);
  assert.equal(isOriginAllowed('https://fightingshine.github.io', baseEnv.ALLOWED_ORIGINS), true);
  assert.equal(isOriginAllowed('http://127.0.0.1:24173', baseEnv.ALLOWED_ORIGINS), true);
  assert.equal(isOriginAllowed('https://evil.example', baseEnv.ALLOWED_ORIGINS), false);
  assert.equal(isTurnstileHostAllowed('blue-chubby-whale.cyou', baseEnv.TURNSTILE_ALLOWED_HOSTS), true);
  assert.equal(isTurnstileHostAllowed('fightingshine.github.io', baseEnv.TURNSTILE_ALLOWED_HOSTS), true);
  assert.equal(isTurnstileHostAllowed('evil.example', baseEnv.TURNSTILE_ALLOWED_HOSTS), false);
});

test('拦截非授权 Origin 的预检与上传请求', async () => {
  const preflight = await handleSubmitRequest(new Request('https://submit.example.workers.dev/api/submit', {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.example' },
  }), baseEnv);
  assert.equal(preflight.status, 403);

  const postRes = await handleSubmitRequest(makeSubmitRequest({ origin: 'https://evil.example' }), baseEnv);
  assert.equal(postRes.status, 403);
});

test('拦截超大 Content-Length 与单 IP 触发限流', async () => {
  const bigRes = await handleSubmitRequest(makeSubmitRequest({ contentLength: 13 * 1024 * 1024 }), baseEnv);
  assert.equal(bigRes.status, 413);

  const rateEnv = { ...baseEnv, RATE_LIMITER: { limit: async () => ({ success: false }) } };
  const limitRes = await handleSubmitRequest(makeSubmitRequest(), rateEnv);
  assert.equal(limitRes.status, 429);
  assert.match((await limitRes.json()).error, /频繁/u);
});

test('Turnstile 验证失败或域名不匹配时拒绝写入 GitHub', async () => {
  let calledGithub = false;
  const badVerify = async url => {
    if (String(url).includes('siteverify')) {
      return new Response(JSON.stringify({ success: true, hostname: 'attacker.example' }), { status: 200 });
    }
    calledGithub = true;
    return new Response('{}', { status: 500 });
  };
  const res = await handleSubmitRequest(makeSubmitRequest(), baseEnv, { fetchImpl: badVerify });
  assert.equal(res.status, 403);
  assert.equal(calledGithub, false);
});

test('伪装图片文件头无法通过服务端检查', async () => {
  const okVerify = async url => {
    if (String(url).includes('siteverify')) {
      return new Response(JSON.stringify({ success: true, hostname: 'fightingshine.github.io' }), { status: 200 });
    }
    throw new Error('不应请求 GitHub');
  };
  const res = await handleSubmitRequest(
    makeSubmitRequest({ bytes: new TextEncoder().encode('<svg/>'), fileName: 'bad.png' }),
    baseEnv,
    { fetchImpl: okVerify },
  );
  assert.equal(res.status, 400);
});

test('完整直传可初始化 submissions 分支、上传原图并创建兼容自动收录脚本的 Issue', async () => {
  const calls = [];
  let createdIssuePayload = null;
  const mockFetch = async (url, init = {}) => {
    const target = String(url);
    calls.push({ method: init.method || 'GET', target });
    if (target.includes('siteverify')) {
      return new Response(JSON.stringify({ success: true, hostname: 'blue-chubby-whale.cyou' }), { status: 200 });
    }
    if (target.endsWith('/git/ref/heads/submissions')) {
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
    }
    if (target.endsWith('/git/trees')) {
      const body = JSON.parse(init.body);
      // GitHub REST API rejects an empty tree array with HTTP 422 "Invalid tree info".
      if (!Array.isArray(body.tree) || body.tree.length === 0) {
        return new Response(JSON.stringify({ message: 'Invalid tree info' }), { status: 422 });
      }
      assert.equal(body.tree[0].path, 'README.md');
      assert.equal(body.tree[0].mode, '100644');
      assert.equal(body.tree[0].type, 'blob');
      assert.ok(typeof body.tree[0].content === 'string' && body.tree[0].content.length > 0);
      return new Response(JSON.stringify({ sha: 'tree_init_sha' }), { status: 201 });
    }
    if (target.endsWith('/git/commits')) {
      return new Response(JSON.stringify({ sha: 'init_commit_sha' }), { status: 201 });
    }
    if (target.endsWith('/git/refs')) {
      return new Response(JSON.stringify({ ref: 'refs/heads/submissions' }), { status: 201 });
    }
    if (target.includes('/contents/submissions/')) {
      const body = JSON.parse(init.body);
      assert.equal(body.branch, 'submissions');
      assert.ok(body.content.length > 100);
      return new Response(JSON.stringify({ commit: { sha: 'uploaded_commit_sha_1234' } }), { status: 201 });
    }
    if (target.endsWith('/issues')) {
      createdIssuePayload = JSON.parse(init.body);
      return new Response(JSON.stringify({ number: 88, html_url: 'https://github.com/Fightingshine/blue-whale-wardrobe/issues/88' }), { status: 201 });
    }
    throw new Error(`意外请求: ${target}`);
  };

  const rateEnv = { ...baseEnv, RATE_LIMITER: { limit: async ({ key }) => ({ success: key === '203.0.113.10' }) } };
  const res = await handleSubmitRequest(makeSubmitRequest(), rateEnv, { fetchImpl: mockFetch, now: new Date('2026-11-13T12:00:00Z') });
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.issueNumber, 88);
  assert.equal(data.issueUrl, 'https://github.com/Fightingshine/blue-whale-wardrobe/issues/88');
  assert.ok(data.imageUrl.startsWith('https://raw.githubusercontent.com/Fightingshine/blue-whale-wardrobe/uploaded_commit_sha_1234/submissions/'));
  assert.equal(createdIssuePayload.title, '[皮肤投稿] 学院风大肥鱼');
  assert.deepEqual(createdIssuePayload.labels, ['皮肤投稿']);

  const urls = extractImageUrls({ body: createdIssuePayload.body });
  assert.deepEqual(urls, [data.imageUrl]);
  const parsedJson = extractSubmissionJson(createdIssuePayload.body);
  assert.equal(parsedJson.schema, 'whale-skin-submission/v1');
  assert.equal(parsedJson.name, '学院风大肥鱼');
});
