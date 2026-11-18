/* ---- pages ---- */
const cmts=id=>{
  const all=typeof commentsOf==='function'?commentsOf(id):D.c.filter(c=>c.p==id);
  const kids=pid=>all.filter(c=>pid?c.pa==pid:!c.pa);
  const descN=cid=>kids(cid).reduce((n,c)=>n+1+descN(c.id),0);
  function tree(pid,depth){
    return kids(pid).map(c=>{
      const row=ci(c,depth),ch=kids(c.id);
      if(!ch.length||depth<1)return row+(ch.length?tree(c.id,depth+1):'');
      const k=String(c.id),open=!!(S.crep&&S.crep[k]),n=descN(c.id);
      const lab=open?'收起':('展开 '+n+' 条回复');
      return `<div class="cthread">${row}${open?tree(c.id,depth+1):''}<button type="button" class="crep" data-a="crep" data-v="${esc(k)}" data-open="${open?1:0}">${lab}</button></div>`;
    }).join('');
  }
  return '<div id="cbox">'+ (tree(0,0)||tree('',0)||'<p class="em">还没有评论</p>') +'</div>';
};
const ci=(c,depth)=>{const s=depth>=1,collapse=(c.depth!=null?c.depth:depth)>=2,rt=c.replyTo,who=rt&&(rt.author&&(rt.author.displayName||rt.author.username)||'');const hint=collapse&&who?`<span class="hint">回复 @${esc(who)}</span> `:((c.depth>=1||s)&&who&&depth>=2?`<span class="hint">回复 @${esc(who)}</span> `:'');const tm=typeof fmtTime==='function'&&c.at?fmtTime(c.at):(c.t||'');return `<div class="cm${s?' sub':''}" data-cid="${c.id}" data-depth="${c.depth||depth||0}">${av(c.a,s?28:34)}<div class="gr"><div class="cb"><b class="nmb">${nmB(P(c.a))}</b> ${hint}${c.deleted?'<i style="color:var(--t3)">'+(esc(c.x)||'（已删除）')+'</i>':esc(c.x)}</div>${c.deleted&&!(c.replyCount)?`<small style="display:block;padding-left:4px">${tm}</small>`:`<small style="display:block;padding-left:4px">${tm}${c.deleted?'':` · <button class="lk${c.ml?' on':''}" data-a="cl" data-v="${c.id}">赞${c.l?' '+c.l:''}</button> · <button class="lk" data-a="rp" data-v="${c.id}">回复</button>`}${c.a=='me'&&!c.deleted?` · <button class="lk dg" data-a="delc" data-v="${c.id}">删除</button>`:''}</small>`}</div></div>`};
const inbar=(k,ph,btn,v,extra='')=>{if(Array.isArray(extra))return cbBar(k,ph,btn,v,extra);return `<div class="inrow">${extra}<textarea class="inta" rows="1" data-grow="5" enterkeyhint="enter" data-d="${k}" data-max="${k=='chin'?textLimit('chat'):k=='cmin'?textLimit('channel'):k=='cin'?280:textLimit('post')}" placeholder="${ph}" autocomplete="off"></textarea><button class="pb" data-a="${btn}" data-v="${v}" data-for="${k}" disabled>发送</button></div>`};
const pPost=id=>{const p=(typeof feedSrc==='function'?feedSrc():D.p).find(x=>x.id==id)||D.p.find(x=>x.id==id)||(S.postCache&&S.postCache[String(id)]);if(!p)return sub('帖子')+'<p class="em">帖子不存在</p>';const all=typeof commentsOf==='function'?commentsOf(id):D.c;const rc=S.reply&&all.find(c=>c.id==S.reply);
return `<div class="pg">${sub('帖子')}<div class="sc">${pc(p,1)}<div class="shd">评论</div>${cmts(id)}</div>${rc?`<div class="rt">回复 ${esc(P(rc.a).n)}<button class="lk" data-a="rpx">取消</button></div>`:''}${inbar('cin',rc?'写一条回复':'写一条评论','cs',id)}</div>`};
const pUser=id=>{
  const hid=S.userView&&String(S.userView.id)===String(id)&&S.userView.hidden;
  if(hid)return `<div class="pg">${sub('用户资料')}<div class="sc"><p class="em">${esc(S.userView.message||'该用户资料不可见')}</p></div></div>`;
  const u=S.userView&&String(S.userView.id)===String(id)&&S.userView.user;
  if(u&&typeof P==='function'){
    // 把服务器卡同步到本地展示（不改写自己的资料）
    const loc=typeof P==='function'?P(id):null;
    if(loc){if(u.displayName)loc.n=u.displayName;if(u.bio!==undefined)loc.bio=u.bio}
  }
  const note=typeof riskNoticeText==='function'?riskNoticeText(id):'';
  return `<div class="pg">${sub(esc((u&&u.displayName)||P(id).n))}<div class="sc">${note?`<div class="riskn" role="note">${esc(note)}</div>`:''}${prof(id)}${u&&u.birthday?`<p class="hint" style="padding:8px 16px">生日 ${esc(u.birthday)}${u.age!=null?' · '+u.age+' 岁':''}</p>`:u&&u.age!=null?`<p class="hint" style="padding:8px 16px">${u.age} 岁</p>`:''}</div></div>`;
};
const pFl=(k,id)=>{const i=k=='following'?0:1,net=typeof usingNet==='function'&&usingNet()&&Array.isArray(S.followList),L=net?S.followList.map(u=>u.id):D.f.filter(e=>e[i]==id).map(e=>e[1-i]);return `<div class="pg" id="flp">${sub(k=='following'?'关注':'粉丝')}<div class="sc">${L.length?L.map(u=>`<div class="row" data-a="user" data-v="${u}" data-fid="${u}">${av(u,48)}<div class="gr"><b class="nmb">${nmB(P(u))}</b><small>@${P(u).h}</small></div>${u=='me'?'':`<button class="pb sm${(typeof isFollowed==='function'?isFollowed(u):fol('me',u))?' s':''}" data-a="fol" data-v="${u}">${(typeof isFollowed==='function'?isFollowed(u):fol('me',u))?'已关注':'关注'}</button>`}</div>`).join(''):'<p class="em">名单是空的</p>'}</div></div>`};
/* r7：小组页身份说明——一句完整的话，放在按钮上方，不出现技术用语 */
const cmRoleLine=c=>{
  if(!c.j)return c.pending?'你已申请加入这个小组，等管理员通过后就能参与讨论。':'加入后可以查看频道里的发言，并参与讨论。';
  const M={'所有者':'你是这个小组的<b>所有者</b>，可以管理成员、频道和小组资料；所有者不能退出小组，不再需要时可以解散。',
    '管理员':'你是这个小组的<b>管理员</b>，可以邀请和管理成员、管理频道、发布公告，也可以编辑小组资料。',
    '版主':'你是这个小组的<b>版主</b>，可以邀请成员、在公告频道发言，并置顶或删除消息。',
    '成员':'你是这个小组的<b>成员</b>，可以在文字频道发言，查看公告。'};
  return M[c.r]||M['成员'];
};
const pCm=id=>{const c0=(typeof cmSrc==='function'?cmSrc():D.cm).find(x=>x.id==id);if(!c0||!Array.isArray(c0.ch)||!c0.ch.length)return sub('社区')+'<div class="sc"><p class="em">'+(S.cmErr&&String(S.cmErr.id)===String(id)?esc(cmGoneText(S.cmErr)):'正在打开社区…')+'</p></div>';const c=c0,cur=c.ch.find(x=>x[0]==S.ch[id])||c.ch[0],ms=(typeof chMsgSrc==='function'?chMsgSrc(cur[0]):(D.cmsg[cur[0]]||[])),adm=canC(c.r,'postAnn'),can=c.j&&(cur[2]!='公告'||adm),mg=c.j&&canC(c.r,'addChannel');
return `<div class="pg">${sub(esc(c.n))}${c.j?pinbar('ch',cur[0]):''}<div class="sc"><div class="cover photo" style="${typeof lookCss==='function'?lookCss(c.bg,cove(c.id)):bgCss(c.bg||cove(c.id))}"${typeof lookMbg==='function'?lookMbg(c.bg):''}>${c.j&&(c.r=='所有者'||c.r=='管理员')?`<button class="cam" data-a="ccov" data-v="${c.id}">更换封面</button>`:''}</div><div class="cmi"><b style="font-size:18px">${esc(c.n)}</b><p>${esc(c.d)}</p><small>${c.m} 名成员 · ${c.ch.length} 个频道</small><p class="cmrole">${cmRoleLine(c)}</p><div class="cmacts">${!c.j?`<button class="pb sm" data-a="join" data-v="${c.id}">加入小组</button>`:c.r=='所有者'?'<button class="pb sm d" data-a="dis" data-v="'+c.id+'">解散小组</button>':`<button class="pb sm s" data-a="leave" data-v="${c.id}">退出小组</button>`}<button class="pb sm s" data-a="go" data-v="cmm:${c.id}">成员</button>${c.j&&canC(c.r,'invite')?`<button class="pb sm s" data-a="cminv" data-v="${c.id}">邀请</button>`:''}${c.j&&canC(c.r,'editInfo')?`<button class="pb sm s" data-a="cmedit" data-v="${c.id}">编辑资料</button>`:''}<button class="pb sm s" data-a="reportcm" data-v="${c.id}">举报</button></div></div><div class="chs">${c.ch.map(h=>`<button data-a="chan" data-v="${c.id}|${h[0]}" class="${h[0]==cur[0]?'on':''}">${h[2]=='公告'?'📢':'#'} ${h[1]}</button>`).join('')}${mg?`<button data-a="addch" data-v="${c.id}" style="background:none;border:1px dashed var(--t3)">＋ 新频道</button><button data-a="chmgr" data-v="${c.id}">⚙ 管理</button>`:''}</div>${ms.length?ms.map(m=>`<div class="cm" data-mid="${m[3]}" data-a="msgm" data-v="ch|${cur[0]}|${m[3]}">${av(m[0],36)}<div class="gr"><b style="display:inline">${esc(m[0]=='me'?'我':P(m[0]).n)}</b> <small>${(typeof fmtTime==='function'&&m.at)?fmtTime(m.at):m[1]}</small>${pinned('ch',cur[0]).includes(m[3])?' <small>📌</small>':''}${m.media&&typeof cbMedia==='function'?cbMedia(m.media):''}${m[2]?`<div style="word-break:break-word;white-space:pre-wrap">${fmt(m[2])}</div>`:''}</div></div>`).join(''):'<p class="em">这个频道还没有消息</p>'}${c.j?'':'<p class="em">'+(typeof usingNet==='function'&&usingNet()?'加入后才能查看发言':'加入后才会出现在你的列表里')+'</p>'}</div>${can?inbar('cmin','在 '+cur[1]+' 发言','cmsend',c.id+'|'+cur[0],cbTools('ch|'+c.id+'|'+cur[0],'ch|cmin|'+cur[0],'')):`<div class="nope">${c.j?'只有所有者、管理员和版主能在公告频道发言':'加入后才能发言'}</div>`}</div>`};
const pinbar=(k,cid)=>{const ids=pinned(k,cid);if(!ids.length)return '';const n=ids.length,i=(S.pi[cid]||0)%n,id=ids[n-1-i],m=msgs(k,cid).find(x=>mid(k,x)==id),who=k=='cv'?m[0]:m[0];
return `<button class="pinb" data-a="pinjump" data-v="${k}|${cid}" aria-label="跳到置顶消息"><span>📌</span><span class="gr"><small>置顶消息${n>1?' '+(i+1)+'/'+n:''}</small><b>${esc(who=='me'?'我':P(who).n)}：${esc(mtext(k,m))}</b></span></button>`};
function quoteBar(q,cid){
  if(!q)return '';
  if(q.deleted||q.state==='deleted')return `<button type="button" class="qbar gone" data-a="replyjump" data-v="${esc(cid+'|'+(q.id||''))}" data-st="deleted">原消息已删除</button>`;
  const who=q.author?(q.author.displayName||q.author.username||''):'';
  const tx=q.encrypted?(q.text||'［加密消息］'):(q.text||'');
  return `<button type="button" class="qbar" data-a="replyjump" data-v="${esc(cid+'|'+(q.id||''))}" data-st="ok"><b>${esc(who)}</b> ${esc(String(tx).slice(0,80))}</button>`;
}
const bubble=(m,g,cid)=>{if(m[1]=='s')return `<div class="mt" style="text-align:center;padding:6px 16px">${esc(m[4])}</div>`;const me=m[0]=='me',b=(m[6]&&m[6].id&&typeof cbMedia==='function')?cbMedia(m[6])+cbRest(m[4]):m[1]=='i'?`<div class="ph2">图片</div>${fmt(m[4])}`:m[1]=='v'?`🎙 语音 · ${fmt(m[4])}`:m[1]=='k'?stkView(m[4]):fmt(m[4]),pn=(D.pm[cid]||[]).includes(m[5]);
const fwd=m.forwarded||m.forwardFrom?`<div class="fwd" data-fwd="1">转发自 ${esc((m.forwardFrom&&(m.forwardFrom.displayName||m.forwardFrom.username||m.forwardFrom.label))||'一条消息')}</div>`:'';
const rx=(m.reactions&&m.reactions.length)?`<div class="mrxs">${m.reactions.map(r=>`<button type="button" class="rx${r.me?' on':''}" data-a="mreact" data-v="cv|${cid}|${m[5]}|${esc(r.emoji)}" aria-label="${esc(r.emoji)} ${r.count}"><span class="rxe">${esc(r.emoji)}</span><span class="rxn">${r.count}</span></button>`).join('')}</div>`:'';
return `<div class="mr${me?' me':''}" data-mid="${m[5]}" id="m-${esc(m[5])}">${me?'':av(m[0],32)}<div class="mw">${g&&!me?`<small class="nmb">${nmB(P(m[0]))}</small>`:''}${quoteBar(m.replyTo,cid)}${fwd}<div class="bub" data-a="msgm" data-v="cv|${cid}|${m[5]}">${pn?'<span class="pnt">📌 </span>':''}${b}</div>${typeof trBox==='function'?trBox('m:'+m[5]):''}${rx}<div class="mt">${(typeof fmtTime==='function'&&m.at)?fmtTime(m.at):(m[2]||'')}${me?' · '+m[3]:''}</div></div></div>`};
const pChat=id=>{const c=(typeof cvSrc==='function'?cvSrc():D.cv).find(x=>x.id==id);if(!c)return `<div class="pg">${sub('会话')}<div class="sc"><p class="em">找不到这个会话</p></div></div>`;const ms=(typeof msgSrc==='function'?msgSrc(id):D.m[id])||[];
return `<div class="pg">${sub(esc(c.n)+(c.g?`<span class="tag${c.projectId?' pjtag':''}">${c.projectId?'项目':'群聊'}</span>`:''),(c.projectId?`<button class="ib pjwsb" data-a="pjws" data-v="${esc(c.projectId)}" aria-label="项目工作台" title="项目工作台">${typeof v2i==='function'?v2i('board'):ic('more')}</button>`:'')+`<button class="ib" data-a="${c.g?'ginfo':'cvm'}" data-v="${id}" aria-label="更多">${ic('more')}</button>`)}${MODE==='account'?'':ban()}${c.g?'':(typeof e2eeChatBar==='function'?e2eeChatBar(c):'')}${c.g?pinbar('cv',id):''}<div class="sc msg">${ms.map(m=>bubble(m,c.g,id)).join('')||'<p class="em">'+(typeof usingNet==='function'&&usingNet()?'还没有消息，发一条吧':'发一条演示消息吧')+'</p>'}</div>${(S.typing&&S.typing[id]&&S.typing[id].until>Date.now())?'<p class="hint" style="padding:0 16px" data-typing="1">对方正在输入…</p>':''}${(S.replyTo&&S.replyTo.cid==id)?`<div class="qedit" id="qedit" data-rid="${esc(S.replyTo.id)}"><span>回复 ${esc(S.replyTo.preview||'')}</span><button type="button" class="pb s sm" data-a="replycancel">取消</button></div>`:''}${inbar('chin',(typeof usingNet==='function'&&usingNet()?'输入消息':'输入演示消息'),'send',id,cbTools('cv|'+id,c.g?'cv|chin|'+id:'',id))}</div>`};
const pEdit=()=>{const g=S.d.eg||'',acct=MODE==='account',row=(k,l)=>`<div class="row" style="padding:6px 0;background:none;border:0"><div class="gr"><b style="font-weight:600">${l}</b></div><button class="pb sm${S.d['v'+k]?'':' s'}" data-a="vis" data-v="${k}" aria-pressed="${!!S.d['v'+k]}">${S.d['v'+k]?'公开':'仅自己'}</button></div>`;
const avpick=`<span class="lab">头像</span><div class="fr" style="justify-content:flex-start;gap:12px;align-items:center;margin:6px 0 12px">${av('me',64)}<button type="button" class="pb sm s" data-a="cover">更换头像和背景</button></div>`;
return `<div class="pg" id="editp">${sub('编辑资料')}<div class="sc pad"><span class="lab">显示名（1–20 字）</span><input class="fld" data-d="en"><span class="lab">${acct?'账号（登录用户名，不可在此修改）':'账号（4–15 位小写字母、数字、下划线）'}</span><input class="fld" data-d="eh" autocapitalize="none" ${acct?'readonly':''}><span class="lab">简介（最多 80 字）</span><textarea class="fld" data-d="eb" rows="3"></textarea>${avpick}<span class="lab">性别</span><div class="sw" style="margin:6px 0 12px">${['男','女','其他',''].map(x=>`<button class="pb sm${g==x?'':' s'}" data-a="gen" data-v="${x}">${x||'不填'}</button>`).join('')}</div><span class="lab">生日</span><input class="fld" type="date" data-d="ebd"><div class="shd" style="padding:8px 0 4px">谁能看到</div>${row('bp','生日')}${row('ap','年龄')}${row('gp','性别')}<div class="fr"><button class="pb" data-a="saveedit">保存</button></div></div></div>`};
const pGi=id=>{const c=(typeof cvSrc==='function'?cvSrc():D.cv).find(x=>x.id==id);if(!c)return sub('群聊信息');const ow=c.own||'me',own=ow=='me',mine=gAdm(c),ids=(c.mem&&c.mem.includes('me')?c.mem:['me',...(c.mem||[])]);const nMem=c.memberCount!=null?c.memberCount:ids.length;
return `<div class="pg">${sub('群聊信息')}<div class="sc"><div class="pf pf2" style="padding-top:24px">${gface(c,80)}<h2 style="margin-top:8px">${esc(c.n)}</h2><small>${nMem} 位成员</small>${mine?`<div class="fr" style="margin-top:12px"><button class="pb s" data-a="grn" data-v="${id}">修改群名</button><button class="pb s" data-a="gav" data-v="${id}">更换群头像</button></div>`:''}</div><div class="shd">成员</div>${c.projectId?'':`<button class="row" style="width:100%;text-align:left;color:var(--ac);font-weight:600" data-a="gadd" data-v="${id}">＋ 添加成员</button>`}${ids.map(u=>`<div class="row" data-a="user" data-v="${u}">${av(u,40)}<div class="gr"><b class="nmb">${nmB(P(u),u=='me'?'我':null)}${gRole(c,u)!='成员'?`<span class="tag">${c.projectId?(gRole(c,u)=='群主'?'发起人':'负责人'):gRole(c,u)}</span>`:''}</b><small>@${P(u).h}</small></div>${mine&&u!='me'&&gRole(c,u)=='成员'||own&&u!='me'?`<button class="pb sm s" data-a="gmr" data-v="${id}|${u}">管理</button>`:''}</div>`).join('')}<div class="shd">我</div><button class="row" style="width:100%;text-align:left" data-a="gnick" data-v="${id}"><div class="gr"><b>我在本群的昵称</b><small>${esc(c.myNickname||'未设置，使用账号名')}</small></div></button><div style="padding:16px">${c.projectId?'':`<button class="pb d" style="width:100%" data-a="gleave" data-v="${id}">退出群聊</button>`}${own?`${c.projectId?'':`<button class="pb d" style="width:100%;margin-top:8px" data-a="gdis" data-v="${id}">解散群聊</button>`}`:''}<button class="pb s" style="width:100%;margin-top:8px" data-a="reportcv" data-v="${id}">举报群聊</button></div></div></div>`};
const pCmm=id=>{const c=cmp(id),rows=[...(c.j?[['me',c.r]]:[]),...Object.entries(c.mb||{})];
return `<div class="pg">${sub('成员')}<div class="sc"><p style="padding:12px 16px 0;color:var(--t2);font-size:13px">所有者可以设置管理员和版主，管理员可以设置版主；只能管理身份比自己低的成员。</p>${rows.map(([u,r])=>`<div class="row" data-a="user" data-v="${u}">${av(u,40)}<div class="gr"><b class="nmb">${nmB(P(u),u=='me'?'我':null)}<span class="tag">${r}</span></b><small>@${P(u).h}</small></div>${u!='me'&&canManage(c.r,r)?`<button class="pb sm s" data-a="rolem" data-v="${id}|${u}">管理</button>`:''}</div>`).join('')||'<p class="em">还没有成员</p>'}</div></div>`};
const INF={privacy:['隐私','你可以选择谁能看到资料：所有人、仅好友，或仅自己。邮箱在设置里会部分隐藏。一对一聊天会加密；群聊暂时还没有加密。'],security:['安全','密码经过保护，别人看不到原文。退出登录后，这台设备需要重新登录。一对一聊天的密钥只留在本机。'],help:['帮助','这是给你和朋友用的版本。登录后刷新页面仍会保持登录。演示内容和真实账号的内容分开存放，互不影响。'],about:['关于','VEXO\n支持账号、动态、社区、聊天、好友和图片视频。\n一对一聊天会加密后发送，群聊暂时还没有加密。请核对手友的安全号码。']};
const pSet=()=>{const t=D.st.theme,r=D.st.rm,s=D.st.sound!==0,h=D.st.haptic!==0,acct=MODE==='account'&&SESSION&&SESSION.user,held=MODE==='demo'&&SESSION&&SESSION.user;
const demoSwitch=(!demoDisabled()&&acct)?`<div class="row"><div class="gr"><b>切换到演示数据</b><small>和这个账号的本地内容分开保存，不会互相覆盖</small></div><button class="pb sm s" data-a="todemo">切换</button></div>`:'';
const who=NET?(acct?`<div class="row"><div class="gr"><b>真实账号</b><small>@${esc(SESSION.user.username)} · ${esc(maskEmail(SESSION.user.email))}${SESSION.user.vip?' · VIP':''}</small></div><button class="pb sm" data-a="logout">退出</button></div>`+demoSwitch:`<div class="row"><div class="gr"><b>${held?'演示数据（登录还在）':'演示数据'}</b><small>${held?'@'+esc(SESSION.user.username)+' 还登录着，可以回去':'未登录。内容只存在这台设备'}</small></div><button class="pb sm" data-a="toacct">${held?'回到账号':'登录'}</button></div>`):(demoDisabled()?`<div class="row"><div class="gr"><b>无法连接服务器</b><small>当前版本未开放本机演示。</small></div><button class="pb sm" data-a="retryconnect">重试</button></div>`:`<div class="row"><div class="gr"><b>当前是离线演示</b><small>没有连上服务器，所以不能登录。数据只在这台设备。</small></div></div>`);
return `<div class="pg">${sub('设置')}<div class="sc"><div class="shd">账号</div>${who}${typeof friendsRow==="function"?friendsRow():""}${vipRow()}${savedRow()}<div class="shd">外观与手感</div><div class="row"><div class="gr"><b>外观</b></div><div class="sw"><button class="pb${t=='dark'?'':' s'}" data-a="theme" data-v="dark">深色</button><button class="pb${t=='light'?'':' s'}" data-a="theme" data-v="light">浅色</button><button class="pb${t=='system'?'':' s'}" data-a="theme" data-v="system">跟随系统</button></div></div><div class="row"><div class="gr"><b>语言</b><small>只切换界面文字，用户发的内容不翻译</small></div><div class="sw" data-ut="1"><button class="pb${LANG==='zh'?'':' s'}" data-a="setlang" data-v="zh">简体中文</button><button class="pb${LANG==='en'?'':' s'}" data-a="setlang" data-v="en">English</button></div></div>${typeof uiSizeRow==='function'?uiSizeRow():''}${typeof skinRow==='function'?skinRow():''}<div class="row"><div class="gr"><b>减少动态效果</b><small>尊重系统偏好，关闭页面转场动画</small></div><button class="pb${r?'':' s'}" data-a="rm" aria-pressed="${!!r}">${r?'已开启':'已关闭'}</button></div><div class="row"><div class="gr"><b>按键音效</b><small>轻柔的点击、切换和发送提示音</small></div><button class="pb${s?'':' s'}" data-a="sound" aria-pressed="${s}">${s?'已开启':'已关闭'}</button></div><div class="row"><div class="gr"><b>按键震动</b><small>${esc(FEEL.cap())}</small></div><button class="pb${h?'':' s'}" data-a="haptic" aria-pressed="${h}">${h?'已开启':'已关闭'}</button></div><div class="row"><div class="gr"><b>试一试手感</b><small>点一下，听声音、感受震动</small></div><button class="pb sm s" data-a="feeltest">试一下</button></div><div class="shd">隐私与安全</div><button class="row" style="width:100%;text-align:left" data-a="priv" id="privrow"><div class="gr"><b>隐私</b><small>资料可见、好友请求等，保存在服务器</small></div><small>›</small></button><button class="row" style="width:100%;text-align:left" data-a="sec" id="secrow"><div class="gr"><b>账号安全</b><small>修改密码、登录设备、退出其他设备</small></div><small>›</small></button><div class="shd">关于</div><button class="row" style="width:100%;text-align:left" data-a="legal" data-v="privacy"><div class="gr"><b>隐私政策</b></div><small>›</small></button><button class="row" style="width:100%;text-align:left" data-a="legal" data-v="terms"><div class="gr"><b>用户协议</b></div><small>›</small></button>${['help','about'].map(k=>`<button class="row" style="width:100%;text-align:left" data-a="go" data-v="info:${k}"><div class="gr"><b>${INF[k][0]}</b></div></button>`).join('')}<div class="row"><div class="gr"><b>版本</b><small>当前运行的应用版本</small></div><small>${esc(typeof runningAppVersion==='function'?runningAppVersion():'')}</small></div><div class="row"><div class="gr"><b>重置当前数据</b><small>只清现在这个身份在本机的帖子和消息，不影响另一个身份，也不删除服务器账号</small></div><button class="pb sm d" data-a="resetq">重置</button></div><div class="card" style="padding:12px 16px;margin:8px 0"><b>VEXO</b><small style="display:block;margin-top:5px">${acct?'已登录。动态、社区和聊天会保存在账号里。':'演示内容只存在这台设备。'}一对一聊天会加密。群聊暂时还没有加密。</small></div></div></div>`};
function legalPh(html){return String(html||'').replace(/【待填：[^】]+】/g,m=>'<span class="legal-ph">'+m+'</span>')}
function legalMd(src){
  const escL=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const inline=t=>escL(t).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/`([^`]+)`/g,'<code>$1</code>');
  const lines=String(src||'').replace(/\r\n/g,'\n').split('\n');
  const out=[];let para=[],list=null;
  const flushP=()=>{if(!para.length)return;const t=para.join(' ').trim();para=[];if(t)out.push('<p>'+inline(t)+'</p>')};
  const flushL=()=>{if(!list)return;out.push('<ul>'+list.map(x=>'<li>'+inline(x)+'</li>').join('')+'</ul>');list=null};
  for(const raw of lines){
    const line=raw.trimEnd();
    if(!line.trim()){flushP();flushL();continue}
    const h=/^(#{1,3})\s+(.+)$/.exec(line);
    if(h){flushP();flushL();out.push('<h'+h[1].length+'>'+inline(h[2])+'</h'+h[1].length+'>');continue}
    const li=/^[-*]\s+(.+)$/.exec(line);
    if(li){flushP();if(!list)list=[];list.push(li[1]);continue}
    flushL();para.push(line.trim());
  }
  flushP();flushL();
  return legalPh(out.join('\n'));
}
const pHelp=()=>{
  const items=[
    ['账号与登录','<p>用用户名或邮箱和密码登录。忘记密码时，请通过《隐私政策》里的联系邮箱联系官方。</p><p>登录后刷新页面仍会保持登录。「我的」里可以编辑昵称、头像、封面和简介。设置里可以切换简体中文 / English，以及深色、浅色或跟随系统。</p>'],
    ['资料、隐私与账号安全','<p>「设置 → 隐私」可以控制谁能看你的资料、谁能加你好友，以及是否公开生日、年龄或性别。</p><p>「设置 → 账号安全」可以修改密码、查看并退出登录设备、导出我的数据，或注销账号。注销前请先导出需要保留的内容，注销后不能自行恢复。</p>'],
    ['发帖与动态','<p>首页点「+」发帖，可以添加最多 9 个照片或视频，也可以加心情、位置和好友标记。发帖前可选择可见范围。正文里写 #话题 会变成话题标签。</p><p>首页有「推荐」「关注」「热门话题」。下拉可以刷新，同时也会检查有没有新版本。「日常」显示在首页顶部，24 小时后消失，不计入帖子数。你可以对帖子表态、评论、收藏、转发和分享。自己帖子的「⋯」菜单里可以给帖子做「推流加热」。</p>'],
    ['聊天与加密','<p>「聊天」里有私聊、群聊和消息请求。互为好友才能直接私聊；不是好友时先发消息请求，对方接受后才能继续聊。</p><p>一对一私聊是端到端加密的，服务器只保存密文。群聊和社区频道目前没有端到端加密，请不要在里面发送只想给对方看的敏感信息。</p><p>输入栏「+」可以发相册、拍摄、语音、文件、表情和@提及。长按消息可以表态、回复、转发、复制、收藏、置顶、删除或举报，也可以翻译（中英文互译）。加密私聊里，只有你点了「翻译」才会把这一条文字发给 AI 翻译。</p>'],
    ['好友、关注与安全','<p>在别人的主页可以关注、加好友或发消息。遇到骚扰可以拉黑或举报，入口在主页或帖子的「⋯」菜单，举报由管理员处理。</p><p>不要轻信陌生人的转账、投资或站外链接。</p>'],
    ['社区','<p>「社区」标签里可以发现、加入或创建小组。小组有多个频道，可以在频道里发言。小组管理员可以管理频道和成员。</p>'],
    ['共创','<p>底部「共创」分为技能交换和共创项目。</p><p>技能交换：发布「我会什么 / 我想要什么」并选择分类。看到合适的人，点「咨询」会打开加密私聊，不必先加好友。也可以让 AI 根据你的发布来匹配。</p><p>共创项目：写明目标和需要的技能，他人申请、发起人同意后即可加入项目群聊，一起处理任务、公告和共享资料。项目完成后可以展示成果。</p>'],
    ['官方账号、投票与活动','<p>名字旁的蓝色「官方」或绿色「官方授权」标识，表示经过认证的账号。投票和活动只有这些账号能发起，普通用户可以参与投票或报名活动。每个投票每人只能投一次，投完即可看到结果。</p>'],
    ['VIP 会员','<p>当前价格为每月 ¥9.9、每年 ¥99，入口在「我的 → 会员中心」。付款后由管理员核对开通，不会自动扣款，也不会马上到账。VIP 提供更高的额度（例如更长的帖子、更多收藏和更大上传）以及专属装饰，基础功能始终免费。</p>'],
    ['通知、更新与小游戏','<p>应用会检查新版本，发现后询问你是否更新；下载完成可以立即重启生效，也可以等下次打开时生效。在首页下拉刷新，或从后台回到应用，也会检查更新。</p><p>「社区」页面有小游戏入口，例如 2048、扫雷。</p>'],
    ['需要人工帮助','<p>可以在聊天列表顶部询问「VEXO 助手」，也可以通过《隐私政策》中的联系邮箱联系运营者。请不要在对话里发送密码或验证码。</p>']
  ];
  const faqs=items.map((it,i)=>`<details class="faq-item"${i===0?' open':''}><summary>${it[0]}</summary><div class="faq-body">${it[1]}</div></details>`).join('');
  return `<div class="pg legal-pg">${sub('帮助')}<div class="sc legal-doc"><p class="legal-lead">这里汇总了 VEXO 的常用做法。更具体的问题也可以问聊天列表顶部的「VEXO 助手」。助手的回答仅供参考。</p><div class="faq">${faqs}</div></div></div>`;
};
const pAbout=()=>{
  const d=(S.legal&&S.legal.privacy)||{};
  const ver=esc(typeof runningAppVersion==='function'?runningAppVersion():'');
  return `<div class="pg legal-pg">${sub('关于')}<div class="sc about-page">
    <div class="about-hero">
      <img class="about-lockup dark-only" src="assets/brand/vexo-lockup.png" alt="VEXO">
      <img class="about-lockup light-only" src="assets/brand/vexo-lockup-light.png" alt="VEXO">
      <p class="about-tag">Beyond Connection.</p>
      <p class="about-ver">版本 ${ver||'—'}</p>
    </div>
    <div class="about-card">
      <p>VEXO 提供账号、动态、社区、聊天、好友、共创和可选的会员服务。</p>
      <p class="muted">一对一私聊会在设备上加密后发送，服务器只保存密文。群聊和社区频道暂时没有端到端加密。</p>
    </div>
    <div class="about-links">
      <button type="button" data-a="legal" data-v="privacy"><span>隐私政策</span><small>›</small></button>
      <button type="button" data-a="legal" data-v="terms"><span>用户协议</span><small>›</small></button>
      <button type="button" data-a="go" data-v="info:help"><span>帮助</span><small>›</small></button>
    </div>
    <p class="about-fine">运营者：${legalPh(esc((d&&d.operatorName)||'【待填：公司全称或运营者姓名】'))}<br>联系邮箱：${legalPh(esc((d&&d.contactEmail)||'【待填：联系邮箱】'))}<br>本页版本号来自当前实际运行的应用包，与设置页「版本」一致。</p>
  </div></div>`;
};
const pInfo=k=>k==='help'?pHelp():k==='about'?pAbout():`<div class="pg">${sub((INF[k]&&INF[k][0])||'说明')}<div class="sc"><p style="padding:16px;white-space:pre-line">${(INF[k]&&INF[k][1])||''}</p></div></div>`;
const pLegal=k=>{
  const d=(S.legal&&S.legal[k])||{};
  const short=k==='terms'?'用户协议':'隐私政策';
  const title=d.title||short;
  let body=d.html||(d.body?legalMd(d.body):'<p class="legal-lead">正在加载…</p>');
  body=String(body).replace(/^\s*<h1>[\s\S]*?<\/h1>\s*/,'');
  const meta=[d.operatorName?('运营者：'+esc(d.operatorName)):'',d.effectiveDate?('生效日期：'+esc(d.effectiveDate)):'',d.version?('版本 '+esc(d.version)):''].filter(Boolean);
  return `<div class="pg legal-pg">${sub(esc(short))}<div class="sc legal-doc">${meta.length?'<div class="legal-meta">'+legalPh(meta.join('<br>'))+'</div>':''}${body}</div></div>`;
};


const MOODS=['开心','兴奋','幸福','感恩','放松','思考','想旅行','在工作','想吃饭','运动中','难过','疲惫'];
function compState(){S.comp=S.comp||{media:[],aud:'public',mood:'',loc:'',tags:[]};return S.comp}
function saveComposeDraft(){try{const c=compState();localStorage.setItem('nova_compose_draft',JSON.stringify({text:S.d.pin||'',aud:c.aud,mood:c.mood,loc:c.loc,tags:c.tags}))}catch(e){}}
function loadComposeDraft(){try{const d=JSON.parse(localStorage.getItem('nova_compose_draft')||'null');if(!d)return;S.d.pin=S.d.pin||d.text||'';const c=compState();if(!c._inited){c.aud=d.aud||'public';c.mood=d.mood||'';c.loc=d.loc||'';c.tags=d.tags||[];c._inited=1}}catch(e){}}
function clearComposeDraft(){try{localStorage.removeItem('nova_compose_draft')}catch(e){}S.comp={media:[],aud:'public',mood:'',loc:'',tags:[]};S.d.pin=''}
const pCompose=()=>{loadComposeDraft();const c=compState(),mx=typeof textLimit==='function'?textLimit('post'):500,aud=AUD_L[c.aud]||'公开',me=P('me');
const media=c.media||[];
const grid=media.length||true?`<div class="cmg">${media.map((m,i)=>`<div class="cmgi">${m.kind==='video'?`<video src="${esc(m.url)}" muted playsinline preload="metadata"></video><i class="vtag">视频</i>`:`<img src="${esc(m.url)}" alt="">`}<button class="x" data-a="delimg" data-v="${i}" aria-label="删除">×</button><div class="ord">${i?`<button data-a="movimg" data-v="${i}|-1" aria-label="前移">‹</button>`:''}${i<media.length-1?`<button data-a="movimg" data-v="${i}|1" aria-label="后移">›</button>`:''}</div></div>`).join('')}${media.length<9?`<button type="button" class="addph" data-a="addimg">${typeof icLine==='function'?icLine('camera'):''}<span>照片 / 视频</span></button>`:''}</div>`:'';
const chips=[c.mood?`<span class="chip">😊 ${esc(c.mood)}<button data-a="clrmood" aria-label="清除">×</button></span>`:'',c.loc?`<span class="chip">📍 ${esc(c.loc)}<button data-a="clrloc" aria-label="清除">×</button></span>`:'',(c.tags||[]).map((id,i)=>`<span class="chip">👤 ${esc(P(id).n)}<button data-a="clrtag" data-v="${i}">×</button></span>`).join('')].filter(Boolean);
/* r7：只有照片/视频、没有文字也能发 */
const canPub=typeof ok==='function'?(ok(S.d.pin||'',mx)||((media.length>0||c.poll||c.act)&&len(S.d.pin||'')<=mx)):!!(S.d.pin||'').trim()||media.length;
return `<div class="pg compose-pg"><div class="top sub"><button class="ib tx" data-a="compx">取消</button><h1>创建帖子</h1><button class="pb${canPub?'':' off'}" data-a="pub" data-for="pin" ${canPub?'':'disabled'}>发布</button></div><div class="sc compose"><div class="cwho">${av('me',48)}<div class="gr"><b>${esc(me.n||'我的账号')}</b><button type="button" class="aud" data-a="audpick">${aud} ▾</button></div></div><textarea class="cta" data-d="pin" data-max="${mx}" data-af rows="6" placeholder="你现在有什么想分享的？"></textarea><div class="cchips">${chips.join('')}</div>${typeof v2ComposeAtt==='function'?v2ComposeAtt(c):''}${grid}<div class="ctools"><button data-a="addimg">${icLine('photo')}<span>照片 / 视频</span></button><button data-a="tagfr">${icLine('tag')}<span>标记好友</span></button><button data-a="addmood">${icLine('mood')}<span>添加心情</span></button><button data-a="addloc">${icLine('loc')}<span>添加位置</span></button>${typeof v2ComposeTools==='function'?v2ComposeTools(c):''}</div><p class="lab" style="text-align:right" data-cnt="pin"></p></div></div>`};
const page=cur=>{const[t,a,b]=cur.split(':');if(typeof V2P!=='undefined'&&V2P[t])return V2P[t](a,b);return t=='story'?pStory(a,b):t=='storynew'?pStoryNew():t=='games'?pGames():t=='game'?pGame(a):t=='compose'?pCompose():t=='post'?pPost(a):t=='user'?pUser(a):t=='fl'?pFl(a,b):t=='cm'?pCm(a):t=='chat'?pChat(a):t=='gi'?pGi(a):t=='cmm'?pCmm(a):t=='edit'?pEdit():t=='vip'?pVip():t=='saved'?pSaved():t=='priv'?pPriv():t=='sec'?pSec():t=='set'?pSet():t=='friends'?pFriends():t=='legal'?pLegal(a):pInfo(a)};
