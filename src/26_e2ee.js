/* M4.11.3 / M4.11.4：客户端设备密钥与 1:1 Olm 加解密。
   密码学由 vendored vodozemac（Apache-2.0）提供，不自写 ratchet。
   私钥只存在本机 localStorage（Web 存储可被 XSS 读取，限制已写明）。
   群聊不加密。独立安全审查尚未完成，不使用已审查通过的标识。 */
(function(){
const E2EE_STORE_PREFIX='nova_e2ee_v1_';
const OTK_BATCH=20;
const OTK_MIN=8;

function e2eeSha256Hex(str){
  // 同步指纹：用 SubtleCrypto 时是异步；这里用纯 JS SHA-256 会是自写哈希。
  // 指纹只作展示，必须与服务端一致。优先用已初始化的 vodozemac Account.sign 之外的 Web Crypto。
  return null;
}

async function sha256Bytes(str){
  const data=new TextEncoder().encode(str);
  if(globalThis.crypto&&crypto.subtle){
    const buf=await crypto.subtle.digest('SHA-256',data);
    return new Uint8Array(buf);
  }
  throw new Error('本环境没有 Web Crypto，无法计算安全号码');
}

async function safetyNumber(edA,edB){
  const a=String(edA||''), b=String(edB||'');
  const x=a<b?a:b, y=a<b?b:a;
  const hash=await sha256Bytes(x+'|'+y);
  const groups=[];
  for(let i=0;i<24;i+=2){
    const n=hash[i]*256+hash[i+1];
    groups.push(String(n%100000).padStart(5,'0'));
  }
  return groups.join(' ');
}

function e2eeKey(userId){return E2EE_STORE_PREFIX+String(userId)}
function e2eeForget(userId){
  try{
    const id=userId!=null?userId:_uid;
    if(id!=null)localStorage.removeItem(e2eeKey(id));
  }catch(e){}
  _acct=null;_store=null;_uid=null;_ready=null;
}
function loadStore(userId){
  try{return JSON.parse(localStorage.getItem(e2eeKey(userId))||'null')||{}}
  catch(e){return {}}
}
function saveStore(userId,s){
  try{localStorage.setItem(e2eeKey(userId),JSON.stringify(s))}
  catch(e){console.warn('e2ee store save failed',e)}
}
function newDeviceId(){
  const b=new Uint8Array(16);
  (crypto.getRandomValues||(function(a){for(let i=0;i<a.length;i++)a[i]=Math.floor(Math.random()*256)})).call(crypto,b);
  let s='dv_';
  for(let i=0;i<b.length;i++)s+=('0'+b[i].toString(16)).slice(-2);
  return s;
}

let _ready=null, _acct=null, _uid=null, _store=null;

function e2eePlainCache(){S.e2eePlain=S.e2eePlain||{};return S.e2eePlain}

async function e2eeInitWasm(){
  if(!globalThis.Vodozemac) throw new Error('vodozemac 未加载');
  if(!e2eeInitWasm.done){
    await Vodozemac.init();
    e2eeInitWasm.done=true;
  }
}

async function e2eeEnsure(){
  if(typeof usingNet!=='function'||!usingNet()||!SESSION||!SESSION.user)return null;
  const uid=SESSION.user.id;
  if(_acct && _uid===uid) return {account:_acct, store:_store};
  await e2eeInitWasm();
  _uid=uid;
  _store=loadStore(uid);
  if(_store.accountPickle && _store.deviceId){
    try{ _acct=Vodozemac.Account.fromPickle(_store.accountPickle); }
    catch(e){ _acct=null; _store={}; }
  }
  if(!_acct){
    _acct=new Vodozemac.Account();
    _store={deviceId:newDeviceId(), accountPickle:_acct.pickle(), sessions:{}, verified:{}, knownIdentities:{}};
    _acct.generateOneTimeKeys(OTK_BATCH);
    _acct.generateFallbackKey();
    _store.accountPickle=_acct.pickle();
    saveStore(uid,_store);
    await e2eeUploadKeys(true);
  } else {
    await e2eeUploadKeys(false);
  }
  return {account:_acct, store:_store};
}

function e2eePersist(){
  if(!_acct||_uid==null||!_store)return;
  _store.accountPickle=_acct.pickle();
  saveStore(_uid,_store);
}

function persistSession(peerKey, sess){
  _store.sessions=_store.sessions||{};
  _store.sessions[peerKey]=sess.pickle();
  e2eePersist();
}

function loadSession(peerKey){
  const p=_store&&_store.sessions&&_store.sessions[peerKey];
  if(!p)return null;
  try{return Vodozemac.Session.fromPickle(p)}catch(e){return null}
}

async function e2eeUploadKeys(forceNew){
  if(!_acct||!SESSION)return;
  const unpublished=JSON.parse(_acct.oneTimeKeys()||'{}');
  const nUn=Object.keys((unpublished.curve25519)||unpublished||{}).length;
  if(!forceNew && nUn<OTK_MIN){
    _acct.generateOneTimeKeys(OTK_BATCH);
  }
  const fbRaw=JSON.parse(_acct.fallbackKey()||'{}');
  const fbMap=fbRaw.curve25519||fbRaw||{};
  const fbEntries=Object.entries(fbMap);
  if(!fbEntries.length){ _acct.generateFallbackKey(); }
  const fb2=JSON.parse(_acct.fallbackKey()||'{}');
  const fbMap2=fb2.curve25519||fb2||{};
  const fbEnt=Object.entries(fbMap2)[0];
  const idk=JSON.parse(_acct.identityKeys());
  const otks=JSON.parse(_acct.oneTimeKeys());
  const body={
    deviceId:_store.deviceId,
    identityKey:{curve25519:idk.curve25519, ed25519:idk.ed25519},
    oneTimeKeys:otks,
  };
  if(fbEnt) body.fallbackKey={keyId:fbEnt[0], key:fbEnt[1]};
  const r=await api('POST','/api/e2ee/keys',body);
  if(r.s===200){
    _acct.markKeysAsPublished();
    e2eePersist();
    return r.j;
  }
  console.warn('e2ee key upload failed', r.s, r.j);
  return null;
}

function peerOfCv(c){
  if(!c||c.g)return null;
  const me=SESSION&&SESSION.user&&SESSION.user.id;
  if(c.peerId)return Number(c.peerId);
  if(c.mem&&c.mem.length){
    const o=c.mem.find(id=>String(id)!=='me'&&Number(id)!==Number(me));
    if(o)return Number(o);
  }
  return null;
}

async function e2eeClaim(peerId){
  const r=await api('POST','/api/e2ee/keys/claim',{userId:Number(peerId), myDeviceId:_store&&_store.deviceId});
  if(r.s!==200) throw new Error(errMsg(r,'无法领取对方密钥'));
  return r.j.keys||[];
}

async function sessionFor(peerId, their){
  const key=peerId+':'+their.deviceId;
  let sess=loadSession(key);
  if(sess) return {sess, key, their, fresh:false};
  const idk=their.identityKey.curve25519;
  const otk=(their.oneTimeKey&&their.oneTimeKey.key)||(their.fallbackKey&&their.fallbackKey.key);
  if(!idk||!otk) throw new Error('对方密钥不完整');
  sess=_acct.createOutboundSession(idk, otk);
  persistSession(key, sess);
  rememberIdentity(peerId, their);
  return {sess, key, their, fresh:true};
}

function rememberIdentity(peerId, their){
  _store.knownIdentities=_store.knownIdentities||{};
  const prev=_store.knownIdentities[peerId];
  const ed=their.identityKey&&their.identityKey.ed25519;
  if(prev&&prev.ed25519&&ed&&prev.ed25519!==ed){
    S.e2eeKeyChange=S.e2eeKeyChange||{};
    S.e2eeKeyChange[peerId]={previous:prev, current:their};
  }
  _store.knownIdentities[peerId]={
    deviceId:their.deviceId,
    curve25519:their.identityKey.curve25519,
    ed25519:ed,
  };
  e2eePersist();
}

async function e2eeEncrypt(peerId, payload){
  await e2eeEnsure();
  if(!_acct) throw new Error('本机加密尚未就绪');
  const keys=await e2eeClaim(peerId);
  if(!keys.length) throw new Error('对方尚未启用加密，无法发送。不会改为明文发送。');
  const plain=typeof payload==='string'?payload:JSON.stringify({v:1,...payload});
  const envelopes=[];
  for(const k of keys){
    const {sess, key, their}=await sessionFor(peerId, k);
    const enc=JSON.parse(sess.encrypt(plain));
    persistSession(key, sess);
    envelopes.push({deviceId:their.deviceId, type:enc.type, body:enc.body, sessionId:sess.sessionId()});
  }
  return {
    ciphertext: JSON.stringify({v:1, envelopes}),
    senderDeviceId: _store.deviceId,
  };
}

function payloadText(obj){
  if(obj==null)return '';
  if(typeof obj==='string'){
    try{obj=JSON.parse(obj)}catch(e){return obj}
  }
  if(obj.t==='text'||obj.type==='text')return String(obj.text||'');
  if(obj.t==='sticker'&&obj.sticker)return obj.sticker;
  if(obj.t==='media')return obj;
  if(obj.text)return String(obj.text);
  return JSON.stringify(obj);
}

function applyCachedPlain(msg, cached){
  const out=Object.assign({},msg);
  if(cached&&typeof cached==='object'&&!Array.isArray(cached)){
    out.text=cached.text||'';
    if(cached.sticker)out.sticker=cached.sticker;
    out._decoded=cached;
  }else{
    out.text=typeof cached==='string'?cached:(cached&&cached.text)||'';
    out._decoded=cached;
  }
  out.decrypted=true;
  out.decryptError=undefined;
  return out;
}
async function e2eeDecrypt(msg){
  if(!msg||!msg.encrypted||!msg.ciphertext)return msg;
  const cache=e2eePlainCache();
  if(cache[msg.id]!==undefined) return applyCachedPlain(msg, cache[msg.id]);
  if(msg.clientId&&S.e2eePending&&S.e2eePending[msg.clientId]!==undefined){
    const p=S.e2eePending[msg.clientId];
    cache[msg.id]=p;
    return applyCachedPlain(msg, p);
  }
  const me=SESSION&&SESSION.user&&msg.author&&Number(SESSION.user.id)===Number(msg.author.id);
  try{
    await e2eeEnsure();
    const wrap=JSON.parse(msg.ciphertext);
    const envs=wrap&&wrap.envelopes||[];
    const mine=_store&&_store.deviceId;
    const env=envs.find(e=>e.deviceId===mine)||(envs.length===1?envs[0]:null);
    if(!env){
      msg.text='［无法解密：不是发给这台设备的］';
      msg.decryptError='NOT_FOR_DEVICE';
      return msg;
    }
    const type=env.type===1||env.type==='olm.message'||env.type==='1'?1:0;
    const senderDev=msg.senderDeviceId||'';
    const peerId=msg.author&&msg.author.id;
    // 先试已有会话（按对端设备）
    let plain=null;
    const tryKeys=Object.keys((_store.sessions)||{}).filter(k=>k.startsWith(String(peerId)+':')||(senderDev&&k.endsWith(':'+senderDev)));
    for(const k of tryKeys){
      const sess=loadSession(k);
      if(!sess)continue;
      try{
        plain=sess.decrypt(type, env.body);
        persistSession(k, sess);
        break;
      }catch(e){}
    }
    if(plain==null && type===0){
      const inbound=_acct.createInboundSession(env.body);
      plain=inbound.plaintext;
      const sess=inbound.takeSession();
      const theirId=inbound.senderIdentityKey;
      const key=peerId+':'+(senderDev||theirId||'unknown');
      persistSession(key, sess);
    }
    if(plain==null){
      if(me){msg.text=msg.text||'［已发送的加密消息］';msg.decrypted=true;return msg;}
      msg.text='［无法解密］';
      msg.decryptError='DECRYPT_FAILED';
      return msg;
    }
    let decoded=plain;
    try{decoded=JSON.parse(plain)}catch(e){decoded=plain}
    const tx=payloadText(decoded);
    if(typeof tx==='string'){ cache[msg.id]=tx; msg.text=tx; }
    else { cache[msg.id]=tx; msg._decoded=tx; if(tx&&tx.t==='sticker'){msg.sticker=tx.sticker;msg.text=''} }
    msg.decrypted=true;
    return msg;
  }catch(e){
    msg.text='［无法解密］';
    msg.decryptError=String(e&&e.message||e);
    return msg;
  }
}

async function e2eeSafetyOf(peerId){
  await e2eeEnsure();
  if(!_acct)return null;
  const my=JSON.parse(_acct.identityKeys());
  const r=await api('GET','/api/e2ee/keys/'+Number(peerId));
  if(r.s!==200||!r.j.devices||!r.j.devices.length)return {ready:false, myEd:my.ed25519};
  const their=r.j.devices.find(d=>!d.revoked)||r.j.devices[0];
  const number=await safetyNumber(my.ed25519, their.identityKey.ed25519);
  rememberIdentity(peerId, their);
  const verified=!!(_store.verified&&_store.verified[peerId]&&_store.verified[peerId].ed25519===their.identityKey.ed25519);
  const changed=!!(S.e2eeKeyChange&&S.e2eeKeyChange[peerId]);
  return {
    ready:true, number, verified, changed,
    myDeviceId:_store.deviceId, theirDeviceId:their.deviceId,
    myEd:my.ed25519, theirEd:their.identityKey.ed25519,
    theirDevices:r.j.devices,
  };
}

function e2eeMarkVerified(peerId, ed){
  if(!_store)return;
  _store.verified=_store.verified||{};
  _store.verified[peerId]={ed25519:ed, at:Date.now()};
  if(S.e2eeKeyChange)delete S.e2eeKeyChange[peerId];
  e2eePersist();
}

function e2eeIsDm(c){return c&&!c.g&&c.kind!=='group'}

async function e2eeOnLogin(){
  try{ await e2eeEnsure(); }
  catch(e){ console.warn('e2ee init', e); }
}


function e2eeChatBar(c){
  const peer=typeof e2eePeerOf==='function'?e2eePeerOf(c):(c&&c.peerId);
  const info=S.e2eeSafety&&S.e2eeSafety[peer];
  if(S.e2eeKeyChange&&peer&&S.e2eeKeyChange[peer]){
    return `<div class="ban" data-e2ee-warn="1"><b>对方密钥已变化</b>请重新核对安全号码，确认后再发送。<button class="lk" data-a="safenum" data-v="${c.id}">查看安全号码</button></div>`;
  }
  if(!info)return `<div class="hint" style="padding:8px 16px" data-e2ee-bar="1">此私聊已加密。<button class="lk" data-a="safenum" data-v="${c.id}">查看安全号码</button></div>`;
  if(!info.ready)return `<div class="hint" style="padding:8px 16px" data-e2ee-bar="1">正在准备加密，或对方还没开启加密。就绪前消息不会发出。<button class="lk" data-a="safenum" data-v="${c.id}">查看安全号码</button></div>`;
  return `<div class="hint" style="padding:8px 16px" data-e2ee-bar="1">此私聊已加密。${info.verified?'已核对安全号码。':'请核对安全号码。'} <button class="lk" data-a="safenum" data-v="${c.id}">安全号码</button></div>`;
}
async function safenum(cid){
  const c=(typeof cvSrc==='function'?cvSrc():[]).find(x=>x.id==cid);
  const peer=c&&(typeof e2eePeerOf==='function'?e2eePeerOf(c):c.peerId);
  if(!peer){T('无法确定对方');return}
  try{
    const info=await e2eeSafetyOf(peer);
    S.e2eeSafety=S.e2eeSafety||{};S.e2eeSafety[peer]=info;
    S.sh={t:'safety',id:cid,peer,info};
  }catch(e){T((e&&e.message)||'无法获取安全号码')}
}
function safeok(peer){
  const info=S.sh&&S.sh.info;
  if(!info||!info.theirEd){S.sh=null;return}
  e2eeMarkVerified(peer, info.theirEd);
  info.verified=true;info.changed=false;
  T('已标记为已核对');
  S.sh=null;
}
function safetySheet(s){
  const info=s&&s.info;
  if(!info||!info.ready)return `<h3>安全号码</h3><p class="hint">对方还没开启加密，或本机还没准备好。双方都就绪之前，消息不会发出。</p><div class="fr"><button class="pb" data-a="x">关闭</button></div>`;
  const grid=(info.number||'').split(' ').map(g=>`<span style="font-family:ui-monospace,Menlo,monospace;letter-spacing:.06em;display:inline-block;width:7ch;margin:6px 2px">${esc(g)}</span>`).join('');
  return `<h3>安全号码</h3><p class="hint" style="margin-bottom:8px">请与对方当面或通过其他可信渠道核对这些数字。数字相同表示正在和同一把身份密钥通话。密钥变化时会再次提示。独立安全审查尚未完成。</p><div style="padding:8px;text-align:center;font-size:15px;line-height:1.9" data-safety-number="${esc(info.number)}">${grid}</div>${info.verified?'<p class="hint">你已将此号码标记为已核对。</p>':''}<div class="fr"><button class="pb s" data-a="x">关闭</button><button class="pb" data-a="safeok" data-v="${s.peer}">${info.verified?'重新确认':'标记为已核对'}</button></div>`;
}

async function e2eeDecryptExport(data){
  if(!data||!Array.isArray(data.conversations))return data;
  for(const cv of data.conversations){
    for(const m of (cv.messages||[])){
      if(!(m&&m.encrypted&&m.ciphertext))continue;
      try{
        const copy=Object.assign({},m);
        await e2eeDecrypt(copy);
        if(copy.decrypted){m.plaintextExport=copy.text;m.decryptedOnClient=true}
        else{m.decryptedOnClient=false;m.decryptError=copy.decryptError}
      }catch(e){m.decryptedOnClient=false;m.decryptError=String(e&&e.message||e)}
    }
  }
  data.e2eeDecryptedOnClient=true;
  return data;
}
// 导出到全局，供聊天与界面调用。
Object.assign(globalThis,{
  e2eeEnsure, e2eeEncrypt, e2eeDecrypt, e2eeSafetyOf, e2eeMarkVerified, e2eeOnLogin,
  e2eePeerOf:peerOfCv, e2eeIsDm, safetyNumber, e2eeUploadKeys, e2eePlainCache,
  e2eeChatBar, safenum, safeok, safetySheet, e2eeDecryptExport, e2eeKey, e2eeForget,
});
})();
