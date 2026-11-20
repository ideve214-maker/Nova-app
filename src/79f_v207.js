/* ===== VEXO 用户端 2.0.7 =====
   1. 评论区翻译：每条评论「翻译」（中↔英自动判断），评论输入框「译」把草稿翻成另一种语言再发；和帖子翻译同一套 /api/ai/translate。
   2. 微信分享：链接改为公开分享页 /s/<帖子>（微信卡片显示标题、摘要和图标），系统分享带上标题；另可生成图片卡片。
   3. 正文里的图片链接（Markdown 图片、图床直链）显示成图片。
   4. 首页每 2 分钟自动刷新一次（只在首页、App 在前台时；滑到下面时只显示「有 N 条新动态」，不打断阅读）。
   5. 外部帖发帖人 / 评论人头像：相对地址按 API 根补全；没有或加载失败时显示首字母头像。 */

/* ---------- 5. 外部作者头像 ---------- */
const EXT_AV_PAL=['#2F6F5E','#5C4A3A','#243044','#6B3A4A','#3A465C','#6A5A3C'];
function extLetterAv(name){
  const s=String(name||'').trim()||'?',l=[...s][0].replace(/[<&"']/g,'')||'?';
  const c=EXT_AV_PAL[[...s].reduce((a,ch)=>a+ch.charCodeAt(0),0)%EXT_AV_PAL.length];
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" rx="40" fill="${c}"/><text x="40" y="52" text-anchor="middle" fill="#fff" font-size="36" font-family="system-ui,sans-serif">${l.toUpperCase()}</text></svg>`;
  return 'data:image/svg+xml;utf8,'+encodeURIComponent(svg);
}
if(typeof document!=='undefined')document.addEventListener('error',e=>{
  const t=e.target;if(!t||t.tagName!=='IMG')return;
  if(t.dataset&&t.dataset.fb&&t.src!==t.dataset.fb){t.src=t.dataset.fb;return}
},true);

/* ---------- 3. 正文里的图片链接 ---------- */
const TX_IMG_EXT=/\.(png|jpe?g|gif|webp|bmp|avif)$/i;
const TX_IMG_HOST=/^(i\.imgur\.com|i\.v2ex\.co|cdn\.v2ex\.com|imgur\.la|pbs\.twimg\.com|i\.loli\.net|s2\.loli\.net|tvax\d\.sinaimg\.cn|wx\d\.sinaimg\.cn)$/i;
function txIsImg(u){try{const x=new URL(u);if(!/^https?:$/.test(x.protocol))return false;return TX_IMG_EXT.test(x.pathname)||(TX_IMG_HOST.test(x.hostname)&&x.pathname.length>1)}catch(e){return false}}
const TX_CACHE=new Map();
function txSplit(text){
  const s=String(text==null?'':text);
  if(!/https?:\/\//i.test(s))return {t:s,imgs:[],links:[]};
  const hit=TX_CACHE.get(s);if(hit)return hit;
  const imgs=[],links=[];const add=u=>{if(!imgs.includes(u)&&imgs.length<9)imgs.push(u)};const addL=u=>{if(!links.includes(u))links.push(u)};
  let t=s.replace(/!\[[^\]\n]*\]\(\s*<?(https?:\/\/[^\s)>]+)>?(?:\s+"[^"]*")?\s*\)/gi,(m,u)=>{add(u);return ''});
  t=t.replace(/(^|[\s(（\[【:：])(https?:\/\/[^\s<>"'）)\]】，。；！？、]+)/gi,(m,pre,u)=>{const clean=u.replace(/[.,;!?，。；！？、]+$/,'');if(!txIsImg(clean)){/* J（2.0.7）：普通链接也从正文拿掉，改成下方的链接卡片 */addL(clean);return pre+u.slice(clean.length)}add(clean);return pre+u.slice(clean.length)});
  /* Markdown 普通链接 [文字](url)：保留文字，链接放进卡片 */
  t=t.replace(/\[([^\]\n]+)\]\(\s*(https?:\/\/[^\s)]+)\s*\)/gi,(m,txt,u)=>{addL(u);return txt});
  t=t.replace(/[(（]\s*[)）]/g,'').replace(/\[\s*\]/g,'').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  const out={t,imgs,links};
  if(TX_CACHE.size>500)TX_CACHE.delete(TX_CACHE.keys().next().value);
  TX_CACHE.set(s,out);return out;
}
/* ---------- 1. 评论翻译 ---------- */
function trHasCjk(s){return /[\u3400-\u9fff\uf900-\ufaff]/.test(String(s||''))}
function trInBtn(pid){return typeof trCan==='function'&&trCan()?`<button type="button" class="ib trin${S.trin?' busy':''}" data-a="trcin" data-v="${esc(String(pid))}" aria-label="翻译输入内容（中文↔英文）" title="中文↔英文">${S.trin?'…':'译'}</button>`:''}
Object.assign(A,{
  trc:v=>{const all=typeof commentsOf==='function'&&S.commentPost!=null?commentsOf(S.commentPost):(D.c||[]);const c=all.find(x=>String(x.id)===String(v));if(!c)return;const src=typeof txSplit==='function'?txSplit(c.x).t:c.x;return trRun('c:'+v,src)},
  trcin:async v=>{
    const src=String(S.d.cin||'').trim();if(!src)return T('先写好评论，再点「译」');
    if(S.trin)return;S.trin=1;if(typeof render==='function')render();
    const to=trHasCjk(src)?'en':'zh';
    const r=await api('POST','/api/ai/translate',{text:[...src].slice(0,2000).join(''),to});
    S.trin=0;
    if(r.s!==200){T(r.s===429?errMsg(r,'翻译次数太多了，请稍后再试'):r.s===503?'翻译暂时不可用，请稍后再试':errMsg(r,'翻译失败'));return}
    S.d.cin=String(r.j.text||'').slice(0,280);T(to==='en'?'已翻译成英文，确认后点发送':'已翻译成中文，确认后点发送');
  },
});

/* ---------- 2. 分享 ---------- */
/* 帖子的公开分享页 /s/<id>（微信卡片的标题、摘要、缩略图取自这页）由服务端提供；
   服务端在 GET /api/health 里返回 features.postSharePage=true 后才用它，否则沿用原来的 /#/post/<id> 链接。 */
let POST_SHARE_PAGE=null;
async function postSharePageProbe(){
  if(POST_SHARE_PAGE!==null)return POST_SHARE_PAGE;
  try{const r=await fetch(apiUrl('/api/health'),{cache:'no-store'});const j=r.ok?await r.json():null;POST_SHARE_PAGE=!!(j&&j.features&&j.features.postSharePage)}catch(e){POST_SHARE_PAGE=false}
  return POST_SHARE_PAGE;
}
function postShareLink(id){
  const b=typeof v2shareBase==='function'?v2shareBase():'';
  if(POST_SHARE_PAGE&&/^https?:\/\//i.test(b))return b+'/s/'+encodeURIComponent(id);
  return typeof postLink==='function'?postLink(id):'';
}
function postShareInfo(p){
  const u=p?P(p.a):{n:''},name=(u&&u.n)||'VEXO 用户';
  const tx=typeof txSplit==='function'?txSplit(p&&p.x):{t:(p&&p.x)||'',imgs:[]};
  const first=((tx.t||'').split('\n').find(l=>l.trim())||'').trim();
  const head=[...first].slice(0,36).join('')+([...first].length>36?'…':'');
  return {name,text:tx.t||'',imgs:tx.imgs,title:(head||name+' 的动态')+' · VEXO',src:(p&&p.sourceLabel)||''};
}
async function sharePoster(p){
  try{
    if(typeof document==='undefined'||typeof File==='undefined')return null;
    const W=1080,H=1440,c=document.createElement('canvas');c.width=W;c.height=H;const g=c.getContext('2d');if(!g)return null;
    const info=postShareInfo(p),F='"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif';
    const load=src=>new Promise(res=>{if(!src)return res(null);const im=new Image();if(/^https?:/i.test(src))im.crossOrigin='anonymous';im.onload=()=>res(im);im.onerror=()=>res(null);im.src=src;setTimeout(()=>res(null),4000)});
    const gr=g.createLinearGradient(0,0,W,H);gr.addColorStop(0,'#4F6EF7');gr.addColorStop(1,'#8A5CF6');g.fillStyle=gr;g.fillRect(0,0,W,H);
    const rr=(x,y,w,h,r)=>{g.beginPath();g.moveTo(x+r,y);g.arcTo(x+w,y,x+w,y+h,r);g.arcTo(x+w,y+h,x,y+h,r);g.arcTo(x,y+h,x,y,r);g.arcTo(x,y,x+w,y,r);g.closePath()};
    g.fillStyle='#fff';rr(56,56,W-112,H-112,44);g.fill();
    /* 头像 */
    let avSrc=typeof avSrcOf==='function'?avSrcOf(p.a):'';if(avSrc&&typeof isMediaId==='function'&&isMediaId(avSrc))avSrc=typeof imcSync==='function'?imcSync(avSrc,'f'):'';
    const avIm=await load(avSrc)||await load(String(p.a).startsWith('ext:')?extLetterAv(info.name):'');
    g.save();g.beginPath();g.arc(176,196,64,0,Math.PI*2);g.closePath();g.clip();
    if(avIm)g.drawImage(avIm,112,132,128,128);else{g.fillStyle='#3A465C';g.fillRect(112,132,128,128);g.fillStyle='#fff';g.font='bold 60px '+F;g.textAlign='center';g.fillText([...info.name][0]||'V',176,218);g.textAlign='left'}
    g.restore();
    g.fillStyle='#13151C';g.font='bold 48px '+F;g.fillText([...info.name].slice(0,16).join(''),272,186);
    g.fillStyle='#8A90A2';g.font='34px '+F;g.fillText(info.src||'VEXO 动态',272,236);
    /* 正文 */
    const wrap=(t,font,max,lh,y,color,maxL)=>{g.font=font;g.fillStyle=color;let line='',n=0;for(const ch of [...String(t||'')]){if(ch==='\n'){g.fillText(line,112,y);y+=lh;line='';if(++n>=maxL)return y;continue}if(g.measureText(line+ch).width>max){g.fillText(line,112,y);y+=lh;line=ch;if(++n>=maxL-1){g.fillText(line+'…',112,y);return y+lh}}else line+=ch}if(line){g.fillText(line,112,y);y+=lh}return y};
    /* 配图：已缓存的媒体或外部图片（允许跨域时） */
    const media=(Array.isArray(p.media)?p.media:[]).map(x=>typeof mItem==='function'?mItem(x):x).filter(x=>!x.kind||x.kind==='image');
    let picSrc='';if(media[0]){picSrc=media[0].url||(typeof imcSync==='function'?imcSync(media[0].id,'c')||imcSync(media[0].id,'f')||imcSync(media[0].id,'p'):'')}if(!picSrc&&info.imgs[0])picSrc=info.imgs[0];
    const pic=await load(picSrc);
    let y=330;y=wrap(info.text||'分享了一条动态','42px '+F,W-224,62,y,'#2A2E3A',pic?6:13)+10;
    if(pic){const bw=W-224,bh=Math.min(H-y-230,Math.round(bw*pic.height/Math.max(1,pic.width)));if(bh>120){g.save();rr(112,y,bw,bh,24);g.clip();const sc=Math.max(bw/pic.width,bh/pic.height),dw=pic.width*sc,dh=pic.height*sc;g.drawImage(pic,112+(bw-dw)/2,y+(bh-dh)/2,dw,dh);g.restore()}}
    /* 底部 */
    g.fillStyle='#EEF0F6';g.fillRect(112,H-230,W-224,2);
    g.fillStyle='#4F6EF7';g.font='bold 44px '+F;g.fillText('VEXO',112,H-160);
    g.fillStyle='#8A90A2';g.font='30px '+F;g.fillText('打开 VEXO 查看全文、点赞和评论',112,H-110);
    const blob=await new Promise(res=>{try{c.toBlob(res,'image/png')}catch(e){res(null)}});if(!blob)return null;
    return new File([blob],'vexo-post.png',{type:'image/png'});
  }catch(e){return null}
}
function v207Sheet(s){
  if(s.t==='xshare7'){const p=typeof findPost==='function'?findPost(s.id):null;const url=postShareLink(s.id),info=postShareInfo(p);const sys=typeof navigator!=='undefined'&&!!navigator.share;
    return `<h3>分享帖子</h3><div class="shcard"><b data-ut>${esc(info.title)}</b><small data-ut>${esc(info.name)}${info.src?' · '+esc(info.src):''}</small>${url?`<span class="v2shu" data-ut>${esc(url)}</span>`:''}</div>${sys&&/^https?:/i.test(url)?`<button class="mi" data-a="xwx" data-v="${esc(s.id)}">💬 分享到微信 / 其他应用（链接卡片）</button>`:''}<button class="mi" data-a="xposter" data-v="${esc(s.id)}">🖼 生成分享图片</button><button class="mi" data-a="xcopylink" data-v="${esc(s.id)}">🔗 复制链接（粘贴到微信）</button>${p&&p.x?`<button class="mi" data-a="xcopytext" data-v="${esc(s.id)}">📋 复制正文</button>`:''}<button class="mi" data-a="x" style="color:var(--t2)">取消</button>`}
  if(s.t==='xposter'){return `<h3>分享图片</h3>${s.busy?'<p class="em">正在生成…</p>':s.url?`<img class="shposter" src="${esc(s.url)}" alt="分享图片"><p class="hint" style="text-align:center">长按图片保存，或发送给微信好友</p>${s.canFiles?`<button class="mi" data-a="xpostershare">📤 发送图片</button>`:''}<a class="mi" href="${esc(s.url)}" download="vexo-post.png">⬇️ 保存图片</a>`:'<p class="em">生成失败，请稍后再试</p>'}<button class="mi" data-a="x" style="color:var(--t2)">关闭</button>`}
  return '';
}
Object.assign(A,{
  xshare:v=>{S.sh={t:'xshare7',id:v};if(POST_SHARE_PAGE===null)return postSharePageProbe()},
  xcopylink:async v=>{S.sh=null;const ok=await copyText(postShareLink(v));T(ok?'已复制链接，可以粘贴到微信':'复制失败，请长按手动复制')},
  /* 微信不接受「文字 + 链接」混合，这里只给标题 + 链接；标题会显示在分享面板和部分应用的卡片上，微信卡片的标题/摘要/缩略图取自分享页 */
  xwx:async v=>{S.sh=null;const p=findPost(v),u=postShareLink(v),info=postShareInfo(p);if(!/^https?:/i.test(u)){const ok=await copyText(u);T(ok?'已复制帖子链接':'复制失败');return}try{await navigator.share({title:info.title,url:u})}catch(e){if(e&&e.name==='AbortError')return;const ok=await copyText(u);T(ok?'已复制链接，可以粘贴到微信':'复制失败')}},
  xposter:async v=>{const p=findPost(v);if(!p)return;S.sh={t:'xposter',id:v,busy:1};if(typeof render==='function')render();const f=await sharePoster(p);if(!S.sh||S.sh.t!=='xposter')return;
    let can=false;try{can=!!(f&&navigator.canShare&&navigator.canShare({files:[f]}))}catch(e){}
    S.sh={t:'xposter',id:v,url:f?URL.createObjectURL(f):'',file:f,canFiles:can}},
  xpostershare:async()=>{const s=S.sh;if(!s||!s.file)return;try{await navigator.share({files:[s.file]})}catch(e){if(e&&e.name==='AbortError')return;T('当前系统不支持直接发送图片，请长按保存')}},
});

/* ---------- 4. 首页每 2 分钟自动刷新 ---------- */
const FEED_AUTO_MS=(()=>{try{const n=Number(window.NOVA_FEED_REFRESH_MS);if(n>=30000)return n}catch(e){}return 120000})();
function feedAutoTick(){
  try{
    if(typeof document!=='undefined'&&document.hidden)return;
    if(typeof usingNet!=='function'||!usingNet()||!SESSION)return;
    const cur=S.st&&S.st[S.st.length-1];if(cur||S.tab!=='home'||S.sh)return;
    if(typeof ptrBlocked==='function'&&ptrBlocked())return;
    S.feedAutoAt=Date.now();
    if(typeof refreshFeedSafe==='function')refreshFeedSafe();
  }catch(e){}
}
if(typeof window!=='undefined'&&!window.__vexoFeedAuto){window.__vexoFeedAuto=setInterval(feedAutoTick,FEED_AUTO_MS)}

/* ---------- L. 通知「全部已读」（服务端已有 POST /api/notifications/read-all） ---------- */
Object.assign(A,{
  nrall:async()=>{
    const L=typeof nSrc==='function'?nSrc():(D.n||[]);
    L.forEach(n=>{n.u=0});S.notifUnread=0;
    if(typeof usingNet==='function'&&usingNet()&&SESSION){
      const r=await api('POST','/api/notifications/read-all',{});
      if(r.s!==200){T(errMsg(r,'操作失败，请稍后再试'));}
      else T('已全部标为已读');
      if(typeof loadNotifications==='function')await loadNotifications();
    }else{if(typeof save==='function')save();T('已全部标为已读')}
  },
});

/* ---------- J. 正文链接 → 预览卡片 ----------
   服务端以后在帖子上返回 linkPreview（或 linkPreviews[]）：{url,title,description,image,siteName}，有就显示标题、摘要、缩略图；
   没有时显示紧凑卡片：网站图标 + 域名 + 路径。点卡片用应用内浏览器打开。 */
function lkHost(u){try{return new URL(u).hostname.replace(/^www\./,'')}catch(e){return ''}}
function lkPath(u){try{const x=new URL(u);let p=decodeURIComponent(x.pathname+(x.search||'')).replace(/\/$/,'');return p.length>48?p.slice(0,46)+'…':p}catch(e){return ''}}
function lkPrevOf(p,u){
  if(!p)return null;
  const L=[].concat(p.linkPreviews||[],p.linkPreview||[],p.preview||[],p.og||[]).filter(x=>x&&typeof x==='object');
  return L.find(x=>x.url===u)||(L.length===1&&!L[0].url?L[0]:null)||null;
}
function lkCards(links,p,det){
  if(!links||!links.length)return '';
  return '<div class="lkcs">'+links.slice(0,det?3:1).map(u=>{
    const h=lkHost(u);if(!h)return '';
    const pv=lkPrevOf(p,u)||{};
    const fav='https://'+h+'/favicon.ico',fb=typeof extLetterAv==='function'?extLetterAv(h):'';
    const img=pv.image&&/^https?:/i.test(pv.image)?`<img class="lkimg" src="${esc(pv.image)}" referrerpolicy="no-referrer" alt="" loading="lazy" data-fb="${esc(fb)}">`:'';
    const title=pv.title?esc(String(pv.title).slice(0,120)):esc(lkPath(u)||h);
    return `<button type="button" class="lkc${img?' big':''}" data-a="extlink" data-v="${esc(u)}" aria-label="打开链接 ${esc(h)}">${img}<span class="lkb"><span class="lkh"><img class="lkfav" src="${esc(fav)}" referrerpolicy="no-referrer" alt="" loading="lazy" data-fb="${esc(fb)}"><span>${esc(pv.siteName||h)}</span></span><span class="lkt">${title}</span>${pv.description?`<span class="lkd">${esc(String(pv.description).slice(0,160))}</span>`:''}</span><span class="lkgo" aria-hidden="true">›</span></button>`;
  }).join('')+'</div>';
}
