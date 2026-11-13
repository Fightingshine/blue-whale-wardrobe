import { useEffect, useRef, useState } from 'react';
import { SITE, assetUrl } from './site.js';
import { cleanText, filterSkins, issueUrl, readLocalImage, submissionData, submissionMarkdown, validateSubmission } from './domain.js';

function Icon({ name, size = 20, ...props }) {
  const paths = {
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    external: <><path d="M8 5H5v14h14v-3M12 4h8v8M20 4 10 14" /></>,
    upload: <><path d="M7 17H6a4 4 0 0 1-.5-8A6.5 6.5 0 0 1 18 8a4.5 4.5 0 0 1 .5 9H17M12 19V9M8 13l4-4 4 4" /></>,
    eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
    download: <><path d="M12 3v12M7 10l5 5 5-5M4 16v5h16v-5"/></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
    close: <path d="m5 5 14 14M19 5 5 19"/>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.3"/></>,
    copy: <><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/></>,
    check: <path d="m4 12 5 5L20 6"/>,
    heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name] || paths.arrow}</svg>;
}

function WhaleMark({ className = '' }) {
  return <svg className={className} viewBox="0 0 72 54" aria-hidden="true" fill="none"><path d="M35 44c0-12 5-13 10-17C55 20 59 14 60 4 47 5 40 10 35 17 30 10 23 5 10 4c1 10 5 16 15 23 5 4 10 5 10 17Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/><path d="M1 49c12-6 22-7 34-2s22 6 35 0" stroke="#93b2f0" strokeWidth="2" strokeLinecap="round"/></svg>;
}

function Wave() {
  return <svg className="wave" viewBox="0 0 1500 66" preserveAspectRatio="none" aria-hidden="true"><path d="M0 22C160-15 160 65 310 32S490 65 650 39s250 33 390-7 160 39 290 9 150-13 170-5V66H0Z" fill="#e9f1ff"/><path d="M0 50c200-50 240 30 450-8s270 26 450 6 270 26 600-22v40H0Z" fill="#f4f8ff"/></svg>;
}

function Modal({ children, title, onClose, className = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);
  return <dialog ref={ref} className={`dialog ${className}`} onCancel={e => { e.preventDefault(); onClose(); }} aria-label={title} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="dialog-content">
      <button type="button" className="icon-button close-dialog" aria-label="关闭弹窗" onClick={onClose}><Icon name="close" size={24}/></button>
      {children}
    </div>
  </dialog>;
}

function Detail({ skin, onClose, onCopy }) {
  const image = assetUrl(skin.reference.path);
  const [copied,setCopied]=useState(false);
  return <Modal title={`${skin.name}三视图`} onClose={onClose} className="detail-dialog">
    <div className="detail-heading"><h2>{skin.name}</h2><p>{skin.description}</p></div>
    <div className="detail-image"><img src={image} alt={`${skin.name}完整正面、侧面、背面三视图`} className={skin.id === 'pixel' ? 'pixel-art' : ''}/></div>
    <ViewLabels/>
    <div className="detail-body"><div><h3>看清这一套的细节</h3><p>{skin.appearance}</p><div className="keywords">{skin.keywords.map(word => <span key={word}>{word}</span>)}</div></div><div className="detail-credit"><h3>来源与使用范围</h3><p>{skin.attribution}</p><p>{skin.rights.note}</p><small>原图 {skin.reference.width} × {skin.reference.height} · 保留原文件</small></div></div>
    <div className="detail-footer"><span className="muted">收录进图鉴不等于自动同步到机器人。</span><div className="button-row"><button className="button secondary" onClick={async () => setCopied(await onCopy(`@蓝色大肥鱼 用${skin.keywords[0]}画一张庆祝图`))}><Icon name={copied ? 'check' : 'copy'}/>{copied ? '示例已复制' : '复制点图示例'}</button><a className="button primary" href={image} download><Icon name="download"/>下载原图</a></div></div>
    <details className="hash-info"><summary>原图校验信息</summary><code>SHA-256: {skin.reference.sha256}</code></details>
  </Modal>;
}

function ViewLabels() {
  return <div className="view-labels" aria-label="三视图顺序"><span>正面</span><span>侧面</span><span>背面</span></div>;
}

