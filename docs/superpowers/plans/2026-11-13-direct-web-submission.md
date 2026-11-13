# 网页直传投稿（Cloudflare Workers + Turnstile）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为「大肥鱼衣橱」新增基于 Cloudflare Workers + Turnstile 的网页内直接投稿通道，使同学无需登录或跳转 GitHub 即可上传三视图并自动生成带图预览的 `皮肤投稿` Issue，审核打 `已收录` 标签后无缝接入现有自动发布流程。

**Architecture:** 前端在配置了 `VITE_SUBMIT_API_URL` 与 `VITE_TURNSTILE_SITE_KEY` 时自动启用直传模式（未配置时保持原有「去 GitHub 附图投稿」兜底）；新增独立目录 `worker/` 承载 Cloudflare Worker 接收端，复用 `src/domain.js` 纯函数校验图片字节与字段、验证 Turnstile `siteverify` 与 `[[ratelimits]]` 限流、通过 V8 原生 `Uint8Array.toBase64()` 将原图写入仓库隔离暂存分支 `submissions` 并自动创建带不可变 Commit SHA 图片链接的 `皮肤投稿` Issue。

**Tech Stack:** React 19、Vite 8、Cloudflare Workers（`wrangler.toml` + `[[ratelimits]]`）、Cloudflare Turnstile、GitHub REST API、Node 原生测试（`node --test`）、Playwright

---

### 文件职责映射

- 修改：`src/domain.js` — 抽出 `validateImageBuffer`（浏览器与 Worker 共用的字节级图检），扩展 `submissionMarkdown(data, { imageUrl })` 支持嵌入直传原图链接
- 修改：`src/site.js` — 读取 `VITE_SUBMIT_API_URL` / `VITE_TURNSTILE_SITE_KEY` 并导出 `getDirectSubmitConfig` 与 `isDirectSubmitEnabled`
- 修改：`src/App.jsx` 与 `src/styles.css` — 投稿弹窗支持 Turnstile 挂载、直传提交、`multipart/form-data` 上传、成功后无跳转回执卡与失败兜底提示
- 修改：`.github/workflows/pages.yml` — 在 `npm run build` 传入非敏感仓库变量 `VITE_SUBMIT_API_URL` 与 `VITE_TURNSTILE_SITE_KEY`
- 新增：`worker/src/submit-handler.js`、`worker/src/index.js`、`worker/wrangler.toml`、`worker/README.md` — Worker 限流、CORS、Turnstile 验签、强校验与 GitHub 暂存分支 + 建 Issue 逻辑
- 测试：`tests/domain.test.mjs`、`tests/worker.test.mjs`、`tests/e2e/site.spec.js` — 单元、集成（含兼容 `sync-approved-issues.mjs` 解析验证）与 Playwright 端到端回归测试
- 文档：`README.md`、`worker/README.md` — 补充网页直传配置与 Cloudflare Workers 部署指引

---

### Task 1: 领域公共校验与站点直传配置（`src/domain.js`、`src/site.js`）

**Files:**
- Modify: `src/domain.js:166-226`
- Modify: `src/site.js:1-12`
- Test: `tests/domain.test.mjs`

- [ ] **Step 1: 在 `tests/domain.test.mjs` 添加失败测试用例（TDD Red）**

在 `tests/domain.test.mjs` 末尾追加对 `validateImageBuffer`、`submissionMarkdown(..., { imageUrl })` 以及 `getDirectSubmitConfig` / `isDirectSubmitEnabled` 的测试：

```js
import {
  cleanText,
  composeAttribution,
  composeDescription,
  filterSkins,
  imageDimensions,
  issueUrl,
  keywordsFrom,
  sniffImage,
  submissionData,
  submissionMarkdown,
  validateImageBuffer,
  validateSubmission,
} from '../src/domain.js';
import { getDirectSubmitConfig, isDirectSubmitEnabled } from '../src/site.js';
```

追加测试：

