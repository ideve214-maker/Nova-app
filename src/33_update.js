/* 自托管热更新（@capgo/capacitor-updater，手动模式）。
   清单地址 window.NOVA_UPDATE_MANIFEST_URL 为空时什么都不做。
   仅在 Capacitor 原生壳里生效；浏览器预览是空操作。
   1.0.7 起：发现新版本时弹窗询问，下载有进度条，完成后可立即重启生效。 */
function builtinAppVersion(){
  try{
    const v=typeof window!=='undefined'?window.NOVA_APP_VERSION:'';
    if(v)return String(v);
  }catch(e){}
  return '1.0.0';
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

/* 1.0.7 更新对话框：发现新版本先问用户；更新时显示下载进度；完成后可立即重启生效，或关闭后下次启动生效；失败可重试。
   对话框挂在 #app 上（不在 #v 里），render() 不会把它清掉。文字按当前语言直接取中/英文。 */
const UPD={phase:'',ver:'',pct:0,bundle:null,opts:null,err:'',busy:0,later:{}};
function updTxt(k,a){
  const en=typeof LANG!=='undefined'&&LANG==='en';
  const t={
    title:en?'Update available':'发现新版本',
    ask:en?'Version '+a+' is available. Update now?':'发现新版本 '+a+'，是否更新？',
    update:en?'Update':'更新', later:en?'Later':'稍后',
    dl:en?'Downloading '+a+'%':'正在下载 '+a+'%',
    dlHint:en?'Keep the app open until the download finishes.':'下载完成前请保持应用在前台。',
    done:en?'Done':'已完成',
    doneHint:en?'Restart now to use the new version, or it will apply the next time you open the app.':'立即重启即可使用新版本；关闭后，下次打开应用时生效。',
    restart:en?'Restart now':'重启生效', close:en?'Close':'关闭',
    fail:en?'Download failed':'下载失败',
    failHint:en?'Check your network and try again.':'请检查网络后重试。',
    retry:en?'Retry':'重试',
  };
  return t[k]||'';
}
function updEsc(x){return String(x==null?'':x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function updHtml(){
  const p=UPD.phase, v=updEsc(UPD.ver);
  const btn=(a,l,pri)=>`<button type="button" class="pb${pri?'':' s'}" data-upd="${a}">${updEsc(l)}</button>`;
  let body='';
  if(p==='ask')body=`<b class="updt">${updTxt('title')}</b><p class="updp">${updEsc(updTxt('ask',UPD.ver))}</p><div class="updb">${btn('later',updTxt('later'))}${btn('go',updTxt('update'),1)}</div>`;
  else if(p==='dl'){const n=Math.max(0,Math.min(100,Math.round(UPD.pct||0)));body=`<b class="updt">${v}</b><p class="updp" id="updpct">${updTxt('dl',n)}</p><div class="updbar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${n}"><i id="updfill" style="width:${n}%"></i></div><p class="updh">${updTxt('dlHint')}</p>`;}
  else if(p==='done')body=`<b class="updt">${updTxt('done')}</b><p class="updp">${updTxt('doneHint')}</p><div class="updb">${btn('close',updTxt('close'))}${btn('restart',updTxt('restart'),1)}</div>`;
  else if(p==='err')body=`<b class="updt">${updTxt('fail')}</b><p class="updp">${updTxt('failHint')}${UPD.err?'<br><small>'+updEsc(UPD.err)+'</small>':''}</p><div class="updb">${btn('close',updTxt('close'))}${btn('retry',updTxt('retry'),1)}</div>`;
  return body?`<div class="updm" role="dialog" aria-modal="true" aria-label="${updTxt('title')}"><div class="upds">${body}</div></div>`:'';
}
function updShow(){
  try{
    let el=document.getElementById('upddlg');
    const html=updHtml();
    if(!html){if(el)el.remove();return}
    if(!el){el=document.createElement('div');el.id='upddlg';el.setAttribute('data-ut','1');(document.getElementById('app')||document.body).appendChild(el);el.addEventListener('click',updClick)}
    el.innerHTML=html;
  }catch(e){}
}
function updProgress(n){
  UPD.pct=n;
  const f=document.getElementById('updfill'), t=document.getElementById('updpct');
  if(f&&t){f.style.width=Math.round(n)+'%';t.textContent=updTxt('dl',Math.round(n));const bar=f.parentNode;if(bar)bar.setAttribute('aria-valuenow',String(Math.round(n)))}
  else updShow();
}
async function updClick(e){
  const b=e.target&&e.target.closest&&e.target.closest('[data-upd]');
  if(!b)return;
  const a=b.getAttribute('data-upd'), U=updaterPlugin();
  if(a==='later'){UPD.later[UPD.ver]=1;UPD.phase='';updShow();return}
  if(a==='close'){UPD.phase='';updShow();return}
  if(a==='go'||a==='retry'){if(U)runUpdateDownload(U);return}
  if(a==='restart'){
    if(!U||!UPD.bundle)return;
    try{await U.set({id:UPD.bundle.id})}catch(err){UPD.phase='err';UPD.err=String(err&&err.message||err||'');updShow()}
  }
}
async function existingBundle(U, ver){
  try{
    if(typeof U.list!=='function')return null;
    const r=await U.list();
    const all=(r&&r.bundles)||[];
    return all.find(b=>b&&String(b.version)===ver&&b.id&&b.id!=='builtin'&&/^(pending|success)$/i.test(String(b.status||'')))||null;
  }catch(e){return null}
}
async function runUpdateDownload(U){
  if(UPD.busy||!UPD.opts)return;
  UPD.busy=1;UPD.phase='dl';UPD.pct=0;UPD.err='';updShow();
  let bundle=null, h=null;
  try{
    if(typeof U.addListener==='function'){
      try{h=await U.addListener('download',ev=>{const n=Number(ev&&ev.percent);if(Number.isFinite(n)&&(!ev.bundle||!ev.bundle.version||String(ev.bundle.version)===UPD.ver))updProgress(n)})}catch(e){}
    }
    bundle=await existingBundle(U, UPD.ver);
    if(!bundle)bundle=await U.download(UPD.opts);
    if(!bundle||!bundle.id)throw new Error('empty bundle');
    UPD.bundle=bundle;
    scheduleBundleApply(U, bundle);
    UPD.pct=100;UPD.phase='done';updShow();
  }catch(e){
    try{console.warn('nova updater: 下载或校验失败', e&&e.message?e.message:e)}catch(e2){}
    await dropFailedBundle(U, bundle);
    UPD.phase='err';UPD.err=String(e&&e.message||'').slice(0,160);updShow();
  }finally{
    UPD.busy=0;
    try{if(h&&typeof h.remove==='function')h.remove()}catch(e){}
  }
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
  const opts={url:zip, version:ver};
  if(sum)opts.checksum=sum;
  /* 清单里的 session_key 交给插件的 sessionKey（Capgo download 的字段名）。 */
  const sessionKey=String(manifest.session_key||manifest.sessionKey||'').trim();
  if(sessionKey){opts.sessionKey=sessionKey;opts.session_key=sessionKey;}
  UPD.ver=ver;UPD.opts=opts;
  /* 已经下载好的同版本包：直接显示「已完成」，不重复下载。 */
  const have=await existingBundle(U, ver);
  if(have){UPD.bundle=have;scheduleBundleApply(U, have);UPD.phase='done';updShow();return}
  if(UPD.later[ver])return;
  UPD.phase='ask';updShow();
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
