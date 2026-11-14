import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

const catalog = JSON.parse(readFileSync(new URL('../public/skins/catalog.json', import.meta.url), 'utf8'));
const image = { name: 'reference.png', sha256: 'a'.repeat(64), width: 1600, height: 900, size: 10000 };
const form = {
  name: '学院风大肥鱼',
  author: '共创同学',
  keywords: '学院风、校园装',
  designStyles: ['campus'],
  designDetails: ['hair', 'ears-tail'],
  description: '深蓝色校园制服，搭配白衬衫与鲸鱼刺绣。',
  sourceType: 'original',
  usageScopes: ['gallery', 'bot'],
  sourceNote: '',
  rotation: true,
  confirmed: true,
};

test('目录中四套历史皮肤可搜索', () => {
  assert.equal(catalog.skins.length, 4);
  assert.equal(filterSkins(catalog.skins, '冬装', 'all')[0].id, 'winter');
});
test('名称、描述、关键词都能搜索', () => {
  assert.equal(filterSkins(catalog.skins, '针织装', 'all')[0].id, 'sweater');
});
test('分类与搜索组合生效', () => {
  assert.equal(filterSkins(catalog.skins, '冬装', 'pixel').length, 0);
});
test('找不到时返回真实空结果', () => {
  assert.deepEqual(filterSkins(catalog.skins, '不存在的皮肤', 'all'), []);
});
test('关键词合并空白和重复', () => {
  assert.deepEqual(keywordsFrom(' 学院风，校园装、学院风\n'), ['学院风', '校园装']);
});
test('去除控制字符但保留正常中文', () => {
  assert.equal(cleanText('  鲸\x00鱼  '), '鲸鱼');
});
test('设计说明与素材来源选题自动组合出清晰描述', () => {
  const desc = composeDescription(form);
  assert.match(desc, /风格主题：学院制服/u);
  assert.match(desc, /深蓝渐浅蓝长发/u);
  assert.match(desc, /补充想法：深蓝色校园制服/u);
  const attr = composeAttribution(form);
  assert.match(attr, /创作者原创设计绘制/u);
  assert.match(attr, /小蓝鲸画图穿搭参考/u);
});
test('没有图片不能提交', () => {
  assert.match(validateSubmission(form, null), /三视图/u);
});
test('缺少昵称不能提交', () => {
  assert.match(validateSubmission({ ...form, author: '' }, image), /昵称/u);
});
test('设计说明和素材来源均可留空选填并直接通过校验', () => {
  const minimal = {
    name: '极简投稿大肥鱼',
    author: '路过同学',
    keywords: '极简风',
    designStyles: [],
    designDetails: [],
    description: '',
    sourceType: '',
    usageScopes: [],
    sourceNote: '',
    rotation: true,
    confirmed: true,
  };
  assert.equal(validateSubmission(minimal, image), '');
  const data = submissionData(minimal, image);
  assert.equal(data.description, '大肥鱼卖萌');
  assert.ok(data.attribution.length > 0);
  const md = submissionMarkdown(data);
  assert.match(md, /未额外填写/u);
});
test('未勾选提交确认不能提交', () => {
  assert.match(validateSubmission({ ...form, confirmed: false }, image), /确认/u);
});
test('完整选题投稿资料通过校验', () => {
  assert.equal(validateSubmission(form, image), '');
});
test('兼容旧字段格式直接传入的投稿校验', () => {
  const legacyForm = {
    name: '海盐风大肥鱼',
    author: '同学A',
    keywords: '海盐风',
    description: '清爽水手短袖与海盐蓝小披肩设计。',
    source: '本人手绘原创，允许图鉴展示',
    rights: true,
    public: true,
    rotation: true,
  };
  assert.equal(validateSubmission(legacyForm, image), '');
  const data = submissionData(legacyForm, image);
  assert.equal(data.rightsConfirmed, true);
  assert.equal(data.publicSubmissionConfirmed, true);
});
test('投稿JSON不包含本地预览地址', () => {
  const data = submissionData(form, { ...image, url: 'blob:local-preview' });
  assert.ok(!JSON.stringify(data).includes('blob:'));
  assert.equal(data.reference.sha256, 'a'.repeat(64));
});
test('Issue指向真实配置的GitHub仓库并提示拖入原图', () => {
  const data = submissionData(form, image);
  const url = new URL(issueUrl('https://github.com/Fightingshine/blue-whale-wardrobe', data));
  assert.equal(url.pathname, '/Fightingshine/blue-whale-wardrobe/issues/new');
  assert.match(url.searchParams.get('body'), /【在这里附上图片】/u);
});
test('不允许把投稿转发到任意域名', () => {
  assert.throws(() => issueUrl('https://evil.example/owner/repo', submissionData(form, image)));
});
test('Markdown包含结构化速览且保持友好措辞', () => {
  const md = submissionMarkdown(submissionData(form, image));
  assert.match(md, /设计说明\*\*：学院制服/u);
  assert.match(md, /素材来源\*\*：原创绘制/u);
  assert.doesNotMatch(md, /触发生图扣费/u);
});
test('长中文投稿不会生成过长链接，改用简洁复制提示', () => {
  const data = submissionData({ ...form, description: '三视图设计'.repeat(190), sourceNote: '公开使用范围'.repeat(60) }, image);
  const url = issueUrl('https://github.com/Fightingshine/blue-whale-wardrobe', data);
  assert.ok(url.length < 7500);
  assert.match(new URL(url).searchParams.get('body'), /完整投稿说明/u);
});
test('不接收SVG伪装为普通图片', () => {
  assert.equal(sniffImage(new TextEncoder().encode('<svg onload="alert(1)"></svg>')), null);
});
test('历史PNG尺寸从实际头部读取', () => {
  const bytes = readFileSync(new URL('../public/skins/original/reference.png', import.meta.url));
  assert.deepEqual(imageDimensions(bytes), { width: 2048, height: 1143 });
});
test('历史JPG尺寸从实际头部读取', () => {
  const bytes = readFileSync(new URL('../public/skins/winter/reference.jpg', import.meta.url));
  assert.deepEqual(imageDimensions(bytes), { width: 1280, height: 714 });
});
test('HTML作为文本保留，渲染时由React转义而非当作标记', () => {
  const data = submissionData({ ...form, name: '<img src=x onerror=alert(1)>' }, image);
  assert.ok(data.name.startsWith('<img'));
  assert.ok(new URL(issueUrl('https://github.com/Fightingshine/blue-whale-wardrobe', data)).searchParams.get('body').includes('"name": "<img'));
});

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
