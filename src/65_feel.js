/* NOVA V5 手感引擎：声音 + 触觉 + 页面转场 + 边缘右滑返回 + 滚动阻尼
   设计原则：全部可关闭；动画只用 transform/opacity；失败一律静默降级，绝不阻断操作。 */
const IOS=/iP(hone|ad|od)/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const RM=()=>!!D.st.rm||!!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches);
const EASE='cubic-bezier(.32,.72,0,1)';

/* ---- 声音（WebAudio 合成，无外部文件） ---- */
let _ac=null;
const TONES={tap:[[740,.035,.016,0]],switch:[[510,.04,.018,0]],send:[[620,.055,.028,0],[920,.065,.024,.065]],warn:[[210,.075,.024,0]],
  open:[[430,.05,.016,0],[640,.05,.012,.045]],close:[[560,.04,.012,0],[380,.05,.01,.04]],snap:[[600,.03,.018,0]],edge:[[300,.03,.01,0]],
  success:[[520,.05,.02,0],[780,.07,.02,.06]]};
function beep(kind){
  if(D.st.sound===0)return;
  try{const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
    _ac=_ac||new AC();if(_ac.state==='suspended')_ac.resume();
    for(const [f,d,g,dl] of (TONES[kind]||TONES.tap)){const t=_ac.currentTime+dl,o=_ac.createOscillator(),n=_ac.createGain();
      o.type='sine';o.frequency.setValueAtTime(f,t);n.gain.setValueAtTime(.0001,t);n.gain.exponentialRampToValueAtTime(g,t+.008);n.gain.exponentialRampToValueAtTime(.0001,t+d);
      o.connect(n);n.connect(_ac.destination);o.start(t);o.stop(t+d+.02)}
  }catch(e){}
}
/* ---- 触觉：Android/桌面用 vibrate；iPhone Safari 没有 vibrate，用 iOS 18 的 <input switch> 触觉技巧（未在真机验证） ---- */
const HP={tap:10,switch:7,send:[10,24,12],warn:[18,30,18],open:8,close:6,snap:12,edge:6,success:[8,40,14]};
let _hx=null;
function iosTick(){try{if(!_hx){_hx=document.createElement('label');_hx.className='hxl';_hx.setAttribute('aria-hidden','true');
  const i=document.createElement('input');i.type='checkbox';i.setAttribute('switch','');_hx.appendChild(i);document.body.appendChild(_hx)}_hx.click()}catch(e){}}
function haptic(kind){
  if(D.st&&D.st.haptic===0)return;
  const N=window.NovaNative;
  if(N&&N.Haptics&&typeof N.Haptics.impact==='function'){
    const style=(kind==='warn'||kind==='success'||kind==='send')?N.ImpactStyle.Medium:N.ImpactStyle.Light;
    Promise.resolve(N.Haptics.impact({style})).catch(()=>{if(IOS)iosTick()});
    return;
  }
  if(IOS)iosTick();
}
const FEEL={log:[],cap(){const N=window.NovaNative;if(N&&N.Capacitor&&N.Capacitor.isNativePlatform&&N.Capacitor.isNativePlatform())return '使用系统振动';if(navigator.vibrate&&!IOS)return '点按会振动';if(IOS)return '这台 iPhone 的浏览器不能振动，已自动关掉';return '这台设备不能振动，仍会播放提示音'}};
function feel(kind){FEEL.log.push(kind);if(FEEL.log.length>60)FEEL.log.shift();beep(kind);haptic(kind)}
window.__feel=FEEL;
const KIND={send:['send','cs','cmsend','pub','saveedit','mkcm','mkg','grn2','sendm'],switch:['tab','go','back','user','post','cm','conv','chan','feed','cmseg','seg','mt'],
  warn:['report','delp','reset','dis2','kick','grm','gleave2','cvdel2','leave2','rmch2','delmsg'],close:['x'],success:['pin','unpin','setrole','cvpin','pinm','unpinm','setimg']};
