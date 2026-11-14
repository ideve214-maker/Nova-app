/* M4.2 社区联网：登录后创建/加入/退出走服务器。演示社区仍只在本机。 */
function adoptCm(c){
  if(!c)return null;
  const ch=(c.channels||[]).map((x,i)=>[x.id,x.name,x.kind==='公告'||x.kindKey==='announce'?'公告':'文字',x.isDefault]);
  const mb={};
  (c.members||[]).forEach(m=>{
    rememberAuthor(m);
    const me=SESSION&&SESSION.user&&Number(SESSION.user.id)===Number(m.id);
    mb[me?'me':String(m.id)]=m.role;
  });
  if(c.owner)rememberAuthor(c.owner);
  return {id:c.id,n:c.name,d:c.description||'',m:c.memberCount||0,j:c.joined?1:0,r:c.role||'',ch,mb,vis:c.visibility,joinStatus:c.joinStatus||(c.joined?'joined':'none'),pending:c.joinStatus==='pending',src:'net',banned:!!c.banned,bg:c.cover||'',status:c.status||'active',takedownReason:c.takedownReason||'',takenDownAt:c.takenDownAt||null};
}
function netCm(){return usingNet()&&Array.isArray(S.communities)}
function cmSrc(){return netCm()?S.communities:D.cm}
async function loadCommunities(){
  if(!usingNet()||!SESSION)return;
  const [mine,disc]=await Promise.all([api('GET','/api/communities?mine=1'),api('GET','/api/communities')]);
  const map=new Map();
  /* r7：「我的」列表里的小组都算已加入（申请中的除外），保证全部出现在「已加入」栏 */
  if(mine.s===200)(mine.j.communities||[]).forEach(c=>{const x=adoptCm(c);if(x&&!x.pending&&x.joinStatus!=='pending'){x.j=1;x.r=x.r||'成员'}map.set(c.id,x)});
  if(disc.s===200)(disc.j.communities||[]).forEach(c=>{if(!map.has(c.id))map.set(c.id,adoptCm(c))});
  S.communities=[...map.values()];
}
async function loadCommunity(id){
  if(!usingNet()||!SESSION)return;
  const r=await api('GET','/api/communities/'+id);
  if(r.s!==200)return null;
  const c=adoptCm(r.j.community);
  S.communities=S.communities||[];
  const i=S.communities.findIndex(x=>x.id==id);
  if(i>=0)S.communities[i]=Object.assign(S.communities[i],c,{mb:c.mb&&Object.keys(c.mb).length?c.mb:S.communities[i].mb});
  else S.communities.push(c);
  return c;
}

function adoptChMsg(m){
  if(!m)return null;
  if(m.author)rememberAuthor(m.author);
  const me=SESSION&&SESSION.user&&Number(SESSION.user.id)===Number(m.author&&m.author.id);
  const who=me?'me':String(m.author&&m.author.id||'');
  const at=m.createdAt||(m.createdAtUtc?Date.parse(m.createdAtUtc):0);
  const row=[who,'',m.text||'',m.id];
  row.at=at;
  return row;
}
function chMsgSrc(cid){
  if(typeof usingNet==='function'&&usingNet()&&S.channelMessages)
    return S.channelMessages[cid]||[];
  return (D.cmsg&&D.cmsg[cid])||[];
}
async function loadChannelMessages(cid){
  if(typeof usingNet!=='function'||!usingNet()||!SESSION||!cid)return;
  const r=await api('GET','/api/channels/'+cid+'/messages');
  if(r.s!==200)return;
  S.channelMessages=S.channelMessages||{};
  S.channelMessages[cid]=(r.j.messages||[]).map(adoptChMsg);
}
