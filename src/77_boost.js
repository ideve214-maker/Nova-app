/* r10 营销管理（3）：推流 / 加热。
   - 信息流：服务器给出 boosts（这个用户还没看过的推流帖）和 boostSlots（插在第几条之后），卡片上显示「曝光中」。
   - 作者：自己的公开帖子 ⋯ 菜单里「推流加热」→ 选套餐和付款方式 → 扫码转账并备注订单码 → 「我已付款」→ 管理员核对后开始推流，卡片显示「推流中 · 已曝光 x/y」。 */
function L2(zh,en){return typeof LANG!=='undefined'&&LANG==='en'?en:zh}
const BZ_ST={pending:['待付款','Awaiting payment'],awaiting_review:['等待核对','Under review'],active:['推流中','Boosting'],done:['已投完','Completed'],ended:['已结束','Ended'],rejected:['已拒绝','Rejected'],expired:['已过期','Expired'],refunded:['已退款','Refunded']};
const BZ_PLAN={'体验':'Starter','标准':'Standard','进阶':'Plus','爆款':'Viral'};
const BZ_PAY={wechat:['微信支付','WeChat Pay'],alipay:['支付宝','Alipay']};
function bzSt(o){const x=BZ_ST[o.status];return x?L2(x[0],x[1]):o.statusLabel||o.status}
function bzPlan(n){return L2(n,BZ_PLAN[n]||n)}
function bzPay(o){const x=BZ_PAY[o.method||o.id];return x?L2(x[0],x[1]):(o.methodName||o.name||'')}
function bzImp(n){return L2(fmtNum(n)+' 次曝光',fmtNum(n)+' impressions')}
function withBoosts(list){
  if(!(typeof usingNet==='function'&&usingNet())||S.feed!=='rec'||!Array.isArray(S.boosts)||!S.boosts.length)return list;
  const have=new Set(list.map(p=>String(p.id))),out=list.slice(),slots=S.boostSlots&&S.boostSlots.length?S.boostSlots:[2,7];let add=0;
  const done=new Set();
  S.boosts.forEach((b,i)=>{const id=String(b.id);if(done.has(id))return;done.add(id);
    /* 普通列表里已经有这条：挪到推流位置并带上「曝光中」，不重复出现 */
    if(have.has(id)){const j=out.findIndex(p=>String(p.id)===id);if(j>=0)out.splice(j,1)}
    const at=Math.min(out.length,(Number(slots[i])||slots[slots.length-1]||2)+add);out.splice(at,0,Object.assign({},b,{_bz:1}));add++});
  return out}
function boostCan(p){return typeof usingNet==='function'&&usingNet()&&p&&p.src==='net'&&(p.aud||p.audience||'public')==='public'}
const BOOST={pid:null,cat:null,orders:[],order:null,plan:null,method:null,busy:0,err:''};
async function boostLoad(pid){
  BOOST.pid=pid;BOOST.err='';BOOST.order=null;BOOST.plan=null;BOOST.busy=1;
  const [c,o]=await Promise.all([api('GET','/api/boost/catalog'),api('GET','/api/boost/orders?postId='+encodeURIComponent(pid))]);
  BOOST.busy=0;
  if(!c||c.s!==200){BOOST.err=errMsg(c,'推流信息读取失败');BOOST.cat=null}else{BOOST.cat=c.j;BOOST.plan=(c.j.plans||[])[1]?c.j.plans[1].id:((c.j.plans||[])[0]||{}).id;BOOST.method=((c.j.methods||[])[0]||{}).id}
  BOOST.orders=o&&o.s===200&&o.j?o.j.orders||[]:[];
  const open=BOOST.orders.find(x=>x.status==='pending'||x.status==='awaiting_review');if(open)BOOST.order=open;
  if(S.sh&&S.sh.t==='boost')render();
}
function fmtNum(n){n=Number(n)||0;if(typeof fmtCount==='function')return fmtCount(n);if(typeof LANG!=='undefined'&&LANG==='en')return n>=1000?(Math.round(n/100)/10)+'k':String(n);return n>=10000?(Math.round(n/1000)/10)+'万':String(n)}
function boostOrderCard(o){
  const open=o.status==='pending'||o.status==='awaiting_review';
  const qr=open&&o.qrUrl?`<img class="vqr" src="${esc(adUrl(o.qrUrl))}" alt="${esc(bzPay(o))}" width="200" height="200">`:'';
  const inst=open?L2(`请用${bzPay(o)}扫描收款码，转账 ${o.amountLabel}，并在转账备注中填写订单码 ${o.code}。付款后点「我已付款」，管理员核对后开始推流，不会自动扣款。`,`Scan the ${bzPay(o)} QR code, pay ${o.amountLabel}, and put the order code ${o.code} in the payment note. Then tap "I've paid". An admin starts the boost after checking; nothing is charged automatically.`):'';
  const prog=o.status==='active'||o.status==='done'||o.status==='ended'?`<div class="bzbar"><i style="width:${Math.min(100,Number(o.progress)||0)}%"></i></div><p>${L2('已曝光','Delivered')} ${fmtNum(o.delivered)} / ${fmtNum(o.impressions)}</p>`:'';
  return `<div class="vpay bzord" data-ut><b>${L2('订单','Order')} ${esc(o.code)}</b><p>${esc(bzPlan(o.planName))} · ${esc(o.amountLabel)} · ${esc(bzImp(o.impressions))} · ${esc(bzSt(o))}</p>${inst?`<p>${esc(inst)}</p>`:''}${qr}${prog}${o.rejectReason?`<p class="vpn">${L2('拒绝原因：','Reason: ')}${esc(o.rejectReason)}</p>`:''}${o.status==='pending'?`<button type="button" class="pb" data-a="boostpaid" data-v="${esc(o.id)}">${L2('我已付款',"I've paid")}</button>`:''}${o.status==='awaiting_review'?`<p class="vpn">${L2('已提交，等待管理员核对，核对后自动开始推流。','Submitted. The boost starts once an admin confirms your payment.')}</p>`:''}<button type="button" class="pb s" data-a="boostrefresh">${L2('刷新状态','Refresh')}</button></div>`}
