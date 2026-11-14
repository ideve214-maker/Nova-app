/* ===== VEXO 2.0.1：AI 功能（智谱 glm-4-flash，免费）——翻译、技能交换匹配、官方助手 =====
   - 全部走服务器（/api/ai/translate、/api/exchange/match、/api/assistant/ask），客户端不带任何密钥；
   - AI 失败时：翻译提示稍后再试；匹配改用关键词规则；助手改为显示最相关的帮助资料；
   - 加密私聊：只在用户点「翻译」时发送这一条消息的文字，第一次会说明会发给 AI 服务（智谱）处理。 */
const AIEN=()=>typeof LANG!=='undefined'&&LANG==='en';
const aiOn=()=>typeof usingNet==='function'&&usingNet()&&!!SESSION;
const aiRR=()=>{if(typeof render==='function')render()};

/* ---------------- 1. 翻译 ---------------- */
function trCan(){return aiOn()}
function trSt(k){S.tr=S.tr||{};return S.tr[k]||null}
function trLabel(k){const t=trSt(k);return t&&t.text&&!t.hide?'隐藏翻译':'翻译'}
function trBox(k){const t=trSt(k);if(!t||t.hide)return '';
  if(t.busy)return `<div class="trb busy" data-ut>${AIEN()?'Translating…':'翻译中…'}</div>`;
  if(!t.text)return '';
  return `<div class="trb" data-ut><p>${esc(t.text)}</p><small>${AIEN()?'Translated by AI':'AI 翻译'}<button type="button" class="lk" data-a="trhide" data-v="${esc(k)}">${AIEN()?'Hide':'隐藏'}</button></small></div>`}
async function trRun(k,text){
  S.tr=S.tr||{};const t=S.tr[k];
  if(t&&t.text){t.hide=!t.hide;return}
  if(t&&t.busy)return;
  const src=String(text||'').trim();if(!src)return T('没有可以翻译的文字');
  S.tr[k]={busy:1};aiRR();
  const r=await api('POST','/api/ai/translate',{text:[...src].slice(0,2000).join('')});
  if(r.s!==200){delete S.tr[k];T(r.s===429?errMsg(r,'翻译次数太多了，请稍后再试'):r.s===503?'翻译暂时不可用，请稍后再试':errMsg(r,'翻译失败'));return}
  S.tr[k]={text:r.j.text,to:r.j.to};
}
const TR_E2EE_OK='vexo_tr_e2ee_ok';
function trMsgFind(cid,id){const arr=(typeof msgSrc==='function'?msgSrc(cid):[])||[];return arr.find(x=>String(x[5])===String(id)||String(typeof mid==='function'?mid('cv',x):'')===String(id))||null}
Object.assign(A,{
  trp:v=>{S.sh=null;const p=(typeof feedSrc==='function'?feedSrc():D.p).find(x=>x.id==v)||(typeof findPost==='function'?findPost(v):null);return trRun('p:'+v,p&&p.x)},
  trm:v=>{const[cid,id]=String(v).split('|');const m=trMsgFind(cid,id);if(!m)return;
    const cv=(typeof cvSrc==='function'?cvSrc():[]).find(c=>c.id==cid);
    const enc=!!(m.encrypted||(cv&&cv.e2ee));
    const t=trSt('m:'+id);
    if(enc&&!(t&&t.text)){let ok='';try{ok=localStorage.getItem(TR_E2EE_OK)||''}catch(e){}if(!ok){S.sh={t:'trcf',cid,id};return}}
    S.sh=null;return trRun('m:'+id,m[4])},
  trcf2:v=>{const s=S.sh;if(!s||s.t!=='trcf')return;if(v==='always'){try{localStorage.setItem(TR_E2EE_OK,'1')}catch(e){}}S.sh=null;const m=trMsgFind(s.cid,s.id);return trRun('m:'+s.id,m&&m[4])},
  trhide:v=>{const t=trSt(v);if(t)t.hide=1},
});

