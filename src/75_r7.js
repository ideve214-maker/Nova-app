/* r7：防缩放、键盘下的面板、帖子媒体上传与显示、日常（独立于帖子）。
   只改前端，可热更新。需要服务端配合的地方写在 docs/r7-server-notes.md。 */

/* ---- 1. 防缩放 ----
   iOS Safari / 主屏幕应用会忽略 user-scalable=no；旧代码的全局 touchmove 拦截又对 .sc 内放行，
   所以在内容区里双指一捏就会整页放大，松手后停在放大状态，看起来"一会儿大一会儿小"。
   这里统一拦掉双指、手势和双击缩放（看图 .pswp 和头像裁剪 .cropstage 自己处理双指，放行），
   万一视口已经不是 1 倍（系统辅助功能、旧版本残留），失焦或视口变化时复位。 */
(function zoomGuard(){
  if(typeof document==='undefined'||window.__novaZoomGuard)return;
  window.__novaZoomGuard=1;
  const own=t=>!!(t&&t.closest&&t.closest('.pswp,.cropstage'));
  const stop=e=>{if(own(e.target))return;if(e.cancelable)e.preventDefault()};
  ['gesturestart','gesturechange','gestureend'].forEach(t=>document.addEventListener(t,stop,{passive:false}));
  document.addEventListener('touchstart',e=>{if(e.touches&&e.touches.length>1)stop(e)},{passive:false,capture:true});
  document.addEventListener('touchmove',e=>{if((e.touches&&e.touches.length>1)||(typeof e.scale==='number'&&e.scale!==1))stop(e)},{passive:false,capture:true});
  document.addEventListener('dblclick',e=>{if(!(e.target&&e.target.closest&&e.target.closest('input,textarea,[contenteditable]')))e.preventDefault()},{passive:false});
  const meta=document.querySelector('meta[name=viewport]');
  const BASE='width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
  let t=null;
  function reset(){
    const vv=window.visualViewport;
    if(!vv||!meta)return false;
    if(Math.abs((vv.scale||1)-1)<0.01)return false;
    meta.setAttribute('content',BASE.replace('initial-scale=1,','initial-scale=1.0,'));
    requestAnimationFrame(()=>meta.setAttribute('content',BASE));
    return true;
  }
  const later=()=>{clearTimeout(t);t=setTimeout(reset,150)};
  if(window.visualViewport)window.visualViewport.addEventListener('resize',later);
  document.addEventListener('focusout',later,true);
  window.addEventListener('orientationchange',later);
  window.__novaZoomReset=reset;
})();

/* ---- 2. 键盘：输入框获得焦点后滚到可见处；群名输入按"完成"收起键盘 ---- */
document.addEventListener('focusin',e=>{
  const el=e.target;
  if(!el||!el.matches||!el.matches('input:not([type=checkbox]):not([type=file]),textarea'))return;
  setTimeout(()=>{
    if(document.activeElement!==el||!el.isConnected)return;
    if(el.closest('.pn,.sc,.pnl'))try{el.scrollIntoView({block:'nearest'})}catch(_){}
  },320);
});
document.addEventListener('keydown',e=>{
  const el=e.target;
  if(e.key==='Enter'&&el&&el.dataset&&(el.dataset.d==='gn'||el.dataset.d==='locin'))
    {e.preventDefault();el.blur()}
});

