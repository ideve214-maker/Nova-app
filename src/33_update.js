/* 自托管热更新（@capgo/capacitor-updater，手动模式）。
   清单地址 window.NOVA_UPDATE_MANIFEST_URL 为空时什么都不做。
   仅在 Capacitor 原生壳里生效；浏览器预览是空操作。 */
function builtinAppVersion(){
  try{
    const v=typeof window!=='undefined'?window.NOVA_APP_VERSION:'';
    if(v)return String(v);
  }catch(e){}
  return '0.7.0-m7.r7';
}
let RUNNING_VERSION=builtinAppVersion();
function runningAppVersion(){return RUNNING_VERSION||builtinAppVersion()}

function updaterPlugin(){
  try{
    const N=window.NovaNative;
    if(!N||!N.Capacitor||typeof N.Capacitor.isNativePlatform!=='function'||!N.Capacitor.isNativePlatform())return null;
    return N.CapacitorUpdater||null;
  }catch(e){return null}
}

function updateManifestUrl(){
  try{return String(window.NOVA_UPDATE_MANIFEST_URL||'').trim()}catch(e){return ''}
}

function splitVer(s){
  const t=String(s||'').trim();
  const m=t.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if(!m)return null;
  return {core:[Number(m[1]),Number(m[2]),Number(m[3])], pre:m[4]?m[4].split('.'):[]};
}
function cmpIdent(a,b){
  const an=/^\d+$/.test(a), bn=/^\d+$/.test(b);
  if(an&&bn)return Number(a)-Number(b);
  if(an&&!bn)return -1;
  if(!an&&bn)return 1;
  return a<b?-1:a>b?1:0;
}
function cmpVer(a,b){
  const A=splitVer(a), B=splitVer(b);
  if(!A||!B)return String(a)===String(b)?0:(String(a)>String(b)?1:-1);
  for(let i=0;i<3;i++){if(A.core[i]!==B.core[i])return A.core[i]-B.core[i]}
  if(!A.pre.length&&!B.pre.length)return 0;
  if(!A.pre.length)return 1;
  if(!B.pre.length)return -1;
  const n=Math.max(A.pre.length,B.pre.length);
  for(let i=0;i<n;i++){
    if(A.pre[i]==null)return -1;
    if(B.pre[i]==null)return 1;
    const c=cmpIdent(A.pre[i],B.pre[i]);
    if(c)return c;
  }
  return 0;
}
function versionNewer(remote, current){return cmpVer(remote, current)>0}

function refreshVersionUi(){
  try{
    const cur=typeof S!=='undefined'&&S.st&&S.st[S.st.length-1];
    if(!cur)return;
    if((cur==='set'||String(cur).startsWith('info:'))&&typeof render==='function')render();
  }catch(e){}
}

async function syncRunningVersion(U){
  try{
    const cur=await U.current();
    const b=cur&&cur.bundle;
    const next=(b&&b.version&&b.id&&b.id!=='builtin')?String(b.version):builtinAppVersion();
    if(next&&next!==RUNNING_VERSION){
      RUNNING_VERSION=next;
      refreshVersionUi();
    }else if(next)RUNNING_VERSION=next;
  }catch(e){}
}

async function dropFailedBundle(U, bundle){
  if(!U)return;
  try{
    if(bundle&&bundle.id&&typeof U.delete==='function')await U.delete({id:bundle.id});
  }catch(e){}
}

function scheduleBundleApply(U, bundle){
  if(!U||!bundle||!bundle.id||scheduleBundleApply.done)return;
  const apply=async()=>{
    if(scheduleBundleApply.done)return;
    scheduleBundleApply.done=1;
    try{
      /* next() 只标记下次启动使用，不会在当前会话中途重载。 */
      if(typeof U.next==='function')await U.next({id:bundle.id});
    }catch(e){
      try{console.warn('nova updater: 标记新版本失败', e&&e.message?e.message:e)}catch(e2){}
      await dropFailedBundle(U, bundle);
    }
  };
  apply();
  const onHide=()=>{
    try{
      if(document.visibilityState==='hidden')apply();
    }catch(e){}
  };
  try{
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', apply);
  }catch(e){}
}

async function checkAndDownloadUpdate(U){
  const url=updateManifestUrl();
  if(!url)return;
  let manifest;
  try{
    const r=await fetch(url,{cache:'no-store'});
    if(!r.ok)return;
    manifest=await r.json();
  }catch(e){
    try{console.warn('nova updater: 无法读取更新清单')}catch(e2){}
    return;
  }
  if(!manifest||manifest.error)return;
  const ver=String(manifest.version||'').trim();
  const zip=String(manifest.url||'').trim();
  const sum=String(manifest.checksum||'').trim();
  if(!ver||!zip)return;
  const current=runningAppVersion();
  if(!versionNewer(ver, current))return;
  let bundle=null;
  try{
    const opts={url:zip, version:ver};
    if(sum)opts.checksum=sum;
    bundle=await U.download(opts);
    if(!bundle||!bundle.id)throw new Error('empty bundle');
    scheduleBundleApply(U, bundle);
  }catch(e){
    try{console.warn('nova updater: 下载或校验失败', e&&e.message?e.message:e)}catch(e2){}
    await dropFailedBundle(U, bundle);
  }
}

async function bootUpdater(){
  if(bootUpdater.done)return;
  bootUpdater.done=1;
  const U=updaterPlugin();
  if(!U)return;
  try{
    if(typeof U.notifyAppReady==='function')await U.notifyAppReady();
  }catch(e){
    try{console.warn('nova updater: notifyAppReady', e&&e.message?e.message:e)}catch(e2){}
  }
  await syncRunningVersion(U);
  try{await checkAndDownloadUpdate(U)}catch(e){}
}

if(typeof window!=='undefined'){
  bootUpdater();
}
