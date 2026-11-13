/* r7 发帖与日常：选图、上传、独立日常发布与顶栏查看。 */
const COMPOSE_MAX={post:9,story:1};
const STORY_TEXT_MAX=140;
function isStoryMode(){return !!(S.comp&&S.comp.mode==='story')}
function mediaSrc(m){
  if(!m)return '';
  const src=typeof m==='string'?m:(m.url||m.src||m.previewUrl||'');
  if(!src)return '';
  if(typeof apiUrl==='function'&&src.charAt(0)==='/'&&!/^[a-z][a-z0-9+.-]*:/i.test(src))return apiUrl(src);
  return src;
}
function taggedChip(p){
  if(p.taggedUsers&&p.taggedUsers.length){
    const names=p.taggedUsers.map(u=>u.displayName||u.username||'').filter(Boolean);
    if(names.length)return '👤 '+names.map(n=>esc(n)).join('、');
  }
  const ids=p.tagged||[];
  if(!ids.length)return '';
  const names=ids.map(id=>{const u=typeof P==='function'?P(String(id)):null;return (u&&D.u[String(id)]&&u.n)?esc(u.n):''}).filter(Boolean);
  return names.length?('👤 '+names.join('、')):('👤 '+ids.length+' 人');
}
function composePicker(){
  let inp=document.getElementById('comp-file');
  if(!inp){
    inp=document.createElement('input');
    inp.type='file';
    inp.id='comp-file';
    inp.accept='image/*';
    inp.multiple=true;
    inp.setAttribute('autocomplete','off');
    inp.style.cssText='position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.appendChild(inp);
    inp.addEventListener('change',onComposeFiles);
  }
  return inp;
}
function addComposeImages(){
  const c=compState();
  const max=COMPOSE_MAX[c.mode==='story'?'story':'post'];
  if((c.media||[]).length>=max){T(c.mode==='story'?'日常只需一张照片':'最多 9 张');return false}
  const inp=composePicker();
  inp.value='';
  inp.multiple=c.mode!=='story';
  inp.click();
  return false;
}
function onComposeFiles(ev){
  const inp=ev&&ev.target;
  const files=[...(inp&&inp.files||[])];
  if(inp)inp.value='';
  if(!files.length){T('没有读到照片，请再选一次');return}
  const c=compState();
  const max=COMPOSE_MAX[c.mode==='story'?'story':'post'];
  const room=Math.max(0,max-(c.media||[]).length);
  const take=files.slice(0,room);
  let added=0;
  for(const f of take){
    const type=(f.type||'').toLowerCase();
    const name=f.name||'';
    if(type.startsWith('video')||/\.(mp4|webm|mov|m4v)$/i.test(name)){T('发帖暂不支持上传视频，请选择照片');continue}
    if(type&&!type.startsWith('image/')&&type!=='application/octet-stream'){T('请选择照片');continue}
    if(!f.size){T('没有读到照片，请再选一次');continue}
    try{
      const url=URL.createObjectURL(f);
      c.media=c.media||[];
      c.media.push({url,kind:'image',name:name||'photo.jpg',file:f});
      added++;
    }catch(e){T('无法读取这张照片，请再试一次')}
  }
  if(typeof render==='function')render();
  if(!added&&take.length)T('没有添加成功，请再试一次');
}
function prepareImageForUpload(file){
  const type=(file.type||'').toLowerCase();
  const name=file.name||'photo.jpg';
  const ok=['image/jpeg','image/png','image/webp','image/gif'].includes(type);
  if(ok&&file.size&&file.size<=10*1024*1024)return Promise.resolve({blob:file,type,name});
  const load=()=>{
    if(typeof createImageBitmap==='function')return createImageBitmap(file);
    return new Promise((resolve,reject)=>{
      const url=URL.createObjectURL(file);
      const img=new Image();
      img.onload=()=>{URL.revokeObjectURL(url);resolve(img)};
      img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('decode'))};
      img.src=url;
    });
  };
  return load().then(bmp=>{
    const w=bmp.width||bmp.naturalWidth,h=bmp.height||bmp.naturalHeight;
    const max=1920,scale=Math.min(1,max/Math.max(w,h,1));
    const cw=Math.max(1,Math.round(w*scale)),ch=Math.max(1,Math.round(h*scale));
    const cv=document.createElement('canvas');cv.width=cw;cv.height=ch;
    const ctx=cv.getContext('2d');ctx.drawImage(bmp,0,0,cw,ch);
    if(bmp.close)try{bmp.close()}catch(e){}
    return new Promise((resolve,reject)=>{
      cv.toBlob(b=>{
        if(!b)return reject(new Error('encode'));
        const base=name.replace(/\.[^.]+$/,'')||'photo';
        resolve({blob:b,type:'image/jpeg',name:base+'.jpg'});
      },'image/jpeg',0.9);
    });
  }).catch(()=>{throw new Error('这张照片格式暂不支持，请换一张，或在相册里导出为 JPEG 后再试')});
}
async function uploadMediaFile(file){
  if(!SESSION||!SESSION.token)throw new Error('请先登录');
  const prepared=await prepareImageForUpload(file);
  const r=await fetch(apiUrl('/api/media'),{method:'POST',headers:{Authorization:'Bearer '+SESSION.token,'Content-Type':prepared.type||'image/jpeg','X-File-Name':encodeURIComponent(prepared.name)},body:prepared.blob});
  let j={};
  try{j=await r.json()}catch(e){}
  if(r.status!==200)throw new Error((j.error&&j.error.message)||'上传失败，请稍后再试');
  if(!j.media||!j.media.id)throw new Error('上传失败，请稍后再试');
  return j.media;
}
async function resolveMediaList(media){
  if(!Array.isArray(media)||!media.length)return media||[];
  const out=[];
  for(const m of media){
    const item=typeof m==='string'?{id:m}:Object.assign({},m);
    const id=item.id||item.mediaId;
    const cur=item.url||'';
    if(cur&&!String(cur).startsWith('blob:')&&!String(cur).startsWith('data:')){
      item.url=mediaSrc(item);
      out.push(item);continue;
    }
    if(id&&SESSION){
      const r=await api('POST','/api/media/'+id+'/ticket',{ttlMs:12*3600*1000});
      if(r.s===200&&r.j.ticket){
        item.id=id;
        item.url=apiUrl('/api/media/'+id+'/file?ticket='+encodeURIComponent(r.j.ticket));
      }
    }
    out.push(item);
  }
  return out;
}
async function resolvePostsMedia(list){
  if(!Array.isArray(list))return list;
  for(const p of list){
    if(p&&p.media&&p.media.length)p.media=await resolveMediaList(p.media);
  }
  return list;
}

