import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_SKIN_DESCRIPTION, LEGACY_EMPTY_DESCRIPTIONS, cleanText, imageDimensions, keywordsFrom, sniffImage } from '../src/domain.js';
import { sha256, validateCatalog, validateSkin } from './catalog.mjs';

const ALLOWED_IMAGE_HOSTS = new Set([
  'github.com',
  'raw.githubusercontent.com',
  'user-images.githubusercontent.com',
  'private-user-images.githubusercontent.com',
  'objects.githubusercontent.com',
  'camo.githubusercontent.com',
  'github-production-user-asset-6210df.s3.amazonaws.com',
]);

export function isAllowedAttachmentUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    return ALLOWED_IMAGE_HOSTS.has(parsed.hostname) || parsed.hostname.endsWith('.githubusercontent.com');
  } catch {
    return false;
  }
}

export function extractSubmissionJson(body = '') {
  const text = String(body || '');
  const match = text.match(/```json\s*([\s\S]*?)```/iu);
  if (!match) return null;
  try {
    const data = JSON.parse(match[1]);
    if (data && data.schema === 'whale-skin-submission/v1') return data;
  } catch {
    return null;
  }
  return null;
}

function readSection(body, headingPattern) {
  const lines = String(body || '').split(/\r?\n/u);
  let collecting = false;
  const collected = [];
  for (const line of lines) {
    if (/^#{1,4}\s+/u.test(line)) {
      if (collecting) break;
      const heading = line.replace(/^#{1,4}\s+/u, '').trim();
      if (headingPattern.test(heading)) collecting = true;
      continue;
    }
    if (collecting) collected.push(line);
  }
  return collected
    .join('\n')
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, '')
    .replace(/<img[^>]*>/giu, '')
    .replace(/【在这里附上图片】/gu, '')
    .trim();
}

