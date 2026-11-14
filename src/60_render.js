const chk=t=>{const k=t.dataset.d,mx=+t.dataset.max||0,raw=len(t.value),b=$(`[data-for=${k}]`),c=$(`[data-cnt=${k}]`);if(b){const media=k==='pin'&&S.comp&&((S.comp.media&&S.comp.media.length)||S.comp.poll||S.comp.act)&&raw<=(mx||1e9);b.disabled=!ok(t.value,mx||1e9)&&!media;b.classList.toggle('off',b.disabled&&b.classList.contains('pb')&&k==='pin')}if(c){c.textContent=raw>mx?`已超出 ${raw-mx} 字`:`${raw}/${mx}`;c.style.color=raw>mx?'var(--dg)':''}};
/* r10：输入框随内容自动变高，最多 data-grow 行（默认 5 行），超过后在框内滚动。回车键换行，点「发送」发送。 */
function growTa(t){if(!t||t.tagName!=='TEXTAREA')return;const max=+(t.dataset.grow||5)||5;const cs=getComputedStyle(t);const lh=parseFloat(cs.lineHeight)||20;const pad=(parseFloat(cs.paddingTop)||0)+(parseFloat(cs.paddingBottom)||0);t.style.height='auto';const want=Math.min(t.scrollHeight,lh*max+pad);t.style.height=Math.max(want,lh+pad)+'px';t.style.overflowY=t.scrollHeight>lh*max+pad+1?'auto':'hidden'}
function renderCore(){
if(MODE==='boot'||MODE==='gate'||MODE==='offline'||MODE==='maint'){document.documentElement.dataset.theme=typeof resolvedTheme==='function'?resolvedTheme():((D.st&&D.st.theme)||'dark');applyVipTheme(false);document.body.classList.toggle('rm',!!(D.st&&D.st.rm));$('#v').innerHTML=(typeof iosStatus==='function'?iosStatus():'')+(MODE==='gate'&&typeof maintBar==='function'?maintBar():'')+(MODE==='boot'?bootView():MODE==='offline'?offlineView():MODE==='maint'?maintView():gateView());if(MODE==='gate'){document.querySelectorAll('#v [data-d]').forEach(el=>{if(S.d[el.dataset.d]!=null)el.value=S.d[el.dataset.d]});const af=$('#v [data-af]');if(af&&!af.value)af.focus()}return}
fixIds();const cur=S.st[S.st.length-1],key=typeof scrollKey==='function'?scrollKey():(cur||S.tab),prevKey=S.k,prevDepth=S._sd||0,newDepth=(S.st||[]).length;if(typeof captureScroll==='function')captureScroll();else{const old=$('#v .sc');if(old&&prevKey){S.sy=S.sy||{};S.sy[prevKey]=old.scrollTop}}if(typeof planScroll==='function')planScroll(prevKey,key,prevDepth,newDepth,cur);S.k=key;S._sd=newDepth;
document.documentElement.dataset.theme=typeof resolvedTheme==='function'?resolvedTheme():(D.st.theme||'dark');syncVipUser();applyVipTheme(vipThemeOn());document.body.classList.toggle('rm',!!D.st.rm);
const hideNav=!!cur;
try{$('#v').classList.toggle('has-nav',!hideNav)}catch(e){}
const shKey=S.sh?String(S.sh.t)+':'+(S.sh.id||''):'',prevShKey=S._shk||'';S._shk=shKey;
$('#v').innerHTML=(typeof iosStatus==='function'?iosStatus():'')+(cur?page(cur):S.tab=='home'?tHome():S.tab=='cm'?tCm():S.tab=='co'&&typeof tCo==='function'?tCo():S.tab=='chat'?tChat():tMe())+(typeof maintBar==='function'?maintBar():'')+(hideNav?'':nav())+sheet();
document.querySelectorAll('#v [data-d]').forEach(el=>{el.value=S.d[el.dataset.d]||'';chk(el);if(el.dataset.grow)growTa(el)});
const sc=$('#v .sc');if(typeof applyScroll==='function')applyScroll(sc,S._restore);else if(sc)sc.scrollTop=(cur&&cur.startsWith('chat:'))||S.bot?1e9:(prevKey==key?(S.sy&&S.sy[key]||0):0);S.bot=0;if(S.jump&&sc){const el=sc.querySelector('[data-mid="'+S.jump+'"]');if(el){sc.scrollTop=el.getBoundingClientRect().top-sc.getBoundingClientRect().top+sc.scrollTop-70;el.classList.add('flash')}S.jump=null}
/* r7：只在刚打开页面/面板时自动聚焦一次。以前每次点按都会整页重绘并重新聚焦输入框，键盘反复弹出收起，页面跟着上下跳、看起来忽大忽小；
   面板打开时也不再去聚焦面板后面页面里的输入框。 */
if(shKey&&shKey===prevShKey)document.querySelectorAll('#v .pn,#v .ov').forEach(x=>x.classList.add('noanim'));
const pgKey=String(cur||S.tab);let af=null;
if(shKey){if(shKey!==prevShKey)af=$('#v .pn [data-af]')}else if(pgKey!==S._afp)af=$('#v .pg [data-af]');
S._afp=pgKey;if(af)af.focus();if(S.foc){const fi=$('#v [data-d='+S.foc+']');fi&&fi.focus();S.foc=null}save()}
