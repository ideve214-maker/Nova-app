/* M4.3 / M4.11：登录后会话走服务器。1:1 私聊由客户端用 vodozemac（Olm）加密后再发送，服务端只存密文。群聊不加密。独立安全审查尚未完成，不使用已审查通过的标识。 */
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
    id:c.id,g,n:title,mem:others.map(m=>String(m.id)),u:c.unread||0,mute:c.muted?1:0,pin:c.pinned?1:0,lastRead:c.lastReadMessageId||null,
    own:owner?(Number(owner.id)===Number(me)?'me':String(owner.id)):'',
    adm,r:c.myRole||(my&&my.role)||'',src:'net',kind:c.kind,last:c.lastMessage||null,e2ee:c.kind==='dm',peerId:others[0]&&others[0].id,publicPins:c.publicPins||[],personalPins:c.personalPins||[]
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
  function finish(row){
    if(m.replyTo)row.replyTo=m.replyTo;
    if(m.forwarded||m.forwardFrom){row.forwarded=!!m.forwarded;row.forwardFrom=m.forwardFrom||m.source}
    if(m.reactions)row.reactions=m.reactions;
    if(m.saved)row.saved=true;
    row.encrypted=!!m.encrypted;row.decryptError=m.decryptError;
    return row}
  if(m.deleted)return finish([me?'me':String(m.author.id),'t',typeof ago==='function'?ago(m.createdAt):'',me?(m.status||'已发送'):'','（已撤回）',m.id,m.media]);
  if(m.sticker)return finish([me?'me':String(m.author.id),'k',typeof ago==='function'?ago(m.createdAt):'',me?(m.status||'已发送'):'',m.sticker,m.id,m.media]);
  let tx=m.media?(m.text?m.text+' ':'')+({image:'[图片]',video:'[视频]',audio:'[语音]',file:'[文件]'}[m.media.kind]||'[文件]'):m.text;
  if(m.encrypted&&(tx==null||tx===''))tx=m.decryptError?'［无法解密］':'［加密消息］';
  const row=[me?'me':String(m.author.id),m.media&&m.media.kind==='image'?'i':m.media&&m.media.kind==='video'?'v':m.media&&m.media.kind==='audio'?'a':'t',typeof ago==='function'?ago(m.createdAt):'',me?(m.status||'已发送'):'',tx,m.id,m.media];
  return finish(row);
}
function msgSrc(id){
  if(typeof usingNet==='function'&&usingNet())return (S.messages&&S.messages[id])||[];
  return D.m[id]||[];
}
async function markConvRead(id){
  if(typeof usingNet!=='function'||!usingNet()||!SESSION||!id)return;
  const r=await api('POST','/api/conversations/'+id+'/read',{});
  if(r.s===200&&Array.isArray(S.conversations)){
    const c=S.conversations.find(x=>x.id==id);if(c){c.u=r.j.unread||0;c.lastRead=r.j.lastReadMessageId}
  }
}
async function loadMessages(id,cursor){
  if(typeof usingNet!=='function'||!usingNet()||!SESSION)return;
  const q=(cursor?'?cursor='+encodeURIComponent(cursor)+'&limit=50':'?limit=50');
  const r=await api('GET','/api/conversations/'+id+'/messages'+q);
  S.messages=S.messages||{};S.msgCursor=S.msgCursor||{};
  if(r.s!==200){S.messages[id]=S.messages[id]||[];return}
  const raw=r.j.messages||[];
  const page=[];
  for(const mm of raw){
    const dec=(mm.encrypted&&typeof e2eeDecrypt==='function')?await e2eeDecrypt(mm):mm;
    page.push(adoptMsg(dec));
  }
  if(!cursor)S.messages[id]=page;
  else{
    const old=S.messages[id]||[];
    const seen=new Set(old.map(m=>m[5]));
    S.messages[id]=[...page.filter(m=>!seen.has(m[5])),...old];
  }
  S.msgCursor[id]=r.j.nextCursor||null;
}
async function sendNet(cid,text,extra){
  const clientId='c'+Date.now()+'-'+Math.random().toString(36).slice(2,8);
  const body={clientId};
  if(extra&&extra.replyToId)body.replyToId=extra.replyToId;
  else if(S.replyTo&&S.replyTo.cid===cid&&S.replyTo.id)body.replyToId=S.replyTo.id;
  if(extra&&extra.sticker)body.sticker={pack:extra.sticker.pack,id:extra.sticker.id};
  if(extra&&extra.mediaId)body.mediaId=extra.mediaId;
  const c=(typeof cvSrc==='function'?cvSrc():[]).find(x=>x.id==cid);
  const isDm=c&&!c.g;
  if(isDm&&typeof e2eeEncrypt==='function'){
    try{
      const peer=typeof e2eePeerOf==='function'?e2eePeerOf(c):null;
      if(!peer){T('无法确定私聊对方');return null}
      const payload=extra&&extra.sticker?{t:'sticker',sticker:extra.sticker,text:text||''}:{t:'text',text:text||''};
      if(extra&&extra.mediaId){payload.t=payload.t||'media';payload.mediaId=extra.mediaId}
      const enc=await e2eeEncrypt(peer,payload);
      delete body.sticker;
      body.encrypted=true;
      body.ciphertext=enc.ciphertext;
      body.senderDeviceId=enc.senderDeviceId;
    }catch(e){
      T((e&&e.message)||'无法加密发送，未改为明文');
      return null;
    }
  }else{
    body.text=text||'';
  }
  S.e2eePending=S.e2eePending||{};
  if(body.encrypted)S.e2eePending[clientId]={text:text||'',sticker:extra&&extra.sticker};
  const r=await api('POST','/api/conversations/'+cid+'/messages',body);
  if(r.s!==200){T(errMsg(r,'发送失败'));delete S.e2eePending[clientId];return null}
  if(body.encrypted&&r.j.message){
    const cache=typeof e2eePlainCache==='function'?e2eePlainCache():(S.e2eePlain=S.e2eePlain||{});
    const pending=S.e2eePending[clientId]||{text:text||'',sticker:extra&&extra.sticker};
    cache[r.j.message.id]=pending.text||'';
    if(pending.sticker)cache[r.j.message.id]=pending; // object with sticker
    r.j.message.text=pending.text||'';
    r.j.message.decrypted=true;
    if(pending.sticker)r.j.message.sticker=pending.sticker;
    delete S.e2eePending[clientId];
  }
  const m=adoptMsg(r.j.message);
  S.messages=S.messages||{};
  S.messages[cid]=S.messages[cid]||[];
  const exist=S.messages[cid].findIndex(x=>x[5]===m[5]);
  if(exist>=0)S.messages[cid][exist]=m;
  else S.messages[cid].push(m);
  if(Array.isArray(S.conversations)){
    const i=S.conversations.findIndex(c=>c.id==cid);
    if(i>=0){const c=S.conversations.splice(i,1)[0];c.last=r.j.message;S.conversations.unshift(c)}
  }
  return r.j.message;
}

