import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { validateCatalog } from './catalog.mjs';

const root = path.resolve(import.meta.dirname, '..');
const catalog = JSON.parse(readFileSync(path.join(root,'public/skins/catalog.json'),'utf8'));
const count = validateCatalog(catalog, path.join(root,'public'));
for (const skin of catalog.skins) {
  const entry = JSON.parse(readFileSync(path.join(root,'public/skins',skin.id,'metadata.json'),'utf8'));
  if (JSON.stringify(entry) !== JSON.stringify(skin)) throw new Error(`${skin.id}: 单独元数据与目录不一致。`);
}
const allowedExtensions = new Set(['.js','.jsx','.mjs','.json','.md','.yml','.yaml','.html','.css','.svg','.txt']);
const banned = [/sk-[A-Za-z0-9_-]{20,}/u, /lc_[A-Za-z0-9_-]{20,}/u, /-----BEGIN [A-Z ]*PRIVATE KEY-----/u, /47\.109\.205\.110/u, /C:[\\/]Users[\\/]/iu];
function scan(directory) {
  for (const item of readdirSync(directory,{withFileTypes:true})) {
    if (['node_modules','.git','dist','test-results','playwright-report'].includes(item.name)) continue;
    const filename = path.join(directory,item.name);
    if (item.isSymbolicLink()) throw new Error('公开项目中不接收符号链接。');
    if (item.isDirectory()) { scan(filename); continue; }
    if (!allowedExtensions.has(path.extname(filename))) continue;
    const text = readFileSync(filename,'utf8');
    // 校验器本身含拦截模式，而不是私有值。
    if (filename === path.join(root,'scripts/validate.mjs')) continue;
    if (banned.some(pattern => pattern.test(text))) throw new Error(`可能存在敏感信息：${path.relative(root,filename)}`);
  }
}
scan(root);
console.log(`校验通过：${count} 套皮肤，原图哈希、尺寸、目录结构与公开内容检查均通过。`);
