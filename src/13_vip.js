/* VIP 状态与会员中心（M2.4.3）。
   数据全部来自服务端：/api/vip/catalog（公开目录）和 /api/vip/me（登录后）。
   这里只缓存服务端返回的结果用于显示；客户端既不保存也不能设置 VIP 身份。 */
const VIP={cat:null,me:null,busy:0,err:''};
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
/* 服务端说你是 VIP，个人资料里的标识才亮；到期回落后同样由服务端结果驱动。 */
function syncVipUser(){if(MODE==='account'&&D&&D.u&&D.u.me)D.u.me[5]=VIP.me&&VIP.me.vip.active?1:0}
function vipStatusCard(){
  if(MODE!=='account')return `<div class="card vp" data-vs="anon"><b>登录后查看你的会员状态</b><small>会员状态保存在服务器上，由服务器判断，不能在本机修改。</small></div>`;
  const m=VIP.me;if(!m)return `<div class="card vp" data-vs="loading"><b>正在读取会员状态…</b></div>`;
  const v=m.vip,until=v.until&&vipDate(v.until),since=v.since&&vipDate(v.since);
  const T={
    none:['当前套餐：Basic','免费使用。核心的社交、聊天、安全能力都已包含。'],
    active:['当前套餐：NOVA VIP',(since?'开通于 '+since+' · ':'')+'到期 '+until+'（剩余 '+v.daysLeft+' 天）'],
    expiring:['NOVA VIP · 即将到期','到期 '+until+'，还剩 '+v.daysLeft+' 天。到期后自动回到 Basic，你的内容都会保留。'],
    expired:['VIP 已过期','已于 '+(v.expiredAt?vipDate(v.expiredAt):'—')+' 回到 Basic。你发过、收藏过的内容都还在。'],
    revoked:['VIP 已被撤销','已回到 Basic，你的内容都还在。如有疑问请联系管理员。']}[v.state]||['当前套餐：Basic',''];
  return `<div class="card vp" data-vs="${esc(v.state)}"><b>${esc(T[0])}</b><small>${esc(T[1])}</small></div>`}
function vipPlans(c){
  const b=c.plans.basic,v=c.plans.vip;
  return `<div class="plans"><div class="plan" data-plan="basic"><b>${esc(b.name)}</b><div class="pp">免费</div><small>${esc(b.tagline)}</small></div><div class="plan v" data-plan="vip"><b>${esc(v.name)}</b><div class="pp">${v.prices.map(p=>esc(p.label)).join('<br>')}</div><small>${esc(v.tagline)}</small></div></div><p class="vpn">${esc(v.priceNote)}</p>`}
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
  else body=vipStatusCard()+vipTestBox(c)+(VIP.err?`<div class="err" role="alert" style="margin:8px 16px">${esc(VIP.err)}</div>`:'')+vipPlans(c)+vipCompare(c)+vipRules(c);
  return `<div class="pg" id="vipc">${sub('会员中心')}<div class="sc">${body}</div></div>`};
/* 设置页里的入口行 */
const vipRow=()=>{if(!NET)return '';const v=MODE==='account'&&VIP.me&&VIP.me.vip;
  const t=MODE!=='account'?'登录后查看会员状态':!v?'Basic · 免费':v.active?'NOVA VIP · 剩余 '+v.daysLeft+' 天':'Basic · 免费';
  return `<button class="row" style="width:100%;text-align:left" data-a="vip"><div class="gr"><b>会员中心</b><small>${esc(t)}</small></div><small>›</small></button>`};
const vipOpen=()=>{S.sh=null;S.st.push('vip');loadVip().then(()=>render())};
const vipRetry=()=>{VIP.err='';loadVip().then(()=>render())};
const vipTog=v=>vipToggle(v);
