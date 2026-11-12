const chk=t=>{const k=t.dataset.d,mx=+t.dataset.max||0,raw=len(t.value),b=$(`[data-for=${k}]`),c=$(`[data-cnt=${k}]`);if(b)b.disabled=!ok(t.value,mx||1e9);if(c){c.textContent=raw>mx?`已超出 ${raw-mx} 字`:`${raw}/${mx}`;c.style.color=raw>mx?'var(--dg)':''}};
function renderCore(){
if(MODE==='boot'||MODE==='gate'||MODE==='offline'){document.documentElement.dataset.theme=typeof resolvedTheme==='function'?resolvedTheme():((D.st&&D.st.theme)||'dark');applyVipTheme(false);document.body.classList.toggle('rm',!!(D.st&&D.st.rm));$('#v').innerHTML=(typeof iosStatus==='function'?iosStatus():'')+(MODE==='boot'?bootView():MODE==='offline'?offlineView():gateView());if(MODE==='gate'){document.querySelectorAll('#v [data-d]').forEach(el=>{if(S.d[el.dataset.d]!=null)el.value=S.d[el.dataset.d]});const af=$('#v [data-af]');if(af&&!af.value)af.focus()}return}
fixIds();const cur=S.st[S.st.length-1],key=cur||S.tab,old=$('#v .sc'),y=old&&S.k==key?old.scrollTop:0;S.k=key;
document.documentElement.dataset.theme=typeof resolvedTheme==='function'?resolvedTheme():(D.st.theme||'dark');syncVipUser();applyVipTheme(vipThemeOn());document.body.classList.toggle('rm',!!D.st.rm);
const hideNav=cur==='compose';
$('#v').innerHTML=(typeof iosStatus==='function'?iosStatus():'')+(cur?page(cur):S.tab=='home'?tHome():S.tab=='cm'?tCm():S.tab=='chat'?tChat():tMe())+(hideNav?'':nav())+sheet();
document.querySelectorAll('#v [data-d]').forEach(el=>{el.value=S.d[el.dataset.d]||'';chk(el)});
const sc=$('#v .sc');if(sc)sc.scrollTop=(cur&&cur.startsWith('chat:'))||S.bot?1e9:y;S.bot=0;if(S.jump&&sc){const el=sc.querySelector('[data-mid="'+S.jump+'"]');if(el){sc.scrollTop=el.getBoundingClientRect().top-sc.getBoundingClientRect().top+sc.scrollTop-70;el.classList.add('flash')}S.jump=null}
const af=$('#v [data-af]');if(af)af.focus();if(S.foc){const fi=$('#v [data-d='+S.foc+']');fi&&fi.focus();S.foc=null}save()}
