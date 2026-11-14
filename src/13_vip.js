/* VIP 状态与会员中心（M2.4.3）。
   数据全部来自服务端：/api/vip/catalog（公开目录）和 /api/vip/me（登录后）。
   这里只缓存服务端返回的结果用于显示；客户端既不保存也不能设置 VIP 身份。 */
const VIP={cat:null,me:null,busy:0,err:''};
/* 会员标识：只表示订阅状态，不是实名认证。 */
const vipBadge=()=>'<i class="vip" role="img" aria-label="VEXO VIP 会员">VIP</i>';
const pad2=n=>String(n).padStart(2,'0');
const vipDate=ms=>{const d=new Date(ms);return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate())};
/* 把「权益在某套餐下的取值」写成人能读的文字；数字都来自服务端目录。 */
function vipFmt(e,plan){const v=e[plan];if(v===null||v===undefined)return '待定';if(e.kind==='flag')return v?'✓ 有':'— 无';
  if(typeof v==='object')return Object.keys(v).map(k=>((e.scopeNames&&e.scopeNames[k])||k)+' '+v[k]).join(' · ')+(e.unit?' '+e.unit:'');
  return v+(e.unit?' '+e.unit:'')}
/* 读取目录与当前状态。离线/演示模式不请求；失败只记录错误文字，由页面显示并允许重试。 */
async function loadVip(){
  if(!NET)return;VIP.busy=1;VIP.err='';
  const acct=MODE==='account'&&SESSION&&SESSION.token;
  const [c,m]=await Promise.all([VIP.cat?null:api('GET','/api/vip/catalog'),acct?api('GET','/api/vip/me'):null]);
  VIP.busy=0;
  if(c){if(c.s===200)VIP.cat=c.j;else VIP.err=errMsg(c,'读取会员信息失败')}
  if(m){if(m.s===200)VIP.me=m.j;else{VIP.me=null;VIP.err=errMsg(m,'读取会员状态失败')}}
  if(!acct)VIP.me=null;
  syncVipUser();
}
/* 某项 flag 权益是否由服务端确认为有效。只看 /api/vip/me 的缓存，客户端不能自己打开。 */
function vipFlag(key){
  if(MODE!=='account'||!VIP.me||!VIP.me.vip||!VIP.me.vip.active)return false;
  const e=VIP.me.entitlements&&VIP.me.entitlements[key];
  return !!(e&&e.enabled)}
function vipBadgeOn(){return vipFlag('vip_badge')}
function vipDecoOn(){return vipFlag('profile_decoration')}
/* 服务端返回 vip_badge 有效，个人资料里的标识才亮；到期或撤销后下一次渲染立即去掉。 */
function syncVipUser(){if(MODE==='account'&&D&&D.u&&D.u.me)D.u.me[5]=vipBadgeOn()?1:0}
/* 香槟金主题（M2.4.5）：是否启用只看服务端返回的状态与权益（VIP 有效 + profile_theme_gold 开启），再加上本机的「不想用」偏好 D.st.vt===0。
   偏好只能关掉主题，不能打开：客户端无法凭自己的数据获得 VIP 外观。到期后服务端不再返回有效状态，下一次读取/刷新即回落默认主题，偏好保留。 */
function vipThemeOn(){return vipFlag('profile_theme_gold')&&!(D&&D.st&&D.st.vt===0)}
function applyVipTheme(on){const r=document.documentElement;if(on)r.dataset.vip='gold';else delete r.dataset.vip}
/* 会员中心里的「主题与标识」：左右两张资料预览（普通 / 香槟金），VIP 有效时多一组切换按钮。预览是静态示意，不是购买入口。 */
function vipThemeCard(c){
  if(MODE!=='account')return '';
  const ent=c.entitlements.find(e=>e.key==='profile_theme_gold');if(!ent)return '';
  const act=!!(VIP.me&&VIP.me.vip.active),on=vipThemeOn(),me=P('me');
  const pv=(k,t)=>`<div class="gpv ${k}" data-pv="${k==='g'?'gold':'basic'}" role="group" aria-label="${t}预览"><div class="gh">${av('me',36,{dec:k==='g'})}<div class="gn"><b>${esc(me.n)}${k==='g'?' '+vipBadge():''}</b><small>@${esc(me.h)}</small></div></div><div class="gl">查看全部</div><div class="gb" aria-hidden="true">编辑资料</div><small class="gc">${t}</small></div>`;
  const note=!VIP.me?'':act?(on?'当前正在使用香槟金主题。':'你选择了默认主题，VIP 有效期内可随时切回香槟金。'):'预览仅作示意。VIP 有效期内自动使用香槟金主题。';
  const btns=act?`<div class="vtb"><button class="pb${on?'':' s'}" data-a="vtheme" data-v="gold" aria-pressed="${on}">香槟金</button><button class="pb${on?' s':''}" data-a="vtheme" data-v="off" aria-pressed="${!on}">默认</button></div>`:'';
  return `<div class="shd">主题与标识</div><div class="vtn" style="padding-top:0;border-bottom:0">${esc(ent.description)}</div><div class="gpvs" id="vtheme">${pv('n','普通主题')}${pv('g','香槟金主题')}</div>${btns}<div class="vtn" data-vt="${on?'gold':'default'}">${esc(note)} 到期后：${esc(ent.onExpire)}</div>`}
