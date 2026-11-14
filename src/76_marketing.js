/* r10 营销管理（1）：营销帖（广告）。
   服务器在信息流第一页附带 ads（已为这个用户随机挑好）和 adEvery（每几条普通帖插 1 条）。
   卡片不显示发布者，只显示「推广」标记和 ⋯ 菜单（不感兴趣等）；曝光 / 点击 / 不感兴趣都回报服务器。 */
const AD_HIDE_REASONS=['不感兴趣','重复看到','内容不适','虚假广告'];
function adUrl(u){u=String(u||'');if(/^https?:\/\//i.test(u))return u;if(/^\/api\//.test(u))return (typeof apiBase==='function'?apiBase():'')+u;return ''}
function adMediaHTML(ad){const m=(ad.media||[]).filter(x=>adUrl(x.url));if(!m.length)return '';
  if(m[0].kind==='video')return `<div class="admedia"><video src="${esc(adUrl(m[0].url))}" controls playsinline muted preload="metadata"></video></div>`;
  if(m.length===1)return `<div class="admedia"><img src="${esc(adUrl(m[0].url))}" alt="" loading="lazy"></div>`;
  return `<div class="admedia grid">${m.slice(0,4).map(x=>`<img src="${esc(adUrl(x.url))}" alt="" loading="lazy">`).join('')}</div>`}
function adCard(ad,slot){
  const id=esc(ad.id),link=ad.linkUrl&&/^https?:\/\//i.test(ad.linkUrl)?ad.linkUrl:'';
  let body='';
  if(ad.kind==='sdk'&&ad.sdk&&ad.sdk.provider==='revive'&&/^https?:\/\//i.test(ad.sdk.slot||''))body=`<iframe class="adframe" src="${esc(ad.sdk.slot)}" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" loading="lazy" title="推广"></iframe>`;
  else body=`${ad.title?`<b class="adtt">${esc(ad.title)}</b>`:''}${ad.text?`<div class="adtx">${esc(ad.text)}</div>`:''}${adMediaHTML(ad)}`;
  const cta=link?`<button class="adcta" data-a="adgo" data-v="${id}">${esc(ad.cta||'了解详情')}<span aria-hidden="true">›</span></button>`:'';
  return `<article class="fcard adcard" data-adid="${id}" data-slot="${slot}"><div class="adhd"><span class="adbadge">推广</span><button class="ib" data-a="admore" data-v="${id}" aria-label="更多">${ic('more')}</button></div><div class="adbd"${link?` data-a="adgo" data-v="${id}"`:''}>${body}</div>${cta}</article>`}
function adsOn(){return typeof usingNet==='function'&&usingNet()&&S.feed!=='topic'&&Array.isArray(S.ads)&&S.ads.length>0}
/* 每 adEvery 条普通帖后插一条；帖子不够一轮但有帖子时，在末尾放一条 */
function withAds(list,render1){
  const out=[];const ads=adsOn()?S.ads.filter(a=>!(S.adHidden&&S.adHidden[a.id])):[];const every=Math.max(1,Number(S.adEvery)||5);let k=0;
  list.forEach((p,i)=>{out.push(render1(p));if(k<ads.length&&(i+1)%every===0){out.push(adCard(ads[k],k));k++}});
  if(k===0&&ads.length&&list.length&&list.length<every)out.push(adCard(ads[0],0));
  return out.join('')}
function adFind(id){return (S.ads||[]).find(a=>a.id===id)}
function adTrack(id,what,body){if(typeof api!=='function'||!usingNet())return Promise.resolve(null);return api('POST','/api/marketing/ads/'+encodeURIComponent(id)+'/'+what,body||{}).catch(()=>null)}
/* 曝光：卡片露出一半以上并停留 1 秒算一次，同一次刷新里同一个位置只算一次 */
if(typeof IntersectionObserver!=='undefined'){
  const seen=new Set(),tm=new Map();
  const io=new IntersectionObserver(es=>es.forEach(en=>{const el=en.target,id=el.getAttribute('data-adid'),key=(S.adLoad||0)+':'+el.getAttribute('data-slot')+':'+id;
    if(en.isIntersecting&&en.intersectionRatio>=.5){if(seen.has(key)||tm.has(key))return;tm.set(key,setTimeout(()=>{tm.delete(key);seen.add(key);adTrack(id,'impression')},1000))}
    else if(tm.has(key)){clearTimeout(tm.get(key));tm.delete(key)}}),{threshold:[0,.5]});
  const obs=new WeakSet();
  const scan=()=>document.querySelectorAll('.adcard[data-adid]').forEach(el=>{if(!obs.has(el)){obs.add(el);io.observe(el)}});
  if(typeof MutationObserver!=='undefined'&&document.getElementById('app')){let q=0;new MutationObserver(()=>{if(q)return;q=1;requestAnimationFrame(()=>{q=0;scan()})}).observe(document.getElementById('app'),{childList:true,subtree:true})}
}
function adOpen(url){try{const w=window.open(url,'_blank','noopener');if(!w)location.href=url}catch(e){}}
Object.assign(A,{
  adgo:v=>{const ad=adFind(v);if(!ad||!ad.linkUrl)return;adTrack(v,'click');adOpen(ad.linkUrl)},
  admore:v=>{S.sh={t:'admore',id:v}},
  adhide:v=>{const [id,ri]=String(v).split('|');const reason=AD_HIDE_REASONS[Number(ri)]||'不感兴趣';S.adHidden=S.adHidden||{};S.adHidden[id]=1;S.sh=null;adTrack(id,'hide',{reason});T('已减少这类推广')},
  adwhy:()=>{S.sh={t:'adwhy'}},
});
const _r7SheetMk=typeof r7Sheet==='function'?r7Sheet:null;
r7Sheet=function(s){
  if(s.t==='admore')return `<h3>推广</h3>${AD_HIDE_REASONS.map((r,i)=>`<button class="mi" data-a="adhide" data-v="${esc(s.id)}|${i}">${r}</button>`).join('')}<button class="mi" data-a="adwhy">为什么会看到这条推广</button><button class="mi" data-a="x">取消</button>`;
  if(s.t==='adwhy')return `<h3>关于推广</h3><p style="color:var(--t2);line-height:1.6;margin-bottom:12px">带「推广」标记的内容是平台投放的广告，按固定频率出现在信息流里，不代表你关注的人发布。选择「不感兴趣」后，这条推广不会再出现。</p><div class="fr"><button class="pb" data-a="x">知道了</button></div>`;
  return _r7SheetMk?_r7SheetMk(s):'';
};