const emptyForm = { name: '', author: '', keywords: '', description: '', source: '', rights: false, public: false, rotation: true };

function Submission({ onClose, template, onCopy }) {
  const [form, setForm] = useState(emptyForm);
  const [image, setImage] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [dragging, setDragging] = useState(false);
  const [feedback,setFeedback]=useState('');
  const imageRef = useRef(null);
  const selection = useRef(0);
  const input = useRef(null);
  useEffect(() => () => { selection.current += 1; if (imageRef.current) URL.revokeObjectURL(imageRef.current.url); }, []);
  const field = name => ({ value: form[name], onChange: e => { setForm(prev => ({ ...prev, [name]: e.target.value })); setError(''); } });

  async function choose(file) {
    if (!file) return;
    const current = ++selection.current;
    setLoading(true); setError(''); setDraft('');
    try {
      const value = await readLocalImage(file, SITE);
      if (current !== selection.current) { URL.revokeObjectURL(value.url); return; }
      if (imageRef.current) URL.revokeObjectURL(imageRef.current.url);
      imageRef.current = value;
      setImage(value);
    } catch (e) {
      if (current !== selection.current) return;
      if (imageRef.current) URL.revokeObjectURL(imageRef.current.url);
      imageRef.current = null; setImage(null); setError(e.message);
    } finally { if (current === selection.current) setLoading(false); }
  }

  function getData() {
    const problem = validateSubmission(form, image);
    if (problem) { setError(problem); return null; }
    return submissionData(form, image);
  }

  async function copyDraft() {
    const data = getData();
    if (!data) return;
    const text = submissionMarkdown(data);
    setDraft(text);
    const copied=await onCopy(text, '投稿说明已复制；在 GitHub 页面附图后再发布。');
    setFeedback(copied ? '投稿说明已复制。请在 GitHub 页面附上原图后再发布。' : '浏览器未允许复制，请展开下方投稿说明手动复制，或下载投稿资料。');
  }

  function downloadDraft() {
    const data = getData(); if (!data) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'skin-submission.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function openGithub(e) {
    e.preventDefault();
    const data = getData(); if (!data) return;
    setDraft(submissionMarkdown(data));
    const url=issueUrl(SITE.github, data);
    if (!new URL(url).searchParams.get('body').includes('whale-skin-submission/v1')) setFeedback('资料较长：GitHub 页面将打开简短模板，请复制下方完整投稿说明并粘贴，再附上原图。');
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  return <Modal title="皮肤投稿" onClose={onClose} className="submission-dialog">
    <div className="submission-heading"><div className="small-brand"><WhaleMark/><span>大肥鱼衣橱</span></div><h2>把你的新衣，放进衣橱。</h2><p>选择三视图，在 GitHub 附图投稿；审核通过后收录。</p></div>
    <form onSubmit={openGithub} noValidate>
      <div className="submission-columns">
        <div className="submission-preview">
          <div className={`dropzone ${dragging ? 'dragging' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); choose(e.dataTransfer.files[0]); }}>
            <input ref={input} id="reference-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={e => choose(e.target.files[0])} aria-label="选择三视图图片" />
            <button type="button" className="upload-trigger" onClick={() => input.current.click()} disabled={loading}><Icon name="upload" size={40}/><span>{loading ? '正在检查图片…' : image ? '更换三视图' : '选择三视图'}<small>PNG / JPG / WebP，最大 10 MB</small></span></button>
          </div>
          <div className={`upload-preview ${image ? '' : 'template-preview'}`}><img src={image?.url || assetUrl(template.reference.path)} alt={image ? '你选择的三视图，仅本地预览' : '三视图格式参考，并非你的投稿图'} />{!image && <span className="template-caption">格式参考 · 请上传你的设计</span>}</div>
          <p className="local-only"><Icon name="info" size={16}/>{image ? '仅在你的设备预览，图片尚未上传' : '原装参考图，仅用作格式示例'}</p>
          {image && <p className="file-meta">{image.width} × {image.height} · {(image.size / 1024 / 1024).toFixed(2)} MB · {cleanText(image.name, 55)}</p>}
          <div className="three-guides">{['正面','侧面','背面'].map(name => <div key={name}><svg className="figure-outline" width="25" height="40" viewBox="0 0 28 42" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><circle cx="14" cy="10" r="6"/><path d="M9 16c-6 1-6 8-5 12l4-1 1 10h4l1-8 1 8h4l1-10 4 1c1-4 1-11-5-12"/></svg><strong>{name}</strong><small>白底、全身、等高<br/>同一套服装</small></div>)}</div>
        </div>
        <div className="submission-fields">
          <div className="field-pair"><label>皮肤名称 <span>*</span><input {...field('name')} maxLength={40} placeholder="例如：学院风大肥鱼" autoComplete="off" required/></label><label>作者署名 <span>*</span><input {...field('author')} maxLength={40} placeholder="你的昵称 / ID" autoComplete="off" required/></label></div>
          <label>触发关键词 <span>*</span><input {...field('keywords')} maxLength={200} placeholder="例如：学院风、校园装" required/><small>用逗号或顿号分隔；上线前会检查关键词冲突。</small></label>
          <label>设计说明 <span>*</span><textarea {...field('description')} maxLength={1000} rows={3} placeholder="介绍服装、配色和希望保留的设计细节，至少 10 字。" required/></label>
          <label>素材来源 / 署名说明 <span>*</span><textarea {...field('source')} maxLength={500} rows={3} placeholder="请说明是否原创、参考来源，以及允许的使用范围。不要填写真实姓名、学号或联系方式。" required/></label>
          <label className="check-label"><input type="checkbox" checked={form.rotation} onChange={e => setForm(prev => ({...prev, rotation:e.target.checked}))}/><span>希望加入日报皮肤轮换，最终由维护者审核决定</span></label>
          <label className="check-label"><input type="checkbox" checked={form.rights} onChange={e => setForm(prev => ({...prev, rights:e.target.checked}))}/><span>我有权公开这张图片，并同意在投稿中说明使用范围</span></label>
          <label className="check-label"><input type="checkbox" checked={form.public} onChange={e => setForm(prev => ({...prev, public:e.target.checked}))}/><span>我知道投稿在 GitHub 公开，且不会自动加入机器人</span></label>
        </div>
      </div>
      {error && <p className="form-error" role="alert"><Icon name="info"/>{error}</p>}
      {feedback && <p className="form-feedback" role="status"><Icon name="info"/>{feedback}</p>}
      <div className="next-step"><Icon name="info"/><span><strong>下一步：</strong>去 GitHub 页面附上原图，再发布 Issue。网页不保存你的图片，也不需要 API Key。</span></div>
      <div className="submission-footer"><span>图片权利不随网站代码开源</span><div className="button-row"><button className="text-button draft-download" type="button" onClick={downloadDraft}>下载投稿资料</button><button className="button secondary" type="button" onClick={copyDraft} disabled={loading}><Icon name="copy"/>复制投稿说明</button><button className="button primary" type="submit" disabled={loading}><Icon name="external"/>去 GitHub 附图投稿</button></div></div>
      {draft && <details className="draft-details"><summary>查看 / 手动复制投稿说明</summary><textarea aria-label="投稿说明文本" value={draft} readOnly rows={8} onFocus={e => e.target.select()}/><p>如果没有复制成功，可以在这里全选后手动复制。请勿将此文本当作已经上传成功。</p></details>}
    </form>
  </Modal>;
}

function Guide({ onClose, onContribute, template }) {
  return <Modal title="三视图投稿规范" onClose={onClose} className="guide-dialog">
    <div className="detail-heading"><h2>三面看清，才是一套完整的新衣。</h2><p>上传一张横向拼图，按正面、侧面、背面排列。</p></div>
    <img className="guide-reference" src={assetUrl(template.reference.path)} alt="原装大肥鱼三视图格式示例"/>
    <ViewLabels/>
    <div className="guide-grid"><section><h3>保留她是谁</h3><p>深蓝长发与浅蓝发梢、蓝眼、侧鳍、鲸尾和 Q 版比例。衣服可以有想象力，人物要认得出来。</p></section><section><h3>三面是一套设计</h3><p>白底、全身、等高；衣服配色、饰品位置与图案在三个视角中一致。不要裁掉鞋子或尾巴。</p></section><section><h3>交代清楚来源</h3><p>署名可用昵称。说明原创、参考与授权范围；代码开源不代表图像自动使用相同许可。</p></section><section><h3>投稿不等于上线</h3><p>先在 GitHub 附图发布 Issue，再由维护者审核收录。未审核图片不会进入机器人，也不会自动调用生图服务。</p></section></div>
    <div className="next-step"><Icon name="info"/><span>格式检查只核对文件类型、尺寸和大小，不会自动判断三视图内容是否合格。</span></div>
    <div className="button-row guide-buttons"><a className="button secondary" href={assetUrl(template.reference.path)} download><Icon name="download"/>下载参考图</a><button className="button primary" onClick={onContribute}><Icon name="upload"/>开始投稿</button></div>
  </Modal>;
}

export default function App() {
  const [catalog, setCatalog] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);
  const focusBeforeModal = useRef(null);

  useEffect(() => {
    const abort = new AbortController();
    fetch(assetUrl('skins/catalog.json'), { signal: abort.signal }).then(response => {
      if (!response.ok) throw new Error('皮肤目录暂时无法加载。');
      return response.json();
    }).then(data => { if (data.schema !== 'whale-skin-catalog/v1' || !Array.isArray(data.skins) || !data.skins.length) throw new Error('皮肤目录格式异常。'); setCatalog(data); }).catch(e => { if (e.name !== 'AbortError') setLoadError(e.message); });
    return () => { abort.abort(); clearTimeout(toastTimer.current); };
  }, []);

  function open(type, skin = null) { focusBeforeModal.current = document.activeElement; setModal({ type, skin }); }
  function close() { setModal(null); requestAnimationFrame(() => focusBeforeModal.current?.focus()); }
  async function copy(text, success = '点图示例已复制，请到 QQ 中自行发送。') {
    let copied=false;
    try { await navigator.clipboard.writeText(text); setToast(success);copied=true; } catch { setToast('浏览器未允许复制，请展开投稿说明手动复制，或下载原图。'); }
    clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 6500);
    return copied;
  }

  if (loadError) return <main className="page-error"><WhaleMark/><h1>衣橱暂时没有打开</h1><p>{loadError}</p><button className="button primary" onClick={() => window.location.reload()}>重新加载</button><a href={SITE.github} target="_blank" rel="noreferrer">到 GitHub 查看皮肤目录</a></main>;
  if (!catalog) return <main className="loading-screen" aria-busy="true"><WhaleMark/><p>正在打开大肥鱼的衣橱…</p></main>;
  const original = catalog.skins.find(skin => skin.id === 'original') || catalog.skins[0];
  const visible = filterSkins(catalog.skins, query, category);
  const filters = [{ id:'all', name:'全部风格' }, ...catalog.skins.map(skin => ({id:skin.category, name:skin.categoryLabel})).filter((item,index,array) => array.findIndex(x => x.id === item.id) === index)];

  return <>
    <a className="skip-link" href="#wardrobe">跳到皮肤图鉴</a>
    <header className="site-header"><div className="header-inner"><a className="brand" href="#top" aria-label="大肥鱼衣橱首页"><WhaleMark/><span>大肥鱼衣橱</span></a><nav aria-label="主要导航"><a href="#wardrobe">皮肤图鉴</a><button onClick={() => open('guide')}>投稿规范</button><button onClick={() => open('submission')}>参与共创</button></nav><a className="github-link" href={SITE.github} target="_blank" rel="noreferrer">GitHub <Icon name="external" size={16}/></a></div></header>
    <main id="top">
      <section className="hero" aria-labelledby="hero-title"><div className="hero-inner"><div className="hero-copy"><h1 id="hero-title"><span>一起，</span><span>给大肥鱼换件新衣。</span></h1><svg className="hero-line" viewBox="0 0 370 50" aria-hidden="true"><path d="M2 26C75-13 117 55 201 31s102 17 166-13" fill="none" stroke="#bed2fb" strokeWidth="3"/><path d="M303 12c12-10 24 2 28 12 10 4 16-1 20-6-2 19-25 22-41 11-6-4-8-11-7-17Z" fill="#9dbbf4"/><circle cx="316" cy="18" r="1.5" fill="white"/><path d="m350 18 10-9 1 11" fill="#9dbbf4"/></svg><p>画下正面、侧面与背面，<br className="mobile-break"/>把你的灵感放进共同的衣橱。</p><div className="hero-actions"><button className="button primary" onClick={() => open('submission')}><Icon name="upload"/>投稿我的皮肤</button><button className="guide-link" onClick={() => open('guide')}>查看投稿规范 <Icon name="arrow" size={17}/></button></div></div>
        <div className="featured-skin"><div className="featured-art"><button className="art-button" onClick={() => open('detail', original)} aria-label="查看原装大肥鱼完整三视图"><img src={assetUrl(original.reference.path)} alt="原装大肥鱼正面、侧面与背面三视图" fetchPriority="high"/></button><ViewLabels/></div><div className="featured-caption"><h2>原装大肥鱼</h2><span className="short-rule"/><p>深蓝女仆裙与白色鲸鱼围裙，柔软长发、蓝眼和鲸尾。每套新衣，都从熟悉的她开始。</p><button className="button secondary" onClick={() => open('detail', original)}><Icon name="eye"/>查看三视图</button><a className="button secondary lighter" href={assetUrl(original.reference.path)} download><Icon name="download"/>下载原图</a></div></div>
      </div><Wave/></section>

      <section className="wardrobe-section" id="wardrobe" aria-labelledby="wardrobe-title"><div className="catalog-toolbar"><h2 id="wardrobe-title">衣橱里的{catalog.skins.length === 4 ? '四套' : `${catalog.skins.length} 套`}皮肤</h2><div className="catalog-controls"><label className="search"><Icon name="search"/><span className="sr-only">搜索皮肤</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索皮肤名称…" type="search"/></label><div className="filter-group" aria-label="按皮肤风格筛选">{filters.map(filter => <button key={filter.id} aria-pressed={category === filter.id} className={category === filter.id ? 'active' : ''} onClick={() => setCategory(filter.id)}>{filter.name}</button>)}</div></div></div>
        <div className="skin-grid">{visible.map(skin => <article className="skin-card" key={skin.id}><button className="card-art art-button" onClick={() => open('detail', skin)} aria-label={`查看${skin.name}三视图`}><img src={assetUrl(skin.reference.path)} alt={`${skin.name}三视图`} className={skin.id === 'pixel' ? 'pixel-art' : ''} loading="lazy"/></button><div className="card-caption"><h3>{skin.name}</h3><p>{skin.description}</p><button className="card-link" onClick={() => open('detail', skin)}>查看三视图 <Icon name="arrow" size={18}/></button></div></article>)}</div>
        {!visible.length && <div className="empty-state" role="status"><Icon name="search" size={32}/><h3>这件新衣还没放进衣橱。</h3><p>换个关键词试试，或者把你的设计投稿给大家。</p><button className="button secondary" onClick={() => {setQuery('');setCategory('all');}}>查看全部皮肤</button></div>}
      </section>
    </main>
    <footer className="site-footer"><div className="footer-note"><span/><p><a href={`${SITE.github}/blob/main/LICENSE`} target="_blank" rel="noreferrer">代码开源</a><b>·</b>投稿经审核后收录<b>·</b><a href={`${SITE.github}/blob/main/ASSET_RIGHTS.md`} target="_blank" rel="noreferrer">图片权利单独说明</a></p><span/></div><p className="footer-sub">历史皮肤保留原图，原作者署名资料待补充。本站不保存投稿图片，不连接机器人管理后台。</p><Wave/></footer>
    {modal?.type === 'detail' && <Detail skin={modal.skin} onClose={close} onCopy={copy}/>}
    {modal?.type === 'guide' && <Guide template={original} onClose={close} onContribute={() => setModal({type:'submission'})}/>}
    {modal?.type === 'submission' && <Submission template={original} onClose={close} onCopy={copy}/>}
    {toast && <div className="toast" role="status"><Icon name="check"/>{toast}<button aria-label="关闭提示" onClick={() => setToast('')}><Icon name="close" size={16}/></button></div>}
  </>;
}
