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
function maybeKnow(){
  const fr=new Set((S.friends||[]).map(f=>String(f.userId!=null?f.userId:f.id)));
  (S.friendIn||[]).forEach(x=>fr.add(String(x.userId)));
  (S.friendOut||[]).forEach(x=>fr.add(String(x.userId)));
  fr.add('me');fr.add('notice');
  if(S.suggest&&S.suggest.length)return S.suggest;
  const ids=typeof usingNet==='function'&&usingNet()?(S.following||[]):Object.keys(D.u);
  return ids.filter(i=>i&&!fr.has(String(i))).slice(0,12).map(i=>({userId:i,user:{id:i,displayName:P(i).n,username:P(i).h}}));
}
function pFriends(){
  const inL=S.friendIn||[],outL=S.friendOut||[],fr=S.friends||[],tab=S.fseg||'req';
  const frow=(it,acts,sub)=>`<div class="freq">${av(String(it.userId),56)}<div class="gr"><b>${esc((it.user&&(it.user.displayName||it.user.username))||P(String(it.userId)).n)}</b><small>@${esc((it.user&&it.user.username)||P(String(it.userId)).h||'')}</small>${sub?`<small>${sub}</small>`:''}</div><div class="acts">${acts}</div></div>`;
  let body='';
  if(tab==='req'){
    body=(inL.length?inL.map(it=>frow(it,`<button class="pb sm" data-a="faccept" data-v="${it.userId}">确认</button><button class="pb sm s" data-a="fdecline" data-v="${it.userId}">删除</button>`,it.mutualFriends?it.mutualFriends+' 位共同好友':'好友请求')).join(''):'<p class="em">没有好友请求</p>')
      +(outL.length?`<div class="shd">我发出的申请</div>`+outL.map(it=>frow(it,`<button class="pb sm s" data-a="fcancel" data-v="${it.userId}">撤回</button>`,'等待对方确认')).join(''):'');
  }else if(tab==='maybe'){
    const mk=maybeKnow();
    body=mk.length?mk.map(it=>frow(it,`<button class="pb sm" data-a="frequest" data-v="${it.userId}">添加</button><button class="pb sm s" data-a="user" data-v="${it.userId}">查看</button>`,'可能认识')).join(''):'<p class="em">暂时没有推荐</p>';
  }else{
    body=fr.length?fr.map(it=>frow(it,`<button class="pb sm s" data-a="dm" data-v="${it.userId}">消息</button><button class="pb sm s" data-a="funfriend" data-v="${it.userId}">删除</button>`)).join(''):'<p class="em">还没有好友。关注不是好友，需要双方确认。</p>';
  }
  return `<div class="pg" id="friendsp">${sub('好友')}<div class="seg"><button data-a="fseg" data-v="req" class="${tab=='req'?'on':''}">好友请求${inL.length?' '+inL.length:''}</button><button data-a="fseg" data-v="maybe" class="${tab=='maybe'?'on':''}">可能认识</button><button data-a="fseg" data-v="all" class="${tab=='all'?'on':''}">我的好友</button></div><div class="sc">${body}</div></div>`;
}
const friendsRow=()=>`<button class="row" style="width:100%;text-align:left" data-a="friends" id="frrow"><div class="gr"><b>好友</b><small>${(S.friendIn&&S.friendIn.length)?(S.friendIn.length+' 条待处理申请'):'申请、列表与删除'}</small></div><small>›</small></button>`;

function loadUserCard(id){
  if(typeof usingNet!=='function'||!usingNet())return Promise.resolve();
  return api('GET','/api/users/'+id).then(r=>{
    if(r.s===200&&r.j&&r.j.user){S.userView={id:String(id),hidden:false,user:r.j.user}}
    else S.userView={id:String(id),hidden:true,code:r.j&&r.j.error&&r.j.error.code,message:(r.j&&r.j.error&&r.j.error.message)||'该用户资料不可见'};
    if(r.s!==200)return;
    return Promise.all([
      api('GET','/api/follows?kind=following&user='+id),
      api('GET','/api/follows?kind=followers&user='+id),
    ]).then(([fo,fr])=>{
      const following=fo.s===200?(fo.j.users||[]).map(u=>String(u.id)):[];
      if(fo.s===200)(fo.j.users||[]).forEach(rememberAuthor);
      S.userFollowing=following;
      S.userSocial={
        following:fo.s===200?(fo.j.followingCount||following.length):0,
        followers:fr.s===200?(fr.j.followerCount||(fr.j.users||[]).length):0,
      };
    });
  });
}
