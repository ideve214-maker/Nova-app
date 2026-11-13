/* M4.1 动态联网：登录后发帖必须等服务器确认才显示成功；演示数据仍只在本机。 */
/** 用本机时区把 UTC 时间戳（毫秒）格式化。服务端只存 UTC epoch，不存「刚刚」这类相对文案。 */
function fmtTime(ms, clock){
  if(ms==null||ms==='')return '';
  const n=typeof ms==='number'?ms:(typeof ms==='string'&&/^\d+$/.test(ms)?Number(ms):Date.parse(ms));
  if(!Number.isFinite(n))return typeof ms==='string'?ms:'';
  const nowMs=clock!=null?clock:(typeof now==='function'?now():Date.now());
  const d=Math.max(0,nowMs-n);
  if(d<60e3)return '刚刚';
  if(d<3600e3)return Math.floor(d/60e3)+' 分钟前';
  const dt=new Date(n), cur=new Date(nowMs);
  const hh=pad2(dt.getHours())+':'+pad2(dt.getMinutes());
  const sameDay=dt.getFullYear()===cur.getFullYear()&&dt.getMonth()===cur.getMonth()&&dt.getDate()===cur.getDate();
  if(sameDay)return '今天 '+hh;
  const yest=new Date(nowMs);yest.setDate(yest.getDate()-1);
  if(dt.getFullYear()===yest.getFullYear()&&dt.getMonth()===yest.getMonth()&&dt.getDate()===yest.getDate())return '昨天 '+hh;
  if(dt.getFullYear()===cur.getFullYear())return (dt.getMonth()+1)+'月'+dt.getDate()+'日 '+hh;
  return dt.getFullYear()+'年'+(dt.getMonth()+1)+'月'+dt.getDate()+'日';
}
function ago(ms, clock){return fmtTime(ms, clock)}

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
  const o={id:p.id,a:me?'me':String(p.author.id),at:p.createdAt,t:ago(p.createdAt),x:p.text,r:p.reactions||[0,0,0,0,0,0],m:p.myReaction==null?-1:p.myReaction,src:'net',edited:!!p.edited,commentCount:p.commentCount,aud:p.audience||'public',audience:p.audience||'public'};if(p.mood)o.mood=p.mood;if(p.location)o.location=p.location;if(p.tagged)o.tagged=p.tagged;if(p.media)o.media=p.media;if(p.poll)o.poll=p.poll;if(p.hashtags)o.hashtags=p.hashtags;if(p.kind)o.kind=p.kind;return o;
}
function netPosts(){if(MODE!=='account'||!NET)return null;return S.posts}
async function loadFeed(){
  if(MODE!=='account'||!SESSION)return;
  const r=await api('GET','/api/posts?limit=50&feed='+(S.feed==='follow'?'follow':S.feed==='topic'?'topic':'rec'));
  if(r.s!==200){
    if(typeof cacheReadFeed==='function'){const cached=await cacheReadFeed();if(cached&&cached.length){S.posts=cached;S.postsErr='';return}}
    S.postsErr=errMsg(r,'动态加载失败');return}
  S.posts=(r.j.posts||[]).map(adoptPost);S.postsErr='';S.postsCursor=r.j.nextCursor||null;
  if(typeof cacheWriteFeed==='function')cacheWriteFeed(S.posts);
}
async function publishPost(text,meta){
  const body={text,clientId:'c'+Date.now()+'-'+Math.random().toString(36).slice(2,8)};
  if(meta){if(meta.audience)body.audience=meta.audience;if(meta.mood)body.mood=meta.mood;if(meta.location)body.location=meta.location;if(meta.tagged&&meta.tagged.length)body.tagged=meta.tagged.map(Number).filter(n=>n);if(meta.media&&meta.media.length)body.media=meta.media;if(meta.kind)body.kind=meta.kind;}
  const r=await api('POST','/api/posts',body);
  if(r.s!==200){T(errMsg(r,'发布失败'));return null}
  const p=adoptPost(r.j.post);
  S.posts=S.posts||[];
  if(!S.posts.some(x=>x.id===p.id))S.posts.unshift(p);
  return p;
}
function usingNet(){return MODE==='account'&&!!NET}
/* r7：日常（story）不进帖子列表、不算帖子数；只在首页顶部一排显示（见 75_r7.js） */
function feedSrc(){const a=usingNet()?(Array.isArray(S.posts)?S.posts:[]):D.p;return typeof isStory==='function'?a.filter(p=>!isStory(p)):a}
function postsOf(id){return feedSrc().filter(p=>p.a==id)}

