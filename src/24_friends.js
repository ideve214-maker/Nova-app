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
  if(st==='accepted')return '<span class="tag">好友</span>';
  if(st==='incoming')return `<button class="pb" data-a="faccept" data-v="${id}">通过申请</button><button class="pb s" data-a="fdecline" data-v="${id}">拒绝</button>`;
  if(st==='outgoing')return `<button class="pb s" data-a="fcancel" data-v="${id}">取消申请</button>`;
  return `<button class="pb s" data-a="frequest" data-v="${id}">加好友</button>`;
}
function frequest(v){return api('POST','/api/friends/request',{userId:Number(v)}).then(r=>{if(r.s!==200){T(errMsg(r,'无法发送申请'));return}T('已发送好友申请');return loadFriends()})}
function faccept(v){return api('POST','/api/friends/accept',{userId:Number(v)}).then(r=>{if(r.s!==200){T(errMsg(r,'无法通过'));return}T('已加为好友');return loadFriends()})}
function fdecline(v){return api('POST','/api/friends/decline',{userId:Number(v)}).then(r=>{if(r.s!==200){T(errMsg(r,'无法拒绝'));return}T('已拒绝');return loadFriends()})}
function fcancel(v){return api('POST','/api/friends/cancel',{userId:Number(v)}).then(r=>{if(r.s!==200){T(errMsg(r,'无法取消'));return}T('已取消申请');return loadFriends()})}
