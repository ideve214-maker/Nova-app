/* 按键皮肤：从 assets/skins/index.json 加载清单，用 CSS 变量/样式表切换，失败回退默认。
   新增皮肤只需加文件夹和注册表条目，不必改本文件的业务逻辑。 */
const SKIN_ROOT='assets/skins';
const SKIN_FALLBACK='nova';
const SKINS={list:[],byId:{},current:null,icons:{},logo:'',ready:false,failed:0};

function skinBase(id){return SKIN_ROOT+'/'+id}
function skinStorageKey(){return (SESSION&&SESSION.user&&SESSION.user.id!=null)?('nova_skin_u_'+SESSION.user.id):'nova_skin'}
function rememberedSkin(){
  try{
    const per=localStorage.getItem(skinStorageKey());
    if(per)return per;
    return localStorage.getItem('nova_skin')||'';
  }catch(e){return ''}
}
function persistSkin(id){
  try{
    localStorage.setItem(skinStorageKey(),id);
    localStorage.setItem('nova_skin',id);
  }catch(e){}
}
function skinIcon(n){
  const aliases={people:'community',person:'profile'};
  const k=SKINS.icons[n]?n:(aliases[n]&&SKINS.icons[aliases[n]]?aliases[n]:'');
  return k&&SKINS.icons[k]?SKINS.icons[k]:'';
}
function brandTitle(){
  const src=SKINS.logo;
  if(src)return '<img class="br-logo" src="'+esc(src)+'" alt="NOVA">';
  return 'NOVA';
}
function resolvedTheme(){
  const t=D&&D.st&&D.st.theme;
  if(t==='system'){
    try{return matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}catch(e){return 'dark'}
  }
  return t==='light'?'light':'dark';
}
function applyResolvedTheme(){
  try{document.documentElement.dataset.theme=resolvedTheme()}catch(e){}
}

async function fetchJson(url){
  const r=await fetch(url,{cache:'no-cache'});
  if(!r.ok)throw new Error('http '+r.status);
  return r.json();
}
function loadSheet(href,id){
  return new Promise(res=>{
    const old=document.getElementById(id);
    if(old)old.remove();
    if(!href){res(true);return}
    const el=document.createElement('link');
    el.id=id;el.rel='stylesheet';el.href=href;
    el.onload=()=>res(true);
    el.onerror=()=>res(false);
    document.head.appendChild(el);
  });
}
async function loadSkinIcons(meta){
  const map={}, icons=meta&&meta.icons||{};
  const ids=Object.keys(icons);
  await Promise.all(ids.map(async k=>{
    const rel=icons[k];
    if(!rel)return;
    try{
      const r=await fetch(skinBase(meta.id)+'/'+rel,{cache:'force-cache'});
      if(!r.ok)return;
      let svg=await r.text();
      svg=svg.replace(/<svg\b/,'<svg aria-hidden="true" width="24" height="24"');
      map[k]=svg;
    }catch(e){}
  }));
  SKINS.icons=map;
}
async function applySkin(id,opts){
  const save=!(opts&&opts.save===false);
  const want=id||SKIN_FALLBACK;
  let meta=SKINS.byId[want];
  if(!meta){
    if(want!==SKIN_FALLBACK&&SKINS.byId[SKIN_FALLBACK]){return applySkin(SKIN_FALLBACK,{save:false})}
    if(want!=='default'&&SKINS.byId.default){return applySkin('default',{save:false})}
    document.documentElement.dataset.skin=SKIN_FALLBACK;
    SKINS.current=SKIN_FALLBACK;
    return;
  }
  const okCss=await loadSheet(meta.css?(skinBase(meta.id)+'/'+meta.css):'', 'nova-skin-css');
  if(!okCss && meta.id!==SKIN_FALLBACK && meta.id!=='default'){
    SKINS.failed++;
    return applySkin(SKIN_FALLBACK,{save:false});
  }
  document.documentElement.dataset.skin=meta.id;
  SKINS.current=meta.id;
  SKINS.logo=meta.logo?skinBase(meta.id)+'/'+meta.logo:'';
  try{await loadSkinIcons(meta)}catch(e){SKINS.icons={}}
  if(save){
    persistSkin(meta.id);
    if(MODE==='account'&&SESSION&&typeof api==='function'){
      api('POST','/api/me/prefs',{skin:meta.id}).catch(()=>{});
    }
  }
  if(typeof render==='function')try{render()}catch(e){}
}

