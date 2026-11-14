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
  return {id:c.id,n:c.name,d:c.description||'',m:c.memberCount||0,j:c.joined?1:0,r:c.role||'',ch,mb,vis:c.visibility,joinStatus:c.joinStatus||(c.joined?'joined':'none'),pending:c.joinStatus==='pending',src:'net',banned:!!c.banned};
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
  if(r.s!==200){S.cmErr={id:String(id),s:r.s,code:r.j&&r.j.error&&r.j.error.code||'',message:r.j&&r.j.error&&r.j.error.message||''};return null}
  S.cmErr=null;
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

/* r8.3：社区被下架/删除（服务器返回 403/404/410）时，不再进入空页面或报通用错误，退回上一页并说明原因 */
function cmGoneText(e){
  const t=String((e&&e.code)||'')+' '+String((e&&e.message)||'');
  if(/TAKEN|TAKEDOWN|SUSPEND|DISABLED|下架|停用/i.test(t))return '该社区因存在问题已被管理员下架，暂时无法访问。如果你是社区所有者，可以在「通知」里打开下架通知提交申诉。';
  if(e&&e.code==='BANNED')return (e.message||'你已被这个社区封禁');
  return '该社区不存在或已被删除。';
}
function cmGoneHandle(id){
  const e=S.cmErr;if(!e||String(e.id)!==String(id)||![403,404,410].includes(e.s))return false;
  S.st=(S.st||[]).filter(x=>!String(x).startsWith('cm:'+id)&&!String(x).startsWith('cmm:'+id));
  if(Array.isArray(S.communities)&&e.s!==403)S.communities=S.communities.filter(c=>String(c.id)!==String(id));
  if(Array.isArray(S.communities)&&e.s===403&&/TAKEN|TAKEDOWN|下架/i.test(String(e.code)+String(e.message)))S.communities=S.communities.filter(c=>String(c.id)!==String(id));
  S.sh={t:'cmgone',msg:cmGoneText(e)};
  return true;
}
