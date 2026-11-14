/* M2.6 个人资料 / 颜色文字头像 / 隐私 / 登录设备。登录后读写都走服务器，重新登录仍在。 */
const AV_COLS=['#2F6F5E','#5C4A3A','#243044','#6B3A4A','#3A465C','#6A5A3C','#3A3F46','#C8A96A'];
const PRIV_DEF={profileVisibility:'everyone',friendRequests:'everyone',showBirthday:true,showAge:true,showGender:true,searchable:true};
const visLabel={everyone:'所有人',friends:'仅好友',private:'仅自己'};
const freqLabel={everyone:'所有人都可以申请',nobody:'不接受申请'};

function applyUser(user){
  const u=D.u.me,p=user.profile||{};
  u[0]=p.displayName||user.username||u[0]||user.username;
  u[1]=user.username;
  u[2]=(p.avatar&&p.avatar.letter)||[...String(u[0]||'我')][0]||'我';
  if(p.avatar&&p.avatar.color)u[3]=p.avatar.color;
  if(p.bio!=null)u[4]=p.bio;
  u[5]=user.vip?1:0;
  u[6]=user.badge||'';
  D.acct=user.id;
  D.pf=D.pf||{};D.pf.me=D.pf.me||{g:'',b:'',gp:1,bp:1,ap:1,cv:0};
  /* r10：图片头像 / 背景以服务器为准，换设备、重新登录都在；本机旧版只存在这台设备上的图片，第一次登录时补传到服务器。 */
  const av=p.avatar||{};
  if(Object.prototype.hasOwnProperty.call(av,'image')){
    if(av.image)D.pf.me.ph=av.image;
    else if(D.pf.me.ph&&!D.pf.me.phSynced)setTimeout(()=>saveMyLook({avatarImage:D.pf.me.ph},''),0);
    else delete D.pf.me.ph;
    D.pf.me.phSynced=1;
  }
  if(Object.prototype.hasOwnProperty.call(p,'cover')){
    if(p.cover)D.pf.me.bg=p.cover;
    else if(D.pf.me.bg&&!D.pf.me.bgSynced)setTimeout(()=>saveMyLook({cover:D.pf.me.bg},''),0);
    else delete D.pf.me.bg;
    D.pf.me.bgSynced=1;
  }
  if(p.gender!=null)D.pf.me.g=p.gender;
  if(p.birthday!=null)D.pf.me.b=p.birthday;
}

async function loadPrivacy(){if(MODE!=='account'||!SESSION)return;const r=await api('GET','/api/me/privacy');if(r.s===200)S.priv=r.j.privacy}
async function loadSessions(){if(MODE!=='account'||!SESSION)return;const r=await api('GET','/api/me/sessions');if(r.s===200)S.sess=r.j.sessions}

function pPriv(){
  const p=Object.assign({},PRIV_DEF,S.priv||{}),row=(k,l,opts)=>`<div class="row"><div class="gr"><b>${l}</b></div><div class="sw">${opts.map(([v,t])=>`<button class="pb sm${p[k]==v?'':' s'}" data-a="privset" data-v="${k}|${v}">${t}</button>`).join('')}</div></div>`;
  const tog=(k,l)=>`<div class="row"><div class="gr"><b>${l}</b></div><button class="pb${p[k]?'':' s'}" data-a="privtog" data-v="${k}" aria-pressed="${!!p[k]}">${p[k]?'已开启':'已关闭'}</button></div>`;
  const body=MODE!=='account'?'<p class="em">登录后，隐私设置会保存在服务器上。</p>':!S.priv&&NET?'<p class="em">正在读取…</p>':row('profileVisibility','谁可以看我的资料',[['everyone','所有人'],['friends','仅好友'],['private','仅自己']])+row('friendRequests','谁可以加我为好友',[['everyone','所有人'],['nobody','不接受']])+tog('showBirthday','公开生日')+tog('showAge','公开年龄')+tog('showGender','公开性别')+tog('searchable','允许被搜索')+'<p class="hint" style="padding:12px 16px">每项都有默认值，修改后保存在服务器。「仅好友」只对已接受的好友开放资料；「仅自己」对其他人显示为找不到该用户。不公开的生日、年龄、性别不会出现在他人看到的资料里。「不接受」好友申请会直接拒绝。</p>';
  return `<div class="pg" id="privp">${sub('隐私')}<div class="sc">${body}</div></div>`}