```js
test('validateImageBuffer 可识别真实 PNG 并拒绝伪装格式与过小尺寸', () => {
  const realPng = readFileSync(new URL('../public/skins/original/reference.png', import.meta.url));
  const ok = validateImageBuffer(realPng, { mimeType: 'image/png' });
  assert.equal(ok.width, 2048);
  assert.equal(ok.height, 1143);
  assert.throws(() => validateImageBuffer(new TextEncoder().encode('<svg/>'), { mimeType: 'image/svg+xml' }), /不支持 SVG/u);
  assert.throws(() => validateImageBuffer(new Uint8Array(64), { mimeType: 'image/png' }), /格式不一致/u);
});

test('submissionMarkdown 传入已上传 HTTPS 原图链接时直接嵌入预览图', () => {
  const rawUrl = 'https://raw.githubusercontent.com/Fightingshine/blue-whale-wardrobe/abc123/submissions/202611/ref/reference.png';
  const md = submissionMarkdown(submissionData(form, image), { imageUrl: rawUrl });
  assert.ok(md.includes(`![学院风大肥鱼 三视图原图](${rawUrl})`));
  assert.doesNotMatch(md, /【在这里附上图片】/u);
  assert.ok(md.includes('"schema": "whale-skin-submission/v1"'));
});

test('直传配置默认关闭且在两项齐备时启用', () => {
  assert.equal(isDirectSubmitEnabled({ submitApiUrl: '', turnstileSiteKey: '' }), false);
  assert.equal(isDirectSubmitEnabled({ submitApiUrl: 'https://example.workers.dev', turnstileSiteKey: '' }), false);
  assert.equal(isDirectSubmitEnabled({ submitApiUrl: 'https://example.workers.dev', turnstileSiteKey: '1x00000000000000000000AA' }), true);
  assert.equal(typeof getDirectSubmitConfig().submitApiUrl, 'string');
});
```

- [ ] **Step 2: 运行单元测试确认失败**

Run: `npm test`
Expected: FAIL (`does not provide an export named 'validateImageBuffer'` / `'getDirectSubmitConfig'`)

- [ ] **Step 3: 实现 `src/domain.js` 与 `src/site.js`**

在 `src/domain.js` 扩展 `submissionMarkdown(data, options = {})`、抽离 `validateImageBuffer(bytes, options)` 并让 `readLocalImage` 复用它：

```js
export function submissionMarkdown(data, options = {}) {
  const styles = data.designTopics?.styles?.join('、') || (data.designTopics?.note ? '见补充想法' : '未额外填写（见三视图原图）');
  const sourceType = data.sourceTopics?.type || (data.sourceTopics?.note ? '见补充备注' : '未额外填写（可在 Issue 中补充）');
  const usages = data.sourceTopics?.usages?.join('、') || '未额外勾选';
  const safeName = data.name.replace(/[\r\n]/gu, ' ');
  const imageUrl = typeof options.imageUrl === 'string' && options.imageUrl.startsWith('https://') ? options.imageUrl : '';
  const imageSection = imageUrl
    ? `![${safeName} 三视图原图](${imageUrl})\n\n> 该投稿通过网页直接上传提交，原图已校验并暂存；维护者审核确认后打上 \`已收录\` 标签即可自动发布至图鉴。`
    : `**最后一步：把刚才选择的三视图原图拖到下方，等图片上传完成后点提交就好啦！**\n\n【在这里附上图片】`;
  return `<!-- whale-skin-submission:v1 -->
## 皮肤投稿：${safeName}

${imageSection}

### 投稿速览
- **作者署名**：${data.author}
- **触发关键词**：${data.keywords.join('、')}
- **设计说明**：${styles}
- **素材来源**：${sourceType}
- **开放范围**：${usages}
- **日报轮换**：${data.requestedDailyRotation ? '希望加入每日穿搭轮换' : '先收录到衣橱图鉴'}

<details>
<summary>完整结构化投稿资料（供维护者收录使用）</summary>

\`\`\`json
${JSON.stringify(data, null, 2)}
\`\`\`

</details>

- [x] 同意将这套三视图公开投稿至 GitHub，原图版权归创作者所有。`;
}
```

添加 `validateImageBuffer` 并重写 `readLocalImage`：

```js
export function validateImageBuffer(bytes, { maxUploadBytes = 10 * 1024 * 1024, maxPixels = 24_000_000, mimeType = '' } = {}) {
  if (mimeType && !IMAGE_TYPES.has(mimeType)) {
    throw new Error('暂仅支持 PNG、JPG 或 WebP 图片（不支持 SVG、GIF 或压缩包）。');
  }
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length > maxUploadBytes || b.length < 24) {
    throw new Error('图片需为有效文件，且大小不超过 10 MB。');
  }
  const actualType = sniffImage(b);
  if (mimeType && actualType !== mimeType) {
    throw new Error('文件内容与图片格式不一致，请换一张重新导出的图片试试。');
  }
  if (!actualType || !IMAGE_TYPES.has(actualType)) {
    throw new Error('暂仅支持 PNG、JPG 或 WebP 图片（不支持 SVG、GIF 或压缩包）。');
  }
  const header = imageDimensions(b);
  if (header.width < 1 || header.height < 1 || header.width > 10000 || header.height > 10000 || header.width * header.height > maxPixels) {
    throw new Error('图片分辨率过高，建议控制在 2400 万像素以内。');
  }
  if (header.width < 600 || header.height < 300 || header.width < header.height) {
    throw new Error('三视图需要是横向拼图（宽大于高，且至少 600 × 300 像素）。');
  }
  return { mimeType: actualType, width: header.width, height: header.height, bytes: b.length };
}

