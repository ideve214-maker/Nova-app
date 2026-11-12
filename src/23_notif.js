/* M4.6 通知联网：登录后通知中心走服务器。演示通知仍只在本机。 */
function adoptNotif(n){
  if(n.actor)rememberAuthor(n.actor);
  return {id:n.id,x:n.title+(n.body?(' · '+n.body):''),t:typeof ago==='function'?ago(n.createdAt):'',u:n.read?0:1,kind:n.kind,refType:n.refType,refId:n.refId,src:'net'};
}
function nSrc(){return typeof usingNet==='function'&&usingNet()&&Array.isArray(S.notifications)?S.notifications:D.n}
async function loadNotifications(){
  if(typeof usingNet!=='function'||!usingNet()||!SESSION)return;
  const r=await api('GET','/api/notifications');
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
