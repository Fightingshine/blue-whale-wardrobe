import { createHash } from 'node:crypto';
import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { imageDimensions, sniffImage } from '../src/domain.js';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function validateSkin(skin, publicRoot, { checkFile = true } = {}) {
  const fail = message => { throw new Error(`${skin?.id || 'unknown'}: ${message}`); };
  if (!skin || !/^[a-z][a-z0-9-]{1,47}$/u.test(skin.id)) fail('皮肤 ID 必须是安全的小写英文标识。');
  for (const key of ['name','category','categoryLabel','attribution']) {
    if (typeof skin[key] !== 'string' || !skin[key].trim() || skin[key].length > 1600) fail(`字段 ${key} 缺失或过长。`);
  }
  for (const key of ['description','appearance']) {
    if (typeof skin[key] !== 'string' || skin[key].length > 1600) fail(`字段 ${key} 格式或长度不合法。`);
  }
  if (!Array.isArray(skin.keywords) || !skin.keywords.length || skin.keywords.some(x => typeof x !== 'string' || !x.trim() || x.length > 32)) fail('关键词不合法。');
  if (skin.status !== 'approved') fail('公开图鉴只能包含已收录项目。');
  if (!skin.rights || typeof skin.rights.note !== 'string' || !skin.rights.note || skin.rights.license !== 'LicenseRef-Asset-Rights-Reserved') fail('需单独说明图像权利，不得自动套用代码许可。');
  const ref = skin.reference;
  if (!ref || !new RegExp(`^skins/${skin.id}/reference\\.(png|jpg|webp)$`, 'u').test(ref.path)) fail('参考图必须位于自己的皮肤目录，禁止远程 URL 或路径穿越。');
  if (!/^[a-f0-9]{64}$/u.test(ref.sha256)) fail('缺少有效的 SHA-256。');
  if (!Number.isInteger(ref.width) || !Number.isInteger(ref.height) || ref.width < 1 || ref.height < 1 || ref.width * ref.height > 24_000_000) fail('图片尺寸不合法。');
  if (!checkFile) return true;
  const root = path.resolve(publicRoot);
  const filename = path.resolve(root, ref.path);
  if (!filename.startsWith(root + path.sep) || lstatSync(filename).isSymbolicLink() || !realpathSync(filename).startsWith(realpathSync(root)+path.sep)) fail('参考图路径不安全。');
  const bytes = readFileSync(filename);
  if (bytes.length > 10 * 1024 * 1024 || !sniffImage(bytes)) fail('参考图无效或超过 10 MB。');
  if (sha256(bytes) !== ref.sha256) fail('原图校验不匹配。');
  const dimensions = imageDimensions(bytes);
  if (dimensions.width !== ref.width || dimensions.height !== ref.height) fail('原图尺寸不匹配。');
  return true;
}

export function validateCatalog(catalog, publicRoot, options = {}) {
  if (catalog?.schema !== 'whale-skin-catalog/v1' || !Array.isArray(catalog.skins) || !catalog.skins.length) throw new Error('目录结构无效。');
  const ids = new Set();
  const names = new Set();
  for (const skin of catalog.skins) {
    validateSkin(skin, publicRoot, options);
    if (ids.has(skin.id) || names.has(skin.name)) throw new Error('皮肤 ID 或名称重复。');
    ids.add(skin.id); names.add(skin.name);
  }
  if (!ids.has('original')) throw new Error('必须保留原装参考图。');
  return catalog.skins.length;
}