/* ---- 3. 媒体：取访问凭证显示服务器上的图片/视频 ---- */
function mItem(m){
  if(typeof m==='string')return /^(blob:|data:|https?:|\/|assets\/)/.test(m)?{url:m}:{id:m};
  return m||{};
}
function mKind(m){
  const x=mItem(m),src=x.url||'';
  return x.kind||((String(x.type||x.mime||'')).startsWith('video')||/\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(src)?'video':'image');
}
const MEDIA_T=new Map();
function mediaTicket(id){
  const c=MEDIA_T.get(id),now=Date.now();
  if(c&&c.exp-now>30e3)return c.p;
  const p=api('POST','/api/media/'+encodeURIComponent(id)+'/ticket',{}).then(r=>{
    if(r.s!==200||!r.j||!r.j.ticket)return null;
    const e=MEDIA_T.get(id);if(e)e.exp=Number(r.j.expiresAt)||Date.now()+240e3;
    return r.j.ticket;
  }).catch(()=>null);
  MEDIA_T.set(id,{p,exp:now+60e3});
  return p;
}
function mediaFileUrl(id,ticket,preview){
  return apiUrl('/api/media/'+encodeURIComponent(id)+'/'+(preview?'preview':'file')+'?ticket='+encodeURIComponent(ticket));
}
function hydrateMedia(root){
  if(typeof SESSION==='undefined'||!SESSION)return;
  (root||document).querySelectorAll('[data-mid]:not([data-mh])').forEach(el=>{
    el.setAttribute('data-mh','1');
    const id=el.getAttribute('data-mid');
    mediaTicket(id).then(t=>{
      if(!el.isConnected)return;
      if(!t){const f=document.createElement('div');f.className='mfail';f.textContent='暂时无法显示';el.replaceWith(f);return}
      if(el.tagName==='VIDEO'){el.poster=mediaFileUrl(id,t,true);el.src=mediaFileUrl(id,t,false)}
      else el.src=mediaFileUrl(id,t,false);
    });
  });
}
/* 帖子/主页里的媒体网格。det=详情页（视频带控制条）。 */
function mediaHTML(list,det,pid){
  const media=(Array.isArray(list)?list:[]).map(mItem).filter(x=>x.url||x.id);
  if(!media.length)return '';
  const show=det?media:media.slice(0,4),n=Math.min(show.length,4);
  const cells=show.map(m=>{
    const src=m.url?` src="${esc(m.url)}"`:` data-mid="${esc(m.id)}"`;
    if(mKind(m)==='video')return `<span class="mv"${det||!pid?'':` data-a="post" data-v="${esc(pid)}"`}><video${src} muted playsinline preload="metadata"${det?' controls':''}></video></span>`;
    return `<img class="zoomimg" loading="lazy"${src} alt="">`;
  }).join('');
  const more=!det&&media.length>4?`<div class="fmore"${pid?` data-a="post" data-v="${esc(pid)}"`:''}>共 ${media.length} 张，点开查看全部</div>`:'';
  return `<div class="fmedia n${n}">${cells}</div>${more}`;
}
if(typeof MutationObserver!=='undefined'&&document.getElementById('app')){
  let q=0;
  const mo=new MutationObserver(()=>{if(q)return;q=1;requestAnimationFrame(()=>{q=0;hydrateMedia(document);storyTick()})});
  mo.observe(document.getElementById('app'),{childList:true,subtree:true});
}
document.addEventListener('play',e=>{const w=e.target&&e.target.closest&&e.target.closest('.mv');if(w)w.classList.add('playing')},true);

/* ---- 4. 上传：HEIC/超大图片先在手机上转成 JPEG；iPhone 的 .mov 按 mp4 容器上传 ---- */
function toJpeg(f,max,q){
  return new Promise((res,rej)=>{
    const url=URL.createObjectURL(f),img=new Image();
    img.onload=()=>{
      try{
        let w=img.naturalWidth,h=img.naturalHeight;const s=Math.min(1,max/Math.max(w,h));
        w=Math.max(1,Math.round(w*s));h=Math.max(1,Math.round(h*s));
        const c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(img,0,0,w,h);
        URL.revokeObjectURL(url);
        c.toBlob(b=>b?res(b):rej(new Error('toBlob')),'image/jpeg',q);
      }catch(e){URL.revokeObjectURL(url);rej(e)}
    };
    img.onerror=()=>{URL.revokeObjectURL(url);rej(new Error('decode'))};
    img.src=url;
  });
}
async function prepUpload(f){
  let file=f,type=String(f.type||'').toLowerCase(),name=String(f.name||'file');
  const base=name.replace(/\.[^.]+$/,'')||'file';
  if(type.startsWith('image/')||/\.(heic|heif)$/i.test(name)){
    const native=/^image\/(jpeg|png|webp|gif)$/.test(type);
    if(!native||f.size>6*1024*1024){
      const j=await toJpeg(f,2560,0.86).catch(()=>null);
      if(j){file=j;type='image/jpeg';name=base+'.jpg'}
    }
  }else if(type==='video/quicktime'||/\.(mov|m4v)$/i.test(name)){type='video/mp4';name=base+'.mp4'}
  else if(!type&&/\.mp4$/i.test(name))type='video/mp4';
  return {file,type,name};
}
async function uploadMedia(f){
  const u=await prepUpload(f);
  const r=await fetch(apiUrl('/api/media'),{method:'POST',headers:{Authorization:'Bearer '+SESSION.token,'Content-Type':u.type||'application/octet-stream','X-File-Name':encodeURIComponent(u.name)},body:u.file});
  let j={};try{j=await r.json()}catch(e){}
  if(r.status!==200||!j.media)throw new Error((j.error&&j.error.message)||'上传失败，请稍后再试');
  return j.media;
}
async function uploadAll(list){
  const todo=(list||[]).filter(m=>!m.id&&m.file);
  for(let i=0;i<todo.length;i++){
    T(todo.length>1?`正在上传 ${i+1}/${todo.length}…`:'正在上传…');
    const md=await uploadMedia(todo[i].file);
    todo[i].id=md.id;todo[i].kind=md.kind==='video'?'video':'image';
  }
}
function pickFiles(accept,multiple){
  return new Promise(res=>{
    const inp=document.createElement('input');inp.type='file';inp.accept=accept;inp.multiple=!!multiple;
    inp.onchange=()=>res([...(inp.files||[])]);inp.click();
  });
}
function localMedia(f){
  const kind=String(f.type||'').startsWith('video')||/\.(mov|mp4|m4v|webm)$/i.test(f.name||'')?'video':'image';
  return {url:URL.createObjectURL(f)+(kind==='video'?'#t=0.1':''),kind,name:f.name,file:f};
}

