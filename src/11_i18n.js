/* 界面语言：简体中文 / English。只翻译应用自带的界面文字（按钮、标签、菜单、提示），
   用户写的内容不翻译。做法：渲染后在 DOM 上把认识的界面文字换成英文；
   一段文字里只要还剩不认识的中文（多半是用户内容），就整段保持原样。 */
const LANGS={zh:'简体中文',en:'English'};
function getLang(){try{const v=localStorage.getItem('nova_lang');return v==='en'?'en':'zh'}catch(e){return 'zh'}}
let LANG=getLang();
const I18N={dict:null,re:null,keys:null};
const I18N_SKIP_SEL='[data-ut],div.tx,.fn,.cap,.fbd,.bio,.gintro,.bb,.bbl,.mtx,.ptx,.cmtx,.ndb,textarea,script,style,[contenteditable="true"]';
const HAS_ZH=/[\u3400-\u9fff]/;
function i18nDict(){
  if(I18N.dict)return I18N.dict;
  const d=(typeof I18N_EN!=='undefined'&&I18N_EN)||{};
  I18N.dict=d;
  const keys=Object.keys(d).filter(k=>HAS_ZH.test(k)&&k.length>=1).sort((a,b)=>b.length-a.length);
  I18N.keys=keys;
  const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  I18N.re=keys.length?new RegExp(keys.map(esc).join('|'),'g'):null;
  return d;
}
/* 带数字的固定说法 */
const I18N_PAT=[
  [/^(\d+)\s*分钟前$/,(m,n)=>n+' min ago'],
  [/^(\d+)\s*小时前$/,(m,n)=>n+' h ago'],
  [/^(\d+)\s*天前$/,(m,n)=>n+' d ago'],
  [/^(\d+(?:\.\d+)?)\s*万$/,(m,n)=>(Number(n)*10)+'k'],
  [/^(\d+)\s*名成员\s*·\s*(\d+)\s*个频道$/,(m,a,b)=>a+(a==='1'?' member':' members')+' · '+b+(b==='1'?' channel':' channels')],
  [/^(\d+)\s*[位名]成员$/,(m,n)=>n+(n==='1'?' member':' members')],
  [/^(\d+(?:\.\d+)?)\s*万位成员$/,(m,n)=>(Number(n)*10)+'k members'],
  [/^(\d+)\s*条回复$/,(m,n)=>n+(n==='1'?' reply':' replies')],
  [/^(\d+)\s*天$/,(m,n)=>n+(n==='1'?' day':' days')],
  [/^(\d+)\s*个$/,(m,n)=>n],
  [/^(\d+)\s*人$/,(m,n)=>n+(n==='1'?' person':' people')],
  [/^(\d+)\s*条$/,(m,n)=>n],
  [/^(\d+)\s*次$/,(m,n)=>n+(n==='1'?' time':' times')],
  [/^(\d+)\s*岁$/,(m,n)=>n+' yrs'],
  [/^(\d+)\s*字$/,(m,n)=>n+' chars'],
  [/^(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日$/,(m,y,mo,d)=>y+'-'+String(mo).padStart(2,'0')+'-'+String(d).padStart(2,'0')],
  [/^(\d{1,2})\s*月\s*(\d{1,2})\s*日$/,(m,mo,d)=>['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(mo)-1]+' '+d],
  [/^昨天\s*(\d{1,2}:\d{2})$/,(m,t)=>'Yesterday '+t],
  [/^在\s*(.+?)\s*发言$/,(m,c)=>'Message '+(c==='大厅'?'Lobby':c)],
  [/^个人屏蔽词最多\s*(\d+)\s*个$/,(m,n)=>'Up to '+n+' personal blocked words'],
  [/^创建新话题过快，请稍后再试（每小时最多\s*(\d+)\s*个新标签）$/,(m,n)=>'Too many new topics. Try again later (up to '+n+' new tags per hour)'],
  [/^回复层级过深（最多\s*(\d+)\s*层）$/,(m,n)=>'Replies are nested too deep (max '+n+' levels)'],
  [/^每条动态最多\s*(\d+)\s*个话题标签$/,(m,n)=>'Up to '+n+' hashtags per post'],
  [/^评论最多\s*(\d+)\s*字$/,(m,n)=>'Comments can be up to '+n+' characters'],
  [/^内容未通过审核(?:：(.+))?$/,(m,r)=>'This content didn\'t pass review'+(r?': '+r:'')],
  [/^(?:动态|正文|内容|消息)最多\s*(\d+)\s*字$/,(m,n)=>'Up to '+n+' characters'],
  [/^(\S+)\s+(关注了你|评论了你的帖子|对你的帖子表态|有一条新公告|赞了你的帖子|通过了你的好友申请)$/,(m,n,a)=>n+' '+(i18nDict()[a]||a)],
  [/^🚀 推流中 · 已曝光 (\d+)\/(\d+)$/,(m,a,b)=>'🚀 Boosting · '+a+'/'+b+' seen'],
  [/^周([一二三四五六日天])$/,(m,w)=>({一:'Mon',二:'Tue',三:'Wed',四:'Thu',五:'Fri',六:'Sat',日:'Sun',天:'Sun'})[w]],
];
function trText(s){
  if(LANG!=='en'||!s||!HAS_ZH.test(s))return s;
  const d=i18nDict();
  const lead=s.match(/^\s*/)[0],trail=s.match(/\s*$/)[0],core=s.trim();
  if(Object.prototype.hasOwnProperty.call(d,core))return lead+d[core]+trail;
  for(const [re,fn] of I18N_PAT){const m=core.match(re);if(m)return lead+fn(...m)+trail}
  if(!I18N.re)return s;
  let lastEnd=-1,glued=false;
  let out=core.replace(I18N.re,(k,off,all)=>{
    /* 两个词紧挨着、中间没有空格或标点：多半是用户写的句子，整段不翻 */
    if(off===lastEnd&&/[\u3400-\u9fff]/.test(all[off-1]||'')&&/[\u3400-\u9fff]/.test(k[0]))glued=true;
    lastEnd=off+k.length;
    const v=d[k];const prev=all[off-1]||'',next=all[off+k.length]||'';
    const sp1=/[A-Za-z0-9)\]）】」』]/.test(prev)&&/^[A-Za-z0-9(]/.test(v)?' ':'';
    const sp2=/[A-Za-z0-9(（【「『]/.test(next)&&/[A-Za-z0-9.)]$/.test(v)?' ':'';
    return sp1+v+sp2;
  });
  for(const [re,fn] of I18N_PAT){/* 片段里的数字说法 */
    const src=re.source.replace(/^\^/,'').replace(/\$$/,'');
    try{out=out.replace(new RegExp(src,'g'),(...a)=>fn(...a.slice(0,a.length-2)))}catch(e){}
  }
  out=out.replace(/：/g,': ').replace(/，/g,', ').replace(/。/g,'. ').replace(/；/g,'; ').replace(/（/g,' (').replace(/）/g,') ').replace(/「|」|“|”/g,'"').replace(/！/g,'! ').replace(/？/g,'? ').replace(/、/g,', ').replace(/[ \t]{2,}/g,' ').replace(/[ \t]+\n/g,'\n').replace(/\n[ \t]+/g,'\n').replace(/[ \t]+([,.;:!?)])/g,'$1').trim();
  if(glued||HAS_ZH.test(out))return s; /* 还有不认识的中文：多半是用户内容，整段不动 */
  return lead+out+trail;
}
const tr=trText;
/* 同一个中文在不同位置意思不同时，按所在元素选译法 */
const I18N_CTX=[['.sts','关注','Following'],['.sts','粉丝','Followers'],['.sts','帖子','Posts'],['.tag,.role,.rtag,.mrole','成员','Member'],['.top h1','帖子','Post'],['.top h1','动态','Post'],['.pill','已关闭','Closed'],['.top h1','共创','Co-create'],['.top h1','项目','Project'],['.top h1','活动','Event']];
function i18nCtx(t){const p=t.parentElement;if(!p)return null;const core=t.nodeValue.trim();for(const [sel,zh,en] of I18N_CTX){if(core===zh&&p.closest(sel))return t.nodeValue.replace(zh,en)}return null}
const I18N_ATTRS=['placeholder','aria-label','title','alt','data-ph'];
function trNode(root){
  if(LANG!=='en'||!root)return;
  i18nDict();
  if(root.nodeType===3){const p=root.parentElement;if(p&&!p.closest(I18N_SKIP_SEL)){const v=trText(root.nodeValue);if(v!==root.nodeValue)root.nodeValue=v}return}
  if(root.nodeType!==1)return;
  if(root.closest&&root.closest(I18N_SKIP_SEL)){if(root.matches&&root.matches('textarea,input')&&!(root.parentElement&&root.parentElement.closest(I18N_SKIP_SEL))){for(const a of I18N_ATTRS){const v=root.getAttribute(a);if(v&&HAS_ZH.test(v))root.setAttribute(a,trText(v))}}return}
  const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT,{acceptNode(n){
    if(n.nodeType===1)return n.matches(I18N_SKIP_SEL)?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_SKIP;
    return HAS_ZH.test(n.nodeValue)?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_SKIP}});
  const list=[];let n;while((n=w.nextNode()))list.push(n);
  for(const t of list){const c=i18nCtx(t);const v=c!=null?c:trText(t.nodeValue);if(v!==t.nodeValue)t.nodeValue=v}
  const els=[root,...root.querySelectorAll('[placeholder],[aria-label],[title],[alt],input[type=button],input[type=submit]')];
  for(const el of els){
    const host=el.parentElement;if(host&&host.closest(I18N_SKIP_SEL))continue;
    for(const a of I18N_ATTRS){const v=el.getAttribute&&el.getAttribute(a);if(v&&HAS_ZH.test(v)){const t=trText(v);if(t!==v)el.setAttribute(a,t)}}
    if(el.tagName==='INPUT'&&(el.type==='button'||el.type==='submit')&&HAS_ZH.test(el.value)){el.value=trText(el.value)}
  }
}
let I18N_MO=null;
function i18nStart(){
  document.documentElement.lang=LANG==='en'?'en':'zh-CN';
  document.documentElement.dataset.lang=LANG;
  if(LANG!=='en'){if(I18N_MO){I18N_MO.disconnect();I18N_MO=null}return}
  trNode(document.body);
  if(I18N_MO||typeof MutationObserver==='undefined')return;
  const pend=new Set();let sch=false;
  I18N_MO=new MutationObserver(ms=>{
    for(const m of ms){
      if(m.type==='characterData')pend.add(m.target);
      else if(m.type==='attributes')pend.add(m.target);
      else m.addedNodes.forEach(x=>pend.add(x));
    }
    if(!sch){sch=true;(window.queueMicrotask||setTimeout)(()=>{sch=false;const a=[...pend];pend.clear();for(const x of a)if(x.isConnected)trNode(x)})}
  });
  I18N_MO.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['placeholder','aria-label','title']});
}
/* 原生对话框也走翻译 */
if(typeof window!=='undefined'&&!window.__i18nWrap){
  window.__i18nWrap=1;
  for(const k of ['alert','confirm','prompt']){const f=window[k];if(typeof f==='function')window[k]=function(msg,...r){return f.call(window,trText(String(msg==null?'':msg)),...r)}}
}
function setLang(v){
  const n=v==='en'?'en':'zh';
  try{localStorage.setItem('nova_lang',n)}catch(e){}
  const was=LANG;LANG=n;
  if(was==='en'&&n==='zh'){if(I18N_MO){I18N_MO.disconnect();I18N_MO=null}}
  document.documentElement.lang=n==='en'?'en':'zh-CN';document.documentElement.dataset.lang=n;
  if(typeof render==='function')render();
  i18nStart();
}
if(typeof document!=='undefined'){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',i18nStart);else setTimeout(i18nStart,0)}