/* ---------------- 2. 技能交换：AI 匹配 ---------------- */
function exMatchBox(){
  if(!aiOn())return '';const c=coS();if(c.mine||c.q)return '';
  const m=c.match;
  if(!m)return `<div class="aimb"><div class="aimh"><b>${ic('spark')}<span>AI 帮你匹配</span></b><button type="button" class="pb sm" data-a="exmatch">找找看</button></div><small class="hint">根据你发布的技能交换，找「会你想学的、又想学你会的」人</small></div>`;
  if(m.busy)return `<div class="aimb"><div class="aimh"><b>${ic('spark')}<span>AI 帮你匹配</span></b></div><p class="em">正在为你匹配…</p></div>`;
  let body;
  if(m.err)body=`<p class="em">${esc(m.err)}</p>`;
  else if(m.need==='post')body=`<p class="hint">先发布一条你的技能交换（会什么、想学什么），AI 才能帮你找到合适的人。</p><button type="button" class="pb sm" data-a="exnew">发布技能交换</button>`;
  else if(!(m.items||[]).length)body='<p class="em">暂时没有找到合适的人，过几天再来看看</p>';
  else body=m.items.map(it=>{const x=it.post,u=P(x.aid);return `<article class="aimc"><button type="button" class="exu" data-a="user" data-v="${x.aid}">${av(x.aid,32)}<span class="gr"><b class="nmb">${nmB(u)}</b>${it.mutual?'<small class="aimu">互相匹配</small>':''}</span></button><p class="aimx" data-ut><span>会</span>${esc(x.offers)}</p><p class="aimx" data-ut><span>想学</span>${esc(x.wants)}</p><p class="aimr" data-ut>💡 ${esc(it.reason||'')}</p><button type="button" class="pb sm" data-a="exask" data-v="${esc(x.id)}">${v2i('chat2')}<span>咨询</span></button></article>`}).join('');
  return `<div class="aimb"><div class="aimh"><b>${ic('spark')}<span>AI 帮你匹配</span></b><span class="sw"><button type="button" class="lk" data-a="exmatch" data-v="1">刷新</button><button type="button" class="lk" data-a="exmatchx">收起</button></span></div>${m.source==='rule'?'<small class="hint">AI 暂时不可用，已按关键词为你匹配</small>':''}<div class="aiml">${body}</div></div>`}
Object.assign(A,{
  exmatch:async()=>{const c=coS();c.match={busy:1};aiRR();
    const r=await api('GET','/api/exchange/match');
    if(r.s!==200){c.match={err:r.s===429?errMsg(r,'匹配次数太多了，请稍后再试'):errMsg(r,'暂时无法匹配，请稍后再试')};return}
    c.match={items:(r.j.items||[]).map(it=>({...it,post:{...it.post,aid:v2aid(it.post.author)}})),source:r.j.source||'',need:r.j.need||''}},
  exmatchx:()=>{coS().match=null},
});

/* ---------------- 3. 官方助手（VEXO 助手）：按固定的帮助资料回答 ---------------- */
const VXA_Q=['怎么开通 VIP 会员？','私聊是加密的吗？','怎么加入共创项目？','忘记密码怎么办？','怎么拉黑或举报别人？','怎么更新到最新版本？'];
const VXA_Q_EN=['How do I get VIP?','Are private chats encrypted?','How do I join a project?','I forgot my password','How do I block or report someone?','How do I update the app?'];
function vxaKey(){return 'vexo_vxa_'+(SESSION&&SESSION.user?SESSION.user.id:'0')}
function vxaLoad(){if(S.vxa)return S.vxa;let a=[];try{a=JSON.parse(localStorage.getItem(vxaKey())||'[]')}catch(e){}S.vxa=Array.isArray(a)?a.slice(-40):[];return S.vxa}
function vxaSave(){try{localStorage.setItem(vxaKey(),JSON.stringify((S.vxa||[]).slice(-40)))}catch(e){}}
function vxaAv(n){return `<span class="vxav" style="width:${n}px;height:${n}px" aria-hidden="true">${ic('spark')}</span>`}
function vxaRow(){if(!aiOn())return '';return `<button type="button" class="row vxarow" data-a="vxaopen">${vxaAv(48)}<div class="gr"><b class="nmb"><span class="nmt">VEXO 助手</span><span class="tag vxtag">官方</span></b><small>${AIEN()?'Questions about VIP, privacy, projects… ask me':'有问题问我：会员、隐私、共创…'}</small></div><small>›</small></button>`}
function pVxa(){
  const L=vxaLoad(),en=AIEN(),Q=en?VXA_Q_EN:VXA_Q;
  const hi=`<div class="mr vxm">${vxaAv(32)}<div class="mw"><div class="bub" data-ut>${en?"Hi! I'm the VEXO assistant. Ask me how to use VEXO — accounts, chats, projects, VIP and more.":'你好！我是 VEXO 助手，可以回答使用上的问题：账号、聊天、共创、会员等等。'}</div></div></div>`;
  const rows=L.map(m=>m.r==='u'?`<div class="mr me"><div class="mw"><div class="bub" data-ut>${esc(m.t)}</div></div></div>`:`<div class="mr vxm">${vxaAv(32)}<div class="mw"><div class="bub vxa-a" data-ut>${esc(m.t)}</div>${m.src==='faq'?`<small class="vxsrc">${en?'AI is busy — here is the closest help article':'AI 暂时不可用，以下是最相关的帮助资料'}</small>`:''}</div></div>`).join('');
  const busy=S.vxBusy?`<div class="mr vxm">${vxaAv(32)}<div class="mw"><div class="bub vxdots" data-ut><i></i><i></i><i></i></div></div></div>`:'';
  const chips=`<div class="vxq">${Q.map((q,i)=>`<button type="button" class="chipb" data-a="vxask" data-v="${i}" data-ut>${esc(q)}</button>`).join('')}</div>`;
  const right=L.length?`<button class="ib tx" data-a="vxclr">清空</button>`:'';
  return `<div class="pg vxpg">${sub('VEXO 助手<span class="tag vxtag">官方</span>',right)}<div class="sc msg vxsc">${hi}${rows}${busy}${!L.length||!S.vxBusy?chips:''}<p class="vxnote">${en?'Answers are generated by AI from the VEXO help pages and may be imperfect. Don’t share passwords or codes here.':'回答由 AI 根据 VEXO 帮助资料生成，仅供参考；请不要在这里发送密码或验证码。'}</p></div><div class="vxbar"><input class="fld" id="vxq" data-d="vxq" data-max="300" enterkeyhint="send" autocomplete="off" placeholder="输入你的问题"><button type="button" class="pb" data-a="vxsend"${S.vxBusy?' disabled':''}>发送</button></div></div>`}