function stopEvents(){if(S.evtAbort){try{S.evtAbort.abort()}catch(e){}S.evtAbort=null}S.evtOn=0}
function applyEvent(ev,data){
  if(ev&&ev.startsWith('friend.')&&typeof loadFriends==='function'){loadFriends().then(()=>{if(typeof render==='function')render()});}
  if(ev==='conversation.recall'&&data&&data.message){const cid=data.conversationId||data.message.conversationId;const arr=S.messages&&S.messages[cid];if(arr){const i=arr.findIndex(x=>x[5]==data.message.id);if(i>=0){arr[i][4]='（已撤回）';arr[i].deleted=1}}if(typeof render==='function')render();return}
if(ev==='conversation.message'&&data&&data.message){
    const cid=data.conversationId||data.message.conversationId;
    const go=async()=>{
      const raw=data.message;
      const dec=(raw.encrypted&&typeof e2eeDecrypt==='function')?await e2eeDecrypt(raw):raw;
      const m=adoptMsg(dec);
      S.messages=S.messages||{};
      S.messages[cid]=S.messages[cid]||[];
      if(!S.messages[cid].some(x=>x[5]===m[5]))S.messages[cid].push(m);
      if(Array.isArray(S.conversations)){
        const i=S.conversations.findIndex(c=>c.id==cid);
        if(i>=0){const c=S.conversations.splice(i,1)[0];c.last=dec;if(S.st[S.st.length-1]!=='chat:'+cid)c.u=(c.u||0)+1;S.conversations.unshift(c)}
        else if(typeof loadConversations==='function')loadConversations();
      }
      if(typeof render==='function')render();
    };
    go();
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
  const raw=r.j.messages||[];
  const page=[];
  for(const mm of raw){
    const dec=(mm.encrypted&&typeof e2eeDecrypt==='function')?await e2eeDecrypt(mm):mm;
    page.push(adoptMsg(dec));
  }
  const seen=new Set((S.messages[id]||[]).map(m=>m[5]));
  S.messages[id]=(S.messages[id]||[]).concat(page.filter(m=>!seen.has(m[5])));
}
/* SSE：心跳由服务端 : ping 维持；断线后用 Last-Event-ID 补拉，当前打开的会话再用 after 补消息。令牌走 Authorization，地址走 apiUrl。连接过多（429）拉长重试。 */
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
        const r=await fetch(apiUrl('/api/events'),{headers,signal:ac.signal});
        if(r.status===401||r.status===403){S.evtOn=0;return}
        if(r.status===429){await new Promise(ok=>setTimeout(ok,8000));continue}
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

async function doForward(dest,srcId,srcCid){
  if(!SESSION||!dest||!srcId)return;
  const destCv=typeof cvf==='function'?cvf(dest):null;
  const arr=(S.messages&&S.messages[srcCid])||[];
  const row=arr.find(x=>x[5]==srcId);
  const plain=row?((typeof mtext==='function'?mtext('cv',row):row[4])||''):'';
  const body={conversationId:dest,clientId:'fwd'+Date.now()};
  const needEnc=destCv&&!destCv.g&&destCv.e2ee&&typeof e2eeEncrypt==='function';
  if(needEnc){
    const peer=typeof e2eePeerOf==='function'?e2eePeerOf(destCv):destCv.peerId;
    if(!peer){T('无法加密转发');return}
    try{
      const enc=await e2eeEncrypt(peer,{v:1,t:'text',text:String(plain)});
      if(enc&&enc.ciphertext){body.encrypted=true;body.ciphertext=typeof enc.ciphertext==='string'?enc.ciphertext:JSON.stringify(enc.ciphertext);if(enc.senderDeviceId)body.senderDeviceId=enc.senderDeviceId}
      else {T('重加密失败');return}
    }catch(e){T('重加密失败');return}
  }else{
    body.text=String(plain);
  }
  const r=await api('POST','/api/messages/'+srcId+'/forward',body);
  if(r.s!==200){T(errMsg(r,'转发失败'));return}
  T('已转发');
  if(typeof adoptMsg==='function'){
    S.messages=S.messages||{};S.messages[dest]=S.messages[dest]||[];
    const dec=(r.j.message.encrypted&&typeof e2eeDecrypt==='function')?await e2eeDecrypt(r.j.message):r.j.message;
    if(plain&&dec.encrypted)dec.text=plain;
    S.messages[dest].push(adoptMsg(dec));
  }
  if(typeof loadConversations==='function')await loadConversations();
}