/* ---- 5. 心情、位置、标记好友 ---- */
const MOOD_E={'开心':'😊','兴奋':'🤩','幸福':'🥰','感恩':'🙏','放松':'😌','思考':'🤔','想旅行':'✈️','在工作':'💼','想吃饭':'🍜','运动中':'🏃','难过':'😢','疲惫':'😪'};
const moodLabel=m=>m?((MOOD_E[m]||'😊')+' '+m):'';
function recentLocs(){try{return JSON.parse(localStorage.getItem('nova_loc_recent')||'[]').filter(Boolean).slice(0,6)}catch(e){return []}}
function rememberLoc(l){if(!l)return;try{const a=[l,...recentLocs().filter(x=>x!==l)].slice(0,6);localStorage.setItem('nova_loc_recent',JSON.stringify(a))}catch(e){}}
function taggedNames(ids){
  const a=(ids||[]).map(String).map(id=>{const p=P(id);return p&&p.n&&p.n!=='用户'?p.n:''});
  const known=a.filter(Boolean),unk=a.length-known.length;
  if(!a.length)return '';
  const head=known.slice(0,2).join('、');
  const rest=a.length-Math.min(2,known.length);
  return head?(rest>0?`${head} 等 ${a.length} 人`:head):`${unk} 位好友`;
}
async function loadTagPeople(){
  if(typeof usingNet!=='function'||!usingNet()||!SESSION)return;
  const jobs=[];
  if(typeof loadFriends==='function')jobs.push(loadFriends());
  if(typeof loadFollows==='function'&&!Array.isArray(S.following))jobs.push(loadFollows());
  await Promise.all(jobs.map(p=>Promise.resolve(p).catch(()=>{})));
}

/* ---- 6. 日常：只在首页顶部那一排显示，24 小时后自动隐藏，不进帖子列表、不算帖子数 ----
   服务端还没有 kind 字段时，用 mood 里的隐藏标记区分（见 docs/r7-server-notes.md）。 */
