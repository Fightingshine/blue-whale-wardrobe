export const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export const LEGACY_EMPTY_DESCRIPTIONS = new Set([
  '未单独填写设计说明，详见三视图原图。',
  '社区共创投稿的三视图皮肤，详见展示细节。',
  '大肥鱼卖萌',
  '大肥鱼摇摇小鲸尾，眨着蓝眼睛求夸夸～',
]);

export function cleanText(value, max = 500) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '').trim().slice(0, max);
}

export function displayDescription(value) {
  const text = cleanText(value, 1600);
  return !text || LEGACY_EMPTY_DESCRIPTIONS.has(text) ? '' : text;
}

export function keywordsFrom(value) {
  return [...new Set(cleanText(value, 200).split(/[,，、\n]/u).map(x => x.trim()).filter(Boolean))];
}

export function sniffImage(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length >= 24 && [137,80,78,71,13,10,26,10].every((v,i) => b[i] === v)) return 'image/png';
  if (b.length >= 4 && b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg';
  if (b.length >= 16 && String.fromCharCode(...b.slice(0,4)) === 'RIFF' && String.fromCharCode(...b.slice(8,12)) === 'WEBP') return 'image/webp';
  return null;
}

export function imageDimensions(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const kind = sniffImage(b);
  if (kind === 'image/png') return { width: view.getUint32(16), height: view.getUint32(20) };
  if (kind === 'image/jpeg') {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 255) { i++; continue; }
      while (b[i] === 255) i++;
      const marker = b[i++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (i + 2 > b.length) break;
      const length = view.getUint16(i);
      if (length < 2 || i + length > b.length) break;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
        return { width: view.getUint16(i + 5), height: view.getUint16(i + 3) };
      }
      i += length;
    }
  }
  if (kind === 'image/webp' && b.length >= 30) {
    const chunk = String.fromCharCode(...b.slice(12,16));
    if (chunk === 'VP8X') return { width: 1+b[24]+(b[25]<<8)+(b[26]<<16), height: 1+b[27]+(b[28]<<8)+(b[29]<<16) };
    if (chunk === 'VP8 ' && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) return { width: view.getUint16(26,true)&0x3fff, height:view.getUint16(28,true)&0x3fff };
    if (chunk === 'VP8L' && b[20] === 0x2f) {
      const bits = view.getUint32(21,true);
      return { width:(bits&0x3fff)+1, height:((bits>>>14)&0x3fff)+1 };
    }
  }
  throw new Error('无法确认图片尺寸，请重新导出 PNG 或 JPG。');
}

export function filterSkins(skins, query, category) {
  const q = cleanText(query, 100).toLocaleLowerCase('zh-CN');
  return skins.filter(skin => (!category || category === 'all' || skin.category === category) &&
    (!q || [skin.name, skin.description, ...skin.keywords].join(' ').toLocaleLowerCase('zh-CN').includes(q)));
}

export const DESIGN_STYLE_OPTIONS = [
  { id: 'campus', label: '学院制服', hint: '水手服 / 百褶裙 / 西装外套' },
  { id: 'daily', label: '日常私服', hint: '卫衣 / 针织 / 轻松便装' },
  { id: 'season', label: '四季限定', hint: '春游 / 夏日海风 / 秋冬绒棉' },
  { id: 'festival', label: '节日庆典', hint: '新年 / 生日 / 派对穿搭' },
  { id: 'fantasy', label: '童话海洋', hint: '礼服 / 魔法 / 海洋星辰' },
  { id: 'retro', label: '复古像素', hint: '格纹拼接 / 像素 / 怀旧风' },
];

export const DESIGN_DETAIL_OPTIONS = [
  { id: 'hair', label: '深蓝渐浅蓝长发' },
  { id: 'ears-tail', label: '鲸鳍耳与蓝白鲸尾' },
  { id: 'ahoge-eyes', label: '弯呆毛与蓝眼睛' },
  { id: 'ocean-trim', label: '海浪 / 贝壳小饰品' },
  { id: 'matching-trim', label: '正侧背配饰一致' },
];

export const SOURCE_TYPE_OPTIONS = [
  { id: 'original', label: '原创绘制', note: '自己手绘或从零设计的穿搭', summary: '创作者原创设计绘制' },
  { id: 'remix', label: '原图改绘', note: '基于原有大肥鱼三视图换衣配色', summary: '基于大肥鱼原有设定图二创改绘' },
  { id: 'ai', label: 'AI 辅助设计', note: '借助生图工具生成并经人工整理', summary: 'AI 辅助生成并经人工整理微调' },
  { id: 'authorized', label: '授权代投', note: '已获原作者同意并代为分享投稿', summary: '已获原作者授权并代为分享' },
];

export const USAGE_SCOPE_OPTIONS = [
  { id: 'gallery', label: '在衣橱图鉴公开展示', summary: '可在衣橱图鉴公开展示' },
  { id: 'bot', label: '作为群聊小蓝鲸画图参考', summary: '可作为小蓝鲸画图穿搭参考' },
  { id: 'remix', label: '欢迎群友在此基础上继续二创', summary: '欢迎在此基础上继续二创' },
];