function uiSizeId(){try{return localStorage.getItem('nova_ui_size')||'md'}catch(e){return 'md'}}
function applyUiSize(id,save,doRender){
  const ok={sm:1,md:1,lg:1}[id]?id:'md';
  try{document.documentElement.dataset.uiSize=ok}catch(e){}
  if(save!==false){try{localStorage.setItem('nova_ui_size',ok)}catch(e){}}
  if(doRender!==false&&save!==false&&typeof render==='function')try{render()}catch(e){}
  return ok;
}
function bootUiSize(){applyUiSize(uiSizeId(),false,false)}
function uiSizeRow(){
  const cur=uiSizeId();
  const btns=[['sm','小'],['md','标准'],['lg','大']].map(([id,l])=>`<button type="button" class="pb${cur===id?'':' s'}" data-a="uisize" data-v="${id}" aria-pressed="${cur===id?'true':'false'}">${l}</button>`).join('');
  const val=cur==='sm'?0:cur==='lg'?2:1;
  return `<div class="row" style="flex-wrap:wrap;align-items:flex-start"><div class="gr"><b>界面大小</b><small>缩放字体、按钮和间距。偏好保存在本机。</small></div><div class="sw uis">${btns}</div><div class="uisz-col" style="width:100%;margin-top:8px"><input type="range" min="0" max="2" step="1" value="${val}" id="uiszrange" aria-label="界面大小"></div><div class="uisz labs" style="width:100%"><span>小</span><span>标准</span><span>大</span></div></div>`;
}
function skinRow(){
  const list=SKINS.list||[];
  if(!list.length)return '';
  const cur=SKINS.current||SKIN_FALLBACK;
  const picks=list.map(s=>{
    const on=s.id===cur;
    const prev=s.preview?(skinBase(s.id)+'/'+s.preview):'';
    const img=prev?`<img src="${esc(prev)}" alt="" style="height:36px;width:auto;border-radius:8px;display:block">`:'';
    return `<button type="button" class="pb sm${on?'':' s'}" data-a="setskin" data-v="${esc(s.id)}" aria-pressed="${on?'true':'false'}" style="display:inline-flex;flex-direction:column;align-items:center;gap:4px;height:auto;padding:8px 12px">${img}<span>${esc(s.name||s.id)}</span></button>`;
  }).join('');
  return `<div class="shd">按键皮肤</div><p class="hint" style="padding:8px 16px 0">换一套按键和主题色彩。加载失败时会回到可用的皮肤。</p><div style="display:flex;flex-wrap:wrap;gap:8px;padding:12px 16px">${picks}</div>`;
}
function setskin(id){return applySkin(id)}

async function bootSkins(){
  try{
    const idx=await fetchJson(SKIN_ROOT+'/index.json');
    const entries=(idx&&idx.skins)||[];
    const defaultId=(idx&&idx.defaultSkin)||SKIN_FALLBACK;
    const loaded=[];
    for(const e of entries){
      const id=e.id||e.path;
      if(!id||!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(id))continue;
      try{
        const meta=await fetchJson(skinBase(id)+'/skin.json');
        meta.id=meta.id||id;
        meta.name=meta.name||e.name||meta.id;
        meta.path=e.path||id;
        SKINS.byId[meta.id]=meta;
        loaded.push(meta);
      }catch(err){}
    }
    SKINS.list=loaded;
    SKINS.ready=true;
    let pick='';
    if(SESSION&&SESSION.user&&SESSION.user.skin)pick=SESSION.user.skin;
    if(!pick)pick=rememberedSkin();
    if(!pick||!SKINS.byId[pick])pick=defaultId;
    if(!SKINS.byId[pick])pick=loaded[0]&&loaded[0].id;
    await applySkin(pick||SKIN_FALLBACK,{save:false});
  }catch(e){
    SKINS.ready=true;
    document.documentElement.dataset.skin=SKIN_FALLBACK;
    SKINS.current=SKIN_FALLBACK;
  }
  applyResolvedTheme();
}
if(typeof window!=='undefined'){
  try{bootUiSize()}catch(e){}
  try{document.documentElement.dataset.skin=rememberedSkin()||SKIN_FALLBACK}catch(e){}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{bootSkins()});
  else bootSkins();
  try{
    const mq=matchMedia('(prefers-color-scheme: light)');
    if(mq&&mq.addEventListener)mq.addEventListener('change',()=>{if(D&&D.st&&D.st.theme==='system'){applyResolvedTheme();if(typeof render==='function')render()}});
  }catch(e){}
}
