/* ===== VEXO 2.0.7（续）=====
   1. 来源标签通用化：「来自 X」优先用服务器给的 sourceLabel / sourceName / origin.name，没有时按来源代码查表，最后直接显示代码。
   2. 自动翻译（K）：设置里或首页顶栏「译」打开后，外文帖子/评论滑进屏幕时自动翻译成中文（界面英文时翻成英文）。
      - 只翻进入视口的内容；多条合并成一次请求（≤8 条或约 1800 字，用 [[n]] 分隔），解析失败退回逐条；
      - 结果存在本机（按 id+内容摘要），同一条不重复请求；服务器若已返回 translations.zh / trZh 直接用；
      - 客户端自限每小时 40 次自动请求（服务器上限 60/小时，给手动翻译留余量），遇到 429 暂停 10 分钟；
      - 每条显示「已翻译 · 查看原文」，可随时切回。 */

/* ---------- 1. 来源标签 ---------- */
const SRC_NAMES={hn:'HN',hackernews:'HN',v2ex:'V2EX',sspai:'少数派',ithome:'IT之家',juejin:'掘金',solidot:'Solidot',github:'GitHub Trending','github-trending':'GitHub Trending',githubtrending:'GitHub Trending',gh_trending:'GitHub Trending',producthunt:'Product Hunt','product-hunt':'Product Hunt',ph:'Product Hunt',bilibili:'B站热门',bili:'B站热门',panews:'PANews',cointelegraph:'Cointelegraph',gcores:'机核',ign:'IGN',wallstreetcn:'华尔街见闻',wscn:'华尔街见闻'};
function extSrcName(p){p=p||{};const o=p.origin;return p.sourceName||p.originName||(o&&typeof o==='object'?(o.label||o.name):'')||SRC_NAMES[String(p.source||'').toLowerCase()]||String(p.source||'')}
function extSrcLabel(p){p=p||{};if(p.sourceLabel)return p.sourceLabel;if(p.origin&&p.origin.label)return p.origin.label;const n=extSrcName(p);return n?'来自 '+n:''}

