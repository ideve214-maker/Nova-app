const pollBox=pl=>typeof pollCard==='function'?pollCard(pl):`<div class="poll"><b>${esc(pl.question)}</b>${(pl.options||[]).map(o=>`<button type="button" class="pb sm${o.voted?' on':''}" data-a="pvote" data-v="${pl.id}|${o.id}" ${pl.closed?'disabled':''}>${esc(o.text)}${o.votes!=null?' · '+o.votes:''}${o.voted?' ✓':''}</button>`).join('')}${pl.closed?'<small class="hint">投票已截止</small>':(pl.closesAt?`<small class="hint">截止后不可再投</small>`:'')}</div>`;
const P=id=>{const a=D.u[id]||D.u.me;return{id,n:a[0],h:a[1],l:a[2],c:a[3],b:a[4],v:a[5],g:a[6]||''}};
const PH={me:'assets/av-me.jpg',zhou:'assets/av-zhou.jpg',chen:'assets/av-chen.jpg',su:'assets/av-su.jpg',he:'assets/av-he.jpg',jiang:'assets/av-jiang.jpg',pei:'assets/av-pei.jpg',notice:'assets/av-notice.jpg',group:'assets/av-group.jpg'};
const BG=['assets/bg-river.jpg','assets/bg-read.jpg'];
const AVT=Object.entries(PH).filter(([k])=>k!=='group').map(([,v])=>v);
const lookPicks=(list,act,id)=>`<div class="picks">${list.map((src,i)=>`<button type="button" class="sq pick" style="${bgCss(src)}" data-a="${act}" data-v="${id?id+'|'+src:src}" aria-label="样板 ${i+1}"></button>`).join('')}</div>`;
const filePick=(kind,id,label)=>`<label class="pb filepick">${label}<input type="file" accept="image/*" data-pick="${kind}" data-id="${esc(id||'')}"></label>`;
const avx=(c,l,s)=>`<span class="av" style="width:${s}px;height:${s}px;background:${c};color:${c=='#C8A96A'?'#1A1408':'#fff'};font-size:${Math.round(s*.42)}px">${esc(l)}</span>`;
const phImg=(src,s)=>`<span class="av ph" style="width:${s}px;height:${s}px"><img src="${esc(src)}" alt=""></span>`;
/* 2.0.2：统一的数字缩写。1 万以上缩写：中文 4.6万 / 1万 / 1.2亿，英文 45.8K / 1.2M。 */
function fmtCount(n){n=Math.max(0,Math.floor(Number(n)||0));if(n<10000)return String(n);
  const t=(v,u)=>{const r=Math.round(v*10)/10;return String(r).replace(/\.0$/,'')+u};
  if(typeof LANG!=='undefined'&&LANG==='en'){if(n<999950)return t(n/1e3,'K');if(n<999950000)return t(n/1e6,'M');return t(n/1e9,'B')}
  if(n<99995000)return t(n/1e4,'万');return t(n/1e8,'亿')}
