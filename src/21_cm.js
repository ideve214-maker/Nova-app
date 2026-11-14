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
  return {id:c.id,n:c.name,d:c.description||'',m:c.memberCount||0,j:c.joined?1:0,r:c.role||'',ch,mb,vis:c.visibility,joinStatus:c.joinStatus||(c.joined?'joined':'none'),pending:c.joinStatus==='pending',src:'net',banned:!!c.banned,bg:c.cover||c.bg||'',cp:c.avatar||c.cp||''};
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
  if(r.s!==200){const e=(r.j&&r.j.error)||{};S.cmErr={id:String(id),s:r.s,code:e.code||'',message:e.message||'',isOwner:!!e.isOwner,appealable:!!e.appealable,communityId:e.communityId||id,communityName:e.communityName||'',reason:e.reason||'',appealStatus:e.appealStatus||null,appeal:e.appeal||null};return null}
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
  if(m.media)row.media=m.media;
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
  S.channelPins=S.channelPins||{};
  if(Array.isArray(r.j.pins))S.channelPins[cid]=r.j.pins.map(String);
}
/* r10：频道消息置顶 / 取消置顶 / 删除都走服务器（之前只改本机，联网时点了没反应）。 */
async function chMsgAct(act,cid,id){
  const r=await api('POST','/api/channel-messages/'+encodeURIComponent(id)+'/'+act,{});
  if(r.s!==200){T(errMsg(r,act==='delete'?'无法删除':act==='pin'?'无法置顶':'无法取消置顶'));return false}
  S.channelPins=S.channelPins||{};
  if(Array.isArray(r.j.pins))S.channelPins[cid]=r.j.pins.map(String);
  if(act==='delete'&&S.channelMessages&&S.channelMessages[cid])S.channelMessages[cid]=S.channelMessages[cid].filter(m=>String(m[3])!==String(id));
  S.sh=null;
  T(act==='delete'?'已删除':act==='pin'?'已置顶，所有成员都能看到':'已取消置顶');
  return true;
}

/* r8.3：社区被下架/删除（服务器返回 403/404/410）时，不再进入空页面或报通用错误，退回上一页并说明原因 */
function cmGoneText(e){
  const t=String((e&&e.code)||'')+' '+String((e&&e.message)||'');
  if(/TAKEN|TAKEDOWN|SUSPEND|DISABLED|下架|停用/i.test(t)){
    if(e&&e.isOwner){
      if(e.appealStatus==='pending')return '该社区因存在问题已被管理员下架，你的申诉正在处理中。';
      if(e.appealable)return '该社区因存在问题已被管理员下架。你可以提交申诉，说明情况后等待管理员处理。';
    }
    return '该社区因存在问题已被管理员下架，暂时无法访问。如果你是社区所有者，可以在本页或「通知」里提交申诉。';
  }
  if(e&&e.code==='BANNED')return (e.message||'你已被这个社区封禁');
  return '该社区不存在或已被删除。';
}
function cmGoneHandle(id){
  const e=S.cmErr;if(!e||String(e.id)!==String(id)||![403,404,410].includes(e.s))return false;
  S.st=(S.st||[]).filter(x=>!String(x).startsWith('cm:'+id)&&!String(x).startsWith('cmm:'+id));
  if(Array.isArray(S.communities)&&e.s!==403)S.communities=S.communities.filter(c=>String(c.id)!==String(id));
  if(Array.isArray(S.communities)&&e.s===403&&/TAKEN|TAKEDOWN|下架/i.test(String(e.code)+String(e.message)))S.communities=S.communities.filter(c=>String(c.id)!==String(id));
  S.sh={t:'cmgone',msg:cmGoneText(e),id:e.communityId||id,name:e.communityName||'',reason:e.reason||'',isOwner:!!e.isOwner,appealable:!!e.appealable,appealStatus:e.appealStatus||null};
  return true;
}

function rawCommunityId(v){
  let s=String(v||'').trim();
  if(/^community:/i.test(s))s=s.slice('community:'.length);
  return s;
}
function saveCmLook(id,body,okMsg){
  if(typeof usingNet==='function'&&usingNet()&&SESSION){
    return api('POST','/api/communities/'+id+'/edit',body).then(r=>{
      if(r.s!==200){T(errMsg(r,'未能同步到服务器'));return false}
      if(r.j&&r.j.community){
        const x=adoptCm(r.j.community),cur=typeof cmp==='function'?cmp(id):null;
        if(cur&&x){if(x.bg!=null)cur.bg=x.bg;if(x.cp!=null)cur.cp=x.cp}
      }
      T(okMsg||'已保存');
      if(typeof render==='function')render();
      return true;
    });
  }
  T(okMsg||'已保存');
  return Promise.resolve(true);
}
function cmAppealForm(s){
  s=s||S.sh||{};
  const name=s.name||'';
  return `<h3>提交申诉</h3><p class="hint">说明社区${name?'「'+esc(name)+'」':''}被下架的情况和你的理由，管理员会尽快处理，结果会通过通知告诉你。</p><textarea class="fld" data-d="aptxt" data-af rows="5" maxlength="4000" placeholder="请填写申诉理由（至少 4 个字）"></textarea><div class="fr"><button class="pb s" data-a="x">取消</button><button class="pb" data-a="cmapsend" data-v="${esc(String(s.id||''))}">提交申诉</button></div>`;
}
async function cmAppealSend(id){
  const cid=rawCommunityId(id||(S.sh&&S.sh.id));
  if(!cid){T('无法提交申诉');return}
  const text=String(S.d.aptxt||'').trim();
  if(text.length<4){T('请填写至少 4 个字的申诉理由');return}
  if(S.apBusy)return;S.apBusy=1;
  let r;try{r=await api('POST','/api/appeals',{kind:'community',related:cid,communityId:cid,body:text})}finally{S.apBusy=0}
  if(!r||r.s!==200){T(errMsg(r,'申诉提交失败，请稍后再试'));return}
  if(S.cmErr&&String(S.cmErr.communityId||S.cmErr.id)===String(cid)){S.cmErr.appealable=false;S.cmErr.appealStatus='pending'}
  const name=(S.sh&&S.sh.name)||(S.cmErr&&S.cmErr.communityName)||'';
  const reason=(S.sh&&S.sh.reason)||(S.cmErr&&S.cmErr.reason)||'';
  S.d.aptxt='';
  S.sh={t:'cmgone',msg:'申诉已提交，管理员会尽快处理。',id:cid,name,reason,isOwner:true,appealable:false,appealStatus:'pending'};
  T('申诉已提交，管理员会尽快处理');
}