function adoptComment(c){
  rememberAuthor(c.author);
  const me=SESSION&&SESSION.user&&c.author&&Number(SESSION.user.id)===Number(c.author.id);
  return {id:c.id,p:c.postId,pa:c.parentId||0,a:me?'me':String(c.author.id),at:c.createdAt,t:ago(c.createdAt),l:c.likeCount||0,ml:c.liked?1:0,x:c.deleted?'（已删除）':c.text,deleted:!!c.deleted,src:'net',depth:c.depth||0,rootId:c.rootId||c.id,replyTo:c.replyTo||null,replyCount:c.replyCount||0};
}
async function loadComments(postId){
  if(!usingNet()||!SESSION)return;
  S.commentPost=postId;S.comments=S.comments&&S.commentPost===postId?S.comments:undefined;
  const r=await api('GET','/api/posts/'+postId+'/comments');
  if(r.s!==200){S.comments=[];S.commentErr=errMsg(r,'评论加载失败');return}
  S.comments=(r.j.comments||[]).map(adoptComment);S.commentErr='';S.commentPost=postId;
  const p=feedSrc().find(x=>x.id==postId);if(p)p.commentCount=r.j.commentCount;
}
function commentsOf(id){
  if(usingNet()&&S.commentPost==id&&Array.isArray(S.comments))return S.comments;
  return D.c.filter(c=>c.p==id);
}

async function loadFollows(){
  if(!usingNet()||!SESSION)return;
  const r=await api('GET','/api/follows?kind=following&user=me');
  if(r.s!==200)return;
  S.following=(r.j.users||[]).map(u=>String(u.id));
  S.followCounts={following:r.j.followingCount,followers:r.j.followerCount};
  (r.j.users||[]).forEach(rememberAuthor);
}
async function loadFollowList(kind,id){
  if(!usingNet()||!SESSION)return;
  const q=id&&id!='me'?'&user='+id:'';
  const r=await api('GET','/api/follows?kind='+(kind==='followers'?'followers':'following')+q);
  if(r.s!==200){S.followList=[];return}
  (r.j.users||[]).forEach(rememberAuthor);
  S.followList=(r.j.users||[]).map(u=>{rememberAuthor(u);return {id:String(u.id),followedByMe:!!u.followedByMe,n:u.displayName,h:u.username}});
  if(id==='me'||!id)S.followCounts={following:r.j.followingCount,followers:r.j.followerCount};
}
function followingIds(){return usingNet()&&Array.isArray(S.following)?S.following:null}
function isFollowed(id){if(id==='me')return false;const ids=followingIds();return ids?ids.includes(String(id)):fol('me',id)}

async function loadMoreFeed(){
  if(!usingNet()||!S.postsCursor||S.postsLoading)return;
  S.postsLoading=1;
  const r=await api('GET','/api/posts?limit=20&feed='+(S.feed==='follow'?'follow':'rec')+'&cursor='+encodeURIComponent(S.postsCursor));
  S.postsLoading=0;
  if(r.s!==200){T(errMsg(r,'加载失败'));return}
  const more=(r.j.posts||[]).map(adoptPost);
  const seen=new Set((S.posts||[]).map(p=>p.id));
  S.posts=(S.posts||[]).concat(more.filter(p=>!seen.has(p.id)));
  S.postsCursor=r.j.nextCursor||null;
}
