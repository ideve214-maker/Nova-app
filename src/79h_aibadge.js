/* ===== VEXO 2.0.7：AI 内部账号（设计文档 §7）=====
   - 作者对象 ai===true：所有头像（av()）右下角加小「AI」角标；
   - badge==='internal'：资料页显示「官方内部账号」，昵称旁不另外加章（13_vip.js 的 nameBadges 已跳过 internal）；
   - 点这类账号的「消息 / 加好友」直接提示「这是官方内部账号，不接收私信」；服务端返回 403 INTERNAL_ACCOUNT 时也显示同一句。 */
const INTERNAL_MSG='这是官方内部账号，不接收私信';
function isInternal(id){id=String(id||'');return !!(D.uai&&D.uai[id])||((D.u&&D.u[id]&&D.u[id][6])==='internal')}
function aiBadgeWrap(h,s){const z=Math.max(9,Math.round((s||40)*.3));return `<span class="avw" style="--aiz:${z}px">${h}<i class="aibg" aria-label="AI 账号">AI</i></span>`}
function internalTag(id){return id!=='me'&&isInternal(id)?`<div class="intag" data-ut>${OBG.internal[typeof LANG!=='undefined'&&LANG==='en'?3:1]}</div>`:''}
setTimeout(function(){ /* 等 80_events.js 把 frequest 等动作挂到 A 上之后再包一层 */
  const wrap=k=>{const f=A[k];if(typeof f!=='function')return;A[k]=v=>{if(isInternal(v)){T(INTERNAL_MSG);return}return f(v)}};
  ['dm','frequest'].forEach(wrap);
  if(typeof errMsg==='function'){const em=errMsg;errMsg=function(r,fb){const c=r&&r.j&&r.j.error&&r.j.error.code;if(c==='INTERNAL_ACCOUNT'||(r&&r.j&&r.j.code==='INTERNAL_ACCOUNT'))return INTERNAL_MSG;return em(r,fb)}}
},0);
