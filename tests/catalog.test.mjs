import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, copyFileSync, cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { validateCatalog, validateSkin } from '../scripts/catalog.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const publicRoot=path.join(root,'public');
const catalog=JSON.parse(readFileSync(path.join(publicRoot,'skins/catalog.json'),'utf8'));

test('全部归档原图哈希和尺寸通过且四套历史皮肤保留',()=>{
  assert.equal(validateCatalog(catalog,publicRoot),catalog.skins.length);
  assert.deepEqual(catalog.skins.filter(skin=>skin.legacy).map(skin=>skin.id).sort(),['original','pixel','sweater','winter']);
});
test('拒绝重复皮肤ID',()=>{assert.throws(()=>validateCatalog({...catalog,skins:[...catalog.skins,catalog.skins[0]]},publicRoot));});
test('拒绝远程参考图',()=>{const skin=structuredClone(catalog.skins[0]);skin.reference.path='https://example.com/reference.png';assert.throws(()=>validateSkin(skin,publicRoot));});
test('拒绝参考图路径穿越',()=>{const skin=structuredClone(catalog.skins[0]);skin.reference.path='../private.json';assert.throws(()=>validateSkin(skin,publicRoot));});
test('拒绝缺少图像权利说明',()=>{const skin=structuredClone(catalog.skins[0]);delete skin.rights;assert.throws(()=>validateSkin(skin,publicRoot));});
test('拒绝未经审核的皮肤进入公开图鉴',()=>{const skin=structuredClone(catalog.skins[0]);skin.status='pending';assert.throws(()=>validateSkin(skin,publicRoot));});
test('拒绝原图SHA不匹配',()=>{const skin=structuredClone(catalog.skins[0]);skin.reference.sha256='0'.repeat(64);assert.throws(()=>validateSkin(skin,publicRoot));});
test('允许未填写设计说明和细节描述的皮肤通过目录校验',()=>{
  const skin=structuredClone(catalog.skins[0]);
  skin.description='';
  skin.appearance='';
  assert.equal(validateSkin(skin,publicRoot),true);
});
test('维护者收录工具可导入临时皮肤且拒绝覆盖现有ID',()=>{
  const temp=mkdtempSync(path.join(tmpdir(),'wardrobe-import-'));
  try{
    mkdirSync(path.join(temp,'scripts'));mkdirSync(path.join(temp,'src'));
    cpSync(publicRoot,path.join(temp,'public'),{recursive:true});
    for(const name of ['add-skin.mjs','catalog.mjs'])copyFileSync(path.join(root,'scripts',name),path.join(temp,'scripts',name));
    copyFileSync(path.join(root,'src/domain.js'),path.join(temp,'src/domain.js'));
    writeFileSync(path.join(temp,'package.json'),'{"type":"module"}');
    const original=catalog.skins[0];
    const metadata={schema:'whale-skin-submission/v1',name:'测试投稿',author:'测试署名',keywords:['测试装'],description:'仅用于临时目录的工作流验证，不会收录到正式图鉴。',attribution:'临时测试夹具，不用于发布。',rightsConfirmed:true,publicSubmissionConfirmed:true,reference:{sha256:original.reference.sha256}};
    writeFileSync(path.join(temp,'submission.json'),JSON.stringify(metadata));
    const args=[path.join(temp,'scripts/add-skin.mjs'),'--id','fixture-look','--image',path.join(temp,'public',original.reference.path),'--metadata',path.join(temp,'submission.json'),'--approve','yes'];
    const imported=spawnSync(process.execPath,args,{encoding:'utf8'});
    assert.equal(imported.status,0,imported.stderr);
    const added=JSON.parse(readFileSync(path.join(temp,'public/skins/catalog.json'),'utf8'));
    assert.equal(added.skins.length,catalog.skins.length+1);assert.equal(added.skins.at(-1).status,'approved');
    assert.equal(validateCatalog(added,path.join(temp,'public')),catalog.skins.length+1);
    const duplicate=spawnSync(process.execPath,args,{encoding:'utf8'});assert.notEqual(duplicate.status,0);
    assert.equal(JSON.parse(readFileSync(path.join(temp,'public/skins/catalog.json'),'utf8')).skins.length,catalog.skins.length+1);
  }finally{rmSync(temp,{recursive:true,force:true});}
});
