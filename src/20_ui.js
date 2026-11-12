const pollBox=pl=>`<div class="poll"><b>${esc(pl.question)}</b>${(pl.options||[]).map(o=>`<button type="button" class="pb sm${o.voted?' on':''}" data-a="pvote" data-v="${pl.id}|${o.id}" ${pl.closed?'disabled':''}>${esc(o.text)}${o.votes!=null?' · '+o.votes:''}${o.voted?' ✓':''}</button>`).join('')}${pl.closed?'<small class="hint">投票已截止</small>':(pl.closesAt?`<small class="hint">截止后不可再投</small>`:'')}</div>`;
const P=id=>{const a=D.u[id]||D.u.me;return{id,n:a[0],h:a[1],l:a[2],c:a[3],b:a[4],v:a[5]}};
const PH={me:'assets/av-me.jpg',zhou:'assets/av-zhou.jpg',chen:'assets/av-chen.jpg',su:'assets/av-su.jpg',he:'assets/av-he.jpg',jiang:'assets/av-jiang.jpg',pei:'assets/av-pei.jpg',notice:'assets/av-notice.jpg',group:'assets/av-group.jpg'};
const BG=['assets/bg-river.jpg','assets/bg-read.jpg'];
const AVT=Object.entries(PH).filter(([k])=>k!=='group').map(([,v])=>v);
const lookPicks=(list,act,id)=>`<div class="picks">${list.map((src,i)=>`<button type="button" class="sq pick" style="${bgCss(src)}" data-a="${act}" data-v="${id?id+'|'+src:src}" aria-label="样板 ${i+1}"></button>`).join('')}</div>`;
const filePick=(kind,id,label)=>`<label class="pb filepick">${label}<input type="file" accept="image/*" data-pick="${kind}" data-id="${esc(id||'')}"></label>`;
const avx=(c,l,s)=>`<span class="av" style="width:${s}px;height:${s}px;background:${c};color:${c=='#C8A96A'?'#1A1408':'#fff'};font-size:${Math.round(s*.42)}px">${esc(l)}</span>`;
const phImg=(src,s)=>`<span class="av ph" style="width:${s}px;height:${s}px"><img src="${esc(src)}" alt=""></span>`;
function cssUrl(src){return String(src||'').replace(/["'\\\n\r<>]/g,'')}
function bgCss(src){const s=cssUrl(src);if(!s)return 'background:#1a1c20';if(s.startsWith('linear-gradient')||s.startsWith('#'))return 'background:'+s;return "background-color:#1a1c20;background-image:url('"+s+"');background-size:cover;background-position:center"}
const av=(id,s,opt)=>{const own=id==='me'&&D.pf&&D.pf.me&&D.pf.me.ph;
  const acctColor=id==='me'&&MODE==='account'&&!own;
  let h=own?phImg(D.pf.me.ph,s):acctColor?avx(P(id).c,P(id).l,s):PH[id]?phImg(PH[id],s):avx(P(id).c,P(id).l,s);
  const deco=opt&&Object.prototype.hasOwnProperty.call(opt,'dec')?!!opt.dec:(id==='me'&&typeof vipDecoOn==='function'&&vipDecoOn());
  if(deco)h=h.replace(/class="av([^"]*)"/,'class="av dec$1" data-dec="gold"');return h};
const gface=(c,s)=>phImg(c&&c.gp&&(String(c.gp).startsWith('data:')||String(c.gp).startsWith('assets/'))?c.gp:PH.group,s);
const cmface=(c,s)=>phImg(c&&c.cp&&(String(c.cp).startsWith('data:')||String(c.cp).startsWith('assets/'))?c.cp:cove(c&&c.id||''),s);
const meCover=()=>{const f=D.pf&&D.pf.me||{};return f.bg||BG[(+f.cv||0)%BG.length]};
const cove=(key)=>BG[[...String(key)].reduce((a,c)=>a+c.charCodeAt(0),0)%BG.length];
const PAL=['#2F6F5E','#5C4A3A','#243044','#6B3A4A','#3A465C','#6A5A3C'],hc=s=>PAL[[...s].reduce((a,c)=>a+c.charCodeAt(0),0)%6];
const fol=(a,b)=>D.f.some(e=>e[0]==a&&e[1]==b),ncm=id=>{const p=(typeof feedSrc==='function'?feedSrc():D.p).find(x=>x.id==id);if(p&&p.commentCount!=null)return p.commentCount;return D.c.filter(c=>c.p==id).length};
const T=m=>{const t=$('#tt');t.textContent=m;t.style.display='block';clearTimeout(T.h);T.h=setTimeout(()=>t.style.display='none',1800)};
const sub=(t,r='')=>`<div class="top sub"><button class="ib" data-a="back" aria-label="返回">${ic('back')}</button><h1>${t}</h1>${r}</div>`;
const rs=p=>{const t=p.r.reduce((a,b)=>a+b,0);return t?p.r.map((n,i)=>[n,i]).filter(a=>a[0]).sort((a,b)=>b[0]-a[0]).slice(0,3).map(a=>E[a[1]]).join('')+' '+t:''};
const AUD_L={public:'公开',followers:'关注者',friends:'好友',self:'仅自己'};
const pc=(p,det)=>{const u=P(p.a),n=typeof ncm==='function'?ncm(p.id):(p.commentCount||0),aud=AUD_L[p.aud||p.audience||'public']||'公开',tm=typeof fmtTime==='function'&&p.at?fmtTime(p.at):(p.t||'');
const nLike=(p.r||[]).reduce((a,b)=>a+(b||0),0),nC=p.commentCount!=null?p.commentCount:n;
const media=Array.isArray(p.media)?p.media:[];
const mediaH=media.length?`<div class="fmedia n${Math.min(media.length,4)}">${media.slice(0,4).map((m,i)=>{const src=typeof m==='string'?m:(m.url||m.src||'');const kind=m.kind||((m.type||'').startsWith('video')||/\.(mp4|webm|mov)(\?|$)/i.test(src)?'video':'image');return kind==='video'?`<video src="${esc(src)}" muted playsinline preload="metadata"${det?' controls':''}></video>`:`<img src="${esc(src)}" alt="">`;}).join('')}</div>`:'';
const chips=[p.mood?`😊 ${esc(p.mood)}`:'',p.location?`📍 ${esc(p.location)}`:'',(p.tagged&&p.tagged.length)?`👤 ${p.tagged.length} 人`:''].filter(Boolean);
return `<article class="fcard" data-pid="${p.id}"><div class="fhd"><div data-a="user" data-v="${p.a}">${av(p.a,40)}</div><div class="gr" data-a="user" data-v="${p.a}"><b class="fn">${esc(u.n)}${u.v?' '+vipBadge():''}</b><small>${esc(tm)}${tm?' · ':''}${aud}</small></div><button class="ib" data-a="more" data-v="${p.id}" aria-label="更多">${ic('more')}</button></div>${p.x?`<div class="fbd"${det?'':` data-a="post" data-v="${p.id}"`}>${esc(p.x)}</div>`:''}${chips.length?`<div class="fmeta">${chips.map(c=>`<span>${c}</span>`).join('')}</div>`:''}${mediaH}${p.poll?pollBox(p.poll):''}<div class="fsum"><span>${nLike?('👍 '+nLike):''}</span><span>${nC?nC+' 条评论':''}</span></div><div class="fbar"><button data-a="rx" data-v="${p.id}" class="${p.m>=0?'on':''}">👍 ${p.m>=0?'已赞':'赞'}</button><button data-a="post" data-v="${p.id}">💬 评论</button><button data-a="sharep" data-v="${p.id}">↗ 分享</button></div></article>`};
const nav=()=>{const un=(typeof cvSrc==='function'?cvSrc():D.cv).reduce((a,c)=>a+(c.mute||c.hid?0:c.u),0);return '<nav>'+[['home','首页','home'],['cm','社区','people'],['chat','聊天','chat'],['me','我的','person']].map(a=>`<button data-a="tab" data-v="${a[0]}" class="${S.tab==a[0]?'on':''}">${ic(a[2])}${a[1]}${a[0]=='chat'&&un?`<i class="bdg">${un>99?'99+':un}</i>`:''}</button>`).join('')+'</nav>'};
const ban=()=>MODE==='account'?'<div class="ban"><b>已登录 · 私聊使用 Olm（vodozemac）加密</b>一对一私聊在发送前加密，服务端只保存密文。群聊暂不加密。独立安全审查尚未完成，请先核对手友的安全号码。Web 客户端由服务器下发，被替换的脚本可以在加密前取走明文。</div>':'<div class="ban"><b>演示模式 · 未加密</b>此页面仅展示交互效果，不发送真实消息，也不提供端到端加密。</div>';

function hasSafeArea(){
  if(hasSafeArea._v!=null)return hasSafeArea._v;
  try{
    const v=parseFloat(getComputedStyle(document.documentElement).paddingTop)||0;
    hasSafeArea._v=v>=20;
    if(hasSafeArea._v)document.documentElement.classList.add('has-safe-area');
  }catch(e){hasSafeArea._v=false}
  return hasSafeArea._v;
}
function iosStatus(){
  if(hasSafeArea())return '';
  const n=new Date(),m=String(n.getMinutes()).padStart(2,'0');
  return `<div class="ios-sb" aria-hidden="true"><span class="ios-time">${n.getHours()}:${m}</span><span class="ios-inds"><span class="ios-sig"><i></i><i></i><i></i><i></i></span><span class="ios-wifi"></span><span class="ios-bat"></span></span></div>`;
}