function vipStatusCard(){
  if(MODE!=='account')return `<div class="card vp" data-vs="anon"><b>登录后查看你的会员状态</b><small>会员状态保存在服务器上，由服务器判断，不能在本机修改。</small></div>`;
  const m=VIP.me;if(!m)return `<div class="card vp" data-vs="loading"><b>正在读取会员状态…</b></div>`;
  const v=m.vip,until=v.until&&vipDate(v.until),since=v.since&&vipDate(v.since);
  const T={
    none:['当前套餐：Basic','免费使用。核心的社交、聊天、安全能力都已包含。'],
    active:['当前套餐：VEXO VIP',(since?'开通于 '+since+' · ':'')+'到期 '+until+'（剩余 '+v.daysLeft+' 天）'],
    expiring:['VEXO VIP · 即将到期','到期 '+until+'，还剩 '+v.daysLeft+' 天。到期后自动回到 Basic，你的内容都会保留。'],
    expired:['VIP 已过期','已于 '+(v.expiredAt?vipDate(v.expiredAt):'—')+' 回到 Basic。你发过、收藏过的内容都还在。'],
    revoked:['VIP 已被撤销','已回到 Basic，你的内容都还在。如有疑问请联系管理员。']}[v.state]||['当前套餐：Basic',''];
  return `<div class="card vp" data-vs="${esc(v.state)}"><b>${esc(T[0])}</b><small>${esc(T[1])}</small></div>`}
/* 开通：目录 purchase.enabled 为真时展示扫码开通；否则仍是禁用占位。
   不会声称付款即到账或「已开通成功」——状态以服务端订单为准，开通需管理员核对。 */
