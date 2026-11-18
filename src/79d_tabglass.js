/* ===== 2.0.1 底部标签栏：液态玻璃（Liquid Glass）指示块 + 拖动切换 =====
   - 当前标签后面有一块半透明玻璃胶囊（backdrop-filter 模糊 + 饱和、内高光、柔和阴影；不支持时用半透明底色）；
   - 切换标签时胶囊用弹簧曲线滑到新位置，途中轻微拉伸、到位略回弹；当前图标放大约 1.15 倍；
   - 按住标签栏左右拖：胶囊跟手（速度越快拉伸越多），经过哪个标签就高亮哪个并轻震一下，松手吸附到最近的标签并切过去；
   - 只用 transform / opacity 做动画；系统「减少动态效果」或 App 里开了「减少动态效果」时不做滑动和拉伸。
   标签栏每次 render() 都会重建，这里记住上一次的位置，新建后从旧位置动画到新位置。
   松手后必须立刻吸附到当前项，不能等整页重绘；滚动推迟的 render() 不能把指示块留在两个标签中间。 */
const TG={x:null,w:0,drag:null};
function tgReduced(){try{return (D.st&&D.st.rm)||matchMedia('(prefers-reduced-motion: reduce)').matches}catch(e){return false}}
function tgBtns(nav){return [...nav.querySelectorAll(':scope > button[data-a=tab]')]}
function tgRect(nav,b){
  const nr=nav.getBoundingClientRect(),br=b.getBoundingClientRect();
  /* left:0 是相对 nav 的 padding box，getBoundingClientRect 含边框，要减去 clientLeft */
  return {x:br.left-nr.left-(nav.clientLeft||0)+4,w:Math.max(0,br.width-8)};
}
function tgPos(nav,b){return tgRect(nav,b).x}
function tgSet(p,x,sx){p.style.transform=`translate3d(${x}px,0,0) scaleX(${sx||1})`}
function tgPill(nav){
  const all=[...nav.querySelectorAll(':scope > .tgpill')];
  all.slice(1).forEach(n=>n.remove());
  return all[0]||null;
}
function tgHaptic(){try{if(typeof haptic==='function')haptic('switch')}catch(e){}}
function tgSnap(nav,b,from){
  if(!nav||!b)return;
  const p=tgPill(nav);if(!p)return;
  const {x:to,w}=tgRect(nav,b);
  p.style.width=w+'px';p.style.opacity='1';TG.w=w;
  const start=from==null?TG.x:from;
  if(p.getAnimations)p.getAnimations().forEach(a=>a.cancel());
  if(start==null||Math.abs(start-to)<1||tgReduced()||typeof p.animate!=='function'){tgSet(p,to,1);TG.x=to;return}
  const mid=(start+to)/2,dir=Math.sign(to-start),st=Math.min(1.35,1+Math.abs(to-start)/(w*4||1));
  tgSet(p,to,1);
  p.animate([
    {transform:`translate3d(${start}px,0,0) scaleX(1)`},
    {transform:`translate3d(${mid}px,0,0) scaleX(${st})`,offset:.45},
    {transform:`translate3d(${to+dir*Math.min(6,w*.06)}px,0,0) scaleX(.97)`,offset:.78},
    {transform:`translate3d(${to}px,0,0) scaleX(1)`}
  ],{duration:380,easing:'cubic-bezier(.3,1.35,.5,1)'});
  TG.x=to;
}
function tgGo(nav,idx){
  const btns=tgBtns(nav),b=btns[Math.max(0,idx)];if(!b)return;
  const from=TG.drag&&TG.drag.x!=null?TG.drag.x:TG.x;
  tgSnap(nav,b,from);
  const v=b.getAttribute('data-v');
  if(S.tab===v&&!(S.st&&S.st.length))return;
  Promise.resolve(A.tab(v)).then(()=>{if(typeof render==='function')render(true)});
}
function tgMount(nav){
  if(TG.drag&&TG.drag.nav===nav&&TG.drag.moved)return;
  const btns=tgBtns(nav);if(!btns.length)return;
  let p=tgPill(nav);
  if(!p){p=document.createElement('i');p.className='tgpill';p.setAttribute('aria-hidden','true');nav.insertBefore(p,nav.firstChild)}
  const i=btns.findIndex(b=>b.classList.contains('on'));
  const b=btns[Math.max(0,i)],{x:to,w}=tgRect(nav,b);
  if(w<8){requestAnimationFrame(()=>{if(!(TG.drag&&TG.drag.moved))tgMount(nav)});return}
  p.style.width=w+'px';TG.w=w;
  if(i<0){p.style.opacity='0'}else{p.style.opacity='1'}
  const from=TG.x;
  TG.x=to;
  if(nav._tg&&Math.abs((from==null?to:from)-to)<1){tgSet(p,to,1);return}
  nav._tg=1;
  if(from==null||Math.abs(from-to)<1||tgReduced()||typeof p.animate!=='function'){tgSet(p,to,1);return}
  /* 弹簧：中途拉伸，结尾略过头再回来 */
  const mid=(from+to)/2,dir=Math.sign(to-from),st=Math.min(1.35,1+Math.abs(to-from)/(w*4||1));
  tgSet(p,to,1);
  p.animate([
    {transform:`translate3d(${from}px,0,0) scaleX(1)`},
    {transform:`translate3d(${mid}px,0,0) scaleX(${st})`,offset:.45},
    {transform:`translate3d(${to+dir*Math.min(6,w*.06)}px,0,0) scaleX(.97)`,offset:.78},
    {transform:`translate3d(${to}px,0,0) scaleX(1)`}
  ],{duration:520,easing:'cubic-bezier(.22,.9,.3,1)'});
  const ic=b.querySelector('svg');if(ic&&typeof ic.animate==='function')ic.animate([{transform:'scale(1)'},{transform:'scale(1.22)',offset:.6},{transform:'scale(1.15)'}],{duration:380,easing:'cubic-bezier(.3,1.4,.5,1)'});
}
/* 拖动切换（指针事件；只在标签栏上，不影响页面里的左右滑动） */
function tgDown(e){
  const nav=e.target.closest&&e.target.closest('.fnav');if(!nav||e.button>0)return;
  const p=tgPill(nav);if(!p)return;
  TG.drag={nav,p,id:e.pointerId,x0:e.clientX,lastX:e.clientX,lastT:performance.now(),moved:false,idx:tgBtns(nav).findIndex(b=>b.classList.contains('on'))};
}
function tgMove(e){
  const d=TG.drag;if(!d||e.pointerId!==d.id)return;
  if(!d.moved){if(Math.abs(e.clientX-d.x0)<8)return;d.moved=true;try{d.nav.setPointerCapture(e.pointerId)}catch(_){}d.nav.classList.add('tgdrag');try{p0(d)}catch(_){}}
  const r=d.nav.getBoundingClientRect(),btns=tgBtns(d.nav),w=TG.w||d.p.offsetWidth;
  const x=Math.max(4,Math.min(r.width-w-4,e.clientX-r.left-w/2));
  const t=performance.now(),v=(e.clientX-d.lastX)/Math.max(1,t-d.lastT);d.lastX=e.clientX;d.lastT=t;
  tgSet(d.p,x,tgReduced()?1:1+Math.min(.3,Math.abs(v)*.12));
  const k=btns.findIndex(b=>{const br=b.getBoundingClientRect();return e.clientX>=br.left&&e.clientX<br.right});
  if(k>=0&&k!==d.idx){d.idx=k;btns.forEach((b,j)=>b.classList.toggle('on',j===k));tgHaptic()}
  d.x=x;
}
function p0(d){d.p.getAnimations&&d.p.getAnimations().forEach(a=>a.cancel());d.p.style.opacity='1'}
function tgUp(e){
  const d=TG.drag;if(!d||e.pointerId!==d.id)return;
  d.nav.classList.remove('tgdrag');
  TG.drag=null;
  if(!d.moved)return;
  S.nc=Date.now();/* 吞掉松手后浏览器补发的 click */
  tgGo(d.nav,d.idx);
}
function tgCancel(e){
  const d=TG.drag;if(!d||(e&&e.pointerId!=null&&e.pointerId!==d.id))return;
  d.nav.classList.remove('tgdrag');
  TG.drag=null;
  if(!d.moved)return;
  S.nc=Date.now();
  tgGo(d.nav,d.idx);
}
function tgRelayout(){
  if(TG.drag&&TG.drag.moved)return;
  const n=document.querySelector('#app .fnav');if(!n)return;
  const p=tgPill(n),b=tgBtns(n).find(x=>x.classList.contains('on'));
  if(p&&b){const {x,w}=tgRect(n,b);p.style.width=w+'px';TG.w=w;tgSet(p,x,1);TG.x=x}
}
if(typeof document!=='undefined'){
  const scan=()=>{const n=document.querySelector('#app .fnav');if(n)tgMount(n)};
  if(typeof MutationObserver!=='undefined'){let q=0;new MutationObserver(()=>{if(q)return;q=1;requestAnimationFrame(()=>{q=0;scan()})}).observe(document.documentElement,{childList:true,subtree:true})}
  document.addEventListener('pointerdown',tgDown,{passive:true});
  document.addEventListener('pointermove',tgMove,{passive:true});
  document.addEventListener('pointerup',tgUp,{passive:true});
  document.addEventListener('pointercancel',tgCancel,{passive:true});
  document.addEventListener('lostpointercapture',tgCancel,{passive:true,capture:true});
  window.addEventListener('resize',()=>{TG.x=null;tgRelayout()});
  if(window.visualViewport)visualViewport.addEventListener('resize',()=>{tgRelayout()});
}
