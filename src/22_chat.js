/* M4.3 单聊/群聊联网：登录后会话走服务器。演示会话仍只在本机。私聊在 M4.11 完成前标明尚未端到端加密。 */
function adoptCv(c){
  if(!c)return null;
  const me=SESSION&&SESSION.user&&SESSION.user.id;
  (c.members||[]).forEach(rememberAuthor);
  const others=(c.members||[]).filter(m=>Number(m.id)!==Number(me));
  const g=c.kind==='group'?1:0;
  const owner=c.owner||(c.members||[]).find(m=>m.roleKey==='owner'||m.role==='群主');
  const my=(c.members||[]).find(m=>Number(m.id)===Number(me));
  const title=g?(c.name||'群聊'):(others[0]?(others[0].displayName||others[0].username):'私聊');
  const adm=(c.members||[]).filter(m=>m.roleKey==='admin'||m.role==='管理员').map(m=>Number(m.id)===Number(me)?'me':String(m.id));
  return {
    id:c.id,g,n:title,mem:others.map(m=>String(m.id)),u:c.unread||0,
    own:owner?(Number(owner.id)===Number(me)?'me':String(owner.id)):'',
    adm,r:c.myRole||(my&&my.role)||'',src:'net',kind:c.kind,last:c.lastMessage||null,e2ee:false
  };
}
function netCv(){return typeof usingNet==='function'&&usingNet()&&Array.isArray(S.conversations)}
function cvSrc(){return netCv()?S.conversations:D.cv}
async function loadConversations(){
  if(typeof usingNet!=='function'||!usingNet()||!SESSION)return;
  const r=await api('GET','/api/conversations');
  if(r.s!==200){S.conversations=S.conversations||[];S.cvErr=errMsg(r,'会话加载失败');return}
  S.conversations=(r.j.conversations||[]).map(adoptCv);S.cvErr='';
}
async function loadConversation(id){
  if(typeof usingNet!=='function'||!usingNet()||!SESSION)return;
  const r=await api('GET','/api/conversations/'+id);
  if(r.s!==200)return null;
  const c=adoptCv(r.j.conversation);
  S.conversations=S.conversations||[];
  const i=S.conversations.findIndex(x=>x.id==id);
  if(i>=0)S.conversations[i]=Object.assign(S.conversations[i],c);
  else S.conversations.unshift(c);
  return c;
}
async function openDm(userId){
  const r=await api('POST','/api/conversations',{kind:'dm',userId:Number(userId)});
  if(r.s!==200){T(errMsg(r,'无法发起私聊'));return null}
  const c=adoptCv(r.j.conversation);
  S.conversations=S.conversations||[];
  if(!S.conversations.some(x=>x.id===c.id))S.conversations.unshift(c);
  else await loadConversations();
  return c;
}
async function createGroupChat(name,userIds){
  const r=await api('POST','/api/conversations',{kind:'group',name,userIds:userIds.map(Number)});
  if(r.s!==200){T(errMsg(r,'无法创建群聊'));return null}
  const c=adoptCv(r.j.conversation);
  S.conversations=S.conversations||[];
  S.conversations.unshift(c);
  return c;
}
