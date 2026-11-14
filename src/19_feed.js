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
  /* r10：别人的图片头像 / 背景（服务器返回 avatar.image、cover）。 */
  D.uph=D.uph||{};
  if(a.avatar&&Object.prototype.hasOwnProperty.call(a.avatar,'image'))D.uph[id]=a.avatar.image||'';
  if(Object.prototype.hasOwnProperty.call(a,'cover')){D.ubg=D.ubg||{};D.ubg[id]=a.cover||''}
}
function adoptPost(p){
  rememberAuthor(p.author);
  const me=SESSION&&SESSION.user&&p.author&&Number(SESSION.user.id)===Number(p.author.id);
  const o={id:p.id,a:me?'me':String(p.author.id),at:p.createdAt,t:ago(p.createdAt),x:p.text,r:p.reactions||[0,0,0,0,0,0],m:p.myReaction==null?-1:p.myReaction,src:'net',edited:!!p.edited,commentCount:p.commentCount,aud:p.audience||'public',audience:p.audience||'public'};if(p.audienceLabel)o.audienceLabel=p.audienceLabel;if(typeof p.isPublic==='boolean')o.isPublic=p.isPublic;if(p.mood)o.mood=p.mood;if(p.location)o.location=p.location;if(p.tagged)o.tagged=p.tagged;if(p.media)o.media=p.media;if(p.poll)o.poll=p.poll;if(p.hashtags)o.hashtags=p.hashtags;if(p.kind)o.kind=p.kind;if(p.hotPosition)o.hotPosition=p.hotPosition;if(p.viewCount!=null)o.viewCount=p.viewCount;if(p.bookmarkCount!=null)o.bookmarkCount=p.bookmarkCount;if(p.boost)o.boost=p.boost;return o;
}
/* 帖子已被删除（作者删帖或管理员处理举报）：从内存列表和离线缓存里去掉，避免继续显示旧帖子 */
function dropPost(id,toast){
  if(!id)return false;let hit=false;
  if(Array.isArray(S.posts)){const n=S.posts.length;S.posts=S.posts.filter(p=>String(p.id)!==String(id));hit=S.posts.length!==n;if(hit&&typeof cacheWriteFeed==='function')cacheWriteFeed(S.posts)}
  if(toast&&typeof T==='function')T('该帖子已被删除');
  return hit;
}
function isGone(r){return r&&r.s===404}
let feedHiddenAt=0;
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){feedHiddenAt=Date.now();return}
  if(!feedHiddenAt||Date.now()-feedHiddenAt<15000)return;feedHiddenAt=0;
  const cur=S.st&&S.st[S.st.length-1];
  if(!cur&&S.tab==='home'&&typeof usingNet==='function'&&usingNet())refreshFeedSafe();
});
/* r8.3 不打断滚动的首页刷新（点首页标签 / 回到前台 / 切回首页时用）：
   - 拉取失败（断网、被拦）：什么都不显示，保留当前列表；
   - 用户在顶部：直接换上新列表；
   - 用户已经往下滑了：不动当前列表，新列表先放着，顶部出现「有 N 条新动态」，点了才换上并回到顶部；
     如果只是有帖子被删、没有新帖，回到顶部时再悄悄换上。 */
