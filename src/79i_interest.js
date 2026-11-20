/* ===== VEXO 2.0.7：个性化推荐（M，用户端部分）=====
   接口（Dift 服务端 2.1.2）：
   - GET/PUT /api/me/interests  {like:[category], dislike:[category], hiddenSources:[origin], onboarded:bool}
   - POST /api/feed/not-interested {postId, reason:'post'|'category'|'source'}
   - POST /api/feed/signals {events:[{postId, dwellMs, action, at}]}；action：view|open|open_origin|like|save|share|hide；
     每 30 秒或切到后台时批量发，每批最多 100 条；停留时长只在帖子露出一半以上时计时。
   服务端还没有这些接口（404）时全部静默跳过：不弹选择页、设置里不显示、不上报。 */
const INT_CATS=[['tech','科技','💻'],['game','游戏','🎮'],['crypto','币圈','🪙'],['finance','财经','📈'],['news','综合热点','📰'],['life','生活','🌿'],['other','其他','✨']];
const INT={sup:null,data:null,busy:0,asked:0,draft:null};
const intNet=()=>typeof usingNet==='function'&&usingNet()&&!!SESSION;
const intCatName=c=>{const x=INT_CATS.find(k=>k[0]===c);return x?x[1]:c};
async function intLoad(force){
  if(!intNet()||INT.busy||(INT.sup===false&&!force))return INT.data;
  INT.busy=1;let r;try{r=await api('GET','/api/me/interests')}catch(e){r={s:0}}INT.busy=0;
  if(r.s===404||r.s===405||r.s===501){INT.sup=false;return null}
  if(r.s!==200||!r.j)return INT.data;
  INT.sup=true;const j=r.j.interests||r.j;
  INT.data={like:Array.isArray(j.like)?j.like:[],dislike:Array.isArray(j.dislike)?j.dislike:[],hiddenSources:Array.isArray(j.hiddenSources)?j.hiddenSources:[],onboarded:!!j.onboarded};
  /* 第一次打开（更新后）还没选过：弹一次选择页（每个账号本机只问一次，跳过也算） */
  const k='vexo_int_asked_'+(SESSION&&SESSION.user&&SESSION.user.id);
  let asked='';try{asked=localStorage.getItem(k)||''}catch(e){}
  if(!INT.data.onboarded&&!asked&&!S.sh&&S.tab==='home'&&!(S.st&&S.st.length)){try{localStorage.setItem(k,'1')}catch(e){}INT.draft=intDraft();S.sh={t:'intpick',first:1};if(typeof render==='function')render()}
  return INT.data;
}
function intDraft(){const d=INT.data||{like:[],dislike:[],hiddenSources:[]};return {like:[...d.like],dislike:[...d.dislike],hiddenSources:[...d.hiddenSources]}}
async function intSave(body){
  let r;try{r=await api('PUT','/api/me/interests',body)}catch(e){r={s:0}}
  if(r.s===404){INT.sup=false;return false}
  if(r.s!==200){T(errMsg(r,'保存失败，请稍后再试'));return false}
  const j=r.j&&(r.j.interests||r.j);/* 服务端会规范化（喜欢和不喜欢重叠时按不喜欢），以返回为准 */
  INT.data=j&&Array.isArray(j.like)?{like:j.like,dislike:j.dislike||[],hiddenSources:j.hiddenSources||[],onboarded:j.onboarded!==false}:{...(INT.data||{}),...body};return true;
}
function intRow(){
  if(!intNet()||INT.sup===false)return '';
  if(INT.sup===null)intLoad();
  const d=INT.data;const sum=d&&d.like.length?d.like.map(intCatName).join('、'):'还没选';
  return `<div class="row"><div class="gr"><b>兴趣偏好</b><small>「为你推荐」多推你感兴趣的类型 · ${esc(sum)}</small></div><button class="pb sm s" data-a="intopen">设置</button></div>`;
}
function intSheet(s){
  if(s.t!=='intpick')return '';
  const d=INT.draft||(INT.draft=intDraft());
  const chip=([k,n,e])=>{const st=d.like.includes(k)?'on':d.dislike.includes(k)?'no':'';return `<button type="button" class="ichip ${st}" data-a="intchip" data-v="${k}" aria-pressed="${st==='on'}">${e} ${n}${st==='no'?' · 不想看':''}</button>`};
  const hs=d.hiddenSources.length?`<div class="shd" style="margin-top:12px">已隐藏的来源</div><div class="ichips">${d.hiddenSources.map(o=>`<button type="button" class="ichip no" data-a="intunhide" data-v="${esc(o)}">${esc(typeof extSrcName==='function'?extSrcName({source:o}):o)} ✕</button>`).join('')}</div>`:'';
  return `<h3>${s.first?'选几个你感兴趣的':'兴趣偏好'}</h3><p class="hint">点一下是「感兴趣」，再点一下是「不想看」，再点取消。之后也可以在 设置 → 兴趣偏好 里改。</p><div class="ichips">${INT_CATS.map(chip).join('')}</div>${hs}<div class="fr" style="margin-top:14px;gap:8px"><button class="pb s" data-a="intskip">${s.first?'跳过':'取消'}</button><button class="pb" data-a="intsave">保存</button></div>`;
}
function niItems(p){
  if(!p||p.a==='me'||!intNet()||INT.sup===false)return '';
  const id=esc(String(p.id));
  return `<button class="mi" data-a="niset" data-v="post|${id}">🙈 不感兴趣</button>${p.category&&p.category!=='other'?`<button class="mi" data-a="niset" data-v="category|${id}">少推「${esc(intCatName(p.category))}」类内容</button>`:''}${p.source?`<button class="mi" data-a="niset" data-v="source|${id}">不看${esc((typeof extSrcLabel==='function'?extSrcLabel(p):'').replace(/^来自 /,'来自 ')||'这个来源')}的帖子</button>`:''}`;
}
function intFindPost(id){return (typeof feedSrc==='function'?feedSrc():D.p).find(x=>String(x.id)===String(id))||(typeof findPost==='function'?findPost(id):null)}
function intDropLocal(pred){if(Array.isArray(S.posts)){S.posts=S.posts.filter(x=>!pred(x))}}
Object.assign(A,{
  intopen:()=>{INT.draft=intDraft();S.sh={t:'intpick'};if(INT.sup===null)return intLoad()},
  intchip:v=>{const d=INT.draft||(INT.draft=intDraft());if(d.like.includes(v)){d.like=d.like.filter(x=>x!==v);d.dislike.push(v)}else if(d.dislike.includes(v)){d.dislike=d.dislike.filter(x=>x!==v)}else d.like.push(v)},
  intunhide:v=>{const d=INT.draft||(INT.draft=intDraft());d.hiddenSources=d.hiddenSources.filter(x=>x!==v)},
  intskip:async()=>{const first=S.sh&&S.sh.first;S.sh=null;INT.draft=null;if(first&&INT.sup)await intSave({onboarded:true})},
  intsave:async()=>{const d=INT.draft||intDraft();S.sh=null;const ok=await intSave({like:d.like,dislike:d.dislike,hiddenSources:d.hiddenSources,onboarded:true});INT.draft=null;if(ok){T('已保存，「为你推荐」会多推你感兴趣的内容');if(typeof refreshFeedSafe==='function')refreshFeedSafe()}},
  niset:async v=>{const[reason,id]=String(v).split('|');const p=intFindPost(id);S.sh=null;
    sigPush(id,0,'hide');
    if(reason==='post')intDropLocal(x=>String(x.id)===String(id));
    else if(reason==='category'&&p&&p.category){intDropLocal(x=>x.category===p.category);if(INT.data&&!INT.data.dislike.includes(p.category)){INT.data.dislike.push(p.category);INT.data.like=INT.data.like.filter(x=>x!==p.category)}}
    else if(reason==='source'&&p&&p.source){intDropLocal(x=>x.source===p.source);if(INT.data&&!INT.data.hiddenSources.includes(p.source))INT.data.hiddenSources.push(p.source)}
    T(reason==='post'?'好的，以后少推类似内容':reason==='category'?'好的，以后少推这类内容':'好的，不再推这个来源的帖子');
    let r;try{r=await api('POST','/api/feed/not-interested',{postId:sigId(id)||id,reason})}catch(e){r={s:0}}
    /* 服务端 2.1.2 返回 {ok, interests}：用它刷新本地偏好 */
    if(r.s===200&&r.j&&r.j.interests){const j=r.j.interests;INT.data={like:j.like||[],dislike:j.dislike||[],hiddenSources:j.hiddenSources||[],onboarded:!!j.onboarded}}
  },
});

