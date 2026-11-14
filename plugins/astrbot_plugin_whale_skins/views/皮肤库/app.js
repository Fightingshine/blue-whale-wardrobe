"use strict";
const $ = id => document.getElementById(id);
const state = {sdk:null,data:null,selected:null,busy:false,dirty:false,preview:0};
const unwrap = r => {if(r?.status === 'error') throw Error(r.message || '操作未完成，请刷新后重试。'); return r?.status === 'ok' ? r.data : r;};
const get = async path => unwrap(await state.sdk.apiGet('/page' + path));
const post = async (path,body) => unwrap(await state.sdk.apiPost('/page' + path,body));
const date = seconds => seconds ? new Date(seconds*1000).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}) : '尚未同步';
function notice(message,error=false){$('notice').hidden=false;$('notice').textContent=message;$('notice').className=error?'error':'';}
function node(tag,text,cls){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;}
function busy(value){state.busy=value;for(const id of ['refresh','sync','save','reset','download'])$(id).disabled=value;}
function render(){
  const q=$('search').value.trim().toLowerCase();$('list').replaceChildren();
  const rows=state.data.skins.filter(r=>[r.name,r.id,...r.keywords].join(' ').toLowerCase().includes(q));
  $('count').textContent=state.data.skins.filter(r=>r.enabled).length+' 套启用';
  for(const row of rows){const button=node('button',undefined,'skin'+(row.id===state.selected?' selected':''));
    button.type='button';button.setAttribute('aria-pressed',String(row.id===state.selected));
    const title=node('strong');title.append(node('span',undefined,'dot'+(row.enabled?' on':'')),document.createTextNode(row.name));
    button.append(title,node('small',row.keywords.join(' · ')),node('small',row.builtin?'基础皮肤':row.present?'共创 · '+row.id:'已撤销收录 · '+row.id));
    button.onclick=()=>{if(state.dirty){notice('请先保存或刷新当前设置，再切换皮肤。',true);return;}if(!state.busy)select(row.id);};$('list').append(button);}
  if(!rows.length)$('list').append(node('p','没有匹配的皮肤，换个关键词试试。','muted'));
}
async function select(id){
  const row=state.data.skins.find(r=>r.id===id);state.selected=row?.id||null;state.dirty=false;render();
  $('empty').hidden=!!row;$('editor').hidden=!row;if(!row)return;
  $('skin-name').textContent=row.name;$('skin-source').textContent=row.builtin?'基础人设':'共创皮肤 · '+row.id;
  $('skin-state').textContent=!row.present?'已撤销收录':row.enabled?'已启用':'已停用';
  $('enabled').checked=row.enabled;$('enabled').disabled=row.id==='original'||!row.present;
  $('daily').checked=row.daily;$('daily').disabled=!row.daily_allowed;
  // 来源明确未允许轮换时只显示停用，服务端同样强制限制。
  $('daily-note').textContent=row.builtin?'四套基础皮肤的原图保持不变。':'只有投稿者同意参与日报的皮肤才能加入轮换。';
  $('keywords').value=row.keywords.join('，');$('keywords').disabled=row.id==='original';
  $('appearance').value=row.appearance;$('appearance').disabled=row.id==='original';$('weight').value=row.weight;
  $('attribution').textContent=row.attribution||'请以原投稿的署名和使用范围为准。';$('checksum').textContent='SHA-256: '+row.reference_sha256;
  $('reference-state').textContent=row.reference_ok?'原图 SHA-256 校验通过':'原图缺失或校验失败，不能用于生图';
  $('preview').removeAttribute('src');const requestId=++state.preview;
  try{const result=await get('/skins/'+encodeURIComponent(id)+'/preview');if(requestId===state.preview)$('preview').src=result.data_url;}
  catch(e){if(requestId===state.preview)notice(e.message,true);}
}
async function load(){state.data=await get('/status');$('sync-state').textContent=state.data.running?'正在整理已审核皮肤…':state.data.sync.last_error||('自动同步'+(state.data.auto_sync?'已开启，每 '+Math.round(state.data.interval_seconds/60)+' 分钟检查':'已暂停'));
  $('sync-time').textContent='最近成功：'+date(state.data.sync.last_success);await select(state.selected||state.data.skins[0]?.id);}
$('search').oninput=()=>{if(state.data)render();};
$('form').oninput=()=>{state.dirty=true;};
$('refresh').onclick=async()=>{busy(true);try{await load();}catch(e){notice(e.message,true);}finally{busy(false);}};
$('sync').onclick=async()=>{if(state.dirty){notice('请先保存当前设置。',true);return;}busy(true);try{await post('/sync',{});notice('正在同步，请稍后刷新查看结果。');await load();}catch(e){notice(e.message,true);}finally{busy(false);}};
$('form').onsubmit=async event=>{event.preventDefault();busy(true);try{const row=state.data.skins.find(r=>r.id===state.selected);
  const patch={enabled:$('enabled').checked,daily:$('daily').checked,weight:Number($('weight').value)};
  if(row.id!=='original'){patch.keywords=[...new Set($('keywords').value.split(/[,，、\n]+/).map(s=>s.trim()).filter(Boolean))];patch.appearance=$('appearance').value;}
  await post('/skins/'+row.id,{revision:state.data.revision,patch});state.dirty=false;await load();notice('已保存，下次画图就会使用新设置。');
}catch(e){notice(e.message,true);}finally{busy(false);}};
$('reset').onclick=async()=>{busy(true);try{await post('/skins/'+state.selected+'/reset',{revision:state.data.revision});state.dirty=false;await load();notice('已恢复来源设置。');}catch(e){notice(e.message,true);}finally{busy(false);}};
$('download').onclick=async()=>{busy(true);try{await state.sdk.download('/page/skins/'+state.selected+'/reference',state.selected+'-reference');}catch(e){notice(e.message,true);}finally{busy(false);}};
(async()=>{try{for(let i=0;i<50&&!window.AstrBotPluginView;i++)await new Promise(r=>setTimeout(r,100));state.sdk=window.AstrBotPluginView;if(!state.sdk)throw Error('请从 AstrBot 插件卡片打开“皮肤库”页面。');const ready=await state.sdk.ready();if(ready?.isDark)document.documentElement.dataset.theme='dark';await load();setInterval(async()=>{if(state.busy||state.dirty||!state.data?.running)return;try{await load();}catch(e){notice(e.message,true);}},5000);}catch(e){notice(e.message,true);}})();
