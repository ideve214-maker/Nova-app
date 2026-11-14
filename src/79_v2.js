/* ===== VEXO 2.0：共创（技能交换 + 共创项目）、官方投票与活动 ===== */
const V2EN=()=>typeof LANG!=='undefined'&&LANG==='en';
const v2on=()=>typeof usingNet==='function'&&usingNet()&&!!SESSION;
const v2e=(r,d)=>typeof errMsg==='function'?errMsg(r,d):((r&&r.j&&r.j.error&&r.j.error.message)||d);
const v2rr=()=>{if(typeof render==='function')render()};
const v2me=()=>P('me');
const v2aid=a=>{if(!a)return '';if(typeof rememberAuthor==='function')rememberAuthor(a);return SESSION&&SESSION.user&&Number(SESSION.user.id)===Number(a.id)?'me':String(a.id)};
Object.assign(ICL,{
  poll:'<path d="M5 20V10M12 20V4M19 20v-7"/>',
  event:'<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  share:'<path d="M12 15V3.5M7.5 8 12 3.5 16.5 8"/><path d="M5 12.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5.5"/>',
  link:'<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  file:'<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M14 3.5v5h5"/>',
  chat2:'<path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4A8 8 0 1 1 20 12z"/>',
  check:'<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  board:'<rect x="3.5" y="4" width="17" height="16" rx="2.5"/><path d="M9 4v16M9 9.5h11.5"/>',
  pin2:'<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  globe:'<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.6 5.4 3.6 8.5s-1.1 5.9-3.6 8.5c-2.5-2.6-3.6-5.4-3.6-8.5S9.5 6.1 12 3.5z"/>',
  users:'<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.6-3 2.8-4.8 5.5-4.8s4.9 1.8 5.5 4.8"/><path d="M15.5 5.6a3 3 0 0 1 0 5.8M17.6 14.6c1.6.6 2.6 2.2 2.9 4.4"/>'
});
IC.spark='M12 2.5l2.1 6.4 6.4 2.1-6.4 2.1L12 19.5l-2.1-6.4L3.5 11l6.4-2.1zM19 16l.9 2.6 2.6.9-2.6.9L19 23l-.9-2.6-2.6-.9 2.6-.9z';
const v2i=n=>typeof icLine==='function'?icLine(n):'';

/* ---- 时间 ---- */
const V2MO=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function v2when(ms){if(!ms)return '';const d=new Date(Number(ms)),p=n=>String(n).padStart(2,'0'),hm=p(d.getHours())+':'+p(d.getMinutes()),same=new Date().getFullYear()===d.getFullYear();
  if(V2EN())return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]+', '+V2MO[d.getMonth()]+' '+d.getDate()+(same?'':' '+d.getFullYear())+' '+hm;
  return (same?'':d.getFullYear()+'年')+(d.getMonth()+1)+'月'+d.getDate()+'日 '+['周日','周一','周二','周三','周四','周五','周六'][d.getDay()]+' '+hm}
function v2dtv(ms){if(!ms)return '';const d=new Date(Number(ms)),p=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes())}
function v2ms(v){if(!v)return null;const t=new Date(v).getTime();return Number.isFinite(t)?t:null}
const v2ago=ms=>typeof ago==='function'?ago(ms):'';
const v2num=(n,zh,en)=>V2EN()?`${n} ${en}`:`${n} ${zh}`;

/* ---- 分享（2.0.1 重做）：微信不接受只有文字的系统分享（会提示「不支持的分享类型」），所以一律分享链接。
   链接指向服务器上的公开只读页：/p/<项目> /x/<技能交换> /e/<活动>（见 server/share-page.mjs）。
   顺序：系统分享面板（标题 + 链接，不再塞长文字）→ 不支持或失败时复制链接。
   withCard=true 时，如果系统支持分享图片文件（navigator.canShare({files})），先生成一张分享卡片图片和链接一起给面板；
   失败（包括微信不收图片 + 链接的组合）就退回只分享链接。 */