export async function readLocalImage(file, limits) {
  if (!file || !IMAGE_TYPES.has(file.type)) throw new Error('暂仅支持 PNG、JPG 或 WebP 图片（不支持 SVG、GIF 或压缩包）。');
  if (file.size > limits.maxUploadBytes || file.size < 24) throw new Error('图片需为有效文件，且大小不超过 10 MB。');
  const bytes = await file.arrayBuffer();
  validateImageBuffer(bytes, { maxUploadBytes: limits.maxUploadBytes, maxPixels: limits.maxPixels, mimeType: file.type });
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('这张图片暂时无法读取，可以重新导出 PNG 或 JPG 再试一次。'); });
  const { width, height } = bitmap;
  bitmap.close();
  if (width > 10000 || height > 10000 || width * height > limits.maxPixels) throw new Error('图片分辨率过高，建议控制在 2400 万像素以内。');
  if (width < 600 || height < 300 || width < height) throw new Error('三视图需要是横向拼图（宽大于高，且至少 600 × 300 像素）。');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
  return { name: file.name, size: file.size, width, height, sha256, url: URL.createObjectURL(file) };
}
```

在 `src/site.js` 添加配置导出：

```js
const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {};

function normalizeApiUrl(raw) {
  return String(raw || '').trim().replace(/\/+$/u, '');
}

export const SITE = Object.freeze({
  name: '大肥鱼衣橱',
  owner: 'Fightingshine',
  repository: 'blue-whale-wardrobe',
  github: 'https://github.com/Fightingshine/blue-whale-wardrobe',
  maxUploadBytes: 10 * 1024 * 1024,
  maxPixels: 24_000_000,
  submitApiUrl: normalizeApiUrl(env.VITE_SUBMIT_API_URL),
  turnstileSiteKey: String(env.VITE_TURNSTILE_SITE_KEY || '').trim(),
});

export function getDirectSubmitConfig() {
  if (typeof window !== 'undefined') {
    const host = window.location?.hostname;
    const testOverride = (host === '127.0.0.1' || host === 'localhost') ? window.__WARDROBE_TEST_CONFIG__ : null;
    if (testOverride && typeof testOverride === 'object') {
      return {
        submitApiUrl: normalizeApiUrl(testOverride.submitApiUrl ?? SITE.submitApiUrl),
        turnstileSiteKey: String(testOverride.turnstileSiteKey ?? SITE.turnstileSiteKey).trim(),
      };
    }
  }
  return {
    submitApiUrl: SITE.submitApiUrl,
    turnstileSiteKey: SITE.turnstileSiteKey,
  };
}

export function isDirectSubmitEnabled(config = getDirectSubmitConfig()) {
  return Boolean(config?.submitApiUrl && config?.turnstileSiteKey);
}

export function assetUrl(relative) {
  return new URL(`${import.meta.env.BASE_URL}${relative}`, document.baseURI).href;
}
```

- [ ] **Step 4: 运行校验与测试确认通过**

Run: `npm run validate && npm test`
Expected: PASS（全部单元测试通过）

- [ ] **Step 5: 中文提交 Task 1**

```powershell
git add src/domain.js src/site.js tests/domain.test.mjs
git commit -m "扩展领域图片校验与直传配置，支持内嵌原图投稿说明"
```

---

### Task 2: Cloudflare Worker 投稿接收端与单元测试（`worker/` + `tests/worker.test.mjs`）

**Files:**
- Create: `worker/src/submit-handler.js`
- Create: `worker/src/index.js`
- Create: `worker/wrangler.toml`
- Create: `tests/worker.test.mjs`

- [ ] **Step 1: 编写失败的 Worker 单元测试 `tests/worker.test.mjs`（TDD Red）**

```js
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
  ALLOWED_ORIGINS: 'https://fightingshine.github.io,http://127.0.0.1:*,http://localhost:*',
  TURNSTILE_ALLOWED_HOSTS: 'fightingshine.github.io,127.0.0.1,localhost',
};

