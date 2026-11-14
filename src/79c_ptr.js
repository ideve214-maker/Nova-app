/* ===== 2.0.1 首页下拉刷新（和管理端一样）：刷新动态 + 检查热更新清单（有新版本直接弹更新对话框，不用重启） =====
   r8.3 去掉过 pulltorefreshjs：它在 iOS 上和系统顶部回弹抢手势，松手瞬间整页重绘导致抖动。这次的做法：
   - 只监听被动触摸事件（passive），不 preventDefault，不改滚动区的位置和高度，回弹仍由系统自己完成；
   - 提示条挂在 #app 上、固定定位，不在滚动内容里，render() 不会把它清掉，也不会挤动列表；
   - 只在首页滚动区已经在最顶部时开始；横向滑动、弹层打开、正在刷新时不触发；
   - 刷新完成后等回弹结束（scrollTop 回到 >= 0）、手指已松开再重绘（见 19_feed.js 的 ptrSettle）。 */
const PTR={y0:null,x0:0,dy:0,armed:false,touch:false,busy:false,sc:null,TH:72};
function ptrTxt(k){const en=typeof LANG!=='undefined'&&LANG==='en';return ({pull:en?'Pull to refresh':'下拉刷新',release:en?'Release to refresh':'松开刷新',busy:en?'Refreshing…':'正在刷新…',done:en?'Updated':'已刷新',fail:en?'Couldn’t refresh':'刷新失败'})[k]||''}
function ptrEl(){let e=document.getElementById('ptri');if(!e){e=document.createElement('div');e.id='ptri';e.setAttribute('data-ut','1');e.setAttribute('aria-live','polite');(document.getElementById('app')||document.body).appendChild(e)}return e}
function ptrShow(state,p){
  const e=ptrEl();
  if(!state){e.className='';e.style.cssText='';return}
  const k=state==='pull'&&p>=1?'release':state;
  e.className='on '+k;
  const pr=state==='pull'?Math.max(0,Math.min(1,p)):1;
  e.style.opacity=String(state==='pull'?Math.min(1,pr*1.4):1);
  e.style.transform='translate(-50%,'+Math.round((pr-1)*24)+'px)';
  e.innerHTML=`<i class="ptrs${state==='busy'?' spin':''}" style="transform:rotate(${state==='pull'?Math.round(pr*180):0}deg)">${state==='busy'?'':state==='done'?'✓':state==='fail'?'!':'↓'}</i><span>${ptrTxt(k)}</span>`;
}
function ptrBlocked(){return !!(S.sh||S.feedRefreshing||document.querySelector('#upddlg .updm,.pswp--open,[role=dialog]'))}
async function ptrSettle(){
  const sc=typeof homeSc==='function'?homeSc():null;
  for(let i=0;i<40;i++){if(!PTR.touch&&(!sc||(sc.scrollTop||0)>=0))return;await new Promise(r=>setTimeout(r,25))}
}
async function ptrRun(){
  if(PTR.busy)return;PTR.busy=true;ptrShow('busy');
  let ok=true;
  try{
    const jobs=[];
    if(typeof refreshFeedSafe==='function')jobs.push(Promise.resolve(refreshFeedSafe()).catch(()=>{ok=false}));
    if(typeof updRecheck==='function')jobs.push(Promise.resolve(updRecheck(true)).catch(()=>{}));
    await Promise.all(jobs);
  }finally{
    PTR.busy=false;ptrShow(ok?'done':'fail');setTimeout(()=>{if(!PTR.busy&&!PTR.armed)ptrShow('')},700);
  }
}
if(typeof document!=='undefined'){
  document.addEventListener('touchstart',ev=>{
    PTR.touch=true;PTR.armed=false;
    if(PTR.busy||!ev.touches||ev.touches.length!==1||ptrBlocked())return;
    if(typeof usingNet!=='function'||!usingNet())return;
    const sc=typeof homeSc==='function'?homeSc():null;
    if(!sc||!sc.contains(ev.target)||(sc.scrollTop||0)>0)return;
    if(ev.target.closest&&ev.target.closest('.st-row,.stories,.cochips,input,textarea,select,video'))return;
    PTR.sc=sc;PTR.y0=ev.touches[0].clientY;PTR.x0=ev.touches[0].clientX;PTR.dy=0;PTR.armed=true;
  },{passive:true,capture:true});
  document.addEventListener('touchmove',ev=>{
    if(!PTR.armed||!ev.touches||!ev.touches.length)return;
    const t=ev.touches[0],dy=t.clientY-PTR.y0,dx=Math.abs(t.clientX-PTR.x0);
    if((dx>14&&dx>Math.abs(dy))||(PTR.sc&&(PTR.sc.scrollTop||0)>0&&dy<=0)){PTR.armed=false;ptrShow('');return}
    PTR.dy=dy;
    if(dy>8)ptrShow('pull',dy/PTR.TH);else ptrShow('');
  },{passive:true,capture:true});
  const end=()=>{PTR.touch=false;if(!PTR.armed)return;PTR.armed=false;if(PTR.dy>=PTR.TH)ptrRun();else if(!PTR.busy)ptrShow('')};
  document.addEventListener('touchend',end,{passive:true,capture:true});
  document.addEventListener('touchcancel',()=>{PTR.touch=false;PTR.armed=false;if(!PTR.busy)ptrShow('')},{passive:true,capture:true});
}