function privOpen(){S.st.push('priv');return MODE==='account'?loadPrivacy():Promise.resolve()}
function privset(v){const[k,val]=v.split('|');if(!S.priv)S.priv={...PRIV_DEF};S.priv[k]=val;return savePriv()}
function privtog(k){if(!S.priv)S.priv={...PRIV_DEF};S.priv[k]=!S.priv[k];return savePriv()}
async function savePriv(){
  if(MODE!=='account'||!SESSION){T('已保存（仅本机）');return}
  const r=await api('POST','/api/me/privacy',S.priv);
  if(r.s!==200){T(errMsg(r,'保存失败'));await loadPrivacy();return}
  S.priv=r.j.privacy;T('已保存')}

function pSec(){
  const acct=MODE==='account'&&SESSION,sess=S.sess||[];
  const edevs=(S.e2eeDevices&&S.e2eeDevices.devices)||[];
  const e2eeBox=acct?`<div class="shd">加密设备</div><p class="hint" style="padding:8px 16px 0">每台设备有自己的加密身份，密钥只留在该设备上。撤销后，那台设备不能再解开之后的聊天。退出登录不会同时撤销加密身份。</p>${edevs.map(d=>`<div class="row" data-edev="${esc(d.deviceId)}"><div class="gr"><b>${esc(d.deviceId)}${d.revoked?' <span class="tag">已撤销</span>':''}</b><small>编号 ${esc((d.identityKey&&d.identityKey.ed25519||'').slice(0,16))}…</small></div>${d.revoked?'':`<button class="pb sm d" data-a="e2eerev" data-v="${esc(d.deviceId)}">撤销</button>`}</div>`).join('')||'<p class="em">尚未生成本机加密设备，登录后会自动创建。</p>'}`:'';

  const pw=`<div class="card" style="padding:12px 16px;margin:8px 0" id="pwbox"><b>修改密码</b><p class="hint">改密后其他设备会退出，这台设备保持登录。</p><label class="lab">当前密码</label><input class="fld" data-d="opw" type="password" autocomplete="current-password"><label class="lab">新密码</label><input class="fld" data-d="npw" type="password" autocomplete="new-password" placeholder="至少 8 位，含字母和数字"><label class="lab">再输入一次</label><input class="fld" data-d="npw2" type="password" autocomplete="new-password">${S.pwerr?`<div class="err" role="alert">${esc(S.pwerr)}</div>`:''}<button class="pb" style="width:100%;margin-top:8px" data-a="chpw">修改密码</button></div>`;
  const devices=acct?`<div class="shd">登录设备</div><p class="hint" style="padding:8px 16px 0" data-ndev="${sess.length}">只显示你自己的登录。${sess.length>1?' 退出其他设备后，那些设备需要重新登录，这台保持登录。':''}</p>${sess.map(s=>`<div class="row" data-sid="${esc(s.id)}"><div class="gr"><b>${esc(s.device||'未知设备')}${s.current?' <span class="tag">当前设备</span>':''}</b><small>${esc(s.ip||'')} · ${s.createdAt?vipDate(s.createdAt):''}</small></div>${s.current?'':`<button class="pb sm d" data-a="revsess" data-v="${esc(s.id)}">退出</button>`}</div>`).join('')||'<p class="em">正在读取设备列表…</p>'}${sess.length>1?`<div style="padding:16px"><button class="pb d" style="width:100%" data-a="revothersq">退出其他 ${sess.length-1} 台设备</button><p class="hint" style="margin-top:8px">当前这台设备将保持登录。</p></div>`:''}`:'<p class="em">登录后可以管理设备和修改密码。</p>';
  return `<div class="pg" id="secp">${sub('账号安全')}<div class="sc">${acct?pw:''}${devices}${e2eeBox}${acct?`<div class="shd">数据导出</div><p class="hint" style="padding:8px 16px 0">导出你的资料、动态和消息。端到端加密的消息会先在本机解密再写入文件；服务端只提供密文。</p><div style="padding:16px"><button class="pb" style="width:100%" data-a="exportme">导出我的数据</button></div>
<div class="shd">注销账号</div><p class="hint" style="padding:8px 16px 0">注销后不能自行恢复。用户名和邮箱会匿名，密码作废，所有设备退出，VIP 取消；你的动态和评论不再对外展示；关注、好友、草稿、收藏和加密设备密钥会被清除。与他人的聊天密文、已上传媒体、支付和举报记录可能因对方或财务、安全需要而保留。请先导出需要保留的数据。</p>
<label class="lab" style="padding:0 16px">输入密码以确认</label>
<div style="padding:0 16px"><input class="fld" data-d="delpw" type="password" autocomplete="current-password" placeholder="当前密码"></div>
<p class="hint" style="padding:8px 16px"><button type="button" class="lk" data-a="deltog">${S.d.delok==='1'?'☑':'☐'} 我了解上述后果，确认要注销</button></p>
${S.delerr?`<div class="err" role="alert" style="margin:0 16px">${esc(S.delerr)}</div>`:''}
<div style="padding:16px"><button class="pb d" style="width:100%" data-a="delacctq">注销并删除我的账号</button></div>`:''}<p class="hint" style="padding:16px">密码经过保护，别人看不到原文。一对一聊天会加密，密钥只留在这台设备。请核对手友的安全号码。退出登录不会同时撤销加密身份。</p></div></div>`}
async function loadE2eeDevices(){
  if(MODE!=='account'||!SESSION)return;
  const r=await api('GET','/api/e2ee/keys');
  if(r.s===200)S.e2eeDevices=r.j;
}
function secOpen(){S.pwerr='';S.st.push('sec');return MODE==='account'?Promise.all([loadSessions(),loadE2eeDevices()]):Promise.resolve()}
async function e2eerev(id){
  if(!id)return;
  const r=await api('POST','/api/e2ee/devices/'+encodeURIComponent(id)+'/revoke',{});
  if(r.s!==200){T(errMsg(r,'无法撤销'));return}
  T('已撤销该加密设备');
  await loadE2eeDevices();
}
async function chpw(){
  if(S.auth&&S.auth.busy)return;const oldP=S.d.opw||'',nw=S.d.npw||'',nw2=S.d.npw2||'';
  S.pwerr='';
  if(!oldP||!nw){S.pwerr='请输入当前密码和新密码';return}
  if(!(nw.length>=8&&nw.length<=128&&/[A-Za-z]/.test(nw)&&/\d/.test(nw))){S.pwerr='密码需 8–128 位，且同时包含字母和数字';return}
  if(nw!==nw2){S.pwerr='两次输入的新密码不一致';return}
  const r=await api('POST','/api/me/password',{oldPassword:oldP,newPassword:nw});
  if(r.s!==200){S.pwerr=errMsg(r,'修改失败');return}
  S.d.opw='';S.d.npw='';S.d.npw2='';T('密码已修改，其他设备已退出');return loadSessions()}