const STORY_MARK='__nova_story__';
const STORY_TTL=24*3600e3;
function isStory(p){return !!p&&(p.kind==='story'||p.mood===STORY_MARK)}
function postAt(p){const n=typeof p.at==='number'?p.at:Date.parse(p.at||'');return Number.isFinite(n)?n:0}
function allPostsRaw(){return typeof usingNet==='function'&&usingNet()?(Array.isArray(S.posts)?S.posts:[]):(D.p||[])}
function storySrc(){const now=Date.now();return allPostsRaw().filter(p=>isStory(p)&&(!postAt(p)||now-postAt(p)<STORY_TTL))}
function storySeen(){try{return new Set(JSON.parse(localStorage.getItem('nova_story_seen')||'[]'))}catch(e){return new Set()}}
function markStorySeen(id){try{const s=storySeen();if(s.has(String(id)))return;const a=[...s,String(id)].slice(-400);localStorage.setItem('nova_story_seen',JSON.stringify(a))}catch(e){}}
function storyGroups(){
  const seen=storySeen(),by=new Map();
  storySrc().forEach(p=>{const a=String(p.a);if(!by.has(a))by.set(a,[]);by.get(a).push(p)});
  const gs=[...by.entries()].map(([a,items])=>{
    items.sort((x,y)=>postAt(x)-postAt(y));
    return {a,items,seen:items.every(p=>seen.has(String(p.id))),last:Math.max(...items.map(postAt))};
  });
  gs.sort((x,y)=>(x.a==='me'?-1:y.a==='me'?1:0)||(x.seen-y.seen)||(y.last-x.last));
  return gs;
}
function storyStrip(){
  const gs=storyGroups();
  const create=`<button class="st-create" data-a="storynew"><span class="st-photo">${av('me',76)}</span><i class="st-add">${typeof icLine==='function'?icLine('plus'):'+'}</i><em>发日常</em></button>`;
  const items=gs.map(g=>`<button class="st-item${g.a==='me'?' mine':''}" data-a="storyopen" data-v="${esc(g.a)}"><span class="st-ring${g.seen&&g.a!=='me'?' seen':''}">${av(g.a,58)}</span><span>${g.a==='me'?'我的日常':esc(P(g.a).n)}</span></button>`).join('');
  const tip=gs.length?'':`<div class="st-tip" style="align-self:center;color:var(--t2);font-size:13px;line-height:1.5;max-width:200px">发一条日常，只在这一排显示，24 小时后自动消失。</div>`;
  return `<div class="stories">${create}${items}${tip}</div>`;
}
const ST_BG=['linear-gradient(160deg,#2D88FF,#7A4DFF)','linear-gradient(160deg,#FF7A59,#FF3D77)','linear-gradient(160deg,#11998E,#38EF7D)','linear-gradient(160deg,#F7971E,#FFD200)','linear-gradient(160deg,#434343,#000)'];
const stBg=id=>ST_BG[[...String(id)].reduce((a,c)=>a+c.charCodeAt(0),0)%ST_BG.length];
let STV={key:'',timer:null};
function pStory(a,idx){
  const g=storyGroups().find(x=>x.a===String(a));
  if(!g||!g.items.length)return `<div class="pg"><div class="stv"><div class="hd"><span class="gr"></span><button data-a="stclose" aria-label="关闭">✕</button></div><div class="bd"><div class="tx" style="font-size:17px;font-weight:500">这条日常已经消失了</div></div></div></div>`;
  const i=Math.max(0,Math.min(g.items.length-1,+idx||0)),p=g.items[i],m=(p.media||[]).map(mItem)[0];
  markStorySeen(p.id);
  const tm=typeof fmtTime==='function'&&postAt(p)?fmtTime(postAt(p)):(p.t||'');
  const bars=g.items.map((x,j)=>`<i class="${j<i?'done':j===i?'on':''}"><b></b></i>`).join('');
  let body;
  if(m){
    const src=m.url?` src="${esc(m.url)}"`:` data-mid="${esc(m.id)}"`;
    body=mKind(m)==='video'?`<video${src} autoplay muted playsinline></video>`:`<img${src} alt="">`;
    if(p.x)body+=`<div class="cap">${esc(p.x)}</div>`;
  }else body=`<div class="tx">${esc(p.x||'')}</div>`;
  const mine=g.a==='me';
  return `<div class="pg"><div class="stv" data-sid="${esc(String(p.id))}" data-sa="${esc(g.a)}" data-si="${i}" data-sn="${g.items.length}" data-kind="${m?mKind(m):'text'}"><div class="bars">${bars}</div><div class="hd">${av(g.a,36)}<span class="gr"><b>${mine?'我的日常':esc(P(g.a).n)}</b><small>${esc(tm)}</small></span><button data-a="stclose" aria-label="关闭">✕</button></div><div class="bd" style="${m?'':'background:'+stBg(p.id)}"><button class="tapl" data-a="stprev" aria-label="上一条"></button><button class="tapr" data-a="stnext" aria-label="下一条"></button>${body}</div><div class="ft"><span>${i+1} / ${g.items.length} · 24 小时后自动消失</span>${mine?`<button data-a="stdel" data-v="${esc(String(p.id))}">删除</button>`:''}</div></div></div>`;
}
function storyTick(){
  const el=document.querySelector('#v .stv[data-sid]');
  const key=el?el.dataset.sid+'|'+el.dataset.si:'';
  if(key===STV.key)return;
  clearTimeout(STV.timer);STV.timer=null;STV.key=key;
  if(!el)return;
  const v=el.querySelector('video');
  if(v){v.addEventListener('ended',()=>{if(STV.key!==key)return;A.stnext();render()});return}
  STV.timer=setTimeout(()=>{if(STV.key!==key)return;A.stnext();render()},5000);
}
function storyCur(){const c=S.st[S.st.length-1]||'';const[t,a,i]=String(c).split(':');return t==='story'?{a,i:+i||0}:null}
function pStoryNew(){
  const c=S.stc||(S.stc={media:null});
  const m=c.media;
  const prev=m?(m.kind==='video'?`<video src="${esc(m.url)}" muted playsinline autoplay loop></video>`:`<img src="${esc(m.url)}" alt="">`)+`<button class="x" data-a="stcrm" aria-label="移除">✕</button>`:`<div class="tx">${esc((S.d.stx||'').trim()||'写一句话，或选一张照片/一段视频')}</div>`;
  return `<div class="pg stc-pg"><div class="top sub"><button class="ib tx" data-a="stcx">取消</button><h1>发日常</h1><button class="pb" data-a="stpub">发布</button></div><div class="sc"><div class="stc-prev" style="background:${m?'#000':ST_BG[0]}">${prev}</div><textarea class="fld cta" data-d="stx" data-max="200" rows="2" placeholder="${m?'加一句说明（可不填）':'写点什么…'}"></textarea><div class="stc-tools"><button class="pb s" data-a="stcpick">${typeof icLine==='function'?icLine('photo'):''} 选照片 / 视频</button></div><p class="stc-hint">日常只出现在首页顶部那一排，24 小时后自动消失；不会出现在帖子列表里，也不计入帖子数。</p></div></div>`;
}
async function publishStory(){
  const c=S.stc||{},x=(S.d.stx||'').trim();
  if(!x&&!c.media)return T('写一句话，或选一张照片/一段视频');
  if(len(x)>200)return T('日常最多 200 字');
  if(S.stBusy)return;
  const done=()=>{S.stc=null;S.d.stx='';if(S.st[S.st.length-1]==='storynew')S.st.pop();S.tab='home';T('日常已发布，24 小时后自动消失')};
  if(typeof usingNet==='function'&&usingNet()&&SESSION){
    S.stBusy=1;
    try{
      if(x&&typeof checkText==='function'&&!(await checkText('post',x)))return;
      const media=c.media?[c.media]:[];
      await uploadAll(media);
      const p=await publishPost(x,{audience:'public',mood:STORY_MARK,kind:'story',media:media.map(m=>({id:m.id,kind:m.kind}))});
      if(!p)return;
      p.kind='story';p.at=p.at||Date.now();
      done();
    }catch(e){T((e&&e.message)||'发布失败，请稍后再试')}
    finally{S.stBusy=0}
    return;
  }
  D.p.unshift({id:'s'+Date.now(),a:'me',at:Date.now(),t:'刚刚',x,kind:'story',r:[0,0,0,0,0,0],m:-1,aud:'public',audience:'public',media:c.media?[{url:c.media.url,kind:c.media.kind}]:[]});
  done();
}

