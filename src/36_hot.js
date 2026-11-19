/* 热榜：V2EX / Hacker News。只展示标题、热度、作者、时间和原帖链接，不展示正文。
   数据来自本服务器 GET /api/hot；列表结构参考 MIT 项目 https://github.com/jiacai2050/mofish */
function hotState(){return S.hot||(S.hot={src:'v2ex'})}
function hotOpenSrc(){const st=hotState();return st.src==='hn'?'hn':'v2ex'}
function hotFmtTime(ts){
  if(!ts)return '';
  if(typeof fmtTime==='function')return fmtTime(ts);
  try{return new Date(ts).toLocaleString()}catch(e){return ''}
}
function hotFmtHeat(src,n){
  n=Number(n)||0;
  const s=typeof fmtCount==='function'?fmtCount(n):String(n);
  return src==='hn'?s+' 分':s+' 回复';
}
function hotIcon(){
  return '<svg class="ic-line" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3s4 4.2 4 8a4 4 0 0 1-8 0c0-1.7.6-3.2 2-5 0 2-1 3-1 5a3 3 0 0 0 6 0c0-3.2-3-6.5-3-8z"/><path d="M9.5 17.5c.6 1.4 1.7 2.5 2.5 2.5s1.9-1.1 2.5-2.5"/></svg>';
}
function hotCard(){
  return `<button type="button" class="gmini" data-a="hot"><span class="ico">${hotIcon()}</span><span class="gr"><b>热榜</b><small>V2EX 和 Hacker News 热门</small></span></button>`;
}
function loadHot(src, force){
  const st=hotState();
  src=src==='hn'?'hn':'v2ex';
  st.src=src;
  const slot=st[src]||(st[src]={items:[],loading:false});
  if(!usingNet()||!SESSION){slot.err='请先登录';slot.loading=false;return Promise.resolve(slot)}
  if(slot.loading)return slot._p||Promise.resolve(slot);
  if(!force&&slot.items&&slot.items.length&&!slot.err)return Promise.resolve(slot);
  slot.loading=true;slot.err='';
  const p=api('GET','/api/hot?source='+encodeURIComponent(src)).then(r=>{
    slot.loading=false;
    if(r.s!==200){slot.err=(r.j&&r.j.message)||'暂时无法获取热榜，请稍后再试。';return slot}
    const j=r.j||{};
    slot.items=Array.isArray(j.items)?j.items:[];
    slot.fetchedAt=j.fetchedAt||null;
    slot.label=j.sourceLabel||(src==='hn'?'Hacker News':'V2EX');
    slot.home=j.sourceHome||(src==='hn'?'https://news.ycombinator.com':'https://www.v2ex.com');
    slot.attr=j.attribution||null;
    return slot;
  }).catch(()=>{slot.loading=false;slot.err='暂时无法获取热榜，请稍后再试。';return slot});
  slot._p=p;
  return p;
}
function hotAttrHtml(attr, slot){
  const a=attr||(slot&&slot.attr)||{};
  const text=a.text||'热榜来自 V2EX 和 Hacker News 官方接口，列表结构参考开源项目 mofish。';
  const v2=a.v2ex||'https://www.v2ex.com';
  const hn=a.hn||'https://news.ycombinator.com';
  const mo=a.mofish||'https://github.com/jiacai2050/mofish';
  return `<p class="hot-attr">${esc(text)} <a href="${esc(v2)}" target="_blank" rel="noopener noreferrer">V2EX</a> · <a href="${esc(hn)}" target="_blank" rel="noopener noreferrer">Hacker News</a> · <a href="${esc(mo)}" target="_blank" rel="noopener noreferrer">mofish</a></p>`;
}
function hotListHtml(src){
  const st=hotState();
  const slot=st[src]||{};
  if(slot.loading&&!(slot.items&&slot.items.length))return '<p class="em">正在读取热榜…</p>';
  if(slot.err&&!(slot.items&&slot.items.length))return `<p class="em">${esc(slot.err)}</p>`;
  const items=slot.items||[];
  if(!items.length)return '<p class="em">暂时没有热门条目。</p>';
  const home=slot.home||(src==='hn'?'https://news.ycombinator.com':'https://www.v2ex.com');
  const label=slot.label||(src==='hn'?'Hacker News':'V2EX');
  const rows=items.map(it=>{
    const meta=[hotFmtHeat(src,it.heat),it.author?('@'+it.author):'',hotFmtTime(it.publishedAt)].filter(Boolean).join(' · ');
    const url=String(it.url||'');
    const safe=/^https?:\/\//i.test(url)?url:'';
    return `<article class="hot-item"><a class="hot-title" href="${esc(safe)}" target="_blank" rel="noopener noreferrer">${esc(it.title||'')}</a><p class="hot-meta">${esc(meta)}</p>${safe?`<a class="hot-orig" href="${esc(safe)}" target="_blank" rel="noopener noreferrer">查看原帖</a>`:''}</article>`;
  }).join('');
  return `<div class="hot-src"><a href="${esc(home)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a></div><div class="hot-list">${rows}</div>`;
}
const pHot=()=>{
  const src=hotOpenSrc();
  const st=hotState();
  const slot=st[src]||{};
  return `<div class="pg hot-pg">${sub('热榜')}<div class="seg"><button data-a="hotseg" data-v="v2ex" class="${src==='v2ex'?'on':''}">V2EX</button><button data-a="hotseg" data-v="hn" class="${src==='hn'?'on':''}">Hacker News</button></div><div class="sc hot-sc">${hotListHtml(src)}${hotAttrHtml(slot.attr,slot)}</div></div>`;
};