function v2shareBase(){const strip=u=>String(u||'').trim().replace(/[#?].*$/,'').replace(/\/+$/,'');
  try{const u=window.NOVA_SHARE_URL||'';if(/^https?:\/\//i.test(u))return strip(u)}catch(e){}
  try{const b=typeof apiBase==='function'?apiBase():'';if(/^https?:\/\//i.test(b))return strip(b)}catch(e){}
  try{if(/^https?:$/.test(location.protocol))return strip(location.origin)}catch(e){}
  return ''}
function v2shareLink(kind,id){const b=v2shareBase();return b?b+'/'+kind+'/'+encodeURIComponent(id):''}
async function v2copyLink(url,title){
  const t=url||title||'';
  const ok=typeof copyText==='function'?await copyText(t):await (async()=>{try{await navigator.clipboard.writeText(t);return true}catch(e){return false}})();
  T(ok?(url?'已复制链接，可以粘贴到微信发给好友':'已复制'):'复制失败，请稍后再试')}
async function v2cardFile(title,lines){
  try{
    if(typeof document==='undefined'||typeof File==='undefined')return null;
    const W=1080,H=1080,c=document.createElement('canvas');c.width=W;c.height=H;const g=c.getContext('2d');if(!g)return null;
    const gr=g.createLinearGradient(0,0,W,H);gr.addColorStop(0,'#4F6EF7');gr.addColorStop(1,'#8A5CF6');g.fillStyle=gr;g.fillRect(0,0,W,H);
    g.fillStyle='rgba(255,255,255,.96)';const r=48,x=60,y=60,w=W-120,h=H-120;g.beginPath();g.moveTo(x+r,y);g.arcTo(x+w,y,x+w,y+h,r);g.arcTo(x+w,y+h,x,y+h,r);g.arcTo(x,y+h,x,y,r);g.arcTo(x,y,x+w,y,r);g.closePath();g.fill();
    const F='"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif';
    const wrap=(t,font,max,lh,yy,color,maxL)=>{g.font=font;g.fillStyle=color;let line='',n=0;for(const ch of [...String(t||'')]){if(g.measureText(line+ch).width>max){g.fillText(line,120,yy);yy+=lh;line=ch;if(++n>=maxL-1){line=line+'…';break}}else line+=ch}if(line){g.fillText(line,120,yy);yy+=lh}return yy};
    g.font='bold 40px '+F;g.fillStyle='#4F6EF7';g.fillText('VEXO',120,170);
    let yy=wrap(title,'bold 68px '+F,W-240,88,290,'#13151C',3)+20;
    for(const l of lines.filter(Boolean).slice(0,4))yy=wrap(l,'40px '+F,W-240,56,yy,'#5C6478',3)+14;
    g.font='34px '+F;g.fillStyle='#8A90A2';g.fillText(V2EN()?'Open the link to view · VEXO':'打开链接查看 · VEXO',120,H-140);
    const blob=await new Promise(res=>c.toBlob(res,'image/png'));if(!blob)return null;
    return new File([blob],'vexo-share.png',{type:'image/png'});
  }catch(e){return null}
}
/* 分享入口：先弹一个小菜单——分享链接（推荐，微信可用）/ 分享图片卡片（系统支持图片分享时才显示）/ 复制链接。
   不把图片和链接混在一次分享里：微信收到「图片 + 链接」或「纯文字」都会提示「不支持的分享类型」，而且这时 navigator.share 已经成功返回，没法再退回。 */
function v2canFiles(){try{if(!navigator.share||!navigator.canShare||typeof File==='undefined')return false;return navigator.canShare({files:[new File([new Uint8Array(8)],'t.png',{type:'image/png'})]})}catch(e){return false}}
async function v2share(title,text,url,opt){
  S.v2shp={title,text,url,lines:(opt&&opt.lines)||[text]};
  S.sh={t:'v2sh'};
}
async function v2shareGo(how){
  const d=S.v2shp;S.sh=null;if(!d)return;
  if(how==='copy'||!d.url)return v2copyLink(d.url,d.title);
  if(how==='card'){const f=await v2cardFile(d.title,d.lines);if(f){try{await navigator.share({files:[f]});return}catch(e){if(e&&e.name==='AbortError')return}}return v2copyLink(d.url,d.title)}
  if(typeof navigator!=='undefined'&&navigator.share){try{await navigator.share({title:d.title,url:d.url});return}catch(e){if(e&&e.name==='AbortError')return}}
  return v2copyLink(d.url,d.title);
}
function v2open(url){if(!/^https?:\/\//i.test(String(url||'')))return T('链接无效');try{const w=window.open(url,'_blank','noopener');if(!w)location.href=url}catch(e){location.href=url}}
const LINK_IC={github:'GH',gitee:'GE',feishu:'飞',['tencent-docs']:'腾',yuque:'语',notion:'N',figma:'F',link:''};
const linkCard=(l,act)=>{const k=(l.link&&l.link.provider)||'link',lab=(l.link&&l.link.label)||'链接',host=(l.link&&l.link.host)||'';return `<button type="button" class="lkc lk-${esc(k)}" data-a="v2url" data-v="${esc(l.url)}"><i class="lki">${LINK_IC[k]?esc(LINK_IC[k]):v2i('link')}</i><span class="gr"><b data-ut>${esc(l.title||lab)}</b><small><span>${esc(lab)}</span> · <span data-ut>${esc(host)}</span></small></span>${act||''}</button>`};

/* ================= 共创标签页 ================= */
const EXC=[['lang','语言'],['dev','编程开发'],['design','设计'],['music','音乐'],['sport','运动健身'],['photo','摄影视频'],['study','学业辅导'],['life','生活技能'],['career','职场商务'],['craft','手工艺'],['other','其他']];
const excL=k=>{const c=EXC.find(x=>x[0]==k);return c?c[1]:'其他'};
const PJST={recruiting:['招募中','rec'],active:['进行中','act'],completed:['已完成','done'],cancelled:['已取消','cxl'],removed:['已移除','cxl']};
function coS(){return S.co||(S.co={seg:'ex',cat:'',q:'',mine:0,ex:null,pj:null,pf:'',err:'',match:null})}
async function coLoad(){
  const c=coS();if(!v2on())return;
  if(c.seg==='ex'){const qs=new URLSearchParams();if(c.cat)qs.set('category',c.cat);if(c.q)qs.set('q',c.q);if(c.mine)qs.set('mine','1');
    const r=await api('GET','/api/exchange?'+qs);if(r.s!==200){c.err=v2e(r,'加载失败');return}c.err='';c.ex=(r.j.posts||[]).map(x=>({...x,aid:v2aid(x.author)}))}
  else{const qs=new URLSearchParams();if(c.pf==='mine')qs.set('mine','1');else if(c.pf)qs.set('status',c.pf);if(c.q)qs.set('q',c.q);
    const r=await api('GET','/api/projects?'+qs);if(r.s!==200){c.err=v2e(r,'加载失败');return}c.err='';c.pj=(r.j.projects||[]).map(x=>({...x,oid:v2aid(x.owner)}))}
}
const coSearch=ph=>`<div class="cosr">${ic('search')}<input type="search" data-d="coq" enterkeyhint="search" placeholder="${ph}" aria-label="${ph}">${coS().q?`<button type="button" class="ib sm" data-a="coqx" aria-label="清除">×</button>`:''}</div>`;
const tCo=()=>{const c=coS(),ex=c.seg==='ex';
  const slogan=ex?['用你擅长的，交换你想学的','Share What You Know. Learn What You Need.']:['让想法，变成共同完成的事','Turn Ideas Into Things We Build Together'];
  return `<div class="pg co-pg"><div class="top"><h1>共创</h1><button class="ib" data-a="${ex?'exnew':'pjnew'}" aria-label="${ex?'发布技能交换':'发起项目'}">${ic('plus')}</button></div><div class="seg"><button data-a="coseg" data-v="ex" class="${ex?'on':''}">技能交换</button><button data-a="coseg" data-v="pj" class="${ex?'':'on'}">共创项目</button></div><div class="sc co-sc"><p class="coslg" data-ut>${V2EN()?slogan[1]:slogan[0]}</p>${ex?coEx():coPj()}</div></div>`};
const coEx=()=>{const c=coS();
  const chips=`<div class="cochips">${[['','全部'],...EXC].map(x=>`<button type="button" class="chipb${c.cat===x[0]&&!c.mine?' on':''}" data-a="cocat" data-v="${x[0]}">${x[1]}</button>`).join('')}<button type="button" class="chipb${c.mine?' on':''}" data-a="comine">我发布的</button></div>`;
  const L=c.ex;let body;
  if(!v2on())body='<p class="em">登录后可以使用技能交换</p>';
  else if(c.err)body=`<p class="em">${esc(c.err)}</p>`;
  else if(!L)body='<p class="em">正在加载…</p>';
  else if(!L.length)body=`<div class="coempty"><p class="em">${c.q||c.cat?'没有匹配的技能交换':'还没有人发布，来做第一个吧'}</p><button class="pb" data-a="exnew">发布技能交换</button></div>`;
  else body=L.map(exCard).join('');
  return coSearch('搜索技能，例如 吉他、Python')+chips+(typeof exMatchBox==='function'?exMatchBox():'')+`<div class="colist">${body}</div>`};
const exCard=x=>{const u=P(x.aid),open=x.status==='open';
  return `<article class="excard${open?'':' off'}" data-exid="${esc(x.id)}"><header class="exh"><button type="button" class="exu" data-a="user" data-v="${x.aid}">${av(x.aid,36)}<span class="gr"><b class="nmb">${nmB(u)}</b><small>${esc(v2ago(x.updatedAt||x.createdAt))}</small></span></button><span class="excat">${excL(x.category)}</span></header>
<div class="exrow"><span class="exk ex-o">我会</span><p data-ut>${esc(x.offers)}</p></div><div class="exrow"><span class="exk ex-w">我想要</span><p data-ut>${esc(x.wants)}</p></div>${x.note?`<p class="exnote" data-ut>${esc(x.note)}</p>`:''}
<footer class="exf">${open?'':'<span class="pill cxl">已关闭</span>'}<span class="sp"></span><button type="button" class="ib sm" data-a="exshare" data-v="${esc(x.id)}" aria-label="分享">${v2i('share')}</button>${x.mine?`<button class="pb sm s" data-a="exedit" data-v="${esc(x.id)}">编辑</button><button class="pb sm s" data-a="${open?'exclose':'exopen'}" data-v="${esc(x.id)}">${open?'关闭':'重新开放'}</button>`:`<button class="pb sm" data-a="exask" data-v="${esc(x.id)}" ${open?'':'disabled'}>${v2i('chat2')}<span>咨询</span></button>`}</footer></article>`};
const coPj=()=>{const c=coS();
  const chips=`<div class="cochips">${[['','全部'],['recruiting','招募中'],['active','进行中'],['completed','已完成'],['mine','我参与的']].map(x=>`<button type="button" class="chipb${c.pf===x[0]?' on':''}" data-a="copf" data-v="${x[0]}">${x[1]}</button>`).join('')}</div>`;
  const L=c.pj;let body;
  if(!v2on())body='<p class="em">登录后可以参与共创项目</p>';
  else if(c.err)body=`<p class="em">${esc(c.err)}</p>`;
  else if(!L)body='<p class="em">正在加载…</p>';
  else if(!L.length)body=`<div class="coempty"><p class="em">${c.q||c.pf?'没有匹配的项目':'还没有项目，发起一个吧'}</p><button class="pb" data-a="pjnew">发起项目</button></div>`;
  else body=`<div class="pjgrid">${L.map(pjCard).join('')}</div>`;
  return coSearch('搜索项目、技能')+chips+`<div class="colist">${body}</div>`};
const pjBar=pg=>`<div class="pjbar" role="progressbar" aria-valuenow="${pg.percent}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pg.percent}%"></i></div>`;
const pjPill=st=>{const s=PJST[st]||PJST.active;return `<span class="pill ${s[1]}">${s[0]}</span>`};
const pjCard=p=>{const u=P(p.oid),pg=p.progress||{total:0,done:0,percent:0};
  return `<article class="pjcard" data-a="pj" data-v="${esc(p.id)}"><div class="pjtop">${pjPill(p.status)}${p.myStatus==='active'?'<span class="pill mine">已加入</span>':p.myStatus==='requested'?'<span class="pill">审核中</span>':''}</div><h3 data-ut>${esc(p.title)}</h3><p class="pjgoal" data-ut>${esc(p.goal)}</p>${(p.skills||[]).length?`<div class="skl">${p.skills.slice(0,4).map(s=>`<span data-ut>${esc(s)}</span>`).join('')}</div>`:''}<div class="pjft"><span class="pjo">${av(p.oid,22)}<b class="nmb">${nmB(u)}</b></span><small class="pjn">${v2i('users')}<span>${p.memberCount}/${p.capacity}</span></small></div></article>`};

/* ================= 技能交换：编辑页 ================= */
const pExEdit=id=>{const isNew=!id||id==='new',cat=S.d.excat||'';
  return `<div class="pg"><div class="top sub"><button class="ib tx" data-a="back">取消</button><h1>${isNew?'发布技能交换':'编辑技能交换'}</h1><button class="pb" data-a="exsave" data-v="${isNew?'':esc(id)}">${isNew?'发布':'保存'}</button></div><div class="sc v2form">
<p class="lab">分类</p><div class="cochips wrap">${EXC.map(x=>`<button type="button" class="chipb${cat===x[0]?' on':''}" data-a="excat" data-v="${x[0]}">${x[1]}</button>`).join('')}</div>
<label class="lab" for="exo">我会什么</label><textarea id="exo" class="fld" data-d="exo" data-max="200" rows="3" placeholder="例如：吉他入门、Python 爬虫、雅思口语"></textarea><p class="lab cnt" data-cnt="exo"></p>
<label class="lab" for="exw">我想要什么</label><textarea id="exw" class="fld" data-d="exw" data-max="200" rows="3" placeholder="例如：想学剪辑、想找人练英语口语"></textarea><p class="lab cnt" data-cnt="exw"></p>
<label class="lab" for="exn">补充说明（可选）</label><textarea id="exn" class="fld" data-d="exn" data-max="500" rows="3" placeholder="时间、方式（线上/线下）等"></textarea></div></div>`};

/* ================= 共创项目：创建 / 编辑 ================= */
const pPjEdit=id=>{const isNew=!id||id==='new';
  return `<div class="pg"><div class="top sub"><button class="ib tx" data-a="back">取消</button><h1>${isNew?'发起项目':'编辑项目'}</h1><button class="pb" data-a="pjsave" data-v="${isNew?'':esc(id)}">${isNew?'发起':'保存'}</button></div><div class="sc v2form">
<label class="lab" for="pjt">项目名称</label><input id="pjt" class="fld" data-d="pjt" data-max="40" placeholder="一句话说清楚，例如：校园二手书小程序">
<label class="lab" for="pjg">目标</label><textarea id="pjg" class="fld" data-d="pjg" data-max="200" rows="2" placeholder="想做成什么，做到什么程度"></textarea>
<label class="lab" for="pjsk">需要的技能（逗号分隔，最多 8 个）</label><input id="pjsk" class="fld" data-d="pjsk" placeholder="例如：前端, UI 设计, 文案">
<label class="lab" for="pjcap">人数上限</label><input id="pjcap" class="fld" data-d="pjcap" type="number" min="2" max="50" inputmode="numeric" placeholder="2–50">
<label class="lab" for="pjd">详细介绍（可选）</label><textarea id="pjd" class="fld" data-d="pjd" data-max="2000" rows="6" placeholder="背景、分工、节奏、怎么协作"></textarea>
${!isNew&&S.pjc&&S.pjc[id]&&['recruiting','active'].includes(S.pjc[id].status)?`<p class="lab">项目状态</p><div class="cochips"><button type="button" class="chipb${S.d.pjst==='recruiting'?' on':''}" data-a="pjst" data-v="recruiting">招募中</button><button type="button" class="chipb${S.d.pjst==='active'?' on':''}" data-a="pjst" data-v="active">进行中（停止招募）</button></div>`:''}</div></div>`};
const pPjDone=id=>`<div class="pg"><div class="top sub"><button class="ib tx" data-a="back">取消</button><h1>完成项目</h1><button class="pb" data-a="pjdone2" data-v="${esc(id)}">发布成果</button></div><div class="sc v2form"><p class="hint">完成后项目会进入成果展示，不能再修改任务和成员。</p><label class="lab" for="pjsum">成果介绍</label><textarea id="pjsum" class="fld" data-d="pjsum" data-max="1000" rows="6" placeholder="做成了什么、效果如何、感谢谁"></textarea><label class="lab" for="pjsl">成果链接（每行一个，最多 6 个）</label><textarea id="pjsl" class="fld" data-d="pjsl" rows="4" placeholder="https://github.com/…"></textarea></div></div>`;

/* ================= 共创项目：详情 / 工作台 ================= */
const pjOf=id=>(S.pjc&&S.pjc[id])||null;
async function pjFetch(id){const r=await api('GET','/api/projects/'+encodeURIComponent(id));if(r.s!==200){T(v2e(r,'项目不存在或已被移除'));return null}const p=r.j.project;p.oid=v2aid(p.owner);(p.members||[]).forEach(m=>m.uid=v2aid(m));(p.tasks||[]).forEach(t=>t.aid=t.assignee?v2aid(t.assignee):'');[...(p.notices||[]),...(p.links||[]),...(p.files||[])].forEach(x=>x.aid=v2aid(x.author));(p.requests||[]).forEach(q=>q.uid=v2aid(q.user));S.pjc=S.pjc||{};S.pjc[id]=p;return p}
const pProject=id=>{const p=pjOf(id);
  if(!p)return `<div class="pg">${sub('项目')}<div class="sc"><p class="em">正在加载…</p></div></div>`;
  const u=P(p.oid),member=p.myStatus==='active',open=['recruiting','active'].includes(p.status),pg=p.progress||{total:0,done:0,percent:0},tab=S.pjtab||'task';
  const acts=[];
  if(member)acts.push(`<button class="pb" data-a="pjchat" data-v="${esc(id)}">${v2i('chat2')}<span>项目群聊</span></button>`);
  else if(p.myStatus==='requested')acts.push('<button class="pb off" disabled>已申请，等待审核</button>');
  else if(p.status==='recruiting'&&p.memberCount<p.capacity)acts.push(`<button class="pb" data-a="pjapply" data-v="${esc(id)}">申请加入</button>`);
  else if(p.status==='recruiting')acts.push('<button class="pb off" disabled>已满员</button>');
  acts.push(`<button class="pb s" data-a="pjshare" data-v="${esc(id)}">${v2i('share')}<span>分享</span></button>`);
  const more=p.isOwner&&open?`<button class="ib" data-a="pjmore" data-v="${esc(id)}" aria-label="更多">${ic('more')}</button>`:member&&!p.isOwner?`<button class="ib" data-a="pjmore" data-v="${esc(id)}" aria-label="更多">${ic('more')}</button>`:'';
  const head=`<section class="pjhero"><div class="pjpills">${pjPill(p.status)}${p.full&&p.status==='recruiting'?'<span class="pill pjfull">已满员</span>':''}</div><h2 data-ut>${esc(p.title)}</h2><p class="pjgoal" data-ut>${esc(p.goal)}</p><button type="button" class="pjown" data-a="user" data-v="${p.oid}">${av(p.oid,28)}<b class="nmb">${nmB(u)}</b><small>发起人</small></button><div class="pjstat two"><span><b>${p.memberCount}/${p.capacity}</b><small>成员</small></span><span><b>${pg.done}/${pg.total}</b><small>任务</small></span></div><div class="pjact">${acts.join('')}</div></section>`;
  const skills=(p.skills||[]).length?`<section class="pjsec"><h4>需要的技能</h4><div class="skl">${p.skills.map(s=>`<span data-ut>${esc(s)}</span>`).join('')}</div></section>`:'';
  const desc=p.description?`<section class="pjsec"><h4>项目介绍</h4><p class="pjdesc" data-ut>${esc(p.description)}</p></section>`:'';
  const show=p.status==='completed'&&p.showcase?`<section class="pjsec pjshow"><h4>🎉 成果展示</h4><p class="pjdesc" data-ut>${esc(p.showcase.summary||'')}</p>${(p.showcase.links||[]).map(l=>linkCard(l)).join('')}</section>`:'';
  /* 2.0.1 成员：一行最多 5 个头像，其余显示叠放的「+N」，点它或「查看全部」打开完整名单；这一行高度固定，不会把下面的内容挤下去 */
  const ML=p.members||[],MAXV=5,shown=ML.slice(0,MAXV),extra=Math.max(0,(Number(p.memberCount)||ML.length)-shown.length);
  const stack=extra?`<button type="button" class="pjmore" data-a="pjmems" data-v="${esc(id)}" aria-label="查看全部成员">${ML.slice(MAXV,MAXV+1).map(m=>`<span class="pjst">${av(m.uid,34)}</span>`).join('')}<span class="pjst pjn">+${extra>99?'99+':extra}</span></button>`:'';
  const mems=`<section class="pjsec pjmsec"><h4>成员 <small>${p.memberCount}</small>${ML.length>1||extra?`<button type="button" class="lk pjall" data-a="pjmems" data-v="${esc(id)}">查看全部</button>`:''}</h4><div class="pjmem">${shown.map(m=>`<button type="button" class="pjm" data-a="user" data-v="${m.uid}">${av(m.uid,40)}<span class="nmb nbc">${nmB(P(m.uid))}</span><small>${m.role==='owner'?'发起人':m.role==='lead'?'负责人':'&nbsp;'}</small></button>`).join('')}${stack}</div></section>`;
  const reqs=p.isOwner&&(p.requests||[]).length?`<section class="pjsec pjreq"><h4>加入申请 <small>${p.requests.length}</small></h4>${p.requests.map(q=>`<div class="row">${av(q.uid,40)}<div class="gr"><b class="nmb">${nmB(P(q.uid))}</b>${q.message?`<small data-ut>${esc(q.message)}</small>`:''}</div><div class="sw"><button class="pb sm" data-a="pjok" data-v="${esc(id)}|${esc(q.user.id)}">通过</button><button class="pb sm s" data-a="pjno" data-v="${esc(id)}|${esc(q.user.id)}">拒绝</button></div></div>`).join('')}</section>`:'';
  /* 2.0.1：项目工作台（任务 / 公告 / 资料）移到项目群聊里（标题栏的「工作台」按钮）；详情页只放公开信息 */
  const ws=member?`<section class="pjsec"><p class="hint">任务、公告和共享资料在项目群聊里：打开「项目群聊」，点右上角的「工作台」。</p><button class="pb s pjwsgo" data-a="pjws" data-v="${esc(id)}">${v2i('board')}<span>打开项目工作台</span></button></section>`:(p.status!=='completed'?'<section class="pjsec"><p class="hint">加入项目后可以在项目群聊里查看任务、公告和共享资料。</p></section>':'');
  return `<div class="pg pj-pg">${sub('项目',more)}<div class="sc">${head}${show}${reqs}${skills}${desc}${mems}${ws}</div></div>`};
/* 2.0.1 项目工作台页（从项目群聊标题栏进入）：只有项目成员能看和操作（服务器只把任务/公告/资料返回给成员） */
const pPjWs=id=>{const p=pjOf(id);
  if(!p)return `<div class="pg">${sub('项目工作台')}<div class="sc"><p class="em">正在加载…</p></div></div>`;
  const member=p.myStatus==='active',open=['recruiting','active'].includes(p.status),pg=p.progress||{total:0,done:0,percent:0};
  if(!member)return `<div class="pg">${sub('项目工作台')}<div class="sc"><p class="em">只有项目成员可以查看工作台</p></div></div>`;
  const top=`<button type="button" class="pjwsh" data-a="pj" data-v="${esc(id)}"><span class="gr"><b data-ut>${esc(p.title)}</b><small>任务 ${pg.done}/${pg.total}</small></span><small>项目详情 ›</small></button>`;
  return `<div class="pg pjws-pg">${sub('项目工作台')}<div class="sc">${top}${pjWork(p,S.pjtab||'task',open)}</div></div>`};
const pjWork=(p,tab,open)=>{const id=p.id;
  const seg=`<div class="seg pjseg"><button data-a="pjtab" data-v="task" class="${tab=='task'?'on':''}">任务</button><button data-a="pjtab" data-v="notice" class="${tab=='notice'?'on':''}">公告</button><button data-a="pjtab" data-v="res" class="${tab=='res'?'on':''}">资料</button></div>`;
  let h='';
  if(tab==='task'){
    const rows=(p.tasks||[]).map(t=>{const done=t.status==='done',canDel=p.isOwner||(SESSION&&Number(t.createdBy)===Number(SESSION.user.id));return `<div class="pjtk${done?' done':''}"><button type="button" class="tkc" data-a="pjtk" data-v="${esc(id)}|${esc(t.id)}" aria-label="${done?'标记为未完成':'标记为完成'}" ${open?'':'disabled'}>${done?v2i('check'):''}</button><span class="gr"><b data-ut>${esc(t.title)}</b><small>${t.aid?`<span class="nmb">${nmB(P(t.aid))}</span>`:'<span>未分配</span>'}</small></span>${canDel&&open?`<button type="button" class="ib sm" data-a="pjtkdel" data-v="${esc(id)}|${esc(t.id)}" aria-label="删除">×</button>`:''}</div>`}).join('')||'<p class="em">还没有任务</p>';
    const add=open?`<div class="pjadd pjtadd"><input class="fld" data-d="pjtk" data-max="60" placeholder="新任务，例如：完成首页设计稿"><select class="fld" data-d="pjta" aria-label="负责人"><option value="">负责人（可选）</option>${(p.members||[]).map(m=>`<option value="${esc(m.id)}">${esc(P(m.uid).n)}</option>`).join('')}</select><button class="pb sm" data-a="pjtkadd" data-v="${esc(id)}">添加</button></div>`:'';
    h=add+`<div class="pjtks">${rows}</div>`;
  }else if(tab==='notice'){
    const add=p.isOwner&&open?`<div class="pjadd col"><textarea class="fld" data-d="pjnt" data-max="2000" rows="3" placeholder="发布公告，所有成员都会收到通知"></textarea><button class="pb sm" data-a="pjntadd" data-v="${esc(id)}">发布公告</button></div>`:'';
    h=add+((p.notices||[]).map(n=>`<article class="pjnt"><header><b class="nmb">${nmB(P(n.aid))}</b><small>${esc(v2ago(n.createdAt))}</small></header><p data-ut>${esc(n.body)}</p></article>`).join('')||'<p class="em">还没有公告</p>');
  }else{
    const add=open?`<div class="pjadd col"><input class="fld" data-d="pjlu" placeholder="粘贴链接：GitHub、飞书、腾讯文档…"><input class="fld" data-d="pjlt" data-max="60" placeholder="标题（可选）"><div class="fr"><button class="pb sm s" data-a="pjfile" data-v="${esc(id)}">${v2i('file')}<span>上传文件</span></button><button class="pb sm" data-a="pjlink" data-v="${esc(id)}">${v2i('link')}<span>添加链接</span></button></div><small class="hint">文件支持 PDF、ZIP、TXT、Word、图片，仅项目成员可见。</small></div>`:'';
    const canDel=x=>p.isOwner||x.aid==='me';
    const links=(p.links||[]).map(l=>linkCard(l,open&&canDel(l)?`<i class="lkx" data-a="pjpdel" data-v="${esc(id)}|${esc(l.id)}" role="button" aria-label="删除">×</i>`:'')).join('');
    const files=(p.files||[]).map(f=>`<div class="pjfl"><button type="button" class="lkc" data-a="v2file" data-v="${esc(f.media&&f.media.id||'')}"><i class="lki">${v2i('file')}</i><span class="gr"><b data-ut>${esc((f.media&&f.media.name)||f.title||'文件')}</b><small><span class="nmb">${nmB(P(f.aid))}</span></small></span></button>${open&&canDel(f)?`<button type="button" class="ib sm" data-a="pjpdel" data-v="${esc(id)}|${esc(f.id)}" aria-label="删除">×</button>`:''}</div>`).join('');
    h=add+(links||files?links+files:'<p class="em">还没有共享资料</p>');
  }
  return `<section class="pjsec pjws">${seg}${h}</section>`};

/* ================= 投票卡片（微博风格，结果条） ================= */
const pollCard=pl=>{const show=pl.options&&pl.options.some(o=>o.votes!=null),tot=Number(pl.totalVotes)||0,pick=(S.pollPick&&S.pollPick[pl.id])||[],can=!pl.closed&&!pl.voted;
  const opts=(pl.options||[]).map(o=>{const pct=show&&tot?Math.round((o.votes||0)*100/tot):0,sel=o.voted||pick.includes(o.id);
    if(show||!can)return `<div class="pop res${o.voted?' mine':''}"><i style="width:${pct}%"></i><span class="pt" data-ut>${esc(o.text)}</span>${o.voted?`<span class="pck">${v2i('check')}</span>`:''}<b>${show?pct+'%':''}</b></div>`;
    return `<button type="button" class="pop${sel?' sel':''}" data-a="${pl.allowMultiple?'ppick':'pvote'}" data-v="${esc(pl.id)}|${esc(o.id)}"><span class="pt" data-ut>${esc(o.text)}</span>${pl.allowMultiple?`<span class="pbx">${sel?v2i('check'):''}</span>`:''}</button>`}).join('');
  const meta=[pl.allowMultiple?'多选':'单选',show?v2num(tot,'票','votes'):'',pl.closed?'已截止':pl.closesAt?(V2EN()?'Ends ':'截止 ')+v2when(pl.closesAt):''].filter(Boolean);
  return `<div class="pollc" data-poll="${esc(pl.id)}"><div class="pq"><i class="pico">${v2i('poll')}</i><b data-ut>${esc(pl.question)}</b></div>${opts}${pl.allowMultiple&&can?`<button class="pb sm pvb" data-a="pvotem" data-v="${esc(pl.id)}" ${pick.length?'':'disabled'}>投票</button>`:''}<small class="pmeta">${meta.map(m=>`<span>${esc(m)}</span>`).join('<span> · </span>')}</small></div>`};

/* ================= 活动卡片 + 详情 ================= */
const ACTST={upcoming:['未开始','rec'],ongoing:['进行中','act'],ended:['已结束','cxl']};
const actCard=a=>{const st=ACTST[a.state]||ACTST.upcoming;S.acts=S.acts||{};S.acts[a.id]=a;
  return `<div class="actc" data-a="act" data-v="${esc(a.id)}"><div class="acov"${a.coverMediaId?` data-mbg="${esc(a.coverMediaId)}"`:''}>${a.coverMediaId?'':`<i>${v2i('event')}</i>`}<span class="pill ${st[1]}">${st[0]}</span></div><div class="acb"><b data-ut>${esc(a.title)}</b><small class="arow">${v2i('event')}<span data-ut>${esc(v2when(a.startsAt))}</span></small><small class="arow">${v2i(a.online?'globe':'pin2')}<span${a.online?'':' data-ut'}>${a.online?'线上活动':esc(a.place)}</span></small><div class="acf"><small>${a.cap?`<span>${V2EN()?a.count+' / '+a.cap+' joined':a.count+' / '+a.cap+' 人报名'}</span>`:`<span>${V2EN()?a.count+' joined':a.count+' 人报名'}</span>`}</small>${a.joined?'<span class="pill mine">已报名</span>':a.full?'<span class="pill cxl">名额已满</span>':a.state==='ended'?'':'<i class="acj">报名</i>'}</div></div></div>`};
async function actFetch(id){const r=await api('GET','/api/activities/'+encodeURIComponent(id));if(r.s!==200){T(v2e(r,'活动不存在或已被移除'));return null}S.acts=S.acts||{};S.acts[id]=r.j.activity;return r.j.activity}
function actSync(a){S.acts=S.acts||{};S.acts[a.id]=a;const upd=p=>{if(p&&p.activity&&p.activity.id===a.id)p.activity=a};(typeof feedSrc==='function'?feedSrc():[]).forEach(upd);if(S.post)upd(S.post)}
const pAct=id=>{const a=S.acts&&S.acts[id];if(!a)return `<div class="pg">${sub('活动')}<div class="sc"><p class="em">正在加载…</p></div></div>`;
  const st=ACTST[a.state]||ACTST.upcoming,au=a.authorId?(SESSION&&Number(SESSION.user.id)===Number(a.authorId)?'me':String(a.authorId)):'';
  let btn='';if(a.mine)btn='';else if(a.joined)btn=a.state==='ended'?'<button class="pb off" disabled>已报名</button>':`<button class="pb s" data-a="actcancel" data-v="${esc(id)}">取消报名</button>`;else if(a.state==='ended')btn='<button class="pb off" disabled>活动已结束</button>';else if(a.full)btn='<button class="pb off" disabled>名额已满</button>';else btn=`<button class="pb" data-a="actjoin" data-v="${esc(id)}">立即报名</button>`;
  const list=a.mine?`<section class="pjsec"><h4>报名名单 <small>${a.count}</small></h4>${S.actSign&&S.actSign[id]?(S.actSign[id].length?S.actSign[id].map(s=>{const uid=v2aid(s.user);return `<div class="row" data-a="user" data-v="${uid}">${av(uid,36)}<div class="gr"><b class="nmb">${nmB(P(uid))}</b><small>${esc(v2when(s.at))}</small></div></div>`}).join(''):'<p class="em">还没有人报名</p>'):'<p class="em">正在加载…</p>'}</section>`:'';
  return `<div class="pg act-pg">${sub('活动',`<button class="ib" data-a="actshare" data-v="${esc(id)}" aria-label="分享">${v2i('share')}</button>`)}<div class="sc"><div class="acov big"${a.coverMediaId?` data-mbg="${esc(a.coverMediaId)}"`:''}>${a.coverMediaId?'':`<i>${v2i('event')}</i>`}<span class="pill ${st[1]}">${st[0]}</span></div><section class="pjhero"><h2 data-ut>${esc(a.title)}</h2><p class="arow">${v2i('event')}<span data-ut>${esc(v2when(a.startsAt))}${a.endsAt?' – '+esc(v2when(a.endsAt)):''}</span></p><p class="arow">${v2i(a.online?'globe':'pin2')}${a.online?`<span>线上活动</span>${a.onlineUrl&&(a.joined||a.mine)?` <button type="button" class="lnk" data-a="v2url" data-v="${esc(a.onlineUrl)}">打开活动链接</button>`:''}`:`<span data-ut>${esc(a.place)}</span>`}</p><p class="arow">${v2i('users')}<span>${a.cap?(V2EN()?a.count+' / '+a.cap+' joined':a.count+' / '+a.cap+' 人报名'):(V2EN()?a.count+' joined':a.count+' 人报名')}</span></p>${a.cap?pjBar({percent:Math.min(100,Math.round(a.count*100/a.cap))}):''}${au?`<button type="button" class="pjown" data-a="user" data-v="${au}">${av(au,28)}<b class="nmb">${nmB(P(au))}</b><small>发起人</small></button>`:''}<div class="pjact">${btn}${a.postId?`<button class="pb s" data-a="post" data-v="${esc(a.postId)}">查看动态</button>`:''}</div></section>${a.description?`<section class="pjsec"><h4>活动介绍</h4><p class="pjdesc" data-ut>${esc(a.description)}</p></section>`:''}${list}</div></div>`};

/* ================= 发帖：投票 / 活动（只给官方账号） ================= */
const v2canOfficial=()=>!!(v2me()&&v2me().g);
const v2ComposeTools=c=>v2canOfficial()?`<button data-a="pollnew">${v2i('poll')}<span>投票</span></button><button data-a="actnew">${v2i('event')}<span>活动</span></button>`:'';
const v2ComposeAtt=c=>{let h='';
  if(c.poll)h+=`<div class="catt"><i class="pico">${v2i('poll')}</i><span class="gr"><b data-ut>${esc(c.poll.question)}</b><small>${c.poll.options.length} <span>个选项</span> · <span>${c.poll.allowMultiple?'多选':'单选'}</span></small></span><button class="ib sm" data-a="pollnew" aria-label="编辑">✎</button><button class="ib sm" data-a="pollclr" aria-label="移除">×</button></div>`;
  if(c.act)h+=`<div class="catt"><i class="pico">${v2i('event')}</i><span class="gr"><b data-ut>${esc(c.act.title)}</b><small data-ut>${esc(v2when(c.act.startsAt))}</small></span><button class="ib sm" data-a="actnew" aria-label="编辑">✎</button><button class="ib sm" data-a="actclr" aria-label="移除">×</button></div>`;
  return h};
const pPollNew=()=>{const n=Math.max(2,Math.min(10,Number(S.d.pln)||2));
  return `<div class="pg"><div class="top sub"><button class="ib tx" data-a="back">取消</button><h1>发起投票</h1><button class="pb" data-a="pollok">完成</button></div><div class="sc v2form"><label class="lab" for="plq">投票问题</label><input id="plq" class="fld" data-d="plq" data-max="200" placeholder="例如：下次线下活动想去哪？"><p class="lab">选项（2–10 个）</p>${Array.from({length:n},(_,i)=>`<div class="plo"><input class="fld" data-d="plo${i}" data-max="80" placeholder="选项 ${i+1}">${n>2?`<button type="button" class="ib sm" data-a="plodel" data-v="${i}" aria-label="删除">×</button>`:''}</div>`).join('')}${n<10?'<button type="button" class="pb sm s" data-a="ploadd">+ 添加选项</button>':''}<p class="lab">投票方式</p><div class="cochips"><button type="button" class="chipb${S.d.plm==='1'?'':' on'}" data-a="plm" data-v="0">单选</button><button type="button" class="chipb${S.d.plm==='1'?' on':''}" data-a="plm" data-v="1">多选</button></div><label class="lab" for="plend">截止时间（可选）</label><input id="plend" class="fld" type="datetime-local" data-d="plend"><p class="hint">每人只能投一次，投票后可以看到实时结果。</p></div></div>`};
const pActNew=()=>{const on=S.d.aon==='1',cov=S.comp&&S.comp.actCover;
  return `<div class="pg"><div class="top sub"><button class="ib tx" data-a="back">取消</button><h1>发起活动</h1><button class="pb" data-a="actok">完成</button></div><div class="sc v2form"><button type="button" class="acov pick" data-a="actcov"${cov?` style="background-image:url('${esc(cov.url)}')"`:''}>${cov?'':`<i>${v2i('camera')}</i><span>添加封面（可选）</span>`}</button>${cov?'<button type="button" class="pb sm s" data-a="actcovx">移除封面</button>':''}
<label class="lab" for="atit">活动标题</label><input id="atit" class="fld" data-d="atit" data-max="60" placeholder="例如：周末摄影漫步">
<label class="lab" for="ast">开始时间</label><input id="ast" class="fld" type="datetime-local" data-d="ast"><label class="lab" for="aen">结束时间（可选）</label><input id="aen" class="fld" type="datetime-local" data-d="aen">
<p class="lab">活动形式</p><div class="cochips"><button type="button" class="chipb${on?'':' on'}" data-a="aon" data-v="0">线下</button><button type="button" class="chipb${on?' on':''}" data-a="aon" data-v="1">线上</button></div>
${on?'<label class="lab" for="aurl">线上链接（可选）</label><input id="aurl" class="fld" data-d="aurl" placeholder="https://meeting.tencent.com/…">':'<label class="lab" for="apl">地点</label><input id="apl" class="fld" data-d="apl" data-max="100" placeholder="例如：上海市徐汇区 西岸美术馆">'}
<label class="lab" for="acap">人数上限（可选）</label><input id="acap" class="fld" type="number" min="1" inputmode="numeric" data-d="acap" placeholder="不填则不限">
<label class="lab" for="adsc">活动介绍</label><textarea id="adsc" class="fld" data-d="adsc" data-max="2000" rows="5" placeholder="流程、注意事项、联系方式"></textarea></div></div>`};
function actSpec(a){return {title:a.title,startsAt:a.startsAt,endsAt:a.endsAt||null,online:!!a.online,place:a.online?'':a.place,onlineUrl:a.online?(a.onlineUrl||''):'',description:a.description||'',cap:a.cap||null,coverMediaId:a.coverMediaId||null}}
async function actPrep(a){const cov=S.comp&&S.comp.actCover;if(cov&&!cov.id&&cov.file){T('正在上传封面…');const m=await uploadMedia(cov.file);cov.id=m.id}if(cov&&cov.id)a.coverMediaId=cov.id;else a.coverMediaId=null}

/* ================= 页面路由 ================= */
const V2P={exedit:pExEdit,pjedit:pPjEdit,pj:pProject,pjdone:pPjDone,act:pAct,pollnew:pPollNew,actnew:pActNew,pjws:pPjWs};

/* ================= 弹层 ================= */
function v2Sheet(s){
  if(s.t==='pjapply')return `<h3>申请加入项目</h3><p class="lab" style="margin-bottom:8px">简单介绍你自己和能做的事，发起人审核通过后你会加入项目群聊。</p><textarea class="fld" data-d="pjmsg" data-max="200" rows="3" placeholder="例如：我会前端开发，每周能投入 5 小时"></textarea><div class="fr"><button class="pb s" data-a="x">取消</button><button class="pb" data-a="pjapply2" data-v="${esc(s.id)}">提交申请</button></div>`;
  if(s.t==='pjmore'){const p=pjOf(s.id);if(!p)return '';return p.isOwner?`<button class="mi" data-a="pjedit" data-v="${esc(s.id)}">编辑项目</button><button class="mi" data-a="pjdone" data-v="${esc(s.id)}">完成项目并展示成果</button><button class="mi d" data-a="pjcxl" data-v="${esc(s.id)}">取消项目</button>`:`<button class="mi d" data-a="pjleave" data-v="${esc(s.id)}">退出项目</button>`}
  if(s.t==='pjmems'){const p=pjOf(s.id);if(!p)return '';const RL={owner:'发起人',lead:'负责人',member:'成员'};const own=p.isOwner&&['recruiting','active'].includes(p.status);return `<h3>成员 <small style="color:var(--t2);font-weight:400">${p.memberCount}/${p.capacity}</small></h3><div class="pjml">${(p.members||[]).map(m=>`<button type="button" class="row" data-a="user" data-v="${m.uid}">${av(m.uid,40)}<div class="gr"><b class="nmb">${nmB(P(m.uid))}</b><small>${RL[m.role]||'成员'}</small></div>${own&&m.role!=='owner'?`<span class="pb sm s pjlead" role="button" data-a="pjlead" data-v="${esc(s.id)}|${esc(m.id)}|${m.role==='lead'?0:1}">${m.role==='lead'?'取消负责人':'设为负责人'}</span>`:''}</button>`).join('')}</div>${own?'<p class="hint" style="padding:8px 0 0">负责人同时是项目群聊的管理员。</p>':''}`}
  if(s.t==='v2sh'){const d=S.v2shp||{};const sys=typeof navigator!=='undefined'&&!!navigator.share;return `<h3>分享</h3>${d.url?`<p class="v2shu" data-ut>${esc(d.url)}</p>`:''}${sys&&d.url?`<button class="mi" data-a="v2sh" data-v="link">${v2i('link')}<span>分享链接（可发到微信）</span></button>`:''}${d.url&&v2canFiles()?`<button class="mi" data-a="v2sh" data-v="card">${v2i('share')}<span>分享图片卡片</span></button>`:''}<button class="mi" data-a="v2sh" data-v="copy">${v2i('file')}<span>${d.url?'复制链接':'复制内容'}</span></button><button class="mi" data-a="x" style="color:var(--t2)">取消</button>`}
  if(s.t==='v2cf')return `<h3>${esc(s.title)}</h3>${s.body?`<p style="color:var(--t2);margin-bottom:8px">${esc(s.body)}</p>`:''}<div class="fr"><button class="pb s" data-a="x">取消</button><button class="pb d" data-a="v2cf2">${esc(s.ok||'确定')}</button></div>`;
  return '';
}
const v2confirm=(title,body,ok,fn)=>{S.sh={t:'v2cf',title,body,ok};S.v2cf=fn};

/* ================= 动作 ================= */
const coReload=()=>coLoad().then(v2rr);
const pjReload=id=>pjFetch(id).then(v2rr);
const pjDo=async(id,path,body,okMsg)=>{const r=await api('POST','/api/projects/'+encodeURIComponent(id)+path,body||{});if(r.s!==200){T(v2e(r,'操作失败'));return null}if(okMsg)T(okMsg);await pjFetch(id);return r.j};
function exFind(id){const c=coS();return (c.ex||[]).find(x=>x.id==id)||(c.match&&(c.match.items||[]).map(m=>m.post).find(x=>x&&x.id==id))||null}
Object.assign(A,{
  coseg:v=>{const c=coS();if(c.seg===v)return;c.seg=v;c.q='';S.d.coq='';c.err='';return coReload()},
  cocat:v=>{const c=coS();c.cat=v||'';c.mine=0;return coReload()},
  comine:()=>{const c=coS();c.mine=c.mine?0:1;c.cat='';return coReload()},
  copf:v=>{const c=coS();c.pf=v||'';return coReload()},
  coq:()=>{const c=coS();c.q=String(S.d.coq||'').trim().slice(0,40);return coReload()},
  coqx:()=>{const c=coS();c.q='';S.d.coq='';return coReload()},
  v2url:v=>{v2open(v)},
  v2sh:v=>v2shareGo(v),
  v2file:v=>{if(!v)return T('文件已被删除');T('正在打开…');return mediaTicket(v).then(t=>{if(!t)return T('无法打开文件');v2open(mediaFileUrl(v,t,false))})},
  v2cf2:()=>{const f=S.v2cf;S.v2cf=null;S.sh=null;if(f)return f()},
  /* 技能交换 */
  exnew:()=>{if(!v2on())return T('请先登录');Object.assign(S.d,{excat:'',exo:'',exw:'',exn:''});A.go('exedit:new')},
  exedit:v=>{const x=exFind(v);if(!x)return;Object.assign(S.d,{excat:x.category,exo:x.offers,exw:x.wants,exn:x.note||''});A.go('exedit:'+v)},
  excat:v=>{S.d.excat=v},
  exsave:async v=>{const body={category:S.d.excat||'',offers:String(S.d.exo||'').trim(),wants:String(S.d.exw||'').trim(),note:String(S.d.exn||'').trim()};
    if(!body.category)return T('请选择分类');if(!body.offers||!body.wants)return T('请填写我会什么和我想要什么');if(S.v2busy)return;S.v2busy=1;
    try{if(typeof checkText==='function'&&!(await checkText('post',[body.offers,body.wants,body.note].join('\n'))))return;
      const r=await api('POST',v?'/api/exchange/'+encodeURIComponent(v):'/api/exchange',body);if(r.s!==200)return T(v2e(r,'发布失败'));
      T(v?'已保存':'已发布');S.st.pop();const c=coS();c.seg='ex';await coLoad()}finally{S.v2busy=0}},
  exclose:v=>api('POST','/api/exchange/'+encodeURIComponent(v)+'/close',{}).then(r=>{if(r.s!==200)return T(v2e(r,'操作失败'));T('已关闭');return coLoad()}),
  exopen:v=>api('POST','/api/exchange/'+encodeURIComponent(v)+'/reopen',{}).then(r=>{if(r.s!==200)return T(v2e(r,'操作失败'));T('已重新开放');return coLoad()}),
  exask:async v=>{if(!v2on())return T('请先登录');const r=await api('POST','/api/exchange/'+encodeURIComponent(v)+'/consult',{});if(r.s!==200)return T(v2e(r,'无法发起咨询'));
    const c=adoptCv(r.j.conversation);S.conversations=S.conversations||[];if(!S.conversations.some(x=>x.id===c.id))S.conversations.unshift(c);
    const x=r.j.post||exFind(v);if(x&&!(S.d.chin||'').trim()){S.d.chin=V2EN()?`Hi! I saw your skill exchange (${x.offers.slice(0,30)}) — can we talk?`:`你好，我对你的技能交换「${x.offers.slice(0,30)}」感兴趣，想聊聊～`}
    S.tab='chat';S.st=['chat:'+c.id];c.u=0;c.hid=0;if(typeof loadMessages==='function')await loadMessages(c.id)},
  exshare:v=>{const x=exFind(v);if(!x)return;const t=(V2EN()?'Skill exchange: ':'技能交换：')+[...x.offers].slice(0,18).join('')+' ⇄ '+[...x.wants].slice(0,18).join('');return v2share(t,'',v2shareLink('x',x.id),{card:1,lines:[(V2EN()?'I can: ':'我会：')+x.offers,(V2EN()?'I want: ':'我想学：')+x.wants]})},
  /* 共创项目 */
  pj:async v=>{S.pjtab=S.pjtab||'task';A.go('pj:'+v);v2rr();await pjFetch(v)},
  pjnew:()=>{if(!v2on())return T('请先登录');Object.assign(S.d,{pjt:'',pjg:'',pjsk:'',pjcap:'5',pjd:''});A.go('pjedit:new')},
  pjedit:v=>{const p=pjOf(v);if(!p)return;S.sh=null;Object.assign(S.d,{pjt:p.title,pjg:p.goal,pjsk:(p.skills||[]).join(', '),pjcap:String(p.capacity),pjd:p.description||'',pjst:p.status});A.go('pjedit:'+v)},
  pjst:v=>{S.d.pjst=v},
  pjsave:async v=>{const body={title:String(S.d.pjt||'').trim(),goal:String(S.d.pjg||'').trim(),skills:String(S.d.pjsk||'').split(/[,，、]/).map(s=>s.trim()).filter(Boolean),capacity:Number(S.d.pjcap)||5,description:String(S.d.pjd||'').trim()};
    if(!body.title||!body.goal)return T('请填写项目名称和目标');if(v&&S.d.pjst)body.status=S.d.pjst;if(S.v2busy)return;S.v2busy=1;
    try{if(typeof checkText==='function'&&!(await checkText('post',[body.title,body.goal,body.description,body.skills.join(' ')].join('\n'))))return;
      const r=await api('POST',v?'/api/projects/'+encodeURIComponent(v):'/api/projects',body);if(r.s!==200)return T(v2e(r,'保存失败'));
      const id=r.j.project.id;T(v?'已保存':'项目已发起');S.st.pop();if(!v)S.st.push('pj:'+id);await pjFetch(id);const c=coS();c.seg='pj';coLoad()}finally{S.v2busy=0}},
  pjtab:v=>{S.pjtab=v},
  pjapply:v=>{S.d.pjmsg='';S.sh={t:'pjapply',id:v}},
  pjapply2:async v=>{const r=await pjDo(v,'/apply',{message:String(S.d.pjmsg||'').trim()},'已提交申请');if(r)S.sh=null},
  pjok:v=>{const[id,u]=v.split('|');return pjDo(id,'/requests/'+encodeURIComponent(u)+'/approve',{},'已通过')},
  pjno:v=>{const[id,u]=v.split('|');return pjDo(id,'/requests/'+encodeURIComponent(u)+'/reject',{},'已拒绝')},
  pjmore:v=>{S.sh={t:'pjmore',id:v}},
  pjleave:v=>{v2confirm('退出这个项目？','退出后会离开项目群聊，需要重新申请才能加入。','退出项目',()=>pjDo(v,'/leave',{},'已退出项目'))},
  pjcxl:v=>{v2confirm('取消这个项目？','取消后项目会从列表中隐藏，不能恢复。','取消项目',()=>pjDo(v,'/cancel',{},'项目已取消').then(()=>coLoad()))},
  pjdone:v=>{S.sh=null;S.d.pjsum='';S.d.pjsl='';A.go('pjdone:'+v)},
  pjdone2:async v=>{const links=String(S.d.pjsl||'').split(/\s+/).map(s=>s.trim()).filter(Boolean).slice(0,6);const summary=String(S.d.pjsum||'').trim();if(!summary)return T('请填写成果介绍');
    const r=await pjDo(v,'/complete',{summary,links},'项目已完成 🎉');if(r){S.st.pop();coLoad()}},
  pjmems:v=>{S.sh={t:'pjmems',id:v}},
  pjlead:async v=>{const[id,uid,on]=v.split('|');const r=await api('POST','/api/projects/'+encodeURIComponent(id)+'/members/'+encodeURIComponent(uid)+'/lead',{on:on==='1'});if(r.s!==200)return T(v2e(r,'操作失败'));T(on==='1'?'已设为负责人':'已取消负责人');await pjFetch(id);S.sh={t:'pjmems',id}},
  pjws:async v=>{S.sh=null;S.pjtab=S.pjtab||'task';S.st.push('pjws:'+v);await pjFetch(v)},
  pjchat:async v=>{const p=pjOf(v);if(!p||!p.conversationId)return T('项目群聊暂不可用');if(typeof loadConversations==='function')await loadConversations();const cid=p.conversationId;S.tab='chat';S.st=['chat:'+cid];if(typeof loadMessages==='function')await loadMessages(cid)},
  pjshare:v=>{const p=pjOf(v);if(!p)return;return v2share((V2EN()?'VEXO Sparks · ':'VEXO 共创 · ')+p.title,p.goal,v2shareLink('p',p.id),{card:1,lines:[p.goal,(p.skills||[]).length?(V2EN()?'Looking for: ':'招募：')+p.skills.join(' / '):'']})},
  pjtk:v=>{const[id,tid]=v.split('|'),p=pjOf(id),t=p&&(p.tasks||[]).find(x=>x.id==tid);if(!t)return;return pjDo(id,'/tasks/'+encodeURIComponent(tid),{status:t.status==='done'?'todo':'done'})},
  pjtkdel:v=>{const[id,tid]=v.split('|');return pjDo(id,'/tasks/'+encodeURIComponent(tid)+'/delete',{},'已删除')},
  pjtkadd:async v=>{const title=String(S.d.pjtk||'').trim();if(!title)return T('请填写任务');const body={title};if(S.d.pjta)body.assigneeId=Number(S.d.pjta);const r=await pjDo(v,'/tasks',body,'已添加任务');if(r){S.d.pjtk='';S.d.pjta=''}},
  pjntadd:async v=>{const t=String(S.d.pjnt||'').trim();if(!t)return T('请填写公告内容');if(typeof checkText==='function'&&!(await checkText('post',t)))return;const r=await pjDo(v,'/posts',{kind:'notice',body:t},'公告已发布');if(r)S.d.pjnt=''},
  pjlink:async v=>{const url=String(S.d.pjlu||'').trim();if(!/^https?:\/\//i.test(url))return T('链接需以 http:// 或 https:// 开头');const r=await pjDo(v,'/posts',{kind:'link',url,title:String(S.d.pjlt||'').trim()},'已添加链接');if(r){S.d.pjlu='';S.d.pjlt=''}},
  pjfile:async v=>{const fs=await pickFiles('.pdf,.zip,.txt,.doc,.docx,.json,image/*',false);const f=fs&&fs[0];if(!f)return;try{T('正在上传…');const m=await uploadMedia(f);await pjDo(v,'/posts',{kind:'file',mediaId:m.id,title:f.name},'已上传');v2rr()}catch(e){T((e&&e.message)||'上传失败')}},
  pjpdel:v=>{const[id,pid]=v.split('|');return pjDo(id,'/posts/'+encodeURIComponent(pid)+'/delete',{},'已删除')},
  /* 投票 */
  ppick:v=>{const[id,oid]=v.split('|');S.pollPick=S.pollPick||{};const a=S.pollPick[id]||[];S.pollPick[id]=a.includes(oid)?a.filter(x=>x!==oid):[...a,oid]},
  pvotem:v=>{const ids=(S.pollPick&&S.pollPick[v])||[];if(!ids.length)return T('请选择选项');if(!v2on())return T('演示模式暂不支持投票');
    return api('POST','/api/polls/'+v+'/vote',{optionIds:ids}).then(r=>{if(r.s!==200){T(v2e(r,'无法投票'));return}delete S.pollPick[v];const pl=r.j.poll;const apply=p=>{if(p&&p.poll&&p.poll.id==pl.id)p.poll=pl};(typeof feedSrc==='function'?feedSrc():D.p).forEach(apply);if(S.post)apply(S.post)})},
  pollnew:()=>{const c=compState(),pl=c.poll;S.d.plq=pl?pl.question:'';const opts=pl?pl.options:['',''];S.d.pln=String(Math.max(2,opts.length));for(let i=0;i<10;i++)S.d['plo'+i]=opts[i]||'';S.d.plm=pl&&pl.allowMultiple?'1':'0';S.d.plend=pl&&pl.closesAt?v2dtv(pl.closesAt):'';A.go('pollnew')},
  ploadd:()=>{S.d.pln=String(Math.min(10,(Number(S.d.pln)||2)+1))},
  plodel:v=>{const n=Number(S.d.pln)||2,i=Number(v);for(let k=i;k<n-1;k++)S.d['plo'+k]=S.d['plo'+(k+1)]||'';S.d['plo'+(n-1)]='';S.d.pln=String(Math.max(2,n-1))},
  plm:v=>{S.d.plm=v},
  pollok:()=>{const q=String(S.d.plq||'').trim(),n=Number(S.d.pln)||2,opts=[];for(let i=0;i<n;i++){const o=String(S.d['plo'+i]||'').trim();if(o)opts.push(o)}
    if(!q)return T('请填写投票问题');if(opts.length<2)return T('至少需要 2 个选项');if(new Set(opts).size!==opts.length)return T('选项不能重复');
    const end=v2ms(S.d.plend);if(end&&end<=Date.now())return T('截止时间必须是未来的时间');const c=compState();c.act=null;c.poll={question:q,options:opts,allowMultiple:S.d.plm==='1',closesAt:end||null};S.st.pop();if(typeof saveComposeDraft==='function')saveComposeDraft()},
  pollclr:()=>{compState().poll=null},
  actnew:()=>{const c=compState(),a=c.act||{};Object.assign(S.d,{atit:a.title||'',ast:a.startsAt?v2dtv(a.startsAt):'',aen:a.endsAt?v2dtv(a.endsAt):'',aon:a.online?'1':'0',apl:a.place||'',aurl:a.onlineUrl||'',acap:a.cap?String(a.cap):'',adsc:a.description||''});A.go('actnew')},
  aon:v=>{S.d.aon=v},
  actcov:async()=>{const fs=await pickFiles('image/*',false);const f=fs&&fs[0];if(!f)return;const c=compState();c.actCover={url:URL.createObjectURL(f),file:f};v2rr()},
  actcovx:()=>{compState().actCover=null},
  actok:()=>{const title=String(S.d.atit||'').trim(),st=v2ms(S.d.ast),en=v2ms(S.d.aen),online=S.d.aon==='1',place=String(S.d.apl||'').trim(),url=String(S.d.aurl||'').trim(),cap=S.d.acap?Math.floor(Number(S.d.acap)):null;
    if(!title)return T('请填写活动标题');if(!st)return T('请选择开始时间');if(st<=Date.now())return T('开始时间必须是未来的时间');if(en&&en<=st)return T('结束时间要晚于开始时间');
    if(!online&&!place)return T('请填写活动地点');if(online&&url&&!/^https?:\/\//i.test(url))return T('链接需以 http:// 或 https:// 开头');if(cap!=null&&!(cap>=1))return T('人数上限至少为 1');
    const c=compState();c.poll=null;c.act={title,startsAt:st,endsAt:en||null,online,place,onlineUrl:url,cap,description:String(S.d.adsc||'').trim()};S.st.pop()},
  actclr:()=>{const c=compState();c.act=null;c.actCover=null},
  /* 活动 */
  act:async v=>{A.go('act:'+v);v2rr();const a=await actFetch(v);if(a&&a.mine){const r=await api('GET','/api/activities/'+encodeURIComponent(v)+'/signups');S.actSign=S.actSign||{};S.actSign[v]=r.s===200?(r.j.signups||[]):[]}},
  actjoin:async v=>{const r=await api('POST','/api/activities/'+encodeURIComponent(v)+'/signup',{});if(r.s!==200)return T(v2e(r,'报名失败'));actSync(r.j.activity);T('报名成功')},
  actcancel:v=>{v2confirm('取消报名？','','取消报名',async()=>{const r=await api('POST','/api/activities/'+encodeURIComponent(v)+'/cancel',{});if(r.s!==200)return T(v2e(r,'操作失败'));actSync(r.j.activity);T('已取消报名')})},
  actshare:v=>{const a=S.acts&&S.acts[v];if(!a)return;return v2share((V2EN()?'VEXO Event · ':'VEXO 活动 · ')+a.title,v2when(a.startsAt),v2shareLink('e',a.id),{card:1,lines:[v2when(a.startsAt),a.online?(V2EN()?'Online':'线上'):(a.place||'')]})},
});
document.addEventListener('keydown',e=>{const t=e.target;if(e.key==='Enter'&&!e.isComposing&&t&&t.dataset&&t.dataset.d==='coq'){e.preventDefault();Promise.resolve(A.coq()).then(v2rr)}});
/* 2.0：表态后关掉面板，并把那条消息滚到可见处，让新的表态小标签露出来 */
(()=>{const orig=A.mreact;if(!orig)return;A.mreact=v=>{const id=String(v).split('|')[2];const r=orig(v);const show=()=>setTimeout(()=>{const el=document.getElementById('m-'+id);if(el&&el.scrollIntoView)el.scrollIntoView({block:'nearest',behavior:'smooth'})},60);if(r&&typeof r.then==='function')return r.then(x=>{show();return x});show();return r}})();