const kindOf=a=>{for(const k in KIND)if(KIND[k].includes(a))return k;return 'tap'};
document.addEventListener('click',e=>{const el=e.target.closest('[data-a]');if(!el||el.disabled)return;feel(kindOf(el.dataset.a))},{capture:true});

/* ---- 页面转场：旧页面做成"幽灵层"滑出，新页面滑入 ---- */
let VIEW=null;
const cleanGhost=()=>document.querySelectorAll('#app>.ghost').forEach(g=>g.remove());
function ghostOf(el){
  const a=$('#app').getBoundingClientRect(),r=el.getBoundingClientRect(),g=el.cloneNode(true);
  g.classList.add('ghost');g.setAttribute('inert','');g.setAttribute('aria-hidden','true');
  g.querySelectorAll('[id]').forEach(x=>x.removeAttribute('id'));g.querySelectorAll('[data-a],[data-d],[data-af]').forEach(x=>{x.removeAttribute('data-a');x.removeAttribute('data-af');x.removeAttribute('data-d')});
  Object.assign(g.style,{left:(r.left-a.left)+'px',top:(r.top-a.top)+'px',width:r.width+'px',height:r.height+'px'});
  $('#app').appendChild(g);
  const s1=el.querySelector('.sc'),s2=g.querySelector('.sc');if(s1&&s2)s2.scrollTop=s1.scrollTop;
  return g;
}
function run(el,frames,opt,done){
  if(!el||!el.animate){done&&done();return null}
  const a=el.animate(frames,{easing:EASE,fill:'both',...opt});let fin=false;
  const end=()=>{if(fin)return;fin=true;try{a.cancel()}catch(e){}done&&done()};
  a.onfinish=end;setTimeout(end,(opt.duration||300)+250);return a;
}
const T3=x=>`translate3d(${x},0,0)`;
/* r8.3：滚动中不整页重绘。服务器推送（私信、通知、好友事件）、后台刷新等异步触发的 render() 如果正赶上手指在拖或惯性滚动，
   会用 innerHTML 换掉整个列表、打断惯性、再把 scrollTop 设回去——这就是"滑着滑着一跳"。
   这类重绘推迟到滚动停下约 160ms 后合并成一次；用户自己点按触发的重绘照常立即执行。 */