/* ---------- 2. 自动翻译 ---------- */
const ATR_KEY='vexo_atr_on',ATR_CACHE='vexo_atr_cache_v1',ATR_CALLS='vexo_atr_calls',ATR_MAX=1500,ATR_HOURLY=40;
const ATR={pend:new Set(),q:[],busy:0,orig:new Set(),src:new Map(),fail:new Set(),pauseUntil:0,timer:0};
function atrOn(){try{return localStorage.getItem(ATR_KEY)==='1'}catch(e){return false}}
function atrTo(){return typeof LANG!=='undefined'&&LANG==='en'?'en':'zh'}
let ATRC=null,ATRS=0;
function atrC(){if(!ATRC){try{ATRC=JSON.parse(localStorage.getItem(ATR_CACHE)||'{}')||{}}catch(e){ATRC={}}}return ATRC}
function atrSave(){clearTimeout(ATRS);ATRS=setTimeout(()=>{const c=atrC(),ks=Object.keys(c);if(ks.length>ATR_MAX)ks.slice(0,ks.length-ATR_MAX).forEach(k=>delete c[k]);try{localStorage.setItem(ATR_CACHE,JSON.stringify(c))}catch(e){}},300)}
function atrHash(s){s=String(s);let h=5381;for(let i=0;i<s.length;i++)h=((h<<5)+h+s.charCodeAt(i))|0;return (h>>>0).toString(36)+s.length.toString(36)}
/* 需要翻译吗：去掉链接/@/# 后，目标是中文时汉字占比 <30% 且有拉丁/其他文字；目标是英文时含汉字才翻 */
function atrNeed(text){
  const t=String(text||'').replace(/https?:\/\/\S+/g,'').replace(/[@#][^\s#@]+/g,'').replace(/[\s\d\p{P}\p{S}]/gu,'');
  if(t.length<2)return false;
  const cjk=(t.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g)||[]).length;
  const han=(t.match(/[\u3400-\u9fff\uf900-\ufaff]/g)||[]).length;
  if(atrTo()==='en')return han>0;
  return han/t.length<.3&&(t.length-cjk>=2||cjk>han);
}
function atrSrv(obj){if(!obj)return '';const to=atrTo(),tr=obj.translations;return (tr&&typeof tr==='object'&&tr[to])||(to==='zh'?obj.trZh:obj.trEn)||''}
function atrCk(k,text){return atrTo()+'|'+k+'|'+atrHash(text)}
function atrNote(k,tr){return `<span class="atrn" data-ut>${tr?'已翻译 · ':'原文 · '}<button type="button" class="lk" data-a="atrorig" data-v="${esc(k)}">${tr?'查看原文':'查看翻译'}</button></span>`}
function atrBody(k,text,obj){
  const raw=esc(text);
  if(!text||!atrOn()||!atrNeed(text))return raw;
  const tr=atrSrv(obj)||atrC()[atrCk(k,text)];
  if(tr){ATR.src.set(k,{text,obj});return ATR.orig.has(k)?`<span class="atro" data-atrk="${esc(k)}">${raw}</span>${atrNote(k,false)}`:`<span class="atrt" data-atrk="${esc(k)}" data-ut>${esc(tr)}</span>${atrNote(k,true)}`}
  if(typeof aiOn==='function'&&!aiOn())return raw;
  ATR.src.set(k,{text,obj});
  return `<span data-trk="${esc(k)}" data-atrk="${esc(k)}">${raw}</span>`;
}
function atrCalls(){let a=[];try{a=JSON.parse(localStorage.getItem(ATR_CALLS)||'[]')||[]}catch(e){}const now=Date.now();return a.filter(t=>now-t<3600e3)}
function atrBudget(){return Date.now()>=ATR.pauseUntil&&atrCalls().length<ATR_HOURLY}
function atrSpend(){const a=atrCalls();a.push(Date.now());try{localStorage.setItem(ATR_CALLS,JSON.stringify(a))}catch(e){}}
function atrEnq(k){
  if(!atrOn()||ATR.pend.has(k)||ATR.fail.has(k))return;
  const s=ATR.src.get(k);if(!s)return;
  if(atrC()[atrCk(k,s.text)])return atrPatch(k);
  ATR.pend.add(k);ATR.q.push(k);clearTimeout(ATR.timer);ATR.timer=setTimeout(atrFlush,350);
}
/* 把这一条在页面上就地换成译文，不整页重绘 */
function atrPatch(k){
  const s=ATR.src.get(k);if(!s)return;
  document.querySelectorAll('[data-atrk]').forEach(el=>{if(el.getAttribute('data-atrk')!==k)return;
    const nx=el.nextElementSibling;if(nx&&nx.classList.contains('atrn'))nx.remove();
    const w=document.createElement('span');w.innerHTML=atrBody(k,s.text,s.obj);el.replaceWith(...w.childNodes)});
}
function atrParse(out,n){
  const parts=String(out||'').split(/\[\[\s*(\d+)\s*\]\]/);const res=new Array(n).fill('');let hit=0;
  for(let i=1;i<parts.length;i+=2){const ix=+parts[i]-1;const v=(parts[i+1]||'').trim();if(ix>=0&&ix<n&&v&&!res[ix]){res[ix]=v;hit++}}
  return hit===n?res:null;
}
async function atrFlush(){
  if(ATR.busy||!ATR.q.length)return;
  if(!atrOn()){ATR.q.forEach(k=>ATR.pend.delete(k));ATR.q=[];return}
  if(!atrBudget()){ATR.q.forEach(k=>ATR.pend.delete(k));ATR.q=[];return}
  const batch=[];let len=0;
  while(ATR.q.length&&batch.length<8){const k=ATR.q[0],s=ATR.src.get(k);if(!s){ATR.q.shift();ATR.pend.delete(k);continue}
    const t=[...String(s.text)].slice(0,1800).join('');if(batch.length&&len+t.length>1800)break;ATR.q.shift();batch.push({k,t,s});len+=t.length+8;
    if(s.single)break}
  if(!batch.length)return;
  const one=batch.length===1;
  const text=one?batch[0].t:batch.map((b,i)=>`[[${i+1}]] ${b.t}`).join('\n\n');
  ATR.busy=1;atrSpend();
  let r;try{r=await api('POST','/api/ai/translate',{text:[...text].slice(0,2000).join(''),to:atrTo()})}catch(e){r={s:0}}
  ATR.busy=0;
  if(!r||r.s!==200){
    if(r&&r.s===429)ATR.pauseUntil=Date.now()+10*60e3;else if(r&&(r.s===503||!r.s))ATR.pauseUntil=Date.now()+2*60e3;else batch.forEach(b=>ATR.fail.add(b.k));
    batch.forEach(b=>ATR.pend.delete(b.k));
  }else{
    const out=String(r.j&&r.j.text||'');
    const res=one?[out.trim()]:atrParse(out,batch.length);
    if(!res){batch.forEach(b=>{b.s.single=1;ATR.pend.delete(b.k)});batch.forEach(b=>atrEnq(b.k))}
    else{const c=atrC();batch.forEach((b,i)=>{ATR.pend.delete(b.k);if(res[i]){c[atrCk(b.k,b.s.text)]=res[i];atrPatch(b.k)}else ATR.fail.add(b.k)});atrSave()}
  }
  if(ATR.q.length)setTimeout(atrFlush,300);
}
function atrRow(){const on=atrOn();return `<div class="row"><div class="gr"><b>自动翻译</b><small>外文帖子和评论滑到眼前时自动翻译成${atrTo()==='en'?'英文':'中文'}，可随时查看原文</small></div><button class="pb${on?'':' s'}" data-a="atrtoggle" aria-pressed="${on}">${on?'已开启':'已关闭'}</button></div>`}
function atrFab(){if(typeof aiOn==='function'&&!aiOn())return '';const on=atrOn();return `<button class="ib atrfab${on?' on':''}" data-a="atrtoggle" data-ut aria-pressed="${on}" aria-label="${on?'关闭自动翻译':'打开自动翻译'}" title="自动翻译">译</button>`}
Object.assign(A,{
  atrtoggle:()=>{const on=!atrOn();try{localStorage.setItem(ATR_KEY,on?'1':'0')}catch(e){}if(on){ATR.fail.clear()}T(on?'已开启自动翻译：外文内容会自动翻成'+(atrTo()==='en'?'英文':'中文'):'已关闭自动翻译')},
  atrorig:v=>{const k=String(v||'');if(ATR.orig.has(k))ATR.orig.delete(k);else ATR.orig.add(k);atrPatch(k)},
});
if(typeof IntersectionObserver!=='undefined'){
  const io=new IntersectionObserver(es=>es.forEach(en=>{if(!en.isIntersecting)return;const el=en.target;io.unobserve(el);const k=el.getAttribute('data-trk');if(k&&el.isConnected)atrEnq(k)}),{rootMargin:'150px 0px'});
  const seen=new WeakSet();
  const scan=()=>{if(!atrOn())return;document.querySelectorAll('[data-trk]').forEach(el=>{if(!seen.has(el)){seen.add(el);io.observe(el)}})};
  if(typeof MutationObserver!=='undefined'&&document.getElementById('app')){let q=0;new MutationObserver(()=>{if(q)return;q=1;requestAnimationFrame(()=>{q=0;scan()})}).observe(document.getElementById('app'),{childList:true,subtree:true})}
  window.__atr={ATR,atrParse,atrNeed,scan};
}