function cssUrl(src){return String(src||'').replace(/["'\\\n\r<>]/g,'')}
function bgCss(src){const s=cssUrl(src);if(!s)return 'background:#1a1c20';if(s.startsWith('linear-gradient')||s.startsWith('#'))return 'background:'+s;return "background-color:#1a1c20;background-image:url('"+s+"');background-size:cover;background-position:center"}
/* r10：头像只有两种——官方默认头像，或者从相册导入的图片（存服务器，别人也能看到）。去掉了「颜色 + 文字」头像。 */
const DEF_AV='assets/av-default.svg';
const avSrcOf=id=>{if(id==='me')return (D.pf&&D.pf.me&&D.pf.me.ph)||'';return (D.uph&&D.uph[id])||''};
const lookImg=(src,s)=>isMediaId(src)?`<span class="av ph" style="width:${s}px;height:${s}px"><img src="${(typeof imcSync==='function'&&imcSync(src,'f'))||DEF_AV}" data-avm="${esc(src)}" alt=""></span>`:phImg(src,s);
const av=(id,s,opt)=>{const src=avSrcOf(id);
  let h=src?lookImg(src,s):(MODE!=='account'&&PH[id])?phImg(PH[id],s):phImg(DEF_AV,s);
  const deco=opt&&Object.prototype.hasOwnProperty.call(opt,'dec')?!!opt.dec:(id==='me'&&typeof vipDecoOn==='function'&&vipDecoOn());
  if(deco)h=h.replace(/class="av([^"]*)"/,'class="av dec$1" data-dec="gold"');return h};
const gface=(c,s)=>{const src=c&&c.gp||'';if(isMediaId(src))return lookImg(src,s).replace(DEF_AV,PH.group);return phImg(src&&(String(src).startsWith('data:')||String(src).startsWith('blob:')||String(src).startsWith('assets/'))?src:PH.group,s)};
const isMediaId=src=>/^md_[A-Za-z0-9_-]{8,80}$/.test(String(src||''));
/* 2.0.1：上传的背景（媒体 id）绝不先显示默认背景——有缓存直接显示，没有就用主色占位再淡入 */
function lookCss(src,fallback){const s=String(src||'');if(isMediaId(s))return typeof imcBgCss==='function'?imcBgCss(s):'background:#1a1c20';return bgCss(s||fallback||'')}
function lookMbg(src){return isMediaId(src)?` data-mbg="${esc(src)}"`:''}
const cmface=(c,s)=>{const src=c&&c.cp||'';if(isMediaId(src))return lookImg(src,s);return phImg(src&&(String(src).startsWith('data:')||String(src).startsWith('blob:')||String(src).startsWith('assets/'))?src:cove(c&&c.id||''),s)};
const meCover=()=>{const f=D.pf&&D.pf.me||{};return f.bg||BG[(+f.cv||0)%BG.length]};
const userCover=id=>(D.ubg&&D.ubg[id])||'';
const cove=(key)=>BG[[...String(key)].reduce((a,c)=>a+c.charCodeAt(0),0)%BG.length];
const PAL=['#2F6F5E','#5C4A3A','#243044','#6B3A4A','#3A465C','#6A5A3C'],hc=s=>PAL[[...s].reduce((a,c)=>a+c.charCodeAt(0),0)%6];
const fol=(a,b)=>D.f.some(e=>e[0]==a&&e[1]==b),ncm=id=>{const p=(typeof feedSrc==='function'?feedSrc():D.p).find(x=>x.id==id);if(p&&p.commentCount!=null)return p.commentCount;return D.c.filter(c=>c.p==id).length};
const T=m=>{const t=$('#tt');if(!t)return;t.textContent=m;t.style.display='block';t.classList.remove('tt-out');void t.offsetWidth;t.classList.add('tt-in');clearTimeout(T.h);clearTimeout(T.h2);T.h=setTimeout(()=>{t.classList.remove('tt-in');t.classList.add('tt-out');T.h2=setTimeout(()=>{t.style.display='none';t.classList.remove('tt-out')},200)},1800)};
const sub=(t,r='')=>`<div class="top sub"><button class="ib" data-a="back" aria-label="返回">${ic('back')}</button><h1>${t}</h1>${r}</div>`;
const rs=p=>{const t=p.r.reduce((a,b)=>a+b,0);return t?p.r.map((n,i)=>[n,i]).filter(a=>a[0]).sort((a,b)=>b[0]-a[0]).slice(0,3).map(a=>E[a[1]]).join('')+' '+t:''};
const AUD_L={public:'公开',followers:'仅粉丝',friends:'仅好友',self:'仅自己'};
function audLabel(p){const from=p&&(p.audienceLabel||p.audience_label);if(from)return String(from);const k=(p&&(p.aud||p.audience))||'public';return AUD_L[k]||(p&&p.isPublic===false?'非公开':'公开')}
const pc=(p,det)=>{const u=P(p.a),n=typeof ncm==='function'?ncm(p.id):(p.commentCount||0),aud=audLabel(p),tm=typeof fmtTime==='function'&&p.at?fmtTime(p.at):(p.t||'');
const nLike=(p.r||[]).reduce((a,b)=>a+(b||0),0),nC=p.commentCount!=null?p.commentCount:n;
const media=Array.isArray(p.media)?p.media:[];
const mediaH=typeof mediaHTML==='function'?mediaHTML(media,det,p.id):'';
const mood=p.mood&&!(typeof isStory==='function'&&p.mood===STORY_MARK)?p.mood:'';
const chips=[p.boost?(p.boost.label==='推流中'?`🚀 推流中 · 已曝光 ${Number(p.boost.delivered)||0}/${Number(p.boost.impressions)||0}`:'🔥 曝光中'):'',S.feed==='topic'&&S.hotMode&&p.hotPosition&&!det?`🔥 热门 ${p.hotPosition}`:'',mood?esc(typeof moodLabel==='function'?moodLabel(mood):'😊 '+mood):'',p.location?`📍 ${esc(p.location)}`:'',(p.tagged&&p.tagged.length)?`👥 和 ${esc(typeof taggedNames==='function'?taggedNames(p.tagged):p.tagged.length+' 人')} 在一起`:''].filter(Boolean);
return `<article class="fcard" data-pid="${p.id}"><div class="fhd"><div data-a="user" data-v="${p.a}">${av(p.a,40)}</div><div class="gr" data-a="user" data-v="${p.a}"><b class="fn nmb">${nmB(u)}</b><small>${esc(tm)}${tm?' · ':''}${aud}</small></div><button class="ib" data-a="more" data-v="${p.id}" aria-label="更多">${ic('more')}</button></div>${p.x&&!(p.activity&&p.x===p.activity.title)?`<div class="fbd"${det?'':` data-a="post" data-v="${p.id}"`}>${esc(p.x)}</div>${typeof trBox==='function'?trBox('p:'+p.id):''}`:''}${chips.length?`<div class="fmeta">${chips.map(c=>`<span>${c}</span>`).join('')}</div>`:''}${mediaH}${p.poll?pollBox(p.poll):''}${p.activity&&typeof actCard==='function'?actCard(p.activity):''}${typeof xbar==='function'?xbar(p,nLike,nC):''}</article>`};
const nav=()=>{const un=(typeof cvSrc==='function'?cvSrc():D.cv).reduce((a,c)=>a+(c.mute||c.hid?0:c.u),0)+(S.mreqCount||0);return '<nav class="fnav">'+[['home','首页','home'],['cm','社区','people'],['co','共创','spark'],['chat','聊天','chat'],['me','我的','person']].map(a=>`<button data-a="tab" data-v="${a[0]}" class="${S.tab==a[0]?'on':''}">${ic(a[2])}${a[1]}${a[0]=='chat'&&un?`<i class="bdg">${un>99?'99+':un}</i>`:''}</button>`).join('')+'</nav>'};
function riskNoticeText(id){
  const u=S.userView&&String(S.userView.id)===String(id)&&S.userView.user;
  if(u&&String(u.id)===String(id)&&(u.riskNotice||u.risky))return u.riskNotice||'这个账号近期被多人举报。请核实对方身份，不要轻信转账、投资或私下链接。';
  return (S.riskNote&&S.riskNote[String(id)])||'';
}
/* 聊天列表：登录后只留一行浅灰小字，不再用大红横幅 */
const banList=()=>MODE==='account'?'<div class="e2line">私聊已加密</div>':ban();
const ban=()=>MODE==='account'?'<div class="ban"><b>已登录 · 私聊已加密</b>一对一聊天会加密后发送。</div>':'<div class="ban"><b>演示模式</b>这里只是演示，不会发送真实消息。</div>';

function hasSafeArea(){
  if(hasSafeArea._v!=null)return hasSafeArea._v;
  try{
    const d=document.createElement('div');
    d.style.cssText='position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px)';
    document.documentElement.appendChild(d);
    const v=parseFloat(getComputedStyle(d).paddingTop)||0;
    d.remove();
    hasSafeArea._v=v>=20;
    if(hasSafeArea._v)document.documentElement.classList.add('has-safe-area');
  }catch(e){hasSafeArea._v=false}
  return hasSafeArea._v;
}
function isDesktopPreview(){
  try{
    if(window.Capacitor||window.navigator.standalone)return false;
    if(/iPhone|iPad|iPod|Android/i.test(navigator.userAgent||''))return false;
    return window.matchMedia('(min-width:600px) and (hover:hover) and (pointer:fine)').matches;
  }catch(e){return false}
}
function iosStatus(){
  if(hasSafeArea()||!isDesktopPreview())return '';
  const n=new Date(),m=String(n.getMinutes()).padStart(2,'0');
  return `<div class="ios-sb" aria-hidden="true"><span class="ios-time">${n.getHours()}:${m}</span><span class="ios-inds"><span class="ios-sig"><i></i><i></i><i></i><i></i></span><span class="ios-wifi"></span><span class="ios-bat"></span></span></div>`;
}