function vipBuy(v){
  if(!(v.purchase&&v.purchase.enabled)){
    return `<button type="button" class="pb off" id="vbuy" disabled aria-disabled="true">${esc(v.purchase&&v.purchase.label?v.purchase.label:'暂未开放')}</button>`;
  }
  return `<div class="vbuys" id="vbuybox">${(v.prices||[]).map(p=>`<button type="button" class="pb" id="vbuy-${esc(p.period)}" data-a="vipbuy" data-v="${esc(p.period)}">开通 ${esc(p.label)}</button>`).join('')}</div>`;
}
function vipPayStatus(s){
  return {pending:'待付款',awaiting_review:'等待管理员核对',paid:'已开通',rejected:'已拒绝',expired:'已过期',refunded:'已退款'}[s]||s;
}
function vipOrderCard(o){
  if(!o)return '';
  const st=o.status,qr=(st==='pending'||st==='awaiting_review')&&o.qrUrl?`<img class="vqr" id="vpayqr" src="${esc(o.qrUrl)}" alt="${esc(o.methodName||'')}收款码" width="220" height="220">`:'';
  const shot=st==='pending'?`<label class="vshot">可选：上传付款截图（JPG/PNG/WebP，最大 5 MB）<input type="file" id="vpayshot" accept="image/jpeg,image/png,image/webp"></label><button type="button" class="pb" id="vpaygo" data-a="vippaid">我已付款</button>`:'';
  const rej=o.rejectReason?`<p class="vpn">拒绝原因：${esc(o.rejectReason)}</p>`:'';
  const inst=o.instructions?`<p>${esc(o.instructions)}</p>`:(o.methodNote?`<p>${esc(o.methodNote)}</p>`:'');
  return `<div class="vpay" id="vpay" data-oid="${esc(o.id)}" data-os="${esc(st)}"><b>订单 ${esc(o.code)}</b><div class="vcode" id="vpaycode">${esc(o.code)}</div><p>金额 ${esc(o.amountLabel)} · ${esc(o.methodName||o.method||'')} · ${esc(vipPayStatus(st))}</p>${inst}${qr}${shot}${rej}<button type="button" class="pb s" data-a="vipord">刷新订单状态</button><button type="button" class="pb s" data-a="vippayclose">关闭</button></div>`;
}
function vipMethodPick(c,period){
  const methods=(c.pay&&c.pay.methods||[]).filter(m=>m.enabled);
  if(!methods.length)return `<p class="vpn">当前没有可用的收款方式。</p>`;
  const price=(c.plans.vip.prices||[]).find(p=>p.period===period);
  return `<div class="vpay" id="vpaypick" data-period="${esc(period)}"><b>选择付款方式</b><p>套餐：${esc(price?price.label:period)}。生成订单后请扫码转账，并在备注中填写订单码。开通需管理员核对，不会自动扣款或立刻到账。</p><div class="vbuys">${methods.map(m=>`<button type="button" class="pb" data-a="vipmethod" data-v="${esc(period)}|${esc(m.id)}">${esc(m.name)}</button>`).join('')}</div><button type="button" class="pb s" data-a="vippayclose">取消</button></div>`;
}
function vipPlans(c){
  const b=c.plans.basic,v=c.plans.vip,on=v.purchase&&v.purchase.enabled;
  const note=on
    ? `${v.priceNote||''} ${v.purchase.reason||''}`
    : `${v.priceNote||''} ${v.purchase?v.purchase.reason+'，现在不能购买，也不会产生任何订单或扣款。':''}`;
  const pick=VIP.pick&&VIP.pick.period&&!VIP.order?vipMethodPick(c,VIP.pick.period):'';
  const orders=(VIP.orders&&VIP.orders.length&&!VIP.order)?`<div class="vpay" id="vpaylist"><b>我的订单</b>${VIP.orders.map(o=>`<button type="button" class="row" data-a="vipshow" data-v="${esc(o.id)}"><div class="gr"><b>${esc(o.code)}</b><small>${esc(o.amountLabel)} · ${esc(vipPayStatus(o.status))}</small></div></button>`).join('')}</div>`:'';
  return `<div class="plans"><div class="plan" data-plan="basic"><b>${esc(b.name)}</b><div class="pp">免费</div><small>${esc(b.tagline)}</small></div><div class="plan v" data-plan="vip"><b>${esc(v.name)}</b><div class="pp">${v.prices.map(p=>esc(p.label)).join('<br>')}</div><small>${esc(v.tagline)}</small>${vipBuy(v)}</div></div>${pick}${vipOrderCard(VIP.order)}${orders}<p class="vpn">${esc(note)}</p>`;
}
async function loadPayOrders(){
  if(MODE!=='account'||!SESSION||!NET)return;
  const r=await api('GET','/api/pay/orders');
  if(r.s===200)VIP.orders=r.j.orders||[];
}
async function vipBuyGo(period){
  if(MODE!=='account'){T('请先登录');return}
  VIP.pick={period};VIP.order=null;render();
}
async function vipMethodGo(v){
  const[period,method]=String(v).split('|');
  if(!period||!method)return;
  const r=await api('POST','/api/pay/orders',{period,method,provider:'manual_qr'});
  if(r.s!==200){T(errMsg(r,'下单失败'));return}
  VIP.order=r.j.order;VIP.pick=null;
  await loadPayOrders();render();
}
async function vipPaidGo(){
  if(!VIP.order)return;
  let body={};
  const f=document.getElementById('vpayshot');
  if(f&&f.files&&f.files[0]){
    const file=f.files[0];
    if(file.size>5*1024*1024){T('截图不能超过 5 MB');return}
    const okType=/^image\/(jpeg|jpg|png|webp)$/i.test(file.type);
    if(!okType){T('截图只接受 JPG、PNG 或 WebP');return}
    const data=await new Promise((res,rej)=>{const rd=new FileReader();rd.onload=()=>{const s=String(rd.result||'');const i=s.indexOf(',');res(i>=0?s.slice(i+1):s)};rd.onerror=rej;rd.readAsDataURL(file)});
    body.receipt={mime:file.type,name:file.name,data};
  }
  const r=await api('POST','/api/pay/orders/'+VIP.order.id+'/paid',body);
  if(r.s!==200){T(errMsg(r,'提交失败'));return}
  VIP.order=r.j.order;await loadPayOrders();T('已提交，等待管理员核对。不会立刻开通。');render();
}
async function vipOrdGo(){
  if(!VIP.order)return;
  const r=await api('GET','/api/pay/orders/'+VIP.order.id);
  if(r.s!==200){T(errMsg(r,'读取订单失败'));return}
  VIP.order=r.j.order;await loadVip();await loadPayOrders();render();
}
async function vipShowGo(id){
  const r=await api('GET','/api/pay/orders/'+id);
  if(r.s!==200){T(errMsg(r,'读取订单失败'));return}
  VIP.order=r.j.order;VIP.pick=null;render();
}
const vipPayClose=()=>{VIP.order=null;VIP.pick=null;render()};
function vipCompare(c){
  return `<div class="shd">权益对比</div>`+c.entitlements.map(e=>`<div class="ent" data-ent="${esc(e.key)}"><div class="et"><b>${esc(e.title)}</b>${e.status==='live'?'':'<span class="tag">即将推出</span>'}<small>${esc(e.description)}</small></div><div class="ev"><span data-p="basic"><i>Basic</i>${esc(vipFmt(e,'basic'))}</span><span class="v" data-p="vip"><i>VIP</i>${esc(vipFmt(e,'vip'))}</span></div></div>`).join('')}
