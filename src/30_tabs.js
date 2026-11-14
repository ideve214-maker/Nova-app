/* ---- tabs ---- */
const tHome=()=>{const fl=typeof followingIds==='function'&&followingIds()?followingIds():D.f.filter(e=>e[0]=='me').map(e=>e[1]),src=typeof feedSrc==='function'?feedSrc():D.p,loading=usingNet()&&!Array.isArray(S.posts);
const base=src.filter(p=>S.feed=='rec'||S.feed=='topic'||p.a=='me'||fl.includes(p.a));
const L=S.feed=='topic'&&!S.hotMode?base.filter(p=>(p.hashtags&&p.hashtags.length)||(p.x&&p.x.includes('#'))):base;
/* r7：顶部一排只放「发日常」和有日常的人（日常独立于帖子，见 75_r7.js） */
const stories=()=>typeof storyStrip==='function'?storyStrip():'';
return `<div class="pg home${S._hc?' hc':''}"><div class="top"><h1 class="br">${typeof brandTitle==='function'?brandTitle():'VEXO'}</h1><button class="ib" data-a="compose" aria-label="发帖">${ic('plus')}</button><button class="ib" data-a="search" aria-label="搜索">${ic('search')}</button><button class="ib" data-a="notif" aria-label="通知">${ic('bell')}${(typeof nSrc==='function'?nSrc():D.n).some(n=>n.u)?'<i class="dot"></i>':''}</button></div>
${modeChip()}
<div class="hcol"><div class="hcoli">${stories()}
<div class="comp"><span data-a="user" data-v="me">${av('me',40)}</span><button class="p" data-a="compose">分享一下你的新鲜事</button><button class="ib" data-a="compose" aria-label="添加照片" style="color:var(--ac)">${ic('image')}</button></div></div></div>
<div class="seg feed-seg"><button data-a="feed" data-v="rec" class="${S.feed=='follow'||S.feed=='topic'?'':'on'}">为你推荐</button><button data-a="feed" data-v="follow" class="${S.feed=='follow'?'on':''}">正在关注</button><button data-a="feed" data-v="topic" class="${S.feed=='topic'?'on':''}">热门话题</button></div>
<div class="sc">
${loading&&!S.postsErr?'<p class="em">正在读取动态…</p>':S.postsErr?`<p class="em">${esc(S.postsErr)}</p>`:L.length?L.map(p=>pc(p)).join(''):`<p class="em" id="feedempty">${S.feed=='topic'?'还没有热门话题':S.feed=='follow'?'你还没有关注任何人':'推荐里还没有帖子'}</p>`}${usingNet()&&S.postsCursor?`<div style="padding:16px"><button class="pb s" style="width:100%" data-a="morefeed" id="morefeed">加载更多</button></div>`:''}</div><button class="totop${S._tt?' on':''}" type="button" aria-label="回到顶部" tabindex="${S._tt?0:-1}" aria-hidden="${S._tt?'false':'true'}"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></svg></button></div>`};
function cmView(){try{const v=localStorage.getItem('nova_cm_view');return (v==='2'||v==='4'||v==='1')?v:'1'}catch(e){return '1'}}
function setCmView(v){const n=(v==='2'||v==='4'||v==='1')?v:'1';try{localStorage.setItem('nova_cm_view',n)}catch(e){}return n}
function cycleCmView(){const o=['1','2','4'],c=cmView();return setCmView(o[(o.indexOf(c)+1)%3])}
const CMVIEW_L={1:'单视图',2:'双视图',4:'四视图'};
function fmtMembers(n){n=Math.max(0,Number(n)||0);if(n>=10000){const w=n/10000,s=w>=10?String(Math.round(w)):String(Math.round(w*10)/10);return s+' 万位成员'}return n+' 位成员'}
const gcard=c=>{
  const vis=c.vis||c.visibility||'public';
  const priv=vis==='private';
  const joined=!!c.j;
  const pending=!!c.pending||c.joinStatus==='pending';
  const plus=typeof icLine==='function'?icLine('plus'):'+';
  const compact=cmView()==='4';
  const down=c.status==='taken_down';
  const open=down?'cmappeal':'cm';
  const btn=down?`<button class="pb" data-a="cmappeal" data-v="${c.id}">提交申诉</button>`:joined?`<button class="pb s" data-a="cm" data-v="${c.id}">${compact?'已加入':'已加入'}</button>`:pending?`<button class="pb s" disabled>${compact?'已申请':'已申请'}</button>`:priv?`<button class="pb" data-a="cmapply" data-v="${c.id}">${compact?'申请':'申请加入'}</button>`:`<button class="pb" data-a="join" data-v="${c.id}">${compact?plus:plus+' 加入小组'}</button>`;
  const cov=typeof bgCss==='function'?bgCss((c.bg||(typeof cove==='function'?cove(c.id):''))):'';
  return `<article class="gcard"><button type="button" class="gcover" style="${cov}" data-a="${open}" data-v="${c.id}" aria-label="${esc(c.n)}"></button><div class="gbody"><b data-a="${open}" data-v="${c.id}">${esc(c.n)}</b><div class="gmeta">${down?'已下架':priv?'私密小组':'公开小组'} · ${fmtMembers(c.m)}</div><div class="gintro">${esc(c.d||'')}</div>${btn}</div></article>`;
};
const gameCard=()=>{const G=typeof GAMES!=='undefined'?GAMES:[];const ic5=G.slice(0,5).map(g=>`<i>${typeof gameIcon==='function'?gameIcon(g.id):''}</i>`).join('');return `<button type="button" class="gmini" data-a="minigame"><span class="ico">${typeof icLine==='function'?icLine('game'):'▶'}</span><span class="gr"><b>小游戏</b><small>${G.length||11} 款小游戏，不用下载，点开就能玩</small>${ic5?`<span class="gicons">${ic5}</span>`:''}</span></button>`};

