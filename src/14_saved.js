/* 个人收藏（M2.5.3）。VIP 只增加你自己的私有收藏额度，不扩大群聊/社区公共置顶。
   已登录走服务端（额度由服务器按套餐执行）；演示只存在本机，按 Basic 20 条。 */
function savedLimit(){
  if(MODE==='account'&&VIP.me&&VIP.me.entitlements&&VIP.me.entitlements.personal_saved_items_plus){
    const v=VIP.me.entitlements.personal_saved_items_plus.value;if(typeof v==='number')return v}
  return 20}
function localSaved(){D.sv=D.sv||[];return D.sv}
function savedItems(){return MODE==='account'&&S.saved&&S.saved.items?S.saved.items:localSaved()}
function isSaved(kind,target){return savedItems().some(i=>i.kind===kind&&i.target===target)}
async function loadSaved(){
  if(MODE!=='account'||!NET||!SESSION){return}
  const r=await api('GET','/api/me/saved');
  if(r.s===200)S.saved={items:r.j.items,count:r.j.count,limit:r.j.limit,plan:r.j.plan}}
async function saveItem(kind,target,title,excerpt){
  if(MODE==='account'&&NET&&SESSION){
    const r=await api('POST','/api/me/saved',{kind,target,title,excerpt});
    if(r.s!==200){T(errMsg(r,'收藏失败'));return false}
    if(!S.saved)S.saved={items:[],count:0,limit:savedLimit()};
    if(!r.j.existed){S.saved.items.unshift(r.j.item);S.saved.count=r.j.count;S.saved.limit=r.j.limit}if(kind==='post'&&typeof r.j.bookmarkCount==='number'&&typeof savSetCount==='function')savSetCount(target,r.j.bookmarkCount);
    T(r.j.existed?'已在收藏中':'已收藏');return true}
  const a=localSaved();
  if(a.some(i=>i.kind===kind&&i.target===target)){T('已在收藏中');return true}
  if(a.length>=savedLimit()){T('个人收藏已达 '+savedLimit()+' 条上限。这是私人收藏，与公共置顶无关。');return false}
  a.unshift({id:'s'+Date.now(),kind,target,title:title||'',excerpt:excerpt||'',createdAt:Date.now()});T('已收藏');return true}
async function unsaveItem(kind,target,id){
  if(MODE==='account'&&NET&&SESSION){
    const r=await api('POST','/api/me/saved/remove',id?{id}:{kind,target});
    if(r.s!==200){T(errMsg(r,'取消收藏失败'));return}
    if(S.saved){S.saved.items=S.saved.items.filter(i=>i.id!==r.j.removed.id);S.saved.count=r.j.count}if(r.j.removed&&r.j.removed.kind==='post'&&typeof r.j.bookmarkCount==='number'&&typeof savSetCount==='function')savSetCount(r.j.removed.target,r.j.bookmarkCount);
    T('已取消收藏');return}
  D.sv=localSaved().filter(i=>id!=null&&id!==''?String(i.id)!==String(id):!(i.kind===kind&&i.target===target));T('已取消收藏')}
/* 2.0.3 帖子收藏（首页 / 详情 / 推流帖 / 从通知或链接打开的帖子都走这里）：
   - 以前只在首页列表和演示数据里找帖子，推流帖、postCache 里的帖子找不到就直接 return，点了没反应；
   - 以前收藏成功后不更新帖子上的 bookmarkCount，数字一直是加载时的旧值；
   现在：先在本机立即切换（亮 / 灭、±1），再以服务器返回的 bookmarkCount 为准；失败就改回去。连点时忽略进行中的那次。 */
