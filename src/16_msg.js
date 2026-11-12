/* NOVA V5 消息工具：消息 ID、置顶、@提醒（纯数据层，界面只读这里） */
/* 私聊/群聊消息：[发送者,类型,时间,状态,文字,id]；社区频道消息：[发送者,时间,文字,id] */
const msgs=(k,cid)=>{if(k=='cv')return (typeof msgSrc==='function'?msgSrc(cid):D.m[cid])||[];return D.cmsg[cid]||[]};
const mid=(k,m)=>k=='cv'?m[5]:m[3];
const mtext=(k,m)=>{const x=k=='cv'?m[4]:m[2];return x&&typeof x==='object'?(typeof stkLabel==='function'?stkLabel(x):(x.glyph||'')+' '+(x.name||'')):x};
const newId=()=>'m'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
/* 给所有缺 ID 的消息补上；种子消息用固定 ID：会话ID_序号 */
function fixIds(){
  for(const c in D.m)D.m[c].forEach((m,i)=>{if(!m[5])m[5]=c+'_'+i});
  for(const h in D.cmsg)D.cmsg[h].forEach((m,i)=>{if(!m[3])m[3]=h+'_'+i});
}
const cmOf=cid=>D.cm.find(c=>c.ch.some(x=>x[0]==cid));
/* 权限：置顶 / @所有人 / 删除他人消息。k='cv'(会话) 或 'ch'(社区频道) */
function msgPerm(k,cid,act){
  if(k=='cv'){const c=(typeof cvSrc==='function'?cvSrc():D.cv).find(x=>x.id==cid);if(!c||!c.g)return false;return canG(gRole(c,'me'),act=='delMsg'?'pinMsg':act)}
  const c=cmOf(cid);return !!c&&!!c.j&&canC(c.r,act);
}
const pinned=(k,cid)=>{if(k=='cv'&&typeof usingNet==='function'&&usingNet()){const c=typeof cvSrc==='function'?cvSrc().find(x=>x.id==cid):null;const ids=[...new Set([...(c&&c.publicPins||[]),...(c&&c.personalPins||[])])];return ids.filter(id=>msgs(k,cid).some(m=>mid(k,m)==id))}return (D.pm[cid]||[]).filter(id=>msgs(k,cid).some(m=>mid(k,m)==id))};
/* 把文字里的 @所有人 / @某人 渲染成高亮（先转义，再替换，防注入） */
function fmt(t){
  const names=Object.keys(D.u).filter(i=>i!='notice').map(i=>P(i).n).sort((a,b)=>b.length-a.length).map(n=>n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
  const re=new RegExp('@(所有人|'+names.join('|')+')','g');
  return esc(t).replace(re,(x,n)=>`<span class="at${n=='所有人'?' all':''}">@${n}</span>`);
}
if(typeof module!=='undefined')module.exports={};