function vipRules(c){
  return `<div class="card vp" style="margin-top:8px"><b>到期后会怎样</b><small>${esc(c.expiry.rule)}${esc(c.expiry.dataPolicy)}</small></div><div class="card vp"><b>这些永远免费</b>${c.alwaysFree.map(x=>`<small>· ${esc(x)}</small>`).join('')}<small style="margin-top:6px">我们不出售：${c.neverSold.map(esc).join('、')}。</small></div>`}
/* 测试模式（M2.4.4）：是否显示完全由服务端目录的 testToggle.enabled 决定；生产环境里该开关为 false，
   这里不渲染任何按钮，服务端也会对 /api/vip/test-toggle 返回 403。 */
function vipTestBox(c){
  if(!(c.testToggle&&c.testToggle.enabled)||MODE!=='account'||!VIP.me)return '';
  const v=VIP.me.vip,test=v.active&&v.source==='test',real=v.active&&v.source!=='test';
  const btn=real?'<button class="pb s" disabled>你已有正式 VIP，测试开关不会改动它</button>':test?'<button class="pb s" data-a="viptoggle" data-v="0">切回普通模式</button>':'<button class="pb" data-a="viptoggle" data-v="1">切换到 VIP（测试）</button>';
  return `<div class="card vp tbox" id="vtest"><b>测试模式</b><small>仅开发环境可见。只影响你自己的账号，由服务器记录，不是真实购买。</small><div style="margin-top:8px">${btn}</div></div>`}
async function vipToggle(v){
  if(VIP.busy)return;VIP.busy=1;
  const r=await api('POST','/api/vip/test-toggle',{on:v==='1'});VIP.busy=0;
  if(r.s!==200){T(errMsg(r,'切换失败'));await loadVip();return}
  VIP.me=r.j;syncVipUser();T(r.j.vip.active?'已切换到 VIP（测试）':'已切回普通模式')}
const pVip=()=>{
  const c=VIP.cat;let body;
  if(!NET)body='<div class="card vp"><b>没有连上服务器</b><small>会员信息保存在服务器上。离线演示模式下无法读取。</small></div>';
  else if(!c)body=VIP.err?`<div class="card vp"><div class="err" role="alert">${esc(VIP.err)}</div><button class="pb" data-a="vipretry">重试</button></div>`:'<p class="em" data-vs="loading">正在读取会员信息…</p>';
  else body=vipStatusCard()+vipTestBox(c)+vipThemeCard(c)+(VIP.err?`<div class="err" role="alert" style="margin:8px 16px">${esc(VIP.err)}</div>`:'')+vipPlans(c)+vipCompare(c)+vipRules(c);
  return `<div class="pg" id="vipc">${sub('会员中心')}<div class="sc">${body}</div></div>`};
/* 设置页里的入口行 */
const vipRow=()=>{if(!NET)return '';const v=MODE==='account'&&VIP.me&&VIP.me.vip;
  const t=MODE!=='account'?'登录后查看会员状态':!v?'Basic · 免费':v.active?'VEXO VIP · 剩余 '+v.daysLeft+' 天':'Basic · 免费';
  return `<button class="row" style="width:100%;text-align:left" data-a="vip"><div class="gr"><b>会员中心</b><small>${esc(t)}</small></div><small>›</small></button>`};
const vipOpen=()=>{S.sh=null;S.st.push('vip');Promise.all([loadVip(),loadPayOrders()]).then(()=>render())};
const vipRetry=()=>{VIP.err='';loadVip().then(()=>render())};
const vipTog=v=>vipToggle(v);
const vipTheme=v=>{D.st.vt=v==='off'?0:1;T(v==='off'?'已切换为默认主题':'已使用香槟金主题')};

/* 发帖/发言长度（M2.5.4）：登录后用服务端返回的当前额度；演示/离线保持原 Basic 上限（280/500/280），不改现有演示行为。 */
const BASIC_TEXT={post:280,chat:500,channel:280};
function textLimit(scope){
  if(MODE==='account'&&VIP.me&&VIP.me.entitlements&&VIP.me.entitlements.longer_post_text){
    const v=VIP.me.entitlements.longer_post_text.value;
    if(v&&typeof v[scope]==='number')return v[scope]}
  return BASIC_TEXT[scope]||280}
async function checkText(scope,text){
  if(MODE!=='account'||!NET||!SESSION){const mx=textLimit(scope);if(!ok(text,mx)){T((scope==='chat'?'消息':scope==='channel'?'发言':'动态')+'最多 '+mx+' 字');return false}return true}
  const r=await api('POST','/api/content/check',{scope,text});
  if(r.s!==200){T(errMsg(r,'内容太长'));return false}return true}