function boostSheet(){
  const c=BOOST.cat,T3=`<h3>${L2('推流加热','Boost post')}</h3>`;
  if(BOOST.busy&&!c)return `${T3}<p class="em">${L2('正在读取…','Loading…')}</p>`;
  if(!c)return `${T3}<p class="em">${esc(BOOST.err||L2('推流信息读取失败',"Couldn't load boost options"))}</p><div class="fr"><button class="pb s" data-a="x">${L2('关闭','Close')}</button></div>`;
  const hist=BOOST.orders.filter(o=>!BOOST.order||o.id!==BOOST.order.id).slice(0,5).map(o=>`<div class="bzrow"><span>${esc(bzPlan(o.planName))} · ${esc(o.amountLabel)}</span><span>${esc(bzSt(o))}${o.status==='active'||o.status==='done'||o.status==='ended'?` · ${fmtNum(o.delivered)}/${fmtNum(o.impressions)}`:''}</span></div>`).join('');
  const H=hist?`<div class="bzhist"><b>${L2('历史订单','Past orders')}</b>${hist}</div>`:'';
  if(BOOST.order)return `${T3}${boostOrderCard(BOOST.order)}${H}`;
  if(!c.enabled)return `${T3}<p class="em">${L2('推流暂未开放',"Boosting isn't available yet")}</p>${H}<div class="fr"><button class="pb s" data-a="x">${L2('关闭','Close')}</button></div>`;
  const plans=(c.plans||[]).map(p=>`<button type="button" class="bzplan${BOOST.plan===p.id?' on':''}" data-a="boostplan" data-v="${esc(p.id)}"><b>${esc(p.priceLabel)}</b><span>${esc(bzImp(p.impressions))}</span><small>${esc(bzPlan(p.name))} · ${L2(Number(p.days)+' 天内','within '+Number(p.days)+(Number(p.days)===1?' day':' days'))}</small></button>`).join('');
  const methods=(c.methods||[]).map(m=>`<button type="button" class="${BOOST.method===m.id?'on':''}" data-a="boostmethod" data-v="${esc(m.id)}">${esc(bzPay(m))}</button>`).join('');
  const note=L2('曝光按人计：每个用户最多算 1 次，真实露出才计数，投满即止。到期没投满按实际曝光结束，可联系管理员处理退款。数字是保底人数，不承诺点赞、关注等效果。',"Impressions count people: each user counts once, only when the post is really on screen, and the boost stops when it's full. If it isn't full when time runs out, it ends with what was delivered and an admin can handle a refund. Likes and follows aren't guaranteed.");
  return `<div data-ut>${T3}<p class="bznote">${L2('把这条帖子推荐给更多还没看过的人，卡片上显示「曝光中」。','Show this post to more people who haven\'t seen it yet. It is labeled "Promoted" in their feed.')}</p><div class="bzplans">${plans}</div><div class="seg bzm">${methods}</div><p class="vpn">${esc(note)}</p>${BOOST.err?`<p class="vpn" style="color:var(--dg,#e5484d)">${esc(BOOST.err)}</p>`:''}<button type="button" class="pb" data-a="boostgo"${BOOST.busy?' disabled':''}>${BOOST.busy?L2('正在生成订单…','Creating order…'):L2('生成订单并付款','Create order & pay')}</button>${H}</div>`}
Object.assign(A,{
  boostopen:v=>{S.sh={t:'boost',id:v};BOOST.cat=null;boostLoad(v)},
  boostplan:v=>{BOOST.plan=v},
  boostmethod:v=>{BOOST.method=v},
  boostgo:()=>{if(BOOST.busy)return;BOOST.busy=1;BOOST.err='';api('POST','/api/boost/orders',{postId:BOOST.pid,planId:BOOST.plan,method:BOOST.method}).then(r=>{BOOST.busy=0;if(!r||r.s!==200){BOOST.err=errMsg(r,'下单失败');render();return}BOOST.order=r.j.order;BOOST.orders.unshift(r.j.order);render()})},
  boostpaid:v=>{api('POST','/api/boost/orders/'+encodeURIComponent(v)+'/paid',{}).then(r=>{if(!r||r.s!==200){T(errMsg(r,'提交失败'));return}BOOST.order=r.j.order;T(L2('已提交，等待管理员核对','Submitted for review'));render()})},
  boostrefresh:()=>{boostLoad(BOOST.pid).then(()=>{const o=BOOST.orders.find(x=>x.status==='active');if(o)T(L2('推流已开始','Boost started'));if(typeof refreshFeedSafe==='function')refreshFeedSafe()})},
});
const _r7SheetBz=r7Sheet;
r7Sheet=function(s){if(s.t==='boost')return boostSheet();return _r7SheetBz(s)};