/* ---------- 行为上报 ---------- */
const SIG={q:[],on:new Map(),acc:new Map(),off:false,timer:0,MAX:100,until:0};
function sigOk(){return !SIG.off&&intNet()}
/* 服务器帖子 id（po_xxx 或数字）；本地草稿 / 演示帖不报 */
function sigId(id){if(id==null)return null;const s=String(id);if(/^\d+$/.test(s))return Number(s);return /^[A-Za-z0-9_-]{3,64}$/.test(s)&&!/^(local|tmp|demo|c_|l_)/.test(s)?s:null}
function sigPush(postId,dwellMs,action){const id=sigId(postId);if(!id||!sigOk())return;SIG.q.push({postId:id,dwellMs:Math.max(0,Math.round(dwellMs||0)),action,at:Date.now()});if(SIG.q.length>=SIG.MAX*3)SIG.q=SIG.q.slice(-SIG.MAX*3)}
function sigStop(id){const t=SIG.on.get(id);if(t==null)return;SIG.on.delete(id);SIG.acc.set(id,(SIG.acc.get(id)||0)+(performance.now()-t))}
function sigStopAll(){[...SIG.on.keys()].forEach(sigStop)}
function sigDrain(){for(const[id,ms] of SIG.acc){if(ms>=500)sigPush(id,ms,'view')}SIG.acc.clear()}
async function sigFlush(useBeacon){
  sigDrain();if(!SIG.q.length||!sigOk())return;
  if(!useBeacon&&Date.now()<SIG.until)return;
  while(SIG.q.length){
    const events=SIG.q.splice(0,SIG.MAX);
    if(useBeacon&&typeof fetch==='function'&&typeof apiUrl==='function'){
      try{fetch(apiUrl('/api/feed/signals'),{method:'POST',keepalive:true,headers:{'Content-Type':'application/json',Authorization:'Bearer '+SESSION.token},body:JSON.stringify({events})}).catch(()=>{})}catch(e){}
      continue;
    }
    let r;try{r=await api('POST','/api/feed/signals',{events})}catch(e){r={s:0}}
    if(r.s===404||r.s===405||r.s===501){SIG.off=true;SIG.q=[];return}
    if(r.s===429){SIG.until=Date.now()+90e3;SIG.q=events.concat(SIG.q).slice(0,SIG.MAX*3);return}
    if(!r.s||r.s>=500){SIG.until=Date.now()+30e3;SIG.q=events.concat(SIG.q).slice(0,SIG.MAX*3);return}
    if(r.s!==200&&r.s!==204){/* 400 BAD_ACTION / TOO_MANY_EVENTS 等：这批丢掉，不重试 */return}
  }
}
if(typeof IntersectionObserver!=='undefined'){
  const io=new IntersectionObserver(es=>es.forEach(en=>{const id=en.target.getAttribute('data-pid');if(!id||!sigId(id))return;
    if(en.isIntersecting&&en.intersectionRatio>=.5&&document.visibilityState!=='hidden'){if(!SIG.on.has(id))SIG.on.set(id,performance.now())}else sigStop(id)}),{threshold:[0,.5,1]});
  const seen=new WeakSet();
  const scan=()=>{if(SIG.off)return;document.querySelectorAll('.fcard[data-pid]').forEach(el=>{if(!seen.has(el)){seen.add(el);io.observe(el)}});
    /* 重绘后旧节点被替换：已不在页面里的计时停掉 */
    for(const id of SIG.on.keys()){if(!document.querySelector(`.fcard[data-pid="${CSS.escape(id)}"]`))sigStop(id)}};
  if(typeof MutationObserver!=='undefined'&&document.getElementById('app')){let q=0;new MutationObserver(()=>{if(q)return;q=1;requestAnimationFrame(()=>{q=0;scan()})}).observe(document.getElementById('app'),{childList:true,subtree:true})}
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){sigStopAll();sigFlush(true)}});
  addEventListener('pagehide',()=>{sigStopAll();sigFlush(true)});
  SIG.timer=setInterval(()=>{const live=[...SIG.on.keys()];sigStopAll();const now=performance.now();live.forEach(id=>SIG.on.set(id,now));sigFlush(false)},30000);
}
/* 动作信号：包一层现有动作（等 80_events.js 挂完再包） */
setTimeout(()=>{
  const wrap=(k,action,pick)=>{const f=A[k];if(typeof f!=='function')return;A[k]=function(v){try{const id=pick?pick(v):v;if(action)sigPush(id,0,action)}catch(e){}return f.apply(this,arguments)}};
  wrap('post','open');wrap('xlike','like');wrap('xbm','save');wrap('xshare','share');
  const fx=A.extlink;if(typeof fx==='function')A.extlink=function(v){try{const p=(S.posts||[]).find(x=>x.sourceUrl&&String(x.sourceUrl)===String(v||S._extUrl||''));if(p)sigPush(p.id,0,'open_origin')}catch(e){}return fx.apply(this,arguments)};
  /* 登录后拉一次偏好（首次弹选择页） */
  const tryLoad=()=>{if(INT.sup===null&&intNet()&&!INT.busy&&Array.isArray(S.posts))intLoad()};
  setInterval(tryLoad,4000);tryLoad();
},0);
window.__sig=SIG;window.__int=INT;