function openCompose(v){
  const story=v==='story';
  S.d=S.d||{};
  if(story){
    if(typeof loadStoryDraft==='function')loadStoryDraft();
    else{
      S.comp={media:[],aud:'public',mood:'',loc:'',tags:[],mode:'story',_inited:1};
      S.d.pin=S.d.spin||'';
    }
  }else{
    S.d.pin='';
    S.comp={media:[],aud:'public',mood:'',loc:'',tags:[],mode:'post'};
    if(typeof loadComposeDraft==='function')loadComposeDraft();
  }
  if(typeof compState==='function')compState();
  S.sh=null;
  A.go('compose');
}
function closeCompose(){
  if(isStoryMode()){if(typeof saveStoryDraft==='function')saveStoryDraft()}
  else if(typeof saveComposeDraft==='function')saveComposeDraft();
  S.sh=null;
  if(S.st[S.st.length-1]==='compose')S.st.pop();else S.st=[];
}

function storyGroups(){
  if(typeof usingNet==='function'&&usingNet()&&Array.isArray(S.stories))return S.stories;
  return Array.isArray(D.stories)?D.stories:[];
}
function adoptStoryGroup(g){
  if(!g)return null;
  if(g.author)rememberAuthor(g.author);
  const me=SESSION&&SESSION.user&&g.author&&Number(SESSION.user.id)===Number(g.author.id);
  const items=(g.items||[]).map(p=>{
    const o=typeof adoptPost==='function'?adoptPost(p):p;
    o.kind='story';
    return o;
  });
  return {id:me?'me':String(g.author&&g.author.id||''),author:g.author,a:me?'me':String(g.author&&g.author.id||''),items,latestAt:g.latestAt};
}
async function loadStories(){
  if(MODE!=='account'||!SESSION)return;
  const r=await api('GET','/api/stories');
  if(r.s!==200){S.storiesErr=errMsg(r,'日常加载失败');return}
  const groups=(r.j.stories||[]).map(adoptStoryGroup).filter(Boolean);
  for(const g of groups)await resolvePostsMedia(g.items||[]);
  S.stories=groups;S.storiesErr='';
}