function homeSc(){const cur=S.st&&S.st[S.st.length-1];if(cur||S.tab!=='home')return null;return document.querySelector('#v .pg.home > .sc')}
async function refreshFeedSafe(){
  if(typeof usingNet!=='function'||!usingNet()||S.feedRefreshing)return;
  S.feedRefreshing=1;
  const prev=Array.isArray(S.posts)?S.posts:null,keep={posts:prev,cursor:S.postsCursor,hot:S.hotMode,err:S.postsErr},feed=S.feed;
  let ok=false;
  try{ok=await loadFeed()}catch(e){ok=false}finally{S.feedRefreshing=0}
  if(S.feed!==feed)return;
  if(!ok){if(prev&&prev.length){S.posts=keep.posts;S.postsCursor=keep.cursor;S.hotMode=keep.hot;S.postsErr=keep.err||''}else if(typeof render==='function')render();return}
  const sc=homeSc();
  if(!sc||!prev||(sc.scrollTop||0)<=4){S.feedPending=null;if(sc&&typeof render==='function')render();return}
  const fresh={posts:S.posts,cursor:S.postsCursor,hot:S.hotMode};
  S.posts=keep.posts;S.postsCursor=keep.cursor;S.hotMode=keep.hot;S.postsErr=keep.err||'';
  const had=new Set(prev.map(p=>String(p.id)));
  const n=(fresh.posts||[]).filter(p=>!had.has(String(p.id))&&!(typeof isStory==='function'&&isStory(p))).length;
  S.feedPending={...fresh,n,feed};
  showNewPill();
}
function applyFeedPending(){const f=S.feedPending;if(!f)return false;S.feedPending=null;if(f.feed!==S.feed)return false;S.posts=f.posts;S.postsCursor=f.cursor;S.hotMode=f.hot;S.postsErr='';return true}
function newPill(){const f=S.feedPending;return f&&f.n>0&&f.feed===S.feed?`<button class="newpill" type="button" data-a="newposts">有 ${f.n>99?'99+':f.n} 条新动态</button>`:''}
/* 只插入/更新提示按钮，不重绘列表 */
function showNewPill(){const pg=document.querySelector('#v .pg.home');if(!pg)return;const old=pg.querySelector('.newpill');const html=newPill();
  if(!html){if(old)old.remove();return}
  if(old){old.outerHTML=html;return}
  const tt=pg.querySelector('.totop');const tmp=document.createElement('div');tmp.innerHTML=html;pg.insertBefore(tmp.firstElementChild,tt||null)}
/* 回到顶部且停下时，把放着的新列表换上（scroll 监听在 75_r7.js，每帧最多一次） */
function feedAtTop(sc){if(!S.feedPending||(sc.scrollTop||0)>4)return;setTimeout(()=>{const s=homeSc();if(!S.feedPending||!s||(s.scrollTop||0)>4)return;if(applyFeedPending()&&typeof render==='function')render()},200)}
function netPosts(){if(MODE!=='account'||!NET)return null;return S.posts}
async function loadFeed(){
  if(MODE!=='account'||!SESSION)return;
  /* r7 热门话题：先取管理员挑选的帖子（按管理员顺序）；一条都没挑或服务器还没有这个接口时，退回原来按话题标签的结果 */
  S.hotMode=0;S.feedPending=null;
  if(S.feed==='topic'){const h=await api('GET','/api/hot-posts?limit=20');if(h.s===200&&h.j&&Array.isArray(h.j.posts)&&h.j.posts.length){S.posts=h.j.posts.map(adoptPost);S.postsErr='';S.postsCursor=null;S.hotMode=1;return true}}
  const r=await api('GET','/api/posts?limit=50&feed='+(S.feed==='follow'?'follow':S.feed==='topic'?'topic':'rec'));
  if(r.s!==200){
    if(S.feedRefreshing&&Array.isArray(S.posts)&&S.posts.length)return false;
    if(typeof cacheReadFeed==='function'){const cached=await cacheReadFeed();if(cached&&cached.length){S.posts=cached;S.postsErr='';return false}}
    S.postsErr=errMsg(r,'动态加载失败');return false}
  S.posts=(r.j.posts||[]).map(adoptPost);S.postsErr='';S.postsCursor=r.j.nextCursor||null;
  if(Array.isArray(r.j.ads)){S.ads=r.j.ads;S.adEvery=r.j.adEvery||5;S.adLoad=(S.adLoad||0)+1}
  if(typeof cacheWriteFeed==='function')cacheWriteFeed(S.posts);
  return true;
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
  if(isGone(r)){S.comments=[];S.commentErr='该帖子已被删除';dropPost(postId,true);return}
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