const cml=()=>{const q=S.cq.trim().toLowerCase(),src=typeof cmSrc==='function'?cmSrc():D.cm;
let L;
/* r7：三栏——发现（全部）、已加入（所有已加入的小组，包括自己管理的）、我管理的（所有者/管理员）；三栏都能搜索 */
const hit=c=>!q||(c.n+(c.d||'')).toLowerCase().includes(q);
if(S.cs=='m')L=src.filter(c=>c.j&&(c.r=='所有者'||c.r=='管理员')&&hit(c));
else if(S.cs=='j')L=src.filter(c=>!!c.j&&hit(c));
else L=src.filter(hit);
L.sort((a,b)=>(b.pin||0)-(a.pin||0));
if(!L.length)return `<p class="em">${q?'没有匹配的小组':S.cs=='m'?'你还没有管理的小组':S.cs=='j'?'还没有加入小组':'还没有小组'}</p>`;
return `<div class="ggrid v${cmView()}">${L.map(gcard).join('')}</div>`};
const tCm=()=>`<div class="pg"><div class="top"><h1>小组</h1><button class="ib" data-a="cmview" aria-label="${CMVIEW_L[cmView()]}" title="${CMVIEW_L[cmView()]}">${typeof icLine==='function'?icLine('grid'+cmView()):ic('more')}</button><button class="ib" data-a="search" aria-label="搜索">${ic('search')}</button><button class="ib" data-a="newcm" aria-label="创建">${ic('plus')}</button></div><div class="seg"><button data-a="cmseg" data-v="d" class="${S.cs=='d'?'on':''}">发现</button><button data-a="cmseg" data-v="j" class="${S.cs=='j'?'on':''}">已加入</button><button data-a="cmseg" data-v="m" class="${S.cs=='m'?'on':''}">我管理的</button></div><div class="sc">${gameCard()}<div style="padding:8px 16px 0"><input class="fld" id="cq" placeholder="搜索小组" value="${esc(S.cq)}"></div>${S.cs=='d'?`<div class="jcard"><input class="fld" data-d="jcode" placeholder="邀请码" value="${esc(S.d.jcode||'')}"><button class="pb sm" data-a="joincode">加入</button></div>`:''}<div id="cl">${cml()}</div></div></div>`;
const last=id=>{if(typeof usingNet==='function'&&usingNet()){const cv=(typeof cvSrc==='function'?cvSrc():[]).find(z=>z.id==id);if(cv&&cv.last){const tx=cv.last.encrypted?(cv.last.text||(S.e2eePlain&&S.e2eePlain[cv.last.id])||'［加密消息］'):(cv.last.text||'');return {x:typeof tx==='string'?tx:'［加密消息］',t:typeof ago==='function'?ago(cv.last.createdAt):''}};const a=typeof msgSrc==='function'?msgSrc(id):[];const m=a[a.length-1];return m?{x:m[4],t:(typeof fmtTime==='function'&&m.at)?fmtTime(m.at):m[2]}:{x:'',t:''}}const a=D.m[id]||[],m=a[a.length-1];return m?{x:m[1]=='i'?'图片':m[1]=='v'?'语音':m[1]=='k'?stkLabel(m[4]):m[4],t:m[2]}:{x:'',t:''}};
const rowc=(c,hd)=>{const l=last(c.id),at=c.u>0&&(D.m[c.id]||[]).slice(-c.u).some(m=>m[0]!='me'&&String(m[4]).includes('@所有人')),W=c.g?216:288;
const row=`<div class="row swc" data-w="${W}" data-a="${hd?'unhide':'conv'}" data-v="${c.id}">${c.g?gface(c,48):av(c.mem[0],48)}<div class="gr"><b>${c.pin?'📌 ':''}${esc(c.n)}${c.g?'<span class="tag">群聊</span>':''}${c.mute?' 🔕':''}</b><small>${at?'<span style="color:var(--dg)">[@所有人] </span>':''}${esc(l.x)}</small></div><div style="text-align:right"><small>${hd?'点击恢复':l.t}</small>${c.u&&!hd?`<br><i class="bdg" style="position:static;display:inline-block${c.mute?';background:var(--t3)':''}">${c.u}</i>`:''}</div>${hd?'':`<button class="ib" data-a="cvm" data-v="${c.id}" aria-label="更多">${ic('more')}</button>`}</div>`;
return hd?row.replace(' swc"','"'):`<div class="swr"><div class="swa">${[['cvpin',c.pin?'取消置顶':'置顶','#2D88FF'],['cvmute',c.mute?'取消静音':'静音','#E8870E'],['cvhide','隐藏','#737985'],...(c.g?[]:[['cvdel','删除','#D4655A']])].map(a=>`<button style="background:${a[2]}" data-a="${a[0]}" data-v="${c.id}">${a[1]}</button>`).join('')}</div>${row}</div>`};
const xl=()=>{const q=S.xq.trim().toLowerCase(),V=(typeof cvSrc==='function'?cvSrc():D.cv).filter(c=>!c.hid&&(!q||(c.n+last(c.id).x).toLowerCase().includes(q))).sort((a,b)=>(b.pin||0)-(a.pin||0)),H=(typeof cvSrc==='function'?cvSrc():D.cv).filter(c=>c.hid);return (V.length?V.map(c=>rowc(c)).join(''):`<p class="em">${q?'没有匹配结果':'没有会话'}</p>`)+(H.length&&!q?`<button class="nope" style="width:100%" data-a="showhid">${S.sh2?'收起已隐藏的会话':'已隐藏的会话 '+H.length}</button>${S.sh2?H.map(c=>rowc(c,1)).join(''):''}`:'')};
const tChat=()=>{const net=typeof usingNet==='function'&&usingNet()&&SESSION;
const reqs=net?(S.msgReqs||[]):(D.rq||[]).filter(r=>r.s=='p'||!r.s);
const np=net?(S.mreqCount||reqs.length):reqs.length;let h;
if(S.cseg=='in')h=`<div style="padding:8px 16px 0"><input class="fld" id="xq" placeholder="搜索" value="${esc(S.xq)}"></div><div id="xl">${xl()}</div>`;
else {
  const card=r=>{
    if(net){
      const u=r.sender||r.other||{},uid=String(r.senderId||(u.id)||'');
      const name=u.displayName||u.username||P(uid).n;
      const handle=u.username||P(uid).h||'';
      const common=[r.mutualFriends?r.mutualFriends+' 位共同好友':'',r.mutualCommunities?r.mutualCommunities+' 个共同社区':''].filter(Boolean).join(' · ');
      const t=typeof fmtTime==='function'&&r.lastAt?fmtTime(r.lastAt):'';
      const more=r.previews&&r.previews.length>1?r.previews.slice(1).map(p=>`<small style="display:block">${esc(p.text)}</small>`).join(''):'';
      return `<div class="mrcard"><div class="row" style="border:0;align-items:flex-start">${av(uid,48)}<div class="gr"><b>${esc(name)}</b><small>@${esc(handle)}</small>${common?`<small>${esc(common)}</small>`:''}<small>${esc(r.lastMessage||r.firstMessage||'')}</small>${more}<small>${esc(t)}</small></div></div><div class="sw" style="padding:0 16px 12px;justify-content:flex-end"><button class="pb sm" data-a="mracc" data-v="${r.id}">接受</button><button class="pb sm s" data-a="mrdel" data-v="${r.id}">删除</button><button class="ib" data-a="mrmore" data-v="${r.id}" aria-label="更多">${ic('more')}</button></div></div>`;
    }
    return `<div class="row">${av(r.u,48)}<div class="gr"><b>${esc(P(r.u).n)}</b><small>${esc(r.x)}</small><small>${r.t||''}</small></div>${r.s=='p'||!r.s?`<div class="sw"><button class="pb sm" data-a="acc" data-v="${r.id}">接受</button><button class="pb sm s" data-a="rej" data-v="${r.id}">删除</button></div>`:`<small>${r.s=='a'?'已接受':'已拒绝'}</small>`}</div>`;
  };
  h=reqs.length?reqs.map(card).join(''):(S.msgReqErr?`<p class="em">${esc(S.msgReqErr)}</p>`:'<p class="em">没有消息请求</p>');
}
return `<div class="pg"><div class="top"><h1>聊天</h1><button class="ib" data-a="newg" aria-label="新建群聊">${ic('plus')}</button></div>${ban()}<div class="seg"><button data-a="seg" data-v="in" class="${S.cseg=='in'?'on':''}">消息</button><button data-a="seg" data-v="rq" class="${S.cseg=='rq'?'on':''}">消息请求${np?`<i class="bdg" style="position:static;display:inline-block;margin-left:6px;vertical-align:middle">${np>99?'99+':np}</i>`:''}</button></div><div class="sc">${h}</div></div>`};
const age=b=>{const d=new Date(b),n=new Date();let a=n.getFullYear()-d.getFullYear();if(n<new Date(n.getFullYear(),d.getMonth(),d.getDate()))a--;return a};
const info=id=>{const f=D.pf[id];if(!f)return[];const me=id=='me',w=k=>me||f[k],t=k=>me&&!f[k]?'（仅自己可见）':'',r=[];if(f.b&&w('bp'))r.push('🎂 出生于 '+f.b.replace(/^(\d+)-(\d+)-(\d+)$/,'$1年$2月$3日')+t('bp'));if(f.b&&w('ap'))r.push('🎈 '+age(f.b)+' 岁'+t('ap'));if(f.g&&w('gp'))r.push('👤 '+f.g+t('gp'));return r};
const prof=id=>{const u=P(id),me=id=='me',n=k=>{if(typeof usingNet==='function'&&usingNet()){const c=me?S.followCounts:S.userSocial;if(c)return k==0?(c.following||c.followingCount||0):(c.followers||c.followerCount||0)}return D.f.filter(e=>e[k]==id).length},f=typeof isFollowed==='function'?isFollowed(id):fol('me',id),IN=info(id),fl=(typeof usingNet==='function'&&usingNet()?(id=='me'?(S.following||[]):(S.userFollowing||[])):D.f.filter(e=>e[0]==id).map(e=>e[1]));
const tab=S.mt==='photos'?'photos':'all';
const posts=(typeof postsOf==='function'?postsOf(id):D.p.filter(p=>p.a==id));
const photos=posts.filter(p=>p.media&&p.media.length);
const dec=me&&typeof vipDecoOn==='function'&&vipDecoOn();
const acts=me?`<div class="fr"><button class="pb" data-a="panel">面板</button><button class="pb s" data-a="compose">创建</button></div>`:`<div class="fr"><button class="pb${f?' s':''}" data-a="fol" data-v="${id}">${f?'已关注':'关注'}</button>${typeof friendBtns==='function'?friendBtns(id):''}${id=='notice'?'':`<button class="pb s" data-a="dm" data-v="${id}">消息</button>`}${typeof safetyBtns==='function'?safetyBtns(id):''}</div>`;
const ov=`<div class="card" style="padding:12px 16px"><div class="fr" style="justify-content:space-between;padding:0"><b style="font-size:17px">总览</b>${me?'<button class="lk" data-a="edit" style="color:var(--ac)">查看全部</button>':''}</div>${IN.length?IN.map(x=>`<div class="ln2">${x}</div>`).join(''):'<small>还没有公开的资料</small>'}</div>`;
const photoGrid=photos.length?`<div class="fmedia n2 prof-ph" style="margin:8px 0">${photos.flatMap(p=>(p.media||[]).map(m=>{const x=typeof mItem==='function'?mItem(m):(typeof m==='string'?{url:m}:m);const src=x.url?` src="${esc(x.url)}"`:x.id?` data-mid="${esc(x.id)}"`:'';if(!src)return '';return (typeof mKind==='function'&&mKind(x)==='video')?`<span class="mv" data-a="post" data-v="${p.id}"><video${src} muted playsinline preload="metadata"></video></span>`:`<img${src} alt="" data-a="post" data-v="${p.id}">`})).join('')}</div>`:'<p class="em">还没有照片或视频</p>';
const body=tab==='photos'?photoGrid:`${ov}${fl.length?`<div class="card"><div class="fr" style="justify-content:space-between;padding:12px 16px 0"><b style="font-size:17px">好友 / 关注</b><button class="lk" data-a="fl" data-v="following|${id}" style="color:var(--ac)">查看全部</button></div><div class="ppl" style="border:0">${fl.map(i=>`<button data-a="user" data-v="${i}">${av(i,52)}<span>${esc(P(i).n)}</span></button>`).join('')}</div></div>`:''}${me?`<div class="comp"><span>${av('me',40)}</span><button class="p" data-a="compose">分享一下你的新鲜事</button></div>`:''}${posts.map(p=>pc(p)).join('')||'<p class="em">这里还没有内容</p>'}`;
return `<div class="cvr tall${dec?' dec':''}"${dec?' data-dec="gold"':''} style="${bgCss(me?meCover():cove(id))}">${me?'<button class="cam" data-a="cover">更换背景</button>':''}</div><div class="pf ovl${dec?' dec':''}"${dec?' data-dec="gold"':''}><div class="avw ovl${dec?' dec':''}"${dec?' data-dec="gold"':''}>${av(id,80)}${me?'<button class="cam" data-a="cover" aria-label="更换头像">更换头像</button>':''}</div>${dec?'<span class="pdec" data-dec="gold" role="img" aria-label="VEXO VIP 资料装饰"></span>':''}<h2>${esc(u.n)}${u.v?' '+vipBadge():''}</h2><div class="handle">@${u.h}</div>${u.b?`<p class="bio">${esc(u.b)}</p>`:''}<div class="sts r7"><span><b>${posts.length}</b>帖子</span><button data-a="fl" data-v="followers|${id}"><b>${n(1)}</b>粉丝</button><button data-a="fl" data-v="following|${id}"><b>${n(0)}</b>关注</button></div>${acts}</div><div class="seg"><button data-a="mt" data-v="all" class="${tab=='all'||tab=='about'?'on':''}">全部</button><button data-a="mt" data-v="photos" class="${tab=='photos'?'on':''}">照片</button></div>${body}`};
const tMe=()=>`<div class="pg"><div class="top"><h1>@${P('me').h}</h1><button class="ib" data-a="go" data-v="set" aria-label="设置" style="font-size:14px;width:auto;padding:0 12px;border-radius:22px">设置</button></div><div class="sc">${prof('me')}</div></div>`;
