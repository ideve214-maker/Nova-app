/* 2.0.1：图片缓存与预取。
   媒体地址带有几分钟就过期的访问凭证，浏览器自己的缓存认不出同一张图，所以按「媒体 id + 规格」缓存：
   - 内存：已解码的 blob 地址，切换标签直接显示，不闪默认背景；
   - 持久：IndexedDB 里的图片数据 + localStorage 里的大小 / 最近使用时间 / 主色，超过 80MB 按最久未用清理；
   - 网络：最多 3 个并发，可见的图片优先，预取排在后面；热更新下载时暂停预取。
   规格：c = 封面（服务器生成的 1080 宽 WebP），p = 缩略图（480），f = 原图（1920）。 */
const IMC={mem:new Map(),q:[],act:0,MAX:80*1024*1024,MEMN:160,db:null,meta:null,pend:new Map(),pf:0};
function imcMeta(){if(!IMC.meta){try{IMC.meta=JSON.parse(localStorage.getItem('vexo_imc')||'{}')||{}}catch(e){IMC.meta={}}}return IMC.meta}
function imcSaveMeta(){clearTimeout(IMC.mt);IMC.mt=setTimeout(()=>{try{localStorage.setItem('vexo_imc',JSON.stringify(IMC.meta||{}))}catch(e){}},1200)}
function imcDb(){
  if(IMC.db)return IMC.db;
  IMC.db=new Promise(res=>{
    try{const r=indexedDB.open('vexo-img',1);r.onupgradeneeded=()=>r.result.createObjectStore('b');r.onsuccess=()=>res(r.result);r.onerror=()=>res(null);r.onblocked=()=>res(null)}catch(e){res(null)}
  });
  return IMC.db;
}
function imcIdb(mode,fn){return imcDb().then(db=>db?new Promise(res=>{try{const tx=db.transaction('b',mode),st=tx.objectStore('b'),r=fn(st);tx.oncomplete=()=>res(r&&r.result);tx.onerror=tx.onabort=()=>res(null)}catch(e){res(null)}}):null)}
const imcK=(id,v)=>id+'|'+v;
/* 同步读取：内存里有就直接返回 blob 地址；封面没有时可以退而用缩略图 */
function imcSync(id,v){const e=IMC.mem.get(imcK(id,v));if(e){e.t=Date.now();return e.u}return ''}
function imcColor(id){const m=imcMeta();return (m[imcK(id,'c')]||m[imcK(id,'p')]||m[imcK(id,'f')]||{}).c||''}
function imcMemPut(k,blob){
  const old=IMC.mem.get(k);if(old)return old.u;
  const u=URL.createObjectURL(blob);IMC.mem.set(k,{u,t:Date.now(),s:blob.size});
  if(IMC.mem.size>IMC.MEMN){
    /* 只回收 2 分钟没用过、页面上也没在用的 */
    const now=Date.now(),list=[...IMC.mem.entries()].sort((a,b)=>a[1].t-b[1].t);
    const html=document.getElementById('app')?document.getElementById('app').innerHTML:'';
    for(const [kk,e] of list){if(IMC.mem.size<=IMC.MEMN*0.8)break;if(now-e.t<120e3||html.includes(e.u))continue;URL.revokeObjectURL(e.u);IMC.mem.delete(kk)}
  }
  return u;
}
function imcEvict(){
  const m=imcMeta();let tot=0;const ks=Object.keys(m);ks.forEach(k=>tot+=(m[k].s||0));
  if(tot<=IMC.MAX)return;
  ks.sort((a,b)=>(m[a].t||0)-(m[b].t||0));
  const del=[];for(const k of ks){if(tot<=IMC.MAX*0.85)break;tot-=(m[k].s||0);del.push(k);delete m[k]}
  imcSaveMeta();imcIdb('readwrite',st=>{del.forEach(k=>st.delete(k))});
}
/* 主色：画成 1×1 取平均色，作为下次加载前的占位底色 */
function imcTint(k,u){
  const m=imcMeta();if(m[k]&&m[k].c)return;
  const im=new Image();im.onload=()=>{try{const c=document.createElement('canvas');c.width=c.height=1;const x=c.getContext('2d');x.drawImage(im,0,0,1,1);const d=x.getImageData(0,0,1,1).data;if(m[k]){m[k].c='rgb('+d[0]+','+d[1]+','+d[2]+')';imcSaveMeta()}}catch(e){}};im.src=u;
}
function imcSeed(id,v,blob){
  /* 刚上传的图：直接放进缓存，界面立刻显示新图，不经过默认背景 */
  const k=imcK(id,v),u=imcMemPut(k,blob),m=imcMeta();
  m[k]={s:blob.size,t:Date.now(),c:(m[k]&&m[k].c)||''};imcSaveMeta();imcIdb('readwrite',st=>st.put(blob,k));imcTint(k,u);imcEvict();
  return u;
}
function imcNetBusy(){return typeof UPD!=='undefined'&&UPD&&(UPD.busy||UPD.phase==='dl')}
function imcPump(){
  while(IMC.act<3&&IMC.q.length){
    const i=IMC.q.findIndex(j=>!j.low);const j=i>=0?IMC.q.splice(i,1)[0]:(imcNetBusy()?null:IMC.q.shift());
    if(!j){setTimeout(imcPump,3000);return}
    IMC.act++;j.run().finally(()=>{IMC.act--;imcPump()});
  }
}
function imcFetch(id,v,low){
  return new Promise(res=>{
    IMC.q.push({k:imcK(id,v),low:!!low,run:async()=>{
      try{
        if(typeof mediaTicket!=='function'||typeof SESSION==='undefined'||!SESSION)return res(null);
        const t=await mediaTicket(id);if(!t)return res(null);
        const path=v==='c'?'cover':v==='p'?'preview':'file';
        const r=await fetch(apiUrl('/api/media/'+encodeURIComponent(id)+'/'+path+'?ticket='+encodeURIComponent(t)));
        if(!r.ok)return res(null);
        const b=await r.blob();if(!/^image\//.test(b.type||'image/'))return res(null);
        res(b);
      }catch(e){res(null)}
    }});
    imcPump();
  });
}
/* 取图：内存 → IndexedDB → 网络。返回已解码好的 blob 地址（失败为 ''） */
function imcGet(id,v,low){
  const k=imcK(id,v),hit=imcSync(id,v);if(hit)return Promise.resolve(hit);
  if(IMC.pend.has(k)){if(!low)IMC.q.forEach(j=>{if(j.k===k)j.low=false});return IMC.pend.get(k)}
  const p=(async()=>{
    let b=await imcIdb('readonly',st=>st.get(k));
    if(!(b instanceof Blob)){
      b=await imcFetch(id,v,low);
      if(!b&&v==='c')b=await imcFetch(id,'f',low);
      if(!b)return '';
      imcIdb('readwrite',st=>st.put(b,k));
    }
    const u=imcMemPut(k,b),m=imcMeta();m[k]={s:b.size,t:Date.now(),c:(m[k]&&m[k].c)||''};imcSaveMeta();imcEvict();imcTint(k,u);
    try{const im=new Image();im.src=u;if(im.decode)await im.decode()}catch(e){}
    return u;
  })().finally(()=>IMC.pend.delete(k));
  IMC.pend.set(k,p);return p;
}
/* 背景 / 封面：有缓存就直接给图，没有就给主色占位（绝不用默认背景顶替自定义背景） */
function imcBgCss(id){
  const u=imcSync(id,'c'),col=imcColor(id)||'#1a1c20';
  if(u)return `background-color:${col};background-image:url('${cssUrl(u)}');background-size:cover;background-position:center`;
  const p=imcSync(id,'p');
  if(p)return `background-color:${col};background-image:url('${cssUrl(p)}');background-size:cover;background-position:center`;
  return `background:${col}`;
}
function imcHydrateBg(el){
  const id=el.getAttribute('data-mbg');if(!id)return;
  if(imcSync(id,'c')){el.setAttribute('data-mok','1');return}
  const g=imcGet(id,'c');
  g.then(u=>{
    if(!u||!el.isConnected)return;
    /* 淡入：先放在 ::before 层，透明度 0 → 1，然后写回元素本身 */
    el.style.setProperty('--mbg',"url('"+cssUrl(u)+"')");el.classList.add('mbgf');
    requestAnimationFrame(()=>requestAnimationFrame(()=>el.classList.add('in')));
    setTimeout(()=>{if(!el.isConnected)return;el.style.backgroundImage="url('"+cssUrl(u)+"')";el.style.backgroundSize='cover';el.style.backgroundPosition='center';el.setAttribute('data-mok','1')},320);
  });
}
function imcHydrateImg(el,id,v,onfail){
  const hit=imcSync(id,v);if(hit){if(el.src!==hit)el.src=hit;return}
  const g=imcGet(id,v);
  g.then(u=>{if(!el.isConnected)return;if(u)el.src=u;else if(onfail)onfail()});
}
/* 小组封面：记住每个小组最后一次的封面，启动时先从本机读出来 */
function imcRememberCm(list){
  try{const m={};(list||[]).forEach(c=>{if(c&&c.id&&c.bg)m[c.id]=c.bg});localStorage.setItem('vexo_cmbg',JSON.stringify(m))}catch(e){}
}
function imcConn(){
  /* 没有原生网络插件时用 navigator.connection（安卓 WebView 有，iOS 没有 → 按 Wi-Fi 处理） */
  try{const N=window.NovaNative;if(N&&N.Network&&IMC.net)return IMC.net}catch(e){}
  const c=navigator.connection;if(!c)return 'wifi';
  if(c.saveData)return 'cell';
  if(c.type==='cellular'||/^(slow-2g|2g|3g)$/.test(c.effectiveType||''))return 'cell';
  return 'wifi';
}
function imcPrefetch(){
  if(typeof SESSION==='undefined'||!SESSION)return;
  const cell=imcConn()==='cell',out=[];const add=(id,v)=>{if(typeof isMediaId==='function'&&isMediaId(id))out.push([id,v])};
  try{const m=JSON.parse(localStorage.getItem('vexo_cmbg')||'{}');Object.values(m).forEach(id=>add(id,cell?'p':'c'))}catch(e){}
  (Array.isArray(S.communities)?S.communities:[]).forEach(c=>{add(c.bg,cell?'p':'c');add(c.cp,'f')});
  const me=D.pf&&D.pf.me||{};add(me.bg,cell?'p':'c');add(me.ph,'f');
  Object.values(D.uph||{}).slice(0,60).forEach(id=>add(id,'f'));
  Object.values(D.ubg||{}).slice(0,20).forEach(id=>add(id,cell?'p':'c'));
  if(!cell){
    const fs=(typeof feedSrc==='function'?feedSrc():D.p)||[];
    fs.slice(0,12).forEach(p=>(p.media||[]).slice(0,4).forEach(x=>{const it=typeof mItem==='function'?mItem(x):x;if(it&&it.id&&(!it.kind||it.kind==='image'))add(it.id,'f')}));
  }
  const co=S.co||{};(co.pj||[]).slice(0,20).forEach(p=>p.owner&&p.owner.avatar&&add(p.owner.avatar.image,'f'));
  (co.ex||[]).slice(0,20).forEach(p=>p.author&&p.author.avatar&&add(p.author.avatar.image,'f'));
  const seen=new Set();
  out.forEach(([id,v])=>{const k=imcK(id,v);if(seen.has(k)||IMC.mem.has(k))return;seen.add(k);imcGet(id,v,true)});
}
function imcBoot(){
  if(IMC.booted)return;IMC.booted=1;
  const idle=window.requestIdleCallback||(f=>setTimeout(f,1500));
  /* 第一屏出来以后再做；先从本机把小组封面读进内存（不走网络），再在空闲时预取其他标签的图片 */
  setTimeout(()=>idle(()=>{
    try{const m=JSON.parse(localStorage.getItem('vexo_cmbg')||'{}');Object.values(m).slice(0,40).forEach(id=>{imcIdb('readonly',st=>st.get(imcK(id,'c'))).then(b=>{if(b instanceof Blob)imcMemPut(imcK(id,'c'),b)})})}catch(e){}
    setTimeout(()=>idle(()=>{
      /* 共创列表还没加载过的话顺便加载一次数据（只有一个请求），头像跟着预取 */
      const p=(typeof v2on==='function'&&v2on()&&typeof coLoad==='function'&&!(S.co&&(S.co.ex||S.co.pj)))?coLoad().catch(()=>{}):Promise.resolve();
      p.then(()=>imcPrefetch());
    },{timeout:4000}),2500);
  },{timeout:3000}),800);
}
