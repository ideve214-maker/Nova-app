/* NOVA V5 统一左滑组件：任何 .swr > .swc 行都可左滑露出 .swa 里的按钮。
   用法：swrow('data-a="xx" data-v="1"', 行内部HTML, [[动作,文字,颜色,值],...])
   规则：同一时间只展开一行；轻扫(速度够快)或拖过一半即展开；展开后点行本身收起；垂直滚动时不抢手势。 */
const swrow=(attrs,inner,acts,cls='row')=>`<div class="swr"><div class="swa">${acts.map(a=>`<button style="background:${a[2]}" data-a="${a[0]}" data-v="${a[3]}">${esc(a[1])}</button>`).join('')}</div><div class="${cls} swc" data-w="${72*acts.length}" ${attrs}>${inner}</div></div>`;
let sw=null;
const swClose=x=>{x.classList.remove('o');x.style.transform=''};
document.addEventListener('pointerdown',e=>{
  const r=e.target.closest('.swc');document.querySelectorAll('.swc.o').forEach(x=>{if(x!==r)swClose(x)});
  if(!r||r.dataset.a=='unhide'||e.target.closest('.swa'))return;
  sw={r,x:e.clientX,y:e.clientY,d:0,m:0,W:+r.dataset.w,o:r.classList.contains('o'),t0:Date.now(),last:e.clientX,lt:Date.now(),v:0};
});
document.addEventListener('pointermove',e=>{
  if(!sw)return;const dx=e.clientX-sw.x,dy=e.clientY-sw.y;
  if(!sw.m){if(Math.abs(dx)>8&&Math.abs(dx)>Math.abs(dy))sw.m=1;else if(Math.abs(dy)>8){sw=null;return}else return}
  const now=Date.now();if(now>sw.lt){sw.v=(e.clientX-sw.last)/(now-sw.lt);sw.last=e.clientX;sw.lt=now}
  let t=(sw.o?-sw.W:0)+dx;t=t>0?t*.25:t<-sw.W?-sw.W+(t+sw.W)*.25:t;   /* 两端带阻尼 */
  sw.r.style.transition='none';sw.r.style.transform='translateX('+t+'px)';sw.d=t;
});
const swEnd=()=>{
  if(!sw)return;const r=sw.r;
  if(sw.m){r.style.transition='';const open=sw.v<-.5?true:sw.v>.5?false:sw.d<-sw.W/2,was=sw.o;
    r.classList.toggle('o',open);r.style.transform=open?'translateX('+(-sw.W)+'px)':'';S.nc=Date.now();if(open!==was)feel('snap')}
  sw=null;
};
document.addEventListener('pointerup',swEnd);
document.addEventListener('pointercancel',()=>{if(sw){sw.r.style.transition='';sw=null}});