Object.assign(A,{
  storynew:()=>{S.stc={media:null};S.d.stx='';S.sh=null;A.go('storynew')},
  stcx:()=>{S.stc=null;if(S.st[S.st.length-1]==='storynew')S.st.pop()},
  stcpick:()=>pickFiles('image/*,video/*',false).then(fs=>{if(!fs.length)return;const c=S.stc||(S.stc={});c.media=localMedia(fs[0])}),
  stcrm:()=>{if(S.stc)S.stc.media=null},
  stpub:()=>publishStory(),
  storyopen:v=>{S.sh=null;S.st.push('story:'+v+':0')},
  stnext:()=>{const c=storyCur();if(!c)return;const gs=storyGroups(),g=gs.find(x=>x.a===c.a);if(g&&c.i<g.items.length-1){S.st[S.st.length-1]='story:'+c.a+':'+(c.i+1);S.noAnim=1;return}
    const k=gs.findIndex(x=>x.a===c.a),nx=gs.slice(k+1).find(x=>!x.seen&&x.a!=='me');if(nx){S.st[S.st.length-1]='story:'+nx.a+':0';S.noAnim=1;return}S.st.pop()},
  stprev:()=>{const c=storyCur();if(!c)return;if(c.i>0){S.st[S.st.length-1]='story:'+c.a+':'+(c.i-1);S.noAnim=1}},
  stclose:()=>{if(storyCur())S.st.pop()},
  stdel:v=>{
    const rm=()=>{if(Array.isArray(S.posts))S.posts=S.posts.filter(p=>String(p.id)!==String(v));D.p=D.p.filter(p=>String(p.id)!==String(v));T('已删除')};
    const local=(D.p||[]).some(p=>String(p.id)===String(v));
    if(!local&&typeof usingNet==='function'&&usingNet()&&SESSION)return api('POST','/api/posts/'+encodeURIComponent(v)+'/delete',{}).then(r=>{if(r.s!==200){T(errMsg(r,'删除失败'));return}rm()});
    rm();
  },
  setlocv:v=>{const c=compState();c.loc=String(v||'').slice(0,80);rememberLoc(c.loc);S.sh=null;if(typeof saveComposeDraft==='function')saveComposeDraft()},
});