export function extractImageUrls(issue = {}) {
  const sources = [String(issue.body || ''), String(issue.body_html || '')];
  const urls = [];
  const seen = new Set();
  const push = raw => {
    const url = String(raw || '').replace(/&amp;/gu, '&').trim();
    if (!url || seen.has(url) || !isAllowedAttachmentUrl(url)) return;
    seen.add(url);
    urls.push(url);
  };
  for (const src of sources) {
    for (const m of src.matchAll(/!\[[^\]]*\]\((https:\/\/[^)\s]+)\)/giu)) push(m[1]);
    for (const m of src.matchAll(/<img\b([^>]*)>/giu)) {
      if (/\bclass=["'][^"']*\bemoji\b/iu.test(m[1])) continue;
      const srcMatch = m[1].match(/\bsrc=["'](https:\/\/[^"']+)["']/iu);
      if (srcMatch) push(srcMatch[1]);
    }
    for (const m of src.matchAll(/https:\/\/(?:github\.com\/user-attachments\/assets\/[^\s<>"')]+|[\w.-]*githubusercontent\.com\/[^\s<>"')]+)/giu)) push(m[0]);
  }
  return urls;
}

export function parseIssueMetadata(issue = {}) {
  const json = extractSubmissionJson(issue.body);
  const titleName = cleanText(String(issue.title || '').replace(/^\[皮肤投稿\]\s*/u, ''), 40);
  const sectionName = cleanText(readSection(issue.body, /^皮肤名称/u), 40);
  const name = cleanText(json?.name || sectionName || titleName || `共创皮肤 #${issue.number}`, 40);

  const sectionAuthor = cleanText(readSection(issue.body, /^作者署名/u), 40);
  const author = cleanText(json?.author || sectionAuthor || issue.user?.login || '社区共创', 40);

  const sectionKeywords = readSection(issue.body, /^触发关键词/u).replace(/^（[^）]+）$/gmu, '').trim();
  const rawKeywords = Array.isArray(json?.keywords) && json.keywords.length
    ? json.keywords.map(x => cleanText(x, 30)).filter(Boolean)
    : keywordsFrom(sectionKeywords);
  const keywords = (rawKeywords.length ? rawKeywords : [cleanText(name, 20) || '共创皮肤']).slice(0, 8);

  const sectionDesc = cleanText(readSection(issue.body, /^设计说明/u), 1000);
  const rawDescription = cleanText(json?.description || sectionDesc, 1500);
  const description = !rawDescription || LEGACY_EMPTY_DESCRIPTIONS.has(rawDescription)
    ? DEFAULT_SKIN_DESCRIPTION
    : rawDescription;

  const sectionAttr = cleanText(readSection(issue.body, /^素材来源/u), 400);
  const note = cleanText(json?.attribution || sectionAttr || `GitHub 共创投稿（Issue #${issue.number}）`, 450);

  return {
    name,
    author,
    keywords,
    description,
    attributionNote: note,
    requestedDailyRotation: Boolean(json?.requestedDailyRotation),
  };
}

export async function fetchApprovedIssues({ repository, token, fetchImpl = fetch, label = '已收录' }) {
  const issues = [];
  for (let page = 1; ; page += 1) {
    const apiUrl = `https://api.github.com/repos/${repository}/issues?labels=${encodeURIComponent(label)}&state=all&sort=created&direction=asc&per_page=100&page=${page}`;
    const headers = {
      Accept: 'application/vnd.github.full+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'blue-whale-wardrobe-sync',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetchImpl(apiUrl, { headers });
    if (!res.ok) throw new Error(`拉取 GitHub Issues 失败（HTTP ${res.status}）。`);
    const batch = await res.json();
    if (!Array.isArray(batch) || !batch.length) break;
    for (const item of batch) {
      if (!item.pull_request) issues.push(item);
    }
    if (batch.length < 100) break;
  }
  return issues;
}

async function downloadValidImage(urls, token, fetchImpl = fetch) {
  for (const url of urls) {
    try {
      const parsed = new URL(url);
      const headers = { 'User-Agent': 'blue-whale-wardrobe-sync' };
      if (token && (parsed.hostname === 'api.github.com' || parsed.hostname === 'github.com')) {
        headers.Authorization = `Bearer ${token}`;
      }
      const res = await fetchImpl(url, { headers, redirect: 'follow' });
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length < 24 || bytes.length > 10 * 1024 * 1024) continue;
      const mime = sniffImage(bytes);
      const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[mime];
      if (!ext) continue;
      const dimensions = imageDimensions(bytes);
      if (dimensions.width < 1 || dimensions.height < 1 || dimensions.width * dimensions.height > 24_000_000) continue;
      return { bytes, ext, sha256: sha256(bytes), dimensions };
    } catch {
      continue;
    }
  }
  return null;
}

export async function syncApprovedIssuesToDir({ outDir, repository, token, fetchImpl = fetch }) {
  const catalogPath = path.join(outDir, 'skins/catalog.json');
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  validateCatalog(catalog, outDir);

  const existingIds = new Set(catalog.skins.map(s => s.id));
  const existingNames = new Set(catalog.skins.map(s => s.name));
  const existingHashes = new Set(catalog.skins.map(s => s.reference?.sha256).filter(Boolean));

  const issues = await fetchApprovedIssues({ repository, token, fetchImpl });
  let added = 0;

  for (const issue of issues) {
    const id = `issue-${issue.number}`;
    if (!/^[a-z][a-z0-9-]{1,47}$/u.test(id) || existingIds.has(id)) continue;
    const urls = extractImageUrls(issue);
    if (!urls.length) {
      console.warn(`跳过 #${issue.number}：未找到合法三视图图片附件。`);
      continue;
    }
    const image = await downloadValidImage(urls, token, fetchImpl);
    if (!image) {
      console.warn(`跳过 #${issue.number}：附件图片无法读取或不符合 PNG/JPG/WebP 格式要求。`);
      continue;
    }
    if (existingHashes.has(image.sha256)) {
      console.log(`跳过 #${issue.number}：原图已存在于图鉴目录中。`);
      continue;
    }

    const meta = parseIssueMetadata(issue);
    let displayName = meta.name;
    if (existingNames.has(displayName)) {
      displayName = cleanText(`${meta.name} (#${issue.number})`, 40);
      if (existingNames.has(displayName)) continue;
    }

    const item = {
      id,
      name: displayName,
      category: 'community',
      categoryLabel: '共创',
      status: 'approved',
      keywords: meta.keywords,
      description: meta.description,
      appearance: meta.description,
      attribution: cleanText(`${meta.author}；${meta.attributionNote}`, 1500),
      legacy: false,
      issueNumber: issue.number,
      issueUrl: cleanText(issue.html_url || '', 300),
      rights: { license: 'LicenseRef-Asset-Rights-Reserved', note: meta.attributionNote },
      requestedDailyRotation: meta.requestedDailyRotation,
      reference: {
        path: `skins/${id}/reference.${image.ext}`,
        sha256: image.sha256,
        width: image.dimensions.width,
        height: image.dimensions.height,
        bytes: image.bytes.length,
      },
    };

    try {
      validateSkin(item, outDir, { checkFile: false });
      const dir = path.join(outDir, 'skins', id);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(outDir, item.reference.path), image.bytes);
      writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify(item, null, 2) + '\n');
      catalog.skins.push(item);
      existingIds.add(id);
      existingNames.add(displayName);
      existingHashes.add(image.sha256);
      added += 1;
    } catch (err) {
      console.warn(`跳过 #${issue.number}：${err.message}`);
    }
  }

  if (added > 0) {
    writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
    validateCatalog(catalog, outDir);
  }
  console.log(`同步完成：共检查 ${issues.length} 条「已收录」投稿，新增 ${added} 套，图鉴总计 ${catalog.skins.length} 套。`);
  return { checked: issues.length, added, total: catalog.skins.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = new Map();
  for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
  const outDir = path.resolve(args.get('--out') || path.resolve(import.meta.dirname, '../dist'));
  const repository = args.get('--repo') || process.env.GITHUB_REPOSITORY || 'Fightingshine/blue-whale-wardrobe';
  if (!/^[\w.-]+\/[\w.-]+$/u.test(repository)) throw new Error('仓库名称格式无效。');
  await syncApprovedIssuesToDir({ outDir, repository, token: process.env.GITHUB_TOKEN || '' });
}