function vxaScroll(){setTimeout(()=>{const sc=document.querySelector('.vxsc');if(sc)sc.scrollTop=sc.scrollHeight},30)}
async function vxaAsk(q){
  q=String(q||'').trim();if(!q||S.vxBusy)return;if([...q].length>300)return T('问题最多 300 字');
  const L=vxaLoad();const history=L.slice(-6).map(m=>({role:m.r==='u'?'user':'assistant',text:m.t}));
  L.push({r:'u',t:q});S.d.vxq='';S.vxBusy=1;vxaSave();aiRR();vxaScroll();
  let r;try{r=await api('POST','/api/assistant/ask',{question:q,history,lang:AIEN()?'en':'zh'})}finally{S.vxBusy=0}
  if(!r||r.s!==200){L.push({r:'a',t:r&&r.s===429?errMsg(r,'提问太频繁了，请稍后再试'):errMsg(r,'暂时无法回答，请稍后再试'),src:'err'})}
  else L.push({r:'a',t:r.j.answer||'',src:r.j.source||''});
  vxaSave();vxaScroll();
}
Object.assign(A,{
  vxaopen:()=>{S.st.push('vxa');S.sh=null;vxaScroll()},
  vxsend:()=>vxaAsk(S.d.vxq),
  vxask:v=>vxaAsk((AIEN()?VXA_Q_EN:VXA_Q)[Number(v)]||''),
  vxclr:()=>{if(typeof v2confirm!=='function'){S.vxa=[];vxaSave();return}v2confirm('清空和 VEXO 助手的对话？','只清除这台设备上的记录。','清空',()=>{S.vxa=[];vxaSave()})},
});
if(typeof document!=='undefined')document.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing&&e.target&&e.target.id==='vxq'){e.preventDefault();S.d.vxq=e.target.value;Promise.resolve(A.vxsend()).then(aiRR)}});

/* ---------------- 弹层：加密私聊翻译前的说明 ---------------- */
const _aiPrevSheet=typeof v2Sheet==='function'?v2Sheet:null;
v2Sheet=function(s){
  if(s&&s.t==='trcf')return `<h3>翻译加密消息</h3><p style="color:var(--t2);margin-bottom:10px">这是端到端加密的私聊。翻译时，只会把这一条消息的文字发送给 AI 服务（智谱）处理，用完即弃，服务器不保存。</p><div class="fr"><button class="pb s" data-a="x">取消</button><button class="pb" data-a="trcf2">翻译</button></div><button class="mi" data-a="trcf2" data-v="always" style="color:var(--t2)">翻译，以后不再提示</button>`;
  return _aiPrevSheet?_aiPrevSheet(s):'';
};
Object.assign(V2P,{vxa:pVxa});