let RD_SCROLL=0,RD_DRAG=0,RD_CLICK=0,RD_T=null,RD_IN=-1e9;
/* 只把"用户手势带来的滚动"算作正在滚动：3 秒内有过触摸/滚轮（覆盖 iOS 惯性），程序自己设置 scrollTop 不算 */
['touchstart','touchmove','wheel'].forEach(t=>document.addEventListener(t,()=>{RD_IN=performance.now()},{capture:true,passive:true}));
document.addEventListener('scroll',e=>{const t=e.target;if(t&&t.classList&&t.classList.contains('sc')&&performance.now()-RD_IN<3000)RD_SCROLL=performance.now()},{capture:true,passive:true});
document.addEventListener('touchmove',e=>{if(e.target&&e.target.closest&&e.target.closest('.sc'))RD_DRAG=1},{capture:true,passive:true});
document.addEventListener('touchend',e=>{if(!e.touches||!e.touches.length)RD_DRAG=0},{capture:true,passive:true});
document.addEventListener('touchcancel',()=>{RD_DRAG=0},{capture:true,passive:true});
['click','keydown','submit','change'].forEach(t=>document.addEventListener(t,()=>{RD_CLICK++;setTimeout(()=>{RD_CLICK=Math.max(0,RD_CLICK-1)},0)},{capture:true,passive:true}));
function scrollBusy(){return RD_DRAG||performance.now()-RD_SCROLL<160}
function render(){
  if(!RD_CLICK&&MODE!=='boot'&&MODE!=='gate'&&scrollBusy()){
    if(!RD_T)RD_T=setTimeout(function wait(){if(scrollBusy()){RD_T=setTimeout(wait,120);return}RD_T=null;render()},120);
    return;
  }
  if(RD_T){clearTimeout(RD_T);RD_T=null}
  const cur=S.st[S.st.length-1],key=cur||S.tab,pv=VIEW,oldPg=$('#v .pg'),oldSh=$('#v .pn'),oldOv=$('#v .ov'),oldShKey=S.shk||null;
  const anim=!RM()&&!S.noAnim&&pv;
  let gp=null,gs=null,go=null;
  if(anim&&pv.key!==key&&oldPg)gp=ghostOf(oldPg);
  if(anim&&oldSh&&!S.sh){gs=ghostOf(oldSh);go=oldOv?ghostOf(oldOv):null}
  cleanGhostExcept([gp,gs,go]);
  renderCore();
  S.noAnim=0;
  const now={key,tab:S.tab,depth:S.st.length};
  const newPg=$('#v .pg'),newSh=$('#v .pn'),newOv=$('#v .ov');
  if(anim){
    if(gp&&newPg){
      const kind=pv.tab!==now.tab||pv.depth===now.depth?'tab':now.depth>pv.depth?'push':'pop';
      if(kind==='push'){newPg.style.zIndex=2;newPg.style.position='relative';gp.style.zIndex=1;
        run(newPg,[{transform:T3('100%')},{transform:'none'}],{duration:340},()=>{newPg.style.zIndex='';newPg.style.position=''});
        run(gp,[{transform:'none',opacity:1},{transform:T3('-26%'),opacity:.55}],{duration:340},()=>gp.remove())}
      else if(kind==='pop'){gp.style.zIndex=3;
        run(newPg,[{transform:T3('-26%'),opacity:.55},{transform:'none',opacity:1}],{duration:320});
        run(gp,[{transform:'none'},{transform:T3('100%')}],{duration:320},()=>gp.remove())}
      else{gp.style.zIndex=3;
        run(newPg,[{opacity:0,transform:'translate3d(0,8px,0)'},{opacity:1,transform:'none'}],{duration:240});
        run(gp,[{opacity:1},{opacity:0}],{duration:160},()=>gp.remove())}
    }
    if(newSh&&!oldSh){feel('open');
      run(newSh,[{transform:'translate3d(0,100%,0)'},{transform:'none'}],{duration:300});
      run(newOv,[{opacity:0},{opacity:1}],{duration:220})}
    if(gs){feel('close');gs.style.zIndex=22;if(go)go.style.zIndex=21;
      run(gs,[{transform:'none'},{transform:'translate3d(0,100%,0)'}],{duration:240,easing:'cubic-bezier(.4,0,1,1)'},()=>gs.remove());
      if(go)run(go,[{opacity:1},{opacity:0}],{duration:240},()=>go.remove())}
  }
  VIEW=now;
  if(typeof afterRender==='function')afterRender();
}
function cleanGhostExcept(keep){document.querySelectorAll('#app>.ghost').forEach(g=>{if(!keep.includes(g))g.remove()})}

