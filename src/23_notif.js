/* M4.6 通知联网：登录后通知中心走服务器。演示通知仍只在本机。 */
function adoptNotif(n){
  if(n.actor)rememberAuthor(n.actor);
  return {id:n.id,x:n.title+(n.body?(' · '+n.body):''),title:n.title||'',body:n.body||'',actor:n.actor?String(n.actor.id):'',appealable:!!(n.appealable||(n.data&&n.data.appealable)||(n.meta&&n.meta.appealable)),data:n.data||n.meta||null,at:n.createdAt,t:typeof fmtTime==='function'?fmtTime(n.createdAt):(typeof ago==='function'?ago(n.createdAt):''),u:n.read?0:1,kind:n.kind,refType:n.refType,refId:n.refId,src:'net'};
}
function nSrc(){return typeof usingNet==='function'&&usingNet()&&Array.isArray(S.notifications)?S.notifications:D.n}
async function loadNotifications(){
  if(typeof usingNet!=='function'||!usingNet()||!SESSION)return;
  const r=await api('GET','/api/notifications?limit=100');
  if(r.s!==200){S.notifications=S.notifications||[];return}
  S.notifications=(r.j.notifications||[]).map(adoptNotif);
  S.notifUnread=r.j.unread||0;
}
async function markNotifRead(id){
  if(typeof usingNet!=='function'||!usingNet()||!SESSION)return;
  if(id)await api('POST','/api/notifications/'+id+'/read',{});
  else await api('POST','/api/notifications/read-all',{});
  return loadNotifications();
}

async function loadSearch(q){
  if(typeof usingNet!=='function'||!usingNet()||!SESSION)return;
  q=String(q||'').trim();
  if(!q){S.search=null;return}
  const r=await api('GET','/api/search?q='+encodeURIComponent(q));
  if(r.s!==200){S.search={err:errMsg(r,'搜索失败')};return}
  (r.j.users||[]).forEach(rememberAuthor);
  S.search=r.j;
}

/* r8.3 通知可以打开：
   - 跟帖子 / 用户 / 会话 / 消息请求有关的，直接跳过去；
   - 其他（举报处理结果、警告、全体通知、系统通知、评论点赞等）打开详情，显示完整标题、正文和时间。
   打开即标为已读。列表里标题最多 2 行、正文最多 3 行，完整内容在详情里。 */
function notifFind(id){return (typeof nSrc==='function'?nSrc():D.n).find(x=>String(x.id)===String(id))}
function notifParts(n){
  if(!n)return {title:'',body:''};
  if(n.title!=null||n.body!=null){const t=String(n.title||''),b=String(n.body||'');return t?{title:t,body:b}:{title:b,body:''}}
  const x=String(n.x||'');const i=x.indexOf(' · ');return i>0?{title:x.slice(0,i),body:x.slice(i+3)}:{title:x,body:''};
}
function notifTime(n){return (typeof fmtTime==='function'&&n&&n.at)?fmtTime(n.at):(n&&n.t)||''}
function notifRoute(n){
  if(!n||!n.refType||n.refId==null||n.refId==='')return null;
  const t=String(n.refType),id=String(n.refId);
  if(t==='post')return {label:'查看帖子',go:()=>openPostById(id,n)};
  if(t==='user'&&id)return {label:'查看主页',go:()=>{S.sh=null;return A.user(id)}};
  if(t==='conversation')return {label:'打开会话',go:()=>{S.sh=null;return A.conv(id)}};
  if(t==='community'&&!notifAppeal(n))return {label:'打开社区',go:()=>{S.sh=null;return A.cm(id)}};
  if(t==='message_request')return {label:'查看消息请求',go:()=>{S.sh=null;S.tab='chat';S.st=[];S.cseg='rq';return typeof loadMsgRequests==='function'?loadMsgRequests():undefined}};
  return null;
}
function notifRow(n){
  const pr=notifParts(n);
  return `<i class="${n.u?'':'z'}"></i><span class="gr ngr"><b class="nt">${esc(pr.title)}</b>${pr.body?`<span class="nb">${esc(pr.body)}</span>`:''}<small>${esc(notifTime(n))}</small></span><span class="nchev" aria-hidden="true">›</span>`;
}
function notifDetail(n){
  if(!n)return '<h3>通知</h3><p class="em">这条通知已不存在</p><div class="fr"><button class="pb s" data-a="notif">返回通知</button></div>';
  const pr=notifParts(n),r=notifRoute(n);
  const ap=notifAppeal(n);
  return `<div class="ndet"><h3 class="ndt">${esc(pr.title||'通知')}</h3><small class="ndtime">${esc(notifTime(n))}</small>${pr.body?`<div class="ndb">${esc(pr.body)}</div>`:''}${ap&&ap.reason?`<div class="ndb nreason">原因：${esc(ap.reason)}</div>`:''}</div><div class="fr">${ap?(notifAppealed(n)?'<button class="pb s" disabled>已提交申诉</button>':`<button class="pb" data-a="napform" data-v="${esc(String(n.id))}">申诉</button>`):''}${r?`<button class="pb" data-a="ngo" data-v="${esc(String(n.id))}">${r.label}</button>`:''}<button class="pb s" data-a="notif">返回通知</button></div>`;
}
function notifMarkRead(n){
  if(!n||!n.u)return;n.u=0;
  if(typeof usingNet==='function'&&usingNet()&&SESSION&&n.src==='net'&&typeof markNotifRead==='function')
    markNotifRead(n.id).then(()=>{if(typeof render==='function')render()}).catch(()=>{});
}
function notifOpen(id){
  const n=notifFind(id);if(!n){S.sh={t:'ndetail',id};return}
  notifMarkRead(n);
  const r=notifRoute(n);
  if(r)return r.go();
  S.sh={t:'ndetail',id:n.id};
}
/* 打开不在当前列表里的帖子（通知、链接）：先向服务器取一次，放进 S.postCache 给帖子页用；已删除就留在详情并提示 */
async function openPostById(id,n){
  const has=typeof findPost==='function'?findPost(id):null;
  if(!has&&typeof usingNet==='function'&&usingNet()){
    const r=await api('GET','/api/posts/'+encodeURIComponent(id));
    if(r.s===200&&r.j&&r.j.post){S.postCache=S.postCache||{};S.postCache[String(id)]=adoptPost(r.j.post)}
    else if(r.s===404){if(typeof T==='function')T('该帖子已被删除');if(n)S.sh={t:'ndetail',id:n.id};return}
  }
  S.sh=null;return A.post(id);
}
/* r8.3 通知面板默认只显示最新 5 条，底部「加载更多」每次再显示 5 条更早的。
   服务器接口只有 limit（最多 100、没有游标），所以一次取最新 100 条，在本机分页。 */