function savPosts(v){v=String(v);const seen=new Set(),out=[];[].concat(typeof feedSrc==='function'?feedSrc():[],Array.isArray(S.posts)?S.posts:[],Array.isArray(S.boosts)?S.boosts:[],D.p||[],S.postCache?Object.values(S.postCache):[]).forEach(x=>{if(x&&String(x.id)===v&&!seen.has(x)){seen.add(x);out.push(x)}});return out}
function savSetCount(v,n){savPosts(v).forEach(x=>{x.bookmarkCount=Math.max(0,n)})}
async function savp(v){v=String(v);S.sh=null;S.savBusy=S.savBusy||{};if(S.savBusy[v])return;
  const ps=savPosts(v),p=ps[0];
  const was=isSaved('post',v),before=p?postBookmarks(p):0;
  const net=MODE==='account'&&NET&&SESSION;
  if(!net){if(!p)return;if(was)return unsaveItem('post',v);return saveItem('post',v,(typeof P==='function'?P(p.a).n:''),p.x)}
  S.savBusy[v]=1;
  if(!S.saved)S.saved={items:[],count:0,limit:savedLimit()};
  const fake={id:'tmp-'+v,kind:'post',target:v,title:'',excerpt:''};
  if(was)S.saved.items=S.saved.items.filter(i=>!(i.kind==='post'&&i.target===v));else S.saved.items.unshift(fake);
  savSetCount(v,before+(was?-1:1));if(typeof render==='function')render();
  try{
    const r=was?await api('POST','/api/me/saved/remove',{kind:'post',target:v}):await api('POST','/api/me/saved',{kind:'post',target:v,title:p&&typeof P==='function'?P(p.a).n:'',excerpt:p?String(p.x||'').slice(0,200):''});
    S.saved.items=S.saved.items.filter(i=>i!==fake);
    if(r.s===200||(was&&r.s===404)){
      if(!was&&r.j&&r.j.item&&!S.saved.items.some(i=>i.kind==='post'&&i.target===v))S.saved.items.unshift(r.j.item);
      if(r.j&&typeof r.j.count==='number')S.saved.count=r.j.count;
      if(r.j&&typeof r.j.bookmarkCount==='number')savSetCount(v,r.j.bookmarkCount);
      T(was?'已取消收藏':'已收藏');
    }else{
      if(was&&!S.saved.items.some(i=>i.kind==='post'&&i.target===v))S.saved.items.unshift({id:'tmp-'+v,kind:'post',target:v});
      savSetCount(v,before);T(errMsg(r,was?'取消收藏失败':'收藏失败'));
    }
  }finally{delete S.savBusy[v];if(typeof render==='function')render()}
}
function savm(v){const[k,cid,id]=v.split('|'),m=msgs(k,cid).find(x=>mid(k,x)==id);S.sh=null;if(!m)return;const tgt=cid+':'+id;if(isSaved('message',tgt))return unsaveItem('message',tgt);return saveItem('message',tgt,P(m[0]).n,String(mtext(k,m)||'').slice(0,80))}
function unsav(v){const it=savedItems().find(i=>String(i.id)===String(v));if(it)return unsaveItem(it.kind,it.target,it.id);const i=String(v).indexOf('|');if(i<0)return;return unsaveItem(v.slice(0,i),v.slice(i+1))}
const savedOpen=()=>{S.sh=null;S.st.push('saved');return MODE==='account'?loadSaved():Promise.resolve()};
function pSaved(){
  const lim=MODE==='account'&&S.saved&&typeof S.saved.limit==='number'?S.saved.limit:savedLimit(),items=savedItems(),n=items.length;
  const rows=n?items.map(i=>`<div class="row" ${i.kind==='post'?'data-a="post" data-v="'+esc(i.target)+'"':''}><div class="gr"><b>${esc(i.title||i.target)}</b><small>${esc(i.excerpt||'')}</small></div><button class="pb sm s" data-a="unsav" data-v="${esc(String(i.id))}">取消收藏</button></div>`).join(''):'<p class="em" data-sv="empty">还没有收藏。帖子或消息的菜单里可以收藏，只你自己看得到。</p>';
  const who=MODE==='account'?(S.saved&&S.saved.plan==='vip'?'VEXO VIP 额度':'Basic 额度'):'演示额度';
  return `<div class="pg" id="savedp">${sub('我的收藏')}<div class="sc"><p class="hint" style="padding:12px 16px 0" data-svq="${n}/${lim}">${esc(who)}：${n} / ${lim} 条。这是你的私人收藏，不会出现在群聊或社区的公共置顶里。</p>${rows}</div></div>`}
const savedRow=()=>`<button class="row" style="width:100%;text-align:left" data-a="saved" id="svrow"><div class="gr"><b>我的收藏</b><small>私人收藏，最多 ${savedLimit()} 条</small></div><small>›</small></button>`;