/* ---- 边缘右滑返回（从屏幕左缘 24px 内向右拖） ---- */
const viewHTML=k=>k?page(k):S.tab=='home'?tHome():S.tab=='cm'?tCm():S.tab=='chat'?tChat():tMe();
let eb=null;
document.addEventListener('touchstart',e=>{
  if(e.touches.length!==1||!S.st.length||S.sh||S.crop)return;const t=e.touches[0],a=$('#app').getBoundingClientRect();
  if(t.clientX-a.left>24)return;eb={x:t.clientX,y:t.clientY,lock:0,pg:$('#v .pg'),under:null,dx:0,t0:Date.now(),w:a.width};
},{passive:true});
document.addEventListener('touchmove',e=>{
  if(!eb)return;const t=e.touches[0],dx=t.clientX-eb.x,dy=t.clientY-eb.y;
  if(!eb.lock){if(dx>8&&dx>Math.abs(dy)*1.5){eb.lock=1;
      const k=S.st.length>1?S.st[S.st.length-2]:null,tmp=document.createElement('div');tmp.innerHTML=viewHTML(k);const u=tmp.firstElementChild,r=eb.pg.getBoundingClientRect(),a=$('#app').getBoundingClientRect();
      u.classList.add('ghost');u.setAttribute('inert','');Object.assign(u.style,{left:(r.left-a.left)+'px',top:(r.top-a.top)+'px',width:r.width+'px',height:r.height+'px',zIndex:1});
      $('#app').appendChild(u);const usc=u.querySelector('.sc');if(usc&&typeof scrollKey==='function'&&typeof peekScroll==='function')usc.scrollTop=peekScroll(scrollKey(k));
      eb.under=u;eb.pg.style.position='relative';eb.pg.style.zIndex=2}
    else if(Math.abs(dy)>8){eb=null;return}else return}
  if(e.cancelable)e.preventDefault();eb.dx=Math.max(0,dx);const p=Math.min(1,eb.dx/eb.w);
  eb.pg.style.transform=T3(eb.dx+'px');eb.pg.style.boxShadow='-10px 0 24px rgba(0,0,0,.28)';
  eb.under.style.transform=T3((-26+26*p)+'%');eb.under.style.opacity=.55+.45*p;
},{passive:false});
const ebEnd=commit=>{
  if(!eb)return;const b=eb;eb=null;if(!b.lock)return;
  const fin=()=>{b.under&&b.under.remove();b.pg.style.cssText=''};
  if(commit){feel('snap');
    run(b.pg,[{transform:T3(b.dx+'px')},{transform:T3('100%')}],{duration:200,easing:'cubic-bezier(.3,.6,.4,1)'},()=>{b.under&&b.under.remove();S.noAnim=1;A.back();render()});
    run(b.under,[{transform:b.under.style.transform,opacity:b.under.style.opacity},{transform:'none',opacity:1}],{duration:200})}
  else{run(b.pg,[{transform:T3(b.dx+'px')},{transform:'none'}],{duration:240},fin);run(b.under,[{transform:b.under.style.transform},{transform:T3('-26%')}],{duration:240})}
};
document.addEventListener('touchend',()=>{if(!eb)return;const v=eb.dx/Math.max(1,Date.now()-eb.t0);ebEnd(eb.dx>eb.w*.33||v>.6)},{passive:true});
document.addEventListener('touchcancel',()=>ebEnd(false),{passive:true});
window.__edgeBack=ebEnd;

/* ---- 滚动阻尼：到顶/到底继续拖会有橡皮筋感。iPhone 自带原生回弹，不重复做 ---- */
let od=null;
document.addEventListener('touchstart',e=>{
  if(IOS||eb||RM())return;const sc=e.target.closest&&e.target.closest('.sc');if(!sc||e.touches.length!==1)return;
  od={sc,y:e.touches[0].clientY,off:0,on:0,tick:0};
},{passive:true});
document.addEventListener('touchmove',e=>{
  if(!od||eb)return;const sc=od.sc,d=e.touches[0].clientY-od.y,top=sc.scrollTop<=0,bot=sc.scrollTop+sc.clientHeight>=sc.scrollHeight-1;
  if(!od.on&&!((top&&d>0)||(bot&&d<0)))return;
  if(!od.on){od.on=1;od.y=e.touches[0].clientY;return}
  const dd=e.touches[0].clientY-od.y;if((top&&dd<=0&&!bot)||(bot&&dd>=0&&!top)){od.off=0;sc.style.transform='';return}
  if(e.cancelable)e.preventDefault();const s=Math.sign(dd),m=Math.abs(dd);od.off=s*Math.min(130,m*.42*(1-Math.min(.6,m/900)));
  sc.style.transition='none';sc.style.transform=`translate3d(0,${od.off}px,0)`;
  if(!od.tick&&Math.abs(od.off)>50){od.tick=1;feel('edge')}
},{passive:false});
const odEnd=()=>{if(!od)return;const sc=od.sc;if(od.on){sc.style.transition='transform .5s cubic-bezier(.2,1.1,.3,1)';sc.style.transform='';setTimeout(()=>{sc.style.transition=''},520)}od=null};
document.addEventListener('touchend',odEnd,{passive:true});document.addEventListener('touchcancel',odEnd,{passive:true});
