/* 命令速查（tldr-pages，CC BY 4.0）：入口在社区页，和小游戏并排。数据只向本服务器 /api/tldr 请求。 */
function tldrState(){return S.tldr || (S.tldr={q:'', items:null, err:'', loading:0, cmd:null, page:null, cmdErr:'', cmdLoading:0})}
function tldrAttrHtml(a){
  if(!a) return '';
  const page=(a.pageUrl&&/\/pages/.test(a.pageUrl))?`<a href="${esc(a.pageUrl)}" target="_blank" rel="noopener">查看原文</a>`:'';
  const site=`<a href="${esc(a.site||'https://tldr.sh')}" target="_blank" rel="noopener">tldr.sh</a>`;
  const repo=`<a href="${esc(a.url||'https://github.com/tldr-pages/tldr')}" target="_blank" rel="noopener">tldr-pages</a>`;
  return `<p class="tldr-attr">${esc(a.text||'内容来自 tldr-pages，按 CC BY 4.0 许可使用。')} ${repo} · ${site}${page?' · '+page:''}</p>`;
}
function tldrCard(){
  const ico=typeof icLine==='function'?icLine('cmd'):'>';
  return `<button type="button" class="gmini" data-a="tldr"><span class="ico">${ico}</span><span class="gr"><b>命令速查</b><small>输入命令名，查看常用用法</small></span></button>`;
}
async function loadTldrSearch(q){
  const st=tldrState();
  st.q=q==null?st.q:String(q);
  if(!(typeof usingNet==='function'&&usingNet()&&SESSION)){st.err='需要登录后才能使用命令速查。';st.items=[];return}
  st._tok=(st._tok||0)+1; const token=st._tok;
  st.loading=1; st.err='';
  const r=await api('GET','/api/tldr?q='+encodeURIComponent(st.q||''));
  if(token!==st._tok) return;
  st.loading=0;
  if(!r||r.s!==200){st.err=(typeof errMsg==='function'?errMsg(r,'暂时无法获取命令目录，请检查网络后再试。'):'暂时无法获取命令目录，请检查网络后再试。');st.items=[];return}
  st.items=r.j.items||[]; st.attr=r.j.attribution;
}
async function loadTldrCmd(name){
  const st=tldrState();
  const cmd=String(name||'').trim();
  st.cmd=cmd; st.page=null; st.cmdErr=''; st.cmdLoading=1;
  if(!(typeof usingNet==='function'&&usingNet()&&SESSION)){st.cmdLoading=0;st.cmdErr='需要登录后才能使用命令速查。';return}
  const r=await api('GET','/api/tldr?cmd='+encodeURIComponent(cmd));
  st.cmdLoading=0;
  if(!r||r.s!==200){st.cmdErr=(typeof errMsg==='function'?errMsg(r,'暂时无法获取命令说明，请检查网络后再试。'):'暂时无法获取命令说明，请检查网络后再试。');return}
  st.page=r.j;
}
function tldrListHtml(){
  const st=tldrState();
  if(st.loading&&!st.items) return '<p class="em">正在加载命令目录…</p>';
  if(st.err) return `<p class="em tldr-err">${esc(st.err)}</p>`;
  const items=st.items||[];
  if(!items.length) return `<p class="em">${st.q?'没有找到匹配的命令。':'暂时没有可显示的命令。'}</p>`;
  return `<div class="tldr-list">${items.map(it=>`<button type="button" class="tldr-item" data-a="tldrcmd" data-v="${esc(it.name)}"><b>${esc(it.name)}</b><small>${esc((it.platforms||[]).join(' · '))}${(it.languages||[]).includes('zh')?' · 中文':''}</small></button>`).join('')}</div>`;
}
const pTldr=()=>{
  const st=tldrState();
  const q=st.q||'';
  return `<div class="pg tldr-pg">${typeof sub==='function'?sub('命令速查'):'<div class="top sub"><h1>命令速查</h1></div>'}<div class="sc tldr-sc"><div class="tldr-search"><input class="fld" id="tldrq" data-d="tldrq" placeholder="搜索命令，例如 ls、git、curl" value="${esc(q)}" autocomplete="off" spellcheck="false"></div>${tldrListHtml()}${tldrAttrHtml(st.attr)}</div></div>`;
};
const pTldrCmd=name=>{
  const st=tldrState();
  const cmd=name||st.cmd||'';
  let body='';
  if(st.cmdLoading&&!st.page) body='<p class="em">正在加载说明…</p>';
  else if(st.cmdErr) body=`<p class="em tldr-err">${esc(st.cmdErr)}</p>`;
  else if(!st.page) body='<p class="em">正在加载说明…</p>';
  else {
    const p=st.page;
    const lang=p.language==='zh'?'中文':'English';
    const ex=(p.examples||[]).map(e=>`<li class="tldr-ex"><p>${esc(e.text||'')}</p>${e.code?`<pre><code>${esc(e.code)}</code></pre>`:''}</li>`).join('');
    body=`<div class="tldr-card"><h2>${esc(p.title||cmd)}</h2><p class="tldr-desc">${esc(p.description||'')}</p><p class="tldr-meta">${esc(lang)} · ${esc(p.platform||'')}</p>${ex?`<ul class="tldr-exs">${ex}</ul>`:''}${tldrAttrHtml(p.attribution)}</div>`;
  }
  return `<div class="pg tldr-pg">${typeof sub==='function'?sub(esc(cmd||'命令速查')):'<div class="top sub"><h1>'+esc(cmd)+'</h1></div>'}<div class="sc tldr-sc">${body}</div></div>`;
};
function scheduleTldrSearch(){
  const st=tldrState();
  clearTimeout(st._tm);
  st._tm=setTimeout(()=>{
    loadTldrSearch(st.q).then(()=>{
      const box=document.getElementById('tldrlist')||document.querySelector('.tldr-sc');
      const list=document.querySelector('.tldr-pg .tldr-list, .tldr-pg .em, .tldr-pg .tldr-err');
      const sc=document.querySelector('.tldr-pg .tldr-sc');
      if(!sc) { if(typeof render==='function') render(); return; }
      const search=sc.querySelector('.tldr-search');
      const attr=sc.querySelector('.tldr-attr');
      const keep=search?search.outerHTML:'';
      const mid=tldrListHtml();
      const foot=tldrAttrHtml(st.attr);
      sc.innerHTML=keep+mid+foot;
      const inp=document.getElementById('tldrq');
      if(inp){inp.value=st.q||'';}
    });
  }, 200);
}
