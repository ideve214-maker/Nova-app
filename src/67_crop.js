/* 头像 / 背景裁剪。上传只接受图片，输出压缩后的 jpeg，不把原始文件直接塞进页面。 */
function cropBox(imgW,imgH,vw,vh,zoom,x,y){
  const z=Math.max(1,Math.min(3,+zoom||1));
  const base=Math.max(vw/imgW,vh/imgH);
  const s=base*z;
  const dw=imgW*s,dh=imgH*s;
  const maxX=Math.max(0,(dw-vw)/2),maxY=Math.max(0,(dh-vh)/2);
  const cx=Math.max(-maxX,Math.min(maxX,+x||0)),cy=Math.max(-maxY,Math.min(maxY,+y||0));
  let sx=(dw/2-vw/2-cx)/s,sy=(dh/2-vh/2-cy)/s,sw=vw/s,sh=vh/s;
  if(sx<0){sw+=sx;sx=0} if(sy<0){sh+=sy;sy=0}
  if(sx+sw>imgW)sw=imgW-sx; if(sy+sh>imgH)sh=imgH-sy;
  if(sw<1)sw=1; if(sh<1)sh=1;
  return {sx,sy,sw,sh,x:cx,y:cy,zoom:z};
}
function layoutCrop(){
  const c=S.crop; if(!c)return;
  const stage=$('#cropstage'),img=$('#cropimg'); if(!stage||!img||!c.w)return;
  const vw=stage.clientWidth,vh=stage.clientHeight; if(!vw||!vh)return;
  c.vw=vw;c.vh=vh;
  const box=cropBox(c.w,c.h,vw,vh,c.zoom,c.x,c.y);
  c.x=box.x;c.y=box.y;c.zoom=box.zoom;
  const base=Math.max(vw/c.w,vh/c.h),s=base*c.zoom;
  img.style.width=(c.w*s)+'px'; img.style.height=(c.h*s)+'px';
  img.style.transform=`translate(calc(-50% + ${c.x}px), calc(-50% + ${c.y}px))`;
}
function closeCrop(){
  const c=S.crop; if(c&&c.blob&&c.url)URL.revokeObjectURL(c.url);
  S.crop=null; const el=$('#crop'); if(el)el.remove();
}
function showCrop(){
  const c=S.crop; if(!c)return;
  const old=$('#crop'); if(old)old.remove();
  const title=c.kind==='bg'||c.kind==='cmbg'?'裁剪背景':'裁剪头像';
  const cls=c.kind==='bg'||c.kind==='cmbg'?'bg':'av';
  const el=document.createElement('div'); el.id='crop'; el.className='crop';
  el.innerHTML=`<div class="cropbar"><button class="pb sm s" data-a="cropx">取消</button><b>${title}</b><button class="pb sm" data-a="cropok">使用</button></div><div class="cropstage ${cls}" id="cropstage"></div><p class="crophelp">拖动调整位置。双指或下面的滑杆可以缩放，圆框或横框里的部分会被留下。</p><label class="cropz">缩放<input id="cropz" type="range" min="100" max="300" value="${Math.round(c.zoom*100)}"></label>`;
  const img=document.createElement('img'); img.id='cropimg'; img.alt=''; img.draggable=false;
  img.onload=()=>{c.w=img.naturalWidth;c.h=img.naturalHeight;layoutCrop()};
  img.src=c.url; el.querySelector('#cropstage').appendChild(img);
  $('#app').appendChild(el);
}
function openCropFromFile(kind,id,file){
  if(!file)return;
  const okType=/^image\//.test(file.type)||/\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(file.name||'');
  if(!okType){T('请从相册或文件里选择图片');return}
  if(file.size>12*1024*1024){T('图片超过 12MB，请换一张小一点的');return}
  const url=URL.createObjectURL(file), probe=new Image();
  probe.onload=()=>{
    if(!probe.naturalWidth){URL.revokeObjectURL(url);T('这张图片读不了，请换 jpg 或 png');return}
    closeCrop(); S.sh=null;
    S.crop={kind,id:id||'',url,blob:true,w:probe.naturalWidth,h:probe.naturalHeight,zoom:1,x:0,y:0};
    render(); showCrop();
  };
  probe.onerror=()=>{URL.revokeObjectURL(url);T('这张图片读不了，请换 jpg 或 png')};
  probe.src=url;
}
function safePhoto(src,allow){return allow.includes(src)}
function applyLook(kind,id,url){
  if(kind==='av'){D.pf.me.ph=url;return true}
  if(kind==='bg'){D.pf.me.bg=url;return true}
  if(kind==='gav'){const c=cvf(id);if(!c||!gAdm(c)){T('没有权限');return false}c.gp=url;gm(id,'你更换了群头像');return true}
  if(kind==='cmbg'||kind==='cmav'){const c=cmp(id);if(!c||(c.r!=='所有者'&&c.r!=='管理员')){T('没有权限');return false}if(kind==='cmbg')c.bg=url;else c.cp=url;return true}
  return false;
}
function applyCrop(){
  const c=S.crop; if(!c)return;
  const img=$('#cropimg'); if(!img||!img.naturalWidth){T('图片还没准备好');return}
  layoutCrop();
  const box=cropBox(c.w,c.h,c.vw,c.vh,c.zoom,c.x,c.y);
  const wide=c.kind==='bg'||c.kind==='cmbg', outW=wide?960:320, outH=wide?432:320;
  const canvas=document.createElement('canvas'); canvas.width=outW; canvas.height=outH;
  const g=canvas.getContext('2d');
  g.drawImage(img,box.sx,box.sy,box.sw,box.sh,0,0,outW,outH);
  let q=0.82, url=canvas.toDataURL('image/jpeg',q);
  while(url.length>280000&&q>0.5){q-=0.08;url=canvas.toDataURL('image/jpeg',q)}
  if(url.length>420000){T('裁剪结果太大，请缩小一点或换一张');return}
  if(!applyLook(c.kind,c.id,url))return;
  closeCrop(); T('已保存');
}
document.addEventListener('change',e=>{
  const t=e.target; if(!t.dataset||!t.dataset.pick)return;
  const f=t.files&&t.files[0], kind=t.dataset.pick, id=t.dataset.id||'';
  t.value=''; if(f)openCropFromFile(kind,id,f);
});
document.addEventListener('input',e=>{
  if(e.target.id!=='cropz'||!S.crop)return;
  S.crop.zoom=(+e.target.value)/100; layoutCrop();
});
document.addEventListener('pointerdown',e=>{
  const st=e.target.closest&&e.target.closest('#cropstage'); if(!st||!S.crop)return;
  const pts=S.crop.pts||(S.crop.pts=new Map());
  pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pts.size===1)S.crop.drag={id:e.pointerId,x:e.clientX,y:e.clientY,ox:S.crop.x,oy:S.crop.y};
  else if(pts.size===2){const [a,b]=[...pts.values()];S.crop.pinch={d:Math.hypot(a.x-b.x,a.y-b.y)||1,z:S.crop.zoom};S.crop.drag=null}
  try{st.setPointerCapture(e.pointerId)}catch(err){}
});
document.addEventListener('pointermove',e=>{
  const c=S.crop; if(!c||!c.pts||!c.pts.has(e.pointerId))return;
  c.pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(c.pts.size>=2&&c.pinch){const [a,b]=[...c.pts.values()];const d=Math.hypot(a.x-b.x,a.y-b.y)||1;c.zoom=c.pinch.z*(d/c.pinch.d);layoutCrop();return}
  if(c.drag&&c.drag.id===e.pointerId){c.x=c.drag.ox+(e.clientX-c.drag.x);c.y=c.drag.oy+(e.clientY-c.drag.y);layoutCrop()}
});
function endPtr(e){const c=S.crop;if(!c||!c.pts)return;c.pts.delete(e.pointerId);if(c.drag&&c.drag.id===e.pointerId)c.drag=null;if(c.pts.size<2)c.pinch=null;if(c.pts.size===1){const [id,p]=[...c.pts.entries()][0];c.drag={id,x:p.x,y:p.y,ox:c.x,oy:c.y}}}
document.addEventListener('pointerup',endPtr);
document.addEventListener('pointercancel',endPtr);
document.addEventListener('wheel',e=>{
  if(!S.crop||!(e.target.closest&&e.target.closest('#crop')))return;
  e.preventDefault(); S.crop.zoom=(S.crop.zoom||1)*(e.deltaY>0?0.96:1.04); layoutCrop();
  const z=$('#cropz'); if(z)z.value=String(Math.round(Math.max(1,Math.min(3,S.crop.zoom))*100));
},{passive:false});
