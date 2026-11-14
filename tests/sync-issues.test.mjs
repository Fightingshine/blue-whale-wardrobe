import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractImageUrls,
  extractSubmissionJson,
  fetchApprovedIssues,
  isAllowedAttachmentUrl,
  parseIssueMetadata,
  syncApprovedIssuesToDir,
} from '../scripts/sync-approved-issues.mjs';
import { validateCatalog } from '../scripts/catalog.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const publicRoot = path.join(root, 'public');
const pngBytes = readFileSync(path.join(publicRoot, 'skins/original/reference.png'));
const jpgBytes = readFileSync(path.join(publicRoot, 'skins/winter/reference.jpg'));

test('仅允许安全 HTTPS GitHub 附件域名', () => {
  assert.equal(isAllowedAttachmentUrl('https://github.com/user-attachments/assets/abc-123'), true);
  assert.equal(isAllowedAttachmentUrl('https://user-images.githubusercontent.com/1/a.png'), true);
  assert.equal(isAllowedAttachmentUrl('http://github.com/user-attachments/assets/abc'), false);
  assert.equal(isAllowedAttachmentUrl('https://evil.example/a.png'), false);
});

test('从 Issue 正文提取合法图片附件并忽略表情图标', () => {
  const issue = {
    body: '说明文字\n![三视图](https://github.com/user-attachments/assets/1111)\n![坏图](https://evil.example/x.png)',
    body_html: '<p><img class="emoji" src="https://github.githubassets.com/images/icons/emoji/whale.png"><img src="https://private-user-images.githubusercontent.com/2/ref.png"></p>',
  };
  assert.deepEqual(extractImageUrls(issue), [
    'https://github.com/user-attachments/assets/1111',
    'https://private-user-images.githubusercontent.com/2/ref.png',
  ]);
});

test('兼容解析网页表单 JSON 和纯手工 Markdown 模板投稿', () => {
  const jsonBody = `<!-- whale-skin-submission:v1 -->
\`\`\`json
${JSON.stringify({
    schema: 'whale-skin-submission/v1',
    name: '海盐水手装',
    author: '画师同学',
    keywords: ['海盐', '水手装'],
    description: '风格主题：学院制服',
    attribution: '创作者原创设计绘制',
    requestedDailyRotation: true,
  })}
\`\`\``;
  assert.equal(extractSubmissionJson(jsonBody).name, '海盐水手装');
  assert.equal(parseIssueMetadata({ number: 12, title: '[皮肤投稿] 标题', body: jsonBody }).author, '画师同学');

  const manualIssue = {
    number: 13,
    title: '[皮肤投稿] 樱花春游服',
    user: { login: 'spring-author' },
    body: `## 皮肤名称\n樱花春游\n\n## 作者署名\n小樱\n\n## 触发关键词\n春游、樱花风\n\n## 设计说明（选填）\n粉色小披肩配浅蓝裙子。`,
  };
  const parsed = parseIssueMetadata(manualIssue);
  assert.equal(parsed.name, '樱花春游');
  assert.equal(parsed.author, '小樱');
  assert.deepEqual(parsed.keywords, ['春游', '樱花风']);

  const emptyManual = parseIssueMetadata({ number: 14, title: '[皮肤投稿] 卖萌大肥鱼', user: { login: 'u1' }, body: '## 皮肤名称\n卖萌大肥鱼' });
  assert.equal(emptyManual.description, '大肥鱼卖萌');

  const legacyEmptyJson = parseIssueMetadata({
    number: 15,
    title: '[皮肤投稿] 短发大肥鱼',
    body: `\`\`\`json\n${JSON.stringify({ name: '短发大肥鱼', author: 'fighting', keywords: ['短发'], description: '未单独填写设计说明，详见三视图原图。' })}\n\`\`\``,
  });
  assert.equal(legacyEmptyJson.description, '大肥鱼卖萌');
});

test('拉取已收录 Issue 支持跨页不限数量并过滤 Pull Request', async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => ({ number: i + 1, title: `皮肤 ${i + 1}` }));
  page1[50] = { number: 51, pull_request: {} };
  const page2 = [{ number: 101, title: '皮肤 101' }, { number: 102, title: '皮肤 102' }];
  const mockFetch = async url => ({
    ok: true,
    json: async () => (new URL(url).searchParams.get('page') === '1' ? page1 : page2),
  });
  const list = await fetchApprovedIssues({ repository: 'Fightingshine/blue-whale-wardrobe', fetchImpl: mockFetch });
  assert.equal(list.length, 101);
  assert.equal(list.at(-1).number, 102);
});

test('打上「已收录」标签的投稿自动同步进构建目录且无数量限制', async () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'wardrobe-sync-'));
  try {
    cpSync(publicRoot, temp, { recursive: true });
    // 修改部分字节避免与原图 SHA-256 完全一致，同时保留完整有效图片结构
    const customPng = Buffer.from(pngBytes);
    customPng[customPng.length - 1] ^= 0;
    const customJpg = Buffer.concat([jpgBytes, Buffer.from('\n')]);

    const issues = [
      {
        number: 21,
        title: '[皮肤投稿] 星空斗篷大肥鱼',
        html_url: 'https://github.com/Fightingshine/blue-whale-wardrobe/issues/21',
        body: '![three-views](https://github.com/user-attachments/assets/star-21)',
        user: { login: 'alice' },
      },
      {
        // 与原装相同名字但不同图片（用冬装加尾巴字节测试），应自动加 (#22) 避免重名失败
        number: 22,
        title: '[皮肤投稿] 原装大肥鱼',
        html_url: 'https://github.com/Fightingshine/blue-whale-wardrobe/issues/22',
        body: '![three-views](https://github.com/user-attachments/assets/dupname-22)',
        user: { login: 'bob' },
      },
      {
        // 含非图片 SVG 的异常附件应安全跳过，不影响其它皮肤同步
        number: 23,
        title: '[皮肤投稿] 异常图片',
        body: '![bad](https://github.com/user-attachments/assets/bad-23)',
        user: { login: 'carol' },
      },
    ];

    const mockFetch = async url => {
      if (url.includes('/issues?')) return { ok: true, json: async () => issues };
      if (url.endsWith('star-21')) return { ok: true, arrayBuffer: async () => customJpg.buffer.slice(customJpg.byteOffset, customJpg.byteOffset + customJpg.byteLength) };
      if (url.endsWith('dupname-22')) return { ok: true, arrayBuffer: async () => Buffer.concat([jpgBytes, Buffer.from('extra')]).buffer };
      if (url.endsWith('bad-23')) return { ok: true, arrayBuffer: async () => new TextEncoder().encode('<svg/>').buffer };
      return { ok: false, status: 404 };
    };

    const result = await syncApprovedIssuesToDir({ outDir: temp, repository: 'Fightingshine/blue-whale-wardrobe', fetchImpl: mockFetch });
    assert.equal(result.checked, 3);
    assert.equal(result.added, 2);
    assert.equal(result.total, 6);

    const catalog = JSON.parse(readFileSync(path.join(temp, 'skins/catalog.json'), 'utf8'));
    assert.equal(catalog.skins.length, 6);
    assert.equal(validateCatalog(catalog, temp), 6);
    assert.equal(catalog.skins[4].categoryLabel, '共创');
    assert.equal(catalog.skins[5].name, '原装大肥鱼 (#22)');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
