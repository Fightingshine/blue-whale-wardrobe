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
  validateSubmission,
} from '../src/domain.js';

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
test('未选风格且没有补充设计说明不能提交', () => {
  assert.match(validateSubmission({ ...form, designStyles: [], description: '短' }, image), /风格主题/u);
});
test('未选素材来源类型且无手填来源不能提交', () => {
  assert.match(validateSubmission({ ...form, sourceType: '', sourceNote: '' }, image), /素材来源/u);
});
test('未选使用范围且无补充说明不能提交', () => {
  assert.match(validateSubmission({ ...form, usageScopes: [], sourceNote: '' }, image), /使用范围/u);
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
  assert.match(md, /风格主题\*\*：学院制服/u);
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
