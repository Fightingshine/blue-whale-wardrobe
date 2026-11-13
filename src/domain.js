export const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export function cleanText(value, max = 500) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '').trim().slice(0, max);
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

export function validateSubmission(form, image) {
  if (!image) return '请先选择一张包含正面、侧面、背面的三视图。';
  if (!cleanText(form.name, 40)) return '请填写皮肤名称。';
  if (!cleanText(form.author, 40)) return '请填写作者署名，使用昵称即可。';
  const keywords = keywordsFrom(form.keywords);
  if (!keywords.length || keywords.length > 8 || keywords.some(x => x.length > 20)) return '请填写 1—8 个关键词，每个不超过 20 字。';
  if (cleanText(form.description, 1000).length < 10) return '请至少用 10 个字介绍服装、配色或设计细节。';
  if (!cleanText(form.source, 500)) return '请说明素材来源及允许的使用范围。';
  if (!form.rights) return '请确认你有权公开这张图片，并说明使用范围。';
  if (!form.public) return '请确认你了解投稿公开、且不会自动加入机器人。';
  return '';
}

export function submissionData(form, image) {
  return {
    schema: 'whale-skin-submission/v1',
    name: cleanText(form.name, 40),
    author: cleanText(form.author, 40),
    keywords: keywordsFrom(form.keywords),
    description: cleanText(form.description, 1000),
    attribution: cleanText(form.source, 500),
    requestedDailyRotation: Boolean(form.rotation),
    reference: { filename: cleanText(image.name, 120), sha256: image.sha256, width: image.width, height: image.height, bytes: image.size },
    rightsConfirmed: Boolean(form.rights),
    publicSubmissionConfirmed: Boolean(form.public),
  };
}

export function submissionMarkdown(data) {
  return `<!-- whale-skin-submission:v1 -->
## 皮肤投稿：${data.name.replace(/[\r\n]/gu, ' ')}

**请在下面拖入三视图原图，再发布 Issue。仅有这段文字不算完成附图。**

【在这里附上图片】

### 投稿资料
\`\`\`json
${JSON.stringify(data, null, 2)}
\`\`\`

- [x] 我有权公开此图；素材来源和使用范围已在资料中说明。
- [x] 我知道 Issue 公开；网站代码的 MIT 许可不自动覆盖图片。
- [x] 我知道投稿需要人工审核，不会自动上线或触发生图扣费。

维护者审核：三视图一致性 / 角色辨识度 / 关键词冲突 / 素材权利说明。`;
}

export function issueUrl(repositoryUrl, data) {
  const parsed = new URL(repositoryUrl);
  if (parsed.origin !== 'https://github.com' || !/^\/[\w.-]+\/[\w.-]+\/?$/u.test(parsed.pathname)) throw new Error('投稿仓库地址无效。');
  const url = new URL(`${parsed.pathname.replace(/\/$/u, '')}/issues/new`, parsed.origin);
  url.searchParams.set('title', `[皮肤投稿] ${data.name}`);
  url.searchParams.set('body', submissionMarkdown(data));
  url.searchParams.set('labels', '皮肤投稿');
  if (url.href.length > 7500) {
    url.searchParams.set('body', `## 皮肤投稿：${data.name}\n\n资料较长，请把网页中复制的完整投稿说明粘贴到这里，并拖入三视图原图，再发布 Issue。\n\n网页本地预览不等于已上传；投稿需要人工审核。`);
  }
  return url.href;
}

export async function readLocalImage(file, limits) {
  if (!file || !IMAGE_TYPES.has(file.type)) throw new Error('请使用 PNG、JPG 或 WebP 图片；不接收 SVG、GIF 和压缩包。');
  if (file.size > limits.maxUploadBytes || file.size < 24) throw new Error('图片需为有效文件，且不超过 10 MB。');
  const bytes = await file.arrayBuffer();
  const actualType = sniffImage(bytes);
  if (!actualType || actualType !== file.type) throw new Error('文件内容与图片格式不一致，请重新导出原图。');
  const header = imageDimensions(bytes);
  if (header.width < 1 || header.height < 1 || header.width > 10000 || header.height > 10000 || header.width * header.height > limits.maxPixels) throw new Error('图片尺寸过大或无效，请缩小到 2400 万像素以内。');
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('图片无法解码，请重新导出 PNG 或 JPG。'); });
  const { width, height } = bitmap;
  bitmap.close();
  if (width > 10000 || height > 10000 || width * height > limits.maxPixels) throw new Error('图片尺寸过大，请缩小到 2400 万像素以内。');
  if (width < 600 || height < 300 || width < height) throw new Error('请上传横向、完整的三视图拼图，至少 600 × 300 像素。');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2,'0')).join('');
  return { name: file.name, size: file.size, width, height, sha256, url: URL.createObjectURL(file) };
}