function openStoryView(id,index){
  const groups=storyGroups();
  const gi=groups.findIndex(g=>String(g.a)===String(id)||String(g.id)===String(id));
  if(gi<0)return T('还没有日常');
  S.storyView={gi,ii:Math.max(0,index||0)};
  S.sh=null;
  A.go('storyview');
}
function closeStoryView(){
  S.storyView=null;
  if(S.st[S.st.length-1]==='storyview')S.st.pop();
}
function navStory(dir){
  const groups=storyGroups();
  const v=S.storyView;if(!v)return;
  let {gi,ii}=v;
  ii+=dir;
  if(gi>=0&&gi<groups.length){
    const items=groups[gi].items||[];
    if(ii>=0&&ii<items.length){S.storyView={gi,ii};return}
    if(ii>=items.length){gi++;ii=0}
    else if(ii<0){gi--;ii=0;if(gi>=0)ii=Math.max(0,((groups[gi].items||[]).length)-1)}
  }
  if(gi<0||gi>=groups.length){closeStoryView();return}
  S.storyView={gi,ii};
}

function pStoryView(){
  const groups=storyGroups();
  const v=S.storyView||{gi:0,ii:0};
  const g=groups[v.gi];
  if(!g)return `<div class="pg storyv"><div class="top sub"><button class="ib" data-a="storyclose" aria-label="关闭">${ic('back')}</button><h1>日常</h1></div><div class="sc"><p class="em">还没有日常</p></div></div>`;
  const items=g.items||[];
  const it=items[v.ii]||items[0]||{};
  const src=(it.media&&it.media[0])?mediaSrc(it.media[0]):'';
  const who=g.a?P(g.a):{n:(g.author&&(g.author.displayName||g.author.username))||'日常'};
  const tm=typeof fmtTime==='function'&&it.at?fmtTime(it.at):(it.t||'');
  const dots=items.length>1?`<div class="story-dots">${items.map((_,i)=>`<i class="${i===v.ii?'on':''}"></i>`).join('')}</div>`:'';
  return `<div class="pg storyv"><div class="top sub"><button class="ib" data-a="storyclose" aria-label="关闭">${ic('back')}</button><h1>${esc(who.n||'日常')}</h1><small>${esc(tm)}</small></div>${dots}<div class="story-body"><button class="story-hit l" data-a="storyprev" aria-label="上一条"></button>${src?`<img src="${esc(src)}" alt="">`:''}${it.x?`<div class="story-text">${esc(it.x)}</div>`:''}<button class="story-hit r" data-a="storynext" aria-label="下一条"></button></div></div>`;
}

async function publishCompose(){
  const story=isStoryMode();
  const x=((story?S.d.pin:S.d.pin)||'').trim();
  const mx=story?STORY_TEXT_MAX:(typeof textLimit==='function'?textLimit('post'):500);
  const c=typeof compState==='function'?compState():{aud:'public',media:[],mood:'',loc:'',tags:[],mode:'post'};
  if(!x&&!(c.media&&c.media.length))return T(story?'写一句，或添加一张照片':'写点什么，或添加一张照片');
  if(x&&!(typeof ok==='function'?ok(x,mx):x.length<=mx))return T(story?('日常最多 '+mx+' 字'):('动态最多 '+mx+' 字'));
  const localMedia=(c.media||[]).map(m=>({url:m.url,kind:m.kind||'image',file:m.file,id:m.id}));
  const meta={audience:c.aud||'public',mood:story?'':(c.mood||''),location:story?'':(c.loc||''),tagged:story?[]:(c.tags||[]),media:localMedia,kind:story?'story':'post'};
  const done=p=>{
    if(story){if(typeof clearStoryDraft==='function')clearStoryDraft()}
    else if(typeof clearComposeDraft==='function')clearComposeDraft();
    S.sh=null;S.st=[];S.tab='home';
    T(story?'日常已发布':'已发布');
  };
  const goLocal=()=>{
    const item={id:'p'+Date.now(),a:'me',t:'刚刚',at:Date.now(),x,r:[0,0,0,0,0,0],m:-1,aud:meta.audience,audience:meta.audience,mood:meta.mood,location:meta.location,tagged:meta.tagged,media:meta.media.map(m=>({url:m.url,kind:m.kind||'image'})),kind:story?'story':'post'};
    if(story){
      D.stories=D.stories||[];
      let g=D.stories.find(z=>z.a==='me');
      if(!g){g={id:'me',a:'me',author:null,items:[],latestAt:item.at};D.stories.unshift(g)}
      g.items.unshift(item);g.latestAt=item.at;
    }else D.p.unshift(item);
    done(item);
  };
  if(MODE==='account'&&NET&&SESSION){
    const run=()=>publishPost(x,meta).then(p=>{if(!p)return;done(p)});
    if(x&&typeof checkText==='function')return checkText('post',x).then(okc=>{if(!okc)return;return run()});
    return run();
  }
  goLocal();
}