function revothersq(){S.sh={t:'revothers'}}
async function revothers(){
  S.sh=null;const r=await api('POST','/api/me/sessions/revoke-others',{});
  if(r.s!==200){T(errMsg(r,'操作失败'));return}
  T('已退出 '+r.j.revoked+' 台其他设备，当前设备保持登录');return loadSessions()}
async function revsess(id){
  const r=await api('POST','/api/me/sessions/revoke',{id});
  if(r.s!==200){T(errMsg(r,'无法退出这台设备'));return}
  T('已退出该设备');return loadSessions()}

/* r10：去掉「颜色 + 文字」头像。保留函数名，旧的按钮如果还在也不会报错。 */
function avcol(){T('头像请用官方默认头像或从相册导入')}
function avlet(){T('头像请用官方默认头像或从相册导入')}
/* r10：保存自己的头像 / 背景到服务器（媒体 id、内置样板路径，空串 = 恢复默认）。 */
function saveMyLook(body,okMsg){
  if(!(MODE==='account'&&NET&&SESSION)){if(okMsg)T(okMsg);return Promise.resolve(true)}
  return api('POST','/api/me/look',body).then(r=>{
    if(r.s!==200){T(errMsg(r,'没有保存到服务器'));return false}
    if(r.j.user)SESSION.user=r.j.user;
    const p=r.j.profile||{};
    if(p.avatar){if(p.avatar.image)D.pf.me.ph=p.avatar.image;else delete D.pf.me.ph}
    if(Object.prototype.hasOwnProperty.call(p,'cover')){if(p.cover)D.pf.me.bg=p.cover;else delete D.pf.me.bg}
    save();if(okMsg)T(okMsg);if(typeof render==='function')render();return true;
  });
}

function deltog(){S.d.delok=S.d.delok==='1'?'':'1';S.delerr=''}
function delacctq(){
  S.delerr='';
  if(!(S.d.delpw||'')){S.delerr='请输入密码';return}
  if(S.d.delok!=='1'){S.delerr='请先确认你了解注销的后果';return}
  S.sh={t:'delacct'};
}
async function delacct(){
  S.sh=null;
  const r=await api('POST','/api/me/delete',{password:S.d.delpw,confirm:true});
  S.d.delpw='';S.d.delok='';
  if(r.s!==200){S.delerr=errMsg(r,'注销失败');return}
  T('账号已注销');
  logout();
}
async function legal(kind){
  const k=kind==='terms'?'terms':'privacy';
  S.st.push('legal:'+k);
  const r=await api('GET','/api/legal/'+k);
  S.legal=S.legal||{};
  if(r.s===200)S.legal[k]=r.j;
  else S.legal[k]={title:k==='terms'?'用户协议':'隐私政策',body:'暂时无法加载文档。'};
}
