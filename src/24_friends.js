/* M4.10 双向好友：申请/同意/拒绝/取消。与单向关注分开。 */
async function loadFriends(){
  if(typeof usingNet!=='function'||!usingNet()||!SESSION)return;
  const[f,r]=await Promise.all([api('GET','/api/friends'),api('GET','/api/friends/requests')]);
  if(f.s===200)S.friends=f.j.friends||[];
  if(r.s===200){S.friendIn=r.j.incoming||[];S.friendOut=r.j.outgoing||[]}
}
function isFriend(id){return !!(S.friends&&S.friends.some(x=>Number(x.userId)===Number(id)))}
function friendStatus(id){
  const n=Number(id);
  if(isFriend(n))return 'accepted';
  if(S.friendIn&&S.friendIn.some(x=>Number(x.userId)===n))return 'incoming';
  if(S.friendOut&&S.friendOut.some(x=>Number(x.userId)===n))return 'outgoing';
  return 'none';
}
function friendBtns(id){
  if(id==='me'||id==='notice'||typeof usingNet!=='function'||!usingNet())return '';
  const st=friendStatus(id);
  if(st==='accepted')return '<span class="tag">好友</span><button class="pb s" data-a="funfriend" data-v="'+id+'">删除好友</button>';
  if(st==='incoming')return `<button class="pb" data-a="faccept" data-v="${id}">通过申请</button><button class="pb s" data-a="fdecline" data-v="${id}">拒绝</button>`;
  if(st==='outgoing')return `<button class="pb s" data-a="fcancel" data-v="${id}">取消申请</button>`;
  return `<button class="pb s" data-a="frequest" data-v="${id}">加好友</button>`;
}
function frequest(v){return api('POST','/api/friends/request',{userId:Number(v)}).then(r=>{if(r.s!==200){T(errMsg(r,'无法发送申请'));return}T('已发送好友申请');return loadFriends()})}
function faccept(v){return api('POST','/api/friends/accept',{userId:Number(v)}).then(r=>{if(r.s!==200){T(errMsg(r,'无法通过'));return}T('已加为好友');return loadFriends()})}
function fdecline(v){return api('POST','/api/friends/decline',{userId:Number(v)}).then(r=>{if(r.s!==200){T(errMsg(r,'无法拒绝'));return}T('已拒绝');return loadFriends()})}
function fcancel(v){return api('POST','/api/friends/cancel',{userId:Number(v)}).then(r=>{if(r.s!==200){T(errMsg(r,'无法取消'));return}T('已取消申请');return loadFriends()})}

function funfriend(v){return api('POST','/api/friends/remove',{userId:Number(v)}).then(r=>{if(r.s!==200){T(errMsg(r,'无法删除好友'));return}T('已删除好友。此前的私聊记录仍在，但不能再发新消息。');return loadFriends()})}
function friendsOpen(){S.sh=null;S.st.push('friends');return typeof loadFriends==='function'?loadFriends():Promise.resolve()}
function pFriends(){
  const inL=S.friendIn||[],outL=S.friendOut||[],fr=S.friends||[];
  const row=(it,acts)=>`<div class="row"><div class="gr"><b>${esc((it.user&&(it.user.displayName||it.user.username))||('用户 '+it.userId))}</b><small>@${esc((it.user&&it.user.username)||'')}</small></div>${acts}</div>`;
  const incoming=inL.length?inL.map(it=>row(it,`<button class="pb sm" data-a="faccept" data-v="${it.userId}">通过</button><button class="pb sm s" data-a="fdecline" data-v="${it.userId}">拒绝</button>`)).join(''):'<p class="em">没有待处理的申请</p>';
  const outgoing=outL.length?outL.map(it=>row(it,`<button class="pb sm s" data-a="fcancel" data-v="${it.userId}">取消</button>`)).join(''):'';
  const list=fr.length?fr.map(it=>row(it,`<button class="pb sm s" data-a="funfriend" data-v="${it.userId}">删除</button><button class="pb sm s" data-a="dm" data-v="${it.userId}">私信</button>`)).join(''):'<p class="em">还没有好友。从用户主页可以发送申请。关注不是好友。</p>';
  return `<div class="pg" id="friendsp">${sub('好友')}<div class="sc"><div class="shd">待处理的申请${inL.length?'（'+inL.length+'）':''}</div>${incoming}${outgoing?`<div class="shd">我发出的申请</div>`+outgoing:''}<div class="shd">我的好友（${fr.length}）</div>${list}<p class="hint" style="padding:12px 16px">删除好友后，双方都不再是好友；以前的私聊还在，但不能再发送。私聊默认只对好友开放。</p></div></div>`;
}
const friendsRow=()=>`<button class="row" style="width:100%;text-align:left" data-a="friends" id="frrow"><div class="gr"><b>好友</b><small>${(S.friendIn&&S.friendIn.length)?(S.friendIn.length+' 条待处理申请'):'申请、列表与删除'}</small></div><small>›</small></button>`;

function loadUserCard(id){
  if(typeof usingNet!=='function'||!usingNet())return Promise.resolve();
  return api('GET','/api/users/'+id).then(r=>{
    if(r.s===200&&r.j&&r.j.user){S.userView={id:String(id),hidden:false,user:r.j.user};return}
    S.userView={id:String(id),hidden:true,code:r.j&&r.j.error&&r.j.error.code,message:(r.j&&r.j.error&&r.j.error.message)||'该用户资料不可见'};
  });
}
