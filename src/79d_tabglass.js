/* ===== 2.0.1 底部标签栏：液态玻璃（Liquid Glass）指示块 + 拖动切换 =====
   - 当前标签后面有一块半透明玻璃胶囊（backdrop-filter 模糊 + 饱和、内高光、柔和阴影；不支持时用半透明底色）；
   - 切换标签时胶囊用弹簧曲线滑到新位置，途中轻微拉伸、到位略回弹；当前图标放大约 1.15 倍；
   - 按住标签栏左右拖：胶囊跟手（速度越快拉伸越多），经过哪个标签就高亮哪个并轻震一下，松手吸附到最近的标签并切过去；
   - 只用 transform / opacity 做动画；系统「减少动态效果」或 App 里开了「减少动态效果」时不做滑动和拉伸。
   标签栏每次 render() 都会重建，这里记住上一次的位置，新建后从旧位置动画到新位置。 */
const TG={x:null,w:0,drag:null};
function tgReduced(){try{return (D.st&&D.st.rm)||matchMedia('(prefers-reduced-motion: reduce)').matches}catch(e){return false}}
function tgBtns(nav){return [...nav.querySelectorAll(':scope > button[data-a=tab]')]}
function tgPos(nav,b){return b.offsetLeft+4}
function tgSet(p,x,sx){p.style.transform=`translate3d(${x}px,0,0) scaleX(${sx||1})`}
function tgHaptic(){try{const N=window.NovaNative;if(D.st&&D.st.haptic===0)return;if(N&&N.Haptics){if(typeof N.Haptics.selectionChanged==='function'){N.Haptics.selectionStart&&N.Haptics.selectionStart();Promise.resolve(N.Haptics.selectionChanged()).catch(()=>{});return}if(typeof N.Haptics.impact==='function'){Promise.resolve(N.Haptics.impact({style:N.ImpactStyle&&N.ImpactStyle.Light})).catch(()=>{});return}}if(navigator.vibrate&&!(typeof IOS!=='undefined'&&IOS))navigator.vibrate(6)}catch(e){}}
function tgMount(nav){
  if(nav._tg)return;nav._tg=1;
  const btns=tgBtns(nav);if(!btns.length)return;
  const i=btns.findIndex(b=>b.classList.contains('on'));
  const p=document.createElement('i');p.className='tgpill';p.setAttribute('aria-hidden','true');nav.insertBefore(p,nav.firstChild);
  const b=btns[Math.max(0,i)],w=b.offsetWidth-8;p.style.width=w+'px';TG.w=w;
  if(i<0){p.style.opacity='0'}
  const to=tgPos(nav,b),from=TG.x;
  TG.x=to;
  if(from==null||Math.abs(from-to)<1||tgReduced()||typeof p.animate!=='function'){tgSet(p,to,1);return}
  /* 弹簧：中途拉伸，结尾略过头再回来 */
  const mid=(from+to)/2,dir=Math.sign(to-from),st=Math.min(1.35,1+Math.abs(to-from)/(w*4));
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
  const p=nav.querySelector('.tgpill');if(!p)return;
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
  const d=TG.drag;if(!d||e.pointerId!==d.id)return;TG.drag=null;
  if(!d.moved)return;
  d.nav.classList.remove('tgdrag');
  S.nc=Date.now();/* 吞掉松手后浏览器补发的 click */
  const btns=tgBtns(d.nav),b=btns[Math.max(0,d.idx)];if(!b)return;
  TG.x=d.x!=null?d.x:TG.x;
  const v=b.getAttribute('data-v');
  if(S.tab===v&&!(S.st&&S.st.length)){const to=tgPos(d.nav,b);if(!tgReduced()&&d.p.animate)d.p.animate([{transform:d.p.style.transform},{transform:`translate3d(${to}px,0,0) scaleX(1)`}],{duration:380,easing:'cubic-bezier(.3,1.35,.5,1)'});tgSet(d.p,to,1);TG.x=to;return}
  Promise.resolve(A.tab(v)).then(()=>{if(typeof render==='function')render()});
}
if(typeof document!=='undefined'){
  const scan=()=>{const n=document.querySelector('#app .fnav');if(n)tgMount(n)};
  if(typeof MutationObserver!=='undefined'){let q=0;new MutationObserver(()=>{if(q)return;q=1;requestAnimationFrame(()=>{q=0;scan()})}).observe(document.documentElement,{childList:true,subtree:true})}
  document.addEventListener('pointerdown',tgDown,{passive:true});
  document.addEventListener('pointermove',tgMove,{passive:true});
  document.addEventListener('pointerup',tgUp,{passive:true});
  document.addEventListener('pointercancel',e=>{const d=TG.drag;if(d&&e.pointerId===d.id){TG.drag=null;d.nav.classList.remove('tgdrag');if(d.moved&&typeof render==='function')render()}},{passive:true});
  window.addEventListener('resize',()=>{TG.x=null;const n=document.querySelector('#app .fnav');if(n){const p=n.querySelector('.tgpill'),b=tgBtns(n).find(x=>x.classList.contains('on'));if(p&&b){p.style.width=(b.offsetWidth-8)+'px';TG.w=b.offsetWidth-8;tgSet(p,tgPos(n,b),1);TG.x=tgPos(n,b)}}});
}
