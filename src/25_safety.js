/* M4.8 用户端举报与拉黑：登录后走真实接口。私聊只提交用户勾选的消息。 */
const REPORT_REASONS=[['spam','垃圾广告'],['harassment','骚扰辱骂'],['abuse','人身攻击'],['illegal','违法违规'],['other','其他']];

function loadBlocks(){
  if(typeof usingNet!=='function'||!usingNet())return Promise.resolve();
  return api('GET','/api/blocks').then(r=>{
    S.blocks=(r.s===200&&r.j&&r.j.blocks)?r.j.blocks:[];
  });
}
function isBlockedUser(id){
  return !!(S.blocks||[]).some(x=>String(x.userId)===String(id));
}

function reportOpen(opts){
  S.sh={t:'report',targetType:opts.targetType,targetId:opts.targetId,targetUserId:opts.targetUserId,conversationId:opts.conversationId||null};
  S.d.rpreason=S.d.rpreason||'spam';
  S.d.rpdetail=S.d.rpdetail||'';
  S.rpids=Array.isArray(opts.messageIds)?opts.messageIds.slice():(opts.messageId?[opts.messageId]:[]);
}

function reportSheet(s){
  const reasons=REPORT_REASONS.map(([k,l])=>`<button class="pb sm${(S.d.rpreason||'spam')===k?'':' s'}" data-a="rpreason" data-v="${k}">${l}</button>`).join('');
  let pick='';
  if(s.targetType==='message'||s.targetType==='conversation'){
    const cid=s.conversationId||s.targetId;
    const list=(typeof msgSrc==='function'?msgSrc(cid):((S.messages&&S.messages[cid])||[])).slice(-30);
    const ids=S.rpids||[];
    pick=list.length
      ?`<p class="lab">勾选要提交的消息（不会把整段会话交给管理员）</p>`+list.map(m=>{
        const mid=m[5], tx=typeof m[4]==='string'?m[4]:'[内容]';
        const on=ids.map(String).includes(String(mid));
        return `<button class="nr" data-a="rptog" data-v="${esc(String(mid))}"><span class="gr"><b>${esc(String(tx).slice(0,80))}</b></span><span>${on?'☑':'☐'}</span></button>`;
      }).join('')
      :'<p class="em">当前会话还没有可勾选的消息</p>';
  }
  return `<h3>举报</h3><p class="lab" style="margin-bottom:8px">选择原因，可附简短说明。提交后进入管理端队列。</p><div class="sw" style="flex-wrap:wrap;gap:6px;margin-bottom:8px">${reasons}</div><textarea class="fld" data-d="rpdetail" data-max="200" rows="3" placeholder="补充说明（选填）"></textarea>${pick}<div class="fr"><button class="pb s" data-a="x">取消</button><button class="pb" data-a="rpsubmit">提交</button></div>`;
}

function rpreason(v){S.d.rpreason=v;if(typeof render==='function')render()}
function rptog(v){
  S.rpids=S.rpids||[];
  const i=S.rpids.map(String).indexOf(String(v));
  if(i>=0)S.rpids.splice(i,1);else S.rpids.push(v);
  if(typeof render==='function')render();
}
function rpsubmit(){
  const s=S.sh;
  if(!s||s.t!=='report')return;
  const reason=S.d.rpreason||'spam';
  const label=(REPORT_REASONS.find(x=>x[0]===reason)||[reason,reason])[1];
  const detail=(S.d.rpdetail||'').trim();
  if(typeof usingNet!=='function'||!usingNet()||!SESSION){
    S.sh=null;T('已记录（仅演示，不会发送给任何人）');return;
  }
  const body={targetType:s.targetType,targetId:s.targetId,reason:label,detail};
  if(s.targetUserId)body.targetUserId=Number(s.targetUserId);
  if(s.conversationId)body.context={conversationId:s.conversationId};
  if(s.targetType==='message'||s.targetType==='conversation'){
    body.messageIds=S.rpids||[];
    if(!body.messageIds.length){T('请先勾选要提交的消息');return}
    body.targetType=body.messageIds.length===1?'message':'conversation';
    if(!body.targetId)body.targetId=body.messageIds[0];
  }
  return api('POST','/api/reports',body).then(r=>{
    if(r.s!==200){T(errMsg(r,'提交失败'));return}
    S.sh=null;T('已提交，管理员会处理并通知你');
  });
}

function blockUser(v){
  const id=Number(v);
  if(typeof usingNet!=='function'||!usingNet()||!SESSION){T('演示模式不能拉黑');return}
  return api('POST','/api/blocks',{userId:id}).then(r=>{
    if(r.s!==200){T(errMsg(r,'无法拉黑'));return}
    T('已拉黑。双方不再是好友，也不能再发私聊。');
    S.sh=null;
    return Promise.all([
      typeof loadBlocks==='function'?loadBlocks():null,
      typeof loadFriends==='function'?loadFriends():null,
    ]).then(()=>{if(typeof render==='function')render()});
  });
}
function unblockUser(v){
  const id=Number(v);
  if(typeof usingNet!=='function'||!usingNet()||!SESSION)return;
  return api('POST','/api/blocks/remove',{userId:id}).then(r=>{
    if(r.s!==200){T(errMsg(r,'无法取消拉黑'));return}
    T('已取消拉黑');
    S.sh=null;
    return typeof loadBlocks==='function'?loadBlocks().then(()=>{if(typeof render==='function')render()}):null;
  });
}
function blockAsk(v){S.sh={t:'blockq',id:v}}
function blockSheet(s){
  return `<h3>拉黑这个用户？</h3><p style="color:var(--t2);margin-bottom:8px">拉黑后双方不再是好友，也不能再发私聊。此前的聊天记录仍在。</p><div class="fr"><button class="pb s" data-a="x">取消</button><button class="pb d" data-a="block2" data-v="${s.id}">拉黑</button></div>`;
}
function safetyBtns(id){
  if(!id||id==='me'||id==='notice')return '';
  if(typeof usingNet!=='function'||!usingNet())return '';
  if(SESSION&&SESSION.user&&String(SESSION.user.id)===String(id))return '';
  const blocked=isBlockedUser(id);
  const rp=`<button class="pb s" data-a="reportu" data-v="${id}">举报</button>`;
  const blk=blocked
    ?`<button class="pb s" data-a="unblock" data-v="${id}">取消拉黑</button>`
    :`<button class="pb s" data-a="blockq" data-v="${id}">拉黑</button>`;
  return rp+blk;
}
