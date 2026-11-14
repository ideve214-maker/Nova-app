/* 按键皮肤：从 assets/skins/index.json 加载清单，用 CSS 变量/样式表切换，失败回退默认。
   新增皮肤只需加文件夹和注册表条目，不必改本文件的业务逻辑。 */
const SKIN_ROOT='assets/skins';
const SKIN_FALLBACK='nova';
const SKINS={list:[],byId:{},current:null,icons:{},logo:'',ready:false,failed:0};

function skinBase(id){return SKIN_ROOT+'/'+id}
function skinStorageKey(){return (SESSION&&SESSION.user&&SESSION.user.id!=null)?('nova_skin_u_'+SESSION.user.id):'nova_skin'}
/* 旧 id 只在这里映射，设置界面不展示这些字符串。 */
const SKIN_RENAMES={facebook:'social-blue',tiktok:'pulse'};
function canonSkin(id){
  const raw=String(id||'').trim();
  if(!raw)return '';
  return SKIN_RENAMES[raw.toLowerCase()]||raw;
}
function rememberedSkin(){
  try{
    const per=localStorage.getItem(skinStorageKey());
    if(per)return canonSkin(per);
    return canonSkin(localStorage.getItem('nova_skin')||'');
  }catch(e){return ''}
}
function migrateStoredSkin(){
  try{
    const keys=[];
    for(let i=0;i<localStorage.length;i++){
      const k=localStorage.key(i);
      if(k&&k.indexOf('nova_skin')===0)keys.push(k);
    }
    keys.forEach(k=>{
      const v=localStorage.getItem(k);
      const n=canonSkin(v);
      if(n&&n!==v)localStorage.setItem(k,n);
    });
  }catch(e){}
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
  const meta=SKINS.current&&SKINS.byId[SKINS.current];
  let rel='';
  if(meta){
    const light=typeof resolvedTheme==='function'&&resolvedTheme()==='light';
    rel=(light&&meta.logoLight)?meta.logoLight:(meta.logo||'');
  }
  const light2=typeof resolvedTheme==='function'&&resolvedTheme()==='light';
  const src=rel?skinBase(meta.id)+'/'+rel:(SKINS.logo||('assets/brand/vexo-lockup'+(light2?'-light':'')+'.png'));
  if(src)return '<img class="br-logo" src="'+esc(src)+'" alt="VEXO">';
  return 'VEXO';
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
function skinTokenHref(meta){
  const rel=meta&&(meta.tokensCss||meta.tokens_css)||'';
  if(!rel||typeof rel!=='string'||rel.includes('..')||rel.startsWith('/'))return '';
  return skinBase(meta.id)+'/'+rel;
}
async function applySkin(id,opts){
  const save=!(opts&&opts.save===false);
  const requested=String(id||'').trim();
  const want=canonSkin(requested)||SKIN_FALLBACK;
  const migrated=!!(requested&&canonSkin(requested)!==requested);
  let meta=SKINS.byId[want];
  if(!meta){
    if(want!==SKIN_FALLBACK&&SKINS.byId[SKIN_FALLBACK]){return applySkin(SKIN_FALLBACK,{save:false})}
    if(want!=='default'&&SKINS.byId.default){return applySkin('default',{save:false})}
    document.documentElement.dataset.skin=SKIN_FALLBACK;
    SKINS.current=SKIN_FALLBACK;
    return;
  }
  await loadSheet(skinTokenHref(meta),'nova-skin-tokens');
  const okCss=await loadSheet(meta.css?(skinBase(meta.id)+'/'+meta.css):'', 'nova-skin-css');
  if(!okCss && meta.id!==SKIN_FALLBACK && meta.id!=='default'){
    SKINS.failed++;
    return applySkin(SKIN_FALLBACK,{save:false});
  }
  document.documentElement.dataset.skin=meta.id;
  SKINS.current=meta.id;
  SKINS.logo=meta.logo?skinBase(meta.id)+'/'+meta.logo:'';
  try{await loadSkinIcons(meta)}catch(e){SKINS.icons={}}
  if(save||migrated){
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
  /* r7：去掉滑杆。上下滑动设置页时手指划过滑杆会实时改界面大小，整页跟着放大缩小；只保留三个按钮。 */
  return `<div class="row" style="flex-wrap:wrap;align-items:flex-start"><div class="gr"><b>界面大小</b><small>缩放字体、按钮和间距。偏好保存在本机。</small></div><div class="sw uis">${btns}</div></div>`;
}
/* r8.3：按键皮肤分两组。「基础」= 初代 / 经典 / 液态玻璃，用按键预览卡；「精选」= Starlight / 星澜 / 社交蓝 / 脉冲，
   每个只放一个应用图标式的方块（skin.json 的 tile），不再加载整屏截图预览。统一 3 列网格、卡片同尺寸。
   分组来自 index.json 的 group；没有标注的按 id 兜底（nova/default/glass 归基础）。皮肤 id、切换和失败回退逻辑不变。 */
const SKIN_BASIC_IDS=['nova','default','glass'];
function skinGroup(s){const g=s&&(s.group||(SKINS.groups&&SKINS.groups[s.id]));if(g==='basic'||g==='featured')return g;return SKIN_BASIC_IDS.includes(s&&s.id)?'basic':'featured'}
function skinCard(s,cur){
  const on=s.id===cur,basic=skinGroup(s)==='basic';
  const rel=basic?(s.preview||''):(s.tile||'');
  const src=rel?(skinBase(s.id)+'/'+rel):'';
  const art=src?`<img class="skart${basic?' skbtn':' sktile'}" src="${esc(src)}" alt="" loading="lazy" decoding="async" onerror="this.style.visibility='hidden'">`:`<span class="skart skph">${esc(String(s.name||s.id).slice(0,1))}</span>`;
  return `<button type="button" class="skcard${on?' on':''}" data-a="setskin" data-v="${esc(s.id)}" aria-pressed="${on?'true':'false'}">${art}<span class="skname">${esc(s.name||s.id)}</span>${on?'<i class="skon" aria-hidden="true">✓</i>':''}</button>`;
}
function skinRow(){
  const list=SKINS.list||[];
  if(!list.length)return '';
  const cur=SKINS.current||SKIN_FALLBACK;
  const basic=list.filter(s=>skinGroup(s)==='basic'),feat=list.filter(s=>skinGroup(s)!=='basic');
  const sec=(t,arr)=>arr.length?`<div class="skgl">${t}</div><div class="skgrid">${arr.map(s=>skinCard(s,cur)).join('')}</div>`:'';
  return `<div class="shd">按键皮肤</div><p class="hint" style="padding:8px 16px 0">换一套按键和主题色彩。加载失败时会回到可用的皮肤。</p><div class="skwrap">${sec('基础',basic)}${sec('精选',feat)}</div>`;
}
function setskin(id){
  const meta=SKINS.byId[canonSkin(id)];
  const mode=meta&&(meta.defaultMode||meta.default_mode);
  if(meta&&(mode==='light'||mode==='dark')&&D&&D.st){
    D.st.theme=mode;
    if(typeof applyResolvedTheme==='function')applyResolvedTheme();
  }
  return applySkin(id);
}

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
        if(e.group)meta.group=e.group;
        SKINS.byId[meta.id]=meta;
        loaded.push(meta);
      }catch(err){}
    }
    SKINS.list=loaded;
    SKINS.ready=true;
    migrateStoredSkin();
    let pick='';
    const serverSkin=SESSION&&SESSION.user&&SESSION.user.skin;
    if(serverSkin)pick=canonSkin(serverSkin);
    if(!pick)pick=rememberedSkin();
    if(!pick||!SKINS.byId[pick])pick=defaultId;
    if(!SKINS.byId[pick])pick=loaded[0]&&loaded[0].id;
    const raw=serverSkin&&canonSkin(serverSkin)!==String(serverSkin).trim()?serverSkin:(pick||SKIN_FALLBACK);
    await applySkin(raw,{save:false});
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
