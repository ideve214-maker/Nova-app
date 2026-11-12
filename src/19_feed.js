/* M4.1 动态联网：登录后发帖必须等服务器确认才显示成功；演示数据仍只在本机。 */
function ago(ms){
  if(!ms)return '';
  const d=Math.max(0,(typeof now==='function'?now():Date.now())-ms);
  if(d<60e3)return '刚刚';
  if(d<3600e3)return Math.floor(d/60e3)+' 分钟前';
  if(d<86400e3)return Math.floor(d/3600e3)+' 小时前';
  if(d<7*86400e3)return Math.floor(d/86400e3)+' 天前';
  return vipDate(ms);
}
function rememberAuthor(a){
  if(!a||!a.id||!D.u)return;
  const me=SESSION&&SESSION.user&&Number(SESSION.user.id)===Number(a.id);
  if(me)return;
  const id=String(a.id);
  const l=(a.avatar&&a.avatar.letter)||[...String(a.displayName||a.username||'用')][0];
  const c=(a.avatar&&a.avatar.color)||'#3A3F46';
  D.u[id]=[a.displayName||a.username,a.username,l,c,'',a.vip?1:0];
}
function adoptPost(p){
  rememberAuthor(p.author);
  const me=SESSION&&SESSION.user&&p.author&&Number(SESSION.user.id)===Number(p.author.id);
  return {id:p.id,a:me?'me':String(p.author.id),t:ago(p.createdAt),x:p.text,r:p.reactions||[0,0,0,0,0,0],m:p.myReaction==null?-1:p.myReaction,src:'net',edited:!!p.edited};
}
function netPosts(){if(MODE!=='account'||!NET)return null;return S.posts}
async function loadFeed(){
  if(MODE!=='account'||!SESSION)return;
  const r=await api('GET','/api/posts?limit=50');
  if(r.s!==200){S.postsErr=errMsg(r,'动态加载失败');return}
  S.posts=(r.j.posts||[]).map(adoptPost);S.postsErr='';
}
async function publishPost(text){
  const r=await api('POST','/api/posts',{text,clientId:'c'+Date.now()+'-'+Math.random().toString(36).slice(2,8)});
  if(r.s!==200){T(errMsg(r,'发布失败'));return null}
  const p=adoptPost(r.j.post);
  S.posts=S.posts||[];
  if(!S.posts.some(x=>x.id===p.id))S.posts.unshift(p);
  return p;
}
function usingNet(){return MODE==='account'&&!!NET}
function feedSrc(){return usingNet()?(Array.isArray(S.posts)?S.posts:[]):D.p}
function postsOf(id){return feedSrc().filter(p=>p.a==id)}
