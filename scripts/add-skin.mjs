import { readFileSync, existsSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { imageDimensions, sniffImage } from '../src/domain.js';
import { sha256, validateCatalog, validateSkin } from './catalog.mjs';

const args = new Map();
for (let i=2;i<process.argv.length;i+=2) args.set(process.argv[i],process.argv[i+1]);
const id=args.get('--id'), input=args.get('--image'), meta=args.get('--metadata');
if (!/^[a-z][a-z0-9-]{1,47}$/u.test(id || '') || !input || !meta || args.get('--approve') !== 'yes') {
  console.error('用法：node scripts/add-skin.mjs --id campus --image ./reference.png --metadata ./skin-submission.json --approve yes');
  process.exit(1);
}
const root=path.resolve(import.meta.dirname,'..');
const publicRoot=path.join(root,'public');
const catalogPath=path.join(publicRoot,'skins/catalog.json');
const catalog=JSON.parse(readFileSync(catalogPath,'utf8'));
validateCatalog(catalog,publicRoot);
if (catalog.skins.some(skin=>skin.id===id) || existsSync(path.join(publicRoot,'skins',id))) throw new Error('此 ID 已存在，禁止覆盖现有皮肤。');
const data=JSON.parse(readFileSync(path.resolve(meta),'utf8'));
if (data.schema !== 'whale-skin-submission/v1' || data.rightsConfirmed !== true || data.publicSubmissionConfirmed !== true) throw new Error('需完整投稿资料、公开确认和权利说明。');
if (!data.author || !data.description || !data.attribution || !Array.isArray(data.keywords) || !data.keywords.length) throw new Error('投稿资料不完整。');
const bytes=readFileSync(path.resolve(input));
const type=sniffImage(bytes);const extension={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[type];
if (!extension || bytes.length>10*1024*1024) throw new Error('图片格式无效或超过 10 MB。');
const hash=sha256(bytes);
if (data.reference?.sha256 !== hash) throw new Error('原图与投稿时的 SHA-256 不一致，请核实而不是跳过检查。');
const dimensions=imageDimensions(bytes);
const item={id,name:data.name,category:'community',categoryLabel:'共创',status:'approved',keywords:data.keywords,
  description:data.description,appearance:data.description,
  attribution:`${data.author}；${data.attribution}`,legacy:false,
  rights:{license:'LicenseRef-Asset-Rights-Reserved',note:data.attribution},
  requestedDailyRotation:Boolean(data.requestedDailyRotation),
  reference:{path:`skins/${id}/reference.${extension}`,sha256:hash,...dimensions,bytes:bytes.length}};
validateSkin(item,publicRoot,{checkFile:false});
validateCatalog({...catalog,skins:[...catalog.skins,item]},publicRoot,{checkFile:false});
// 网络下载和自动审批均不在此脚本中；只导入维护者已审核的本地文件。
const directory=path.join(publicRoot,'skins',id);mkdirSync(directory);
copyFileSync(path.resolve(input),path.join(publicRoot,item.reference.path));
writeFileSync(path.join(directory,'metadata.json'),JSON.stringify(item,null,2)+'\n',{flag:'wx'});
catalog.skins.push(item);
writeFileSync(catalogPath,JSON.stringify(catalog,null,2)+'\n');
validateCatalog(catalog,publicRoot);
console.log(`已在当前工作分支加入 ${item.name}。请审查差异、运行测试并提交 PR；此操作不会更新机器人。`);
