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

function adoptMsg(m){
  if(!m)return null;
  rememberAuthor(m.author);
  const me=SESSION&&SESSION.user&&m.author&&Number(SESSION.user.id)===Number(m.author.id);
  return [me?'me':String(m.author.id),'t',typeof ago==='function'?ago(m.createdAt):'',me?'已发送':'',m.deleted?'（已撤回）':m.text,m.id];
}
function msgSrc(id){
  if(typeof usingNet==='function'&&usingNet())return (S.messages&&S.messages[id])||[];
  return D.m[id]||[];
}
async function loadMessages(id,cursor){
  if(typeof usingNet!=='function'||!usingNet()||!SESSION)return;
  const q=(cursor?'?cursor='+encodeURIComponent(cursor)+'&limit=50':'?limit=50');
  const r=await api('GET','/api/conversations/'+id+'/messages'+q);
  S.messages=S.messages||{};S.msgCursor=S.msgCursor||{};
  if(r.s!==200){S.messages[id]=S.messages[id]||[];return}
  const page=(r.j.messages||[]).map(adoptMsg);
  if(!cursor)S.messages[id]=page;
  else{
    const old=S.messages[id]||[];
    const seen=new Set(old.map(m=>m[5]));
    S.messages[id]=[...page.filter(m=>!seen.has(m[5])),...old];
  }
  S.msgCursor[id]=r.j.nextCursor||null;
}
async function sendNet(cid,text){
  const clientId='c'+Date.now()+'-'+Math.random().toString(36).slice(2,8);
  const r=await api('POST','/api/conversations/'+cid+'/messages',{text,clientId});
  if(r.s!==200){T(errMsg(r,'发送失败'));return null}
  const m=adoptMsg(r.j.message);
  S.messages=S.messages||{};
  S.messages[cid]=S.messages[cid]||[];
  if(!S.messages[cid].some(x=>x[5]===m[5]))S.messages[cid].push(m);
  if(Array.isArray(S.conversations)){
    const i=S.conversations.findIndex(c=>c.id==cid);
    if(i>=0){const c=S.conversations.splice(i,1)[0];c.last=r.j.message;S.conversations.unshift(c)}
  }
  return r.j.message;
}

function stopEvents(){if(S.evtAbort){try{S.evtAbort.abort()}catch(e){}S.evtAbort=null}S.evtOn=0}
function applyEvent(ev,data){
  if(ev==='conversation.message'&&data&&data.message){
    const cid=data.conversationId||data.message.conversationId;
    const m=adoptMsg(data.message);
    S.messages=S.messages||{};
    S.messages[cid]=S.messages[cid]||[];
    if(!S.messages[cid].some(x=>x[5]===m[5]))S.messages[cid].push(m);
    if(Array.isArray(S.conversations)){
      const i=S.conversations.findIndex(c=>c.id==cid);
      if(i>=0){const c=S.conversations.splice(i,1)[0];c.last=data.message;if(S.st[S.st.length-1]!=='chat:'+cid)c.u=(c.u||0)+1;S.conversations.unshift(c)}
      else if(typeof loadConversations==='function')loadConversations();
    }
    if(typeof render==='function')render();
  }
}

async function catchUpMessages(id){
  if(typeof usingNet!=='function'||!usingNet()||!SESSION||!id)return;
  S.messages=S.messages||{};
  const arr=S.messages[id]||[];
  const last=arr[arr.length-1];
  if(!last){return loadMessages(id)}
  const r=await api('GET','/api/conversations/'+id+'/messages?after='+encodeURIComponent(last[5])+'&limit=50');
  if(r.s!==200)return;
  const page=(r.j.messages||[]).map(adoptMsg);
  const seen=new Set((S.messages[id]||[]).map(m=>m[5]));
  S.messages[id]=(S.messages[id]||[]).concat(page.filter(m=>!seen.has(m[5])));
}
async function startEvents(){
  if(typeof usingNet!=='function'||!usingNet()||!SESSION)return;
  stopEvents();
  const ac=new AbortController();S.evtAbort=ac;S.evtOn=1;
  const loop=async()=>{
    while(S.evtOn&&SESSION&&!ac.signal.aborted){
      try{
        const cur=S.st&&S.st[S.st.length-1];
        if(cur&&String(cur).startsWith('chat:'))await catchUpMessages(String(cur).slice(5));
        const headers={Authorization:'Bearer '+SESSION.token,Accept:'text/event-stream'};
        if(S.lastEventId)headers['Last-Event-ID']=String(S.lastEventId);
        const r=await fetch('/api/events',{headers,signal:ac.signal});
        if(r.status!==200){await new Promise(ok=>setTimeout(ok,3000));continue}
        const reader=r.body.getReader(),dec=new TextDecoder();
        let buf='';
        while(S.evtOn){
          const {done,value}=await reader.read();
          if(done)break;
          buf+=dec.decode(value,{stream:true});
          const parts=buf.split('\n\n');buf=parts.pop();
          for(const raw of parts){
            let id,ev,data='';
            for(const line of raw.split('\n')){
              if(line.startsWith('id:'))id=line.slice(3).trim();
              else if(line.startsWith('event:'))ev=line.slice(6).trim();
              else if(line.startsWith('data:'))data+=line.slice(5).trim();
            }
            if(id)S.lastEventId=id;
            if(ev&&data){try{applyEvent(ev,JSON.parse(data))}catch(e){}}
          }
        }
      }catch(e){if(ac.signal.aborted)return}
      if(S.evtOn&&SESSION&&!ac.signal.aborted)await new Promise(ok=>setTimeout(ok,2000));
    }
  };
  loop();
}