const NOTIF_PAGE=5;
function notifShown(){const all=typeof nSrc==='function'?nSrc():D.n;const k=Math.max(NOTIF_PAGE,S.notifShow||NOTIF_PAGE);return {list:all.slice(0,k),more:all.length>k}}
function notifMoreRow(){return `<div class="swr"><button type="button" class="nr nmore" data-a="nmore">加载更多</button></div>`}
/* r8.3 申诉入口：可申诉的通知（如社区被下架 community_takedown，带 appealable）在详情里显示「申诉」，
   填写理由后提交到 POST /api/appeals（服务器 account.submitAppeal：body 4–4000 字、kind、related），
   同时带上 target_type / target_id，方便服务器按对象处理。 */
function notifAppeal(n){
  if(!n)return null;const d=n.data||{};
  const ok=n.appealable||d.appealable||n.kind==='community_takedown';
  if(!ok)return null;
  const tt=String(d.target_type||d.targetType||(n.kind==='community_takedown'?'community':(n.refType||'other')));
  const tid=String(d.target_id||d.targetId||d.communityId||d.community_id||n.refId||'');
  return {targetType:tt,targetId:tid,name:d.name||d.communityName||'',reason:d.reason||''};
}
function notifAppealKey(){return 'nova_appealed_'+(SESSION&&SESSION.user?SESSION.user.id:'demo')}
function notifAppealed(n){try{return !!JSON.parse(localStorage.getItem(notifAppealKey())||'{}')[n.id]}catch(e){return false}}
function notifAppealMark(n){try{const m=JSON.parse(localStorage.getItem(notifAppealKey())||'{}');m[n.id]=Date.now();localStorage.setItem(notifAppealKey(),JSON.stringify(m))}catch(e){}}
function notifAppealForm(id){
  const n=notifFind(id),ap=notifAppeal(n);
  if(!ap)return '<h3>申诉</h3><p class="em">这条通知不能申诉</p><div class="fr"><button class="pb s" data-a="notif">返回通知</button></div>';
  const what=ap.targetType==='community'?('社区'+(ap.name?'「'+esc(ap.name)+'」':'')):'相关内容';
  return `<h3>提交申诉</h3><p class="hint">说明${what}的情况和你的理由，管理员会尽快处理，结果会通过通知告诉你。</p><textarea class="fld" data-d="aptxt" data-af rows="5" maxlength="4000" placeholder="请填写申诉理由（至少 4 个字）"></textarea><div class="fr"><button class="pb s" data-a="ndback" data-v="${esc(String(id))}">取消</button><button class="pb" data-a="napsend" data-v="${esc(String(id))}">提交申诉</button></div>`;
}
async function notifAppealSend(id){
  const n=notifFind(id),ap=notifAppeal(n);if(!ap)return;
  const text=String(S.d.aptxt||'').trim();
  if(text.length<4){T('请填写至少 4 个字的申诉理由');return}
  if(S.apBusy)return;S.apBusy=1;
  let r;try{r=await api('POST','/api/appeals',{kind:ap.targetType,body:text,related:ap.targetId,communityId:ap.targetType==='community'?ap.targetId:undefined,target_type:ap.targetType,target_id:ap.targetId,targetType:ap.targetType,targetId:ap.targetId,notificationId:String(n.id)})}finally{S.apBusy=0}
  if(!r||r.s!==200){T(errMsg(r,'申诉提交失败，请稍后再试'));return}
  notifAppealMark(n);S.d.aptxt='';S.sh={t:'ndetail',id:n.id};T('申诉已提交，管理员会尽快处理');
}