function makeSubmitRequest({
  origin = 'https://fightingshine.github.io',
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
  assert.equal(isOriginAllowed('https://fightingshine.github.io', baseEnv.ALLOWED_ORIGINS), true);
  assert.equal(isOriginAllowed('http://127.0.0.1:24173', baseEnv.ALLOWED_ORIGINS), true);
  assert.equal(isOriginAllowed('https://evil.example', baseEnv.ALLOWED_ORIGINS), false);
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
  const res = await handleSubmitRequest(makeSubmitRequest({ bytes: new TextEncoder().encode('<svg/>'), fileName: 'bad.png' }), baseEnv, { fetchImpl: okVerify });
  assert.equal(res.status, 400);
});

test('完整直传可初始化 submissions 分支、上传原图并创建兼容自动收录脚本的 Issue', async () => {
  const calls = [];
  let createdIssuePayload = null;
  const mockFetch = async (url, init = {}) => {
    const target = String(url);
    calls.push({ method: init.method || 'GET', target });
    if (target.includes('siteverify')) {
      return new Response(JSON.stringify({ success: true, hostname: 'fightingshine.github.io' }), { status: 200 });
    }
    if (target.endsWith('/git/ref/heads/submissions')) {
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
    }
    if (target.endsWith('/git/trees')) {
      return new Response(JSON.stringify({ sha: 'tree_empty_sha' }), { status: 201 });
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

  // 验证与既有 sync-approved-issues.mjs 解析器完全兼容
  const urls = extractImageUrls({ body: createdIssuePayload.body });
  assert.deepEqual(urls, [data.imageUrl]);
  const parsedJson = extractSubmissionJson(createdIssuePayload.body);
  assert.equal(parsedJson.schema, 'whale-skin-submission/v1');
  assert.equal(parsedJson.name, '学院风大肥鱼');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/worker.test.mjs`
Expected: FAIL (`Cannot find module '../worker/src/submit-handler.js'`)

- [ ] **Step 3: 创建 `worker/src/submit-handler.js`、`worker/src/index.js`、`worker/wrangler.toml`**

编写 `worker/src/submit-handler.js`：

```js
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
  const rules = splitCsv(allowedConfig, ['https://fightingshine.github.io']);
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
  const allowed = splitCsv(allowedConfig, ['fightingshine.github.io', '127.0.0.1', 'localhost']).map(s => s.toLowerCase());
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

  const treeRes = await fetchImpl(`https://api.github.com/repos/${repo}/git/trees`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ tree: [] }),
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

export async function handleSubmitRequest(request, env, { fetchImpl = fetch, now = new Date() } = {}) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin') || '';
  const allowedOrigins = env.ALLOWED_ORIGINS || 'https://fightingshine.github.io';
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
  const branch = env.SUBMISSIONS_BRANCH || 'submissions';

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return jsonResponse({ ok: false, error: '投稿表单格式无效，请刷新页面重试。' }, 400, cors);
  }

  const turnstileToken = String(formData.get('cf-turnstile-response') || '').trim();
  const verify = await verifyTurnstile({
    token: turnstileToken,
    secret: env.TURNSTILE_SECRET_KEY,
    remoteIp: clientIp,
    allowedHosts: env.TURNSTILE_ALLOWED_HOSTS || 'fightingshine.github.io,127.0.0.1,localhost',
    fetchImpl,
  });
  if (!verify.ok) {
    return jsonResponse({ ok: false, error: verify.error }, 403, cors);
  }

  const rawPayload = formData.get('payload');
  let formFields;
  try {
    formFields = JSON.parse(String(rawPayload || ''));
    if (!formFields || typeof formFields !== 'object') throw new Error('invalid');
  } catch {
    return jsonResponse({ ok: false, error: '投稿文字资料解析失败，请检查表单内容。' }, 400, cors);
  }

  const file = formData.get('image');
  if (!file || typeof file.arrayBuffer !== 'function') {
    return jsonResponse({ ok: false, error: '请先选择一张三视图原图后再提交。' }, 400, cors);
  }
  if (file.size > MAX_UPLOAD_BYTES || file.size < 24) {
    return jsonResponse({ ok: false, error: '图片需为有效文件，且大小不超过 10 MB。' }, 400, cors);
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
    return jsonResponse({ ok: false, error: err.message }, 400, cors);
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
  if (problem) {
    return jsonResponse({ ok: false, error: problem }, 400, cors);
  }

  const data = submissionData(formFields, imageMeta);
  const ym = now.toISOString().slice(0, 7).replace('-', '');
  const stamp = now.getTime().toString(36);
  const filePath = `submissions/${ym}/${stamp}-${sha256.slice(0, 8)}-${asciiSlug(data.name)}/reference.${ext}`;

  try {
    await ensureSubmissionsBranch({ repo: repository, branch, token: env.GITHUB_TOKEN, fetchImpl });

    const uploadRes = await fetchImpl(`https://api.github.com/repos/${repository}/contents/${filePath}`, {
      method: 'PUT',
      headers: githubHeaders(env.GITHUB_TOKEN),
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
    const rawUrl = `https://raw.githubusercontent.com/${repository}/${commitSha}/${filePath}`;

    const issueRes = await fetchImpl(`https://api.github.com/repos/${repository}/issues`, {
      method: 'POST',
      headers: githubHeaders(env.GITHUB_TOKEN),
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

    return jsonResponse({
      ok: true,
      issueNumber: issueJson.number,
      issueUrl: issueJson.html_url,
      imageUrl: rawUrl,
      name: data.name,
    }, 201, cors);
  } catch (err) {
    return jsonResponse({
      ok: false,
      error: `${err.message || '直传处理失败'} 你也可以点击下方按钮改用 GitHub 手动投稿。`,
    }, 502, cors);
  }
}
```

创建 `worker/src/index.js`：

```js
import { handleSubmitRequest } from './submit-handler.js';

export default {
  async fetch(request, env) {
    return handleSubmitRequest(request, env);
  },
};
```

创建 `worker/wrangler.toml`：

```toml
name = "blue-whale-wardrobe-submit"
main = "src/index.js"
compatibility_date = "2026-10-01"

[vars]
GITHUB_REPOSITORY = "Fightingshine/blue-whale-wardrobe"
SUBMISSIONS_BRANCH = "submissions"
ALLOWED_ORIGINS = "https://fightingshine.github.io,http://127.0.0.1:*,http://localhost:*"
TURNSTILE_ALLOWED_HOSTS = "fightingshine.github.io,127.0.0.1,localhost"

[[ratelimits]]
name = "RATE_LIMITER"
namespace_id = "1001"

[ratelimits.simple]
limit = 3
period = 60
```

- [ ] **Step 4: 运行校验与单元测试确认通过**

Run: `npm run validate && npm test`
Expected: PASS（`worker.test.mjs` 与既有全部单元测试全通过）

- [ ] **Step 5: 中文提交 Task 2**

```powershell
git add worker/src/submit-handler.js worker/src/index.js worker/wrangler.toml tests/worker.test.mjs
git commit -m "新增 Cloudflare Worker 网页直传投稿接口与单元测试"
```

---

### Task 3: 前端直传模式、Turnstile 集成与回执视图（`src/App.jsx`、`src/styles.css`）

**Files:**
- Modify: `src/App.jsx:115-205,365-397`
- Modify: `src/styles.css`（新增 `.turnstile-box` 与 `.submission-success` 样式及移动端适配）

- [ ] **Step 1: 在 `tests/e2e/site.spec.js` 添加失败端到端测试（TDD Red）**

添加测试覆盖：
1. 未配置直传时，不加载 Turnstile 且主按钮仍为 `去 GitHub 附图投稿`（现有测试已覆盖）；
2. 当 `127.0.0.1` 注入直传配置并 mock `window.turnstile` 与 `**/api/submit` 时：
   - 弹窗内渲染 Turnstile 验证区域，主按钮为 `直接提交投稿`，保留 `GitHub 手动投稿` 备用入口；
   - 未通过人机验证点击直接提交，显示清晰验证提示；
   - 通过 Turnstile 并提交成功，向 `/api/submit` 发送 `multipart/form-data`（包含 `image`、`payload`、`cf-turnstile-response`），弹窗直接切换为无跳转成功回执视图（含 Issue `#88` 链接），且不调用 `window.open`；
   - 若服务端返回 429/502 错误，显示错误提示，仍可点击 `GitHub 手动投稿` 回退。

- [ ] **Step 2: 实现 `src/App.jsx` 与 `src/styles.css` 支持直传与优雅兜底**

在 `src/App.jsx`：
- 添加轻量辅助 `ensureTurnstileScript()`（单例 Promise 加载 `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit`；若 `window.turnstile` 已存在直接 resolve，防止 E2E mock 或重复加载出错）。
- `Submission` 组件读取 `const directConfig = getDirectSubmitConfig(); const directEnabled = isDirectSubmitEnabled(directConfig);`。
- 用 `fileRef` 保存最近一次选中的原始 `File` 对象，`turnstileContainerRef` / `turnstileWidgetIdRef` 管理 Turnstile 组件渲染、重置与卸载清理。
- 新增 `submitResult` 状态（`{ issueNumber, issueUrl, name }`）与 `submitting` 状态：
  - 提交成功后直接展示 `.submission-success`（显示皮肤名称、`查看提交的 Issue #...` 链接、`继续提交另一套` 与 `完成返回图鉴`）。
  - 表单底部：开启直传时展示 `.turnstile-box` + 对应提示文案；按钮行提供 `下载资料 (JSON)`、`复制投稿说明`、`GitHub 手动投稿`（备用 `type="button"` 调 `openGithub`）及主按钮 `直接提交投稿`（`type="submit"` 调 `submitDirect`）。
- 在 `src/styles.css` 添加 `.turnstile-box`、`.turnstile-hint`、`.submission-success` 等样式并检查 900px / 600px 断点无横向溢出。

- [ ] **Step 3: 运行 E2E 与单元测试确认全通过（TDD Green）**

Run (PowerShell):
```powershell
npm run validate
npm test
npm run build
$env:PW_PORT = "24173"
$env:PW_CHANNEL = "msedge"
npm run test:e2e
```
Expected: PASS（全部单元测试与 18/16 条桌面/手机 Playwright 用例全部通过）

- [ ] **Step 4: 检查桌面与手机渲染截图无溢出或错位**

设置 `$env:QA_DIR` 跑一次截图并用 `read_file` 目检直传成功/表单截图。

- [ ] **Step 5: 中文提交 Task 3**

```powershell
git add src/App.jsx src/styles.css tests/e2e/site.spec.js
git commit -m "前端投稿工作台支持 Cloudflare Turnstile 人机验证与无跳转直传提交"
```

---

### Task 4: 工作流配置与部署文档完善（`.github/workflows/pages.yml`、`worker/README.md`、`README.md`）

**Files:**
- Modify: `.github/workflows/pages.yml`
- Create: `worker/README.md`
- Modify: `README.md`

- [ ] **Step 1: 更新 `.github/workflows/pages.yml` 传入公开 Vite 变量**

在 `.github/workflows/pages.yml` 的 `npm run build` 步骤追加：

```yaml
      - run: npm run build
        env:
          VITE_SUBMIT_API_URL: ${{ vars.VITE_SUBMIT_API_URL }}
          VITE_TURNSTILE_SITE_KEY: ${{ vars.VITE_TURNSTILE_SITE_KEY }}
```

- [ ] **Step 2: 编写 `worker/README.md` 与同步更新 `README.md`**

在 `worker/README.md` 写出从零完成 Cloudflare 登录、创建 Turnstile Widget、配置仓库 Fine-grained PAT、运行 `npx wrangler secret put` 与 `npx wrangler deploy` 以及写入 GitHub Actions Variables 的清晰步骤；同步更新 `README.md` 项目结构与双模式说明。

- [ ] **Step 3: 运行全量验证套件确认零失误**

Run (PowerShell):
```powershell
npm run validate
npm test
npm run build
$env:PW_PORT = "24173"
$env:PW_CHANNEL = "msedge"
npm run test:e2e
```
Expected: PASS（0 失败）

- [ ] **Step 4: 中文提交 Task 4**

```powershell
git add .github/workflows/pages.yml worker/README.md README.md
git commit -m "完善构建变量传递与 Cloudflare Worker 直传部署文档"
```