export function composeDescription(form = {}) {
  const styles = (Array.isArray(form.designStyles) ? form.designStyles : [])
    .map(id => DESIGN_STYLE_OPTIONS.find(x => x.id === id)?.label || cleanText(id, 24))
    .filter(Boolean);
  const details = (Array.isArray(form.designDetails) ? form.designDetails : [])
    .map(id => DESIGN_DETAIL_OPTIONS.find(x => x.id === id)?.label || cleanText(id, 30))
    .filter(Boolean);
  const note = cleanText(form.description, 800);
  const parts = [];
  if (styles.length) parts.push(`风格主题：${styles.join('、')}`);
  if (details.length) parts.push(`保留与细节：${details.join('、')}`);
  if (note) parts.push((styles.length || details.length) ? `补充想法：${note}` : note);
  return cleanText(parts.join('｜'), 1000);
}

export function composeAttribution(form = {}) {
  const sourceOption = SOURCE_TYPE_OPTIONS.find(x => x.id === form.sourceType);
  const scopes = (Array.isArray(form.usageScopes) ? form.usageScopes : [])
    .map(id => USAGE_SCOPE_OPTIONS.find(x => x.id === id)?.summary || cleanText(id, 40))
    .filter(Boolean);
  const note = cleanText(form.sourceNote ?? form.source, 300);
  const parts = [];
  if (sourceOption) parts.push(`素材来源：${sourceOption.summary}`);
  if (scopes.length) parts.push(`使用范围：${scopes.join('、')}`);
  if (note) parts.push((sourceOption || scopes.length) ? `补充说明：${note}` : note);
  return cleanText(parts.join('；'), 500);
}

export function validateSubmission(form = {}, image) {
  if (!image) return '请先选择一张包含正面、侧面、背面的三视图图片。';
  if (!cleanText(form.name, 40)) return '给这套新衣起个皮肤名称吧。';
  if (!cleanText(form.author, 40)) return '写上你想展示在图鉴里的作者昵称吧。';
  const keywords = keywordsFrom(form.keywords);
  if (!keywords.length || keywords.length > 8 || keywords.some(x => x.length > 20)) return '请填写 1—8 个触发关键词，每个不超过 20 字。';
  const confirmed = form.confirmed !== undefined ? Boolean(form.confirmed) : Boolean(form.rights && form.public);
  if (!confirmed) return '请勾选确认同意前往 GitHub 公开投稿。';
  return '';
}

export function submissionData(form, image) {
  const confirmed = form.confirmed !== undefined ? Boolean(form.confirmed) : Boolean(form.rights && form.public);
  const styleLabels = (Array.isArray(form.designStyles) ? form.designStyles : [])
    .map(id => DESIGN_STYLE_OPTIONS.find(x => x.id === id)?.label)
    .filter(Boolean);
  const detailLabels = (Array.isArray(form.designDetails) ? form.designDetails : [])
    .map(id => DESIGN_DETAIL_OPTIONS.find(x => x.id === id)?.label)
    .filter(Boolean);
  const sourceLabel = SOURCE_TYPE_OPTIONS.find(x => x.id === form.sourceType)?.label || '';
  const usageLabels = (Array.isArray(form.usageScopes) ? form.usageScopes : [])
    .map(id => USAGE_SCOPE_OPTIONS.find(x => x.id === id)?.label)
    .filter(Boolean);
  const composedDescription = composeDescription(form);
  const composedAttribution = composeAttribution(form);
  return {
    schema: 'whale-skin-submission/v1',
    name: cleanText(form.name, 40),
    author: cleanText(form.author, 40),
    keywords: keywordsFrom(form.keywords),
    description: composedDescription,
    attribution: composedAttribution || '未单独填写素材来源与使用范围，可在 Issue 中补充说明。',
    designTopics: {
      styles: styleLabels,
      details: detailLabels,
      note: cleanText(form.description, 800),
    },
    sourceTopics: {
      type: sourceLabel,
      usages: usageLabels,
      note: cleanText(form.sourceNote ?? form.source, 300),
    },
    requestedDailyRotation: Boolean(form.rotation),
    reference: { filename: cleanText(image.name, 120), sha256: image.sha256, width: image.width, height: image.height, bytes: image.size },
    rightsConfirmed: confirmed,
    publicSubmissionConfirmed: confirmed,
  };
}

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

export function issueUrl(repositoryUrl, data) {
  const parsed = new URL(repositoryUrl);
  if (parsed.origin !== 'https://github.com' || !/^\/[\w.-]+\/[\w.-]+\/?$/u.test(parsed.pathname)) throw new Error('投稿仓库地址无效。');
  const url = new URL(`${parsed.pathname.replace(/\/$/u, '')}/issues/new`, parsed.origin);
  url.searchParams.set('title', `[皮肤投稿] ${data.name}`);
  url.searchParams.set('body', submissionMarkdown(data));
  url.searchParams.set('labels', '皮肤投稿');
  if (url.href.length > 7500) {
    url.searchParams.set('body', `## 皮肤投稿：${data.name}\n\n文字资料较长，请把网页中复制好的完整投稿说明粘贴到这里，再拖入三视图原图就完成啦。`);
  }
  return url.href;
}

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
  const sha256 = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2,'0')).join('');
  return { name: file.name, size: file.size, width, height, sha256, url: URL.createObjectURL(file) };
}
