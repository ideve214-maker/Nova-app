/* r10 聊天输入栏（私聊、群聊、社区频道通用）：
   - 输入框占满主要宽度，最多自动增高到 5 行；右侧「＋」打开功能面板（相册、拍摄、语音、文件、表情、@、小游戏），有字时「＋」换成「发送」。
   - 语音：点「语音」开始录音，录音条上可取消或发送；上传到 /api/media 后作为消息发送，气泡里可播放。
   - 发送后、或停在底部时收到新消息，自动滚到最新一条。 */
const CB_SVG={
  video:'M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z',
  file:'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z',
  emoji:'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z',
  at:'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10h5v-2h-5c-4.34 0-8-3.66-8-8s3.66-8 8-8 8 3.66 8 8v1.43c0 .79-.71 1.57-1.5 1.57s-1.5-.78-1.5-1.57V12c0-2.76-2.24-5-5-5s-5 2.24-5 5 2.24 5 5 5c1.38 0 2.64-.56 3.54-1.47.65.89 1.77 1.47 2.96 1.47 1.97 0 3.5-1.6 3.5-3.57V12c0-5.52-4.48-10-10-10zm0 13c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3z',
  game:'M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-10 7H8v3H6v-3H3v-2h3V8h2v3h3v2zm4.5 2c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm4-3c-.83 0-1.5-.67-1.5-1.5S18.67 9 19.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z',
  camera:'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM9 2 7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z',
};
const cbSvg=n=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="${CB_SVG[n]}"/></svg>`;
/* target：'cv|会话id' 或 'ch|社区id|频道id'；ment：@ 提及的参数（空=没有）；stk：贴纸用的会话 id（空=没有） */
function cbTools(target,ment,stk){
  const t=[
    {a:'cbpick',v:target+'|album',i:ic('image'),l:'相册'},
    {a:'cbpick',v:target+'|camera',i:cbSvg('camera'),l:'拍摄'},
    {a:'voice',v:target,i:ic('mic'),l:'语音'},
    {a:'cbpick',v:target+'|file',i:cbSvg('file'),l:'文件'},
  ];
  if(stk)t.push({a:'cbstk',v:stk,i:cbSvg('emoji'),l:'表情'});
  if(ment)t.push({a:'cbment',v:ment,i:cbSvg('at'),l:'@提及'});
  t.push({a:'cbgame',v:'',i:cbSvg('game'),l:'小游戏'});
  t.target=target;
  return t;
}
function cbRecFor(target){return S.rec&&S.rec.target===target?S.rec:null}
function cbFmtDur(ms){const s=Math.max(0,Math.floor(ms/1000));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')}
function cbBar(k,ph,btn,v,tools){
  const target=tools.target||'';
  const rec=cbRecFor(target);
  if(rec){
    return `<div class="cbdock"><div class="inrow cbrow cbrec" data-k="${k}"><div class="cbrecb"><span class="cbdot"></span><span id="cbrect">${cbFmtDur(Date.now()-rec.t0)}</span><span class="cbrecl">正在录音…</span></div><button type="button" class="pb s sm" data-a="voicecancel">取消</button><button class="pb" data-a="voice" data-v="${esc(target)}">发送</button></div></div>`;
  }
  const open=S.cbp===target;
  const max=k=='chin'?textLimit('chat'):k=='cmin'?textLimit('channel'):textLimit('post');
  const row=`<div class="inrow cbrow${open?' cbopen':''}" data-k="${k}"><textarea class="inta" rows="1" data-grow="5" enterkeyhint="enter" data-d="${k}" data-max="${max}" placeholder="${ph}" autocomplete="off"></textarea><button type="button" class="ib cbplus${open?' on':''}" data-a="cbplus" data-v="${esc(target)}" aria-label="更多功能" aria-expanded="${open?'true':'false'}">${ic('plus')}</button><button class="pb cbsend" data-a="${btn}" data-v="${v}" data-for="${k}" disabled>发送</button></div>`;
  const panel=open?`<div class="cbpanel" role="menu">${tools.map(t=>`<button type="button" class="cbtile" role="menuitem" data-a="${t.a}" data-v="${esc(t.v)}"><span class="cbico">${t.i}</span><span class="cbl">${t.l}</span></button>`).join('')}</div>`:'';
  return `<div class="cbdock">${row}${panel}</div>`;
}
/* 消息气泡里的媒体 */
function cbRest(tx){const s=String(tx||'').replace(/\s*\[(图片|视频|语音|文件)\]\s*$/,'');return s?`<div class="cbtx">${fmt(s)}</div>`:''}
function cbSize(n){n=+n||0;return n>1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB'}
function cbMedia(md){
  if(!md||!md.id)return '';
  const id=esc(md.id);
  if(md.kind==='image')return `<img class="cbimg" data-mid="${id}" alt="图片" data-a="cbimg" data-v="${id}">`;
  if(md.kind==='video')return `<video class="cbvid" data-mid="${id}" controls playsinline preload="metadata"></video>`;
  if(md.kind==='audio'){
    const sec=Math.max(1,Math.round((+md.duration||0)/1000));
    const w=Math.min(200,72+sec*4);
    return `<button type="button" class="cbvoice${CB_AU.on&&CB_AU.mid===md.id?' on':''}" data-a="vplay" data-v="${id}" style="width:${w}px" aria-label="播放语音"><span class="cbvi" aria-hidden="true"></span><span class="cbvw" aria-hidden="true"><i></i><i></i><i></i></span><span class="cbvs">${md.duration?sec+'″':''}</span></button>`;
  }
  return `<button type="button" class="cbfile" data-a="cbfile" data-v="${id}">${cbSvg('file')}<span><b>${esc(md.name||'文件')}</b><small>${cbSize(md.size)}</small></span></button>`;
}
function cbParse(v){const p=String(v||'').split('|');return p[0]==='ch'?{type:'ch',cm:p[1],ch:p[2],rest:p.slice(3)}:{type:'cv',id:p[1],rest:p.slice(2)}}
function cbKey(v){const t=cbParse(v);return t.type==='ch'?'ch|'+t.cm+'|'+t.ch:'cv|'+t.id}
async function cbUpload(blob,name){
  const r=await fetch(apiUrl('/api/media'),{method:'POST',headers:{Authorization:'Bearer '+SESSION.token,'Content-Type':(blob.type||'application/octet-stream').split(';')[0],'X-File-Name':encodeURIComponent(name||'file')},body:blob});
  let j=null;try{j=await r.json()}catch(e){}
  if(r.status!==200)throw new Error((j&&j.error&&j.error.message)||'上传失败');
  return j.media;
}
async function cbSendMedia(target,blob,name,ok){
  if(typeof usingNet!=='function'||!usingNet()||!SESSION){T('演示模式暂不支持此功能');return}
  const t=cbParse(target);
  T('正在上传…');
  try{
    const md=await cbUpload(blob,name);
    if(t.type==='ch'){
      const r=await api('POST','/api/channels/'+t.ch+'/messages',{mediaId:md.id});
      if(r.s!==200){T(errMsg(r,'发送失败'));return}
      S.channelMessages=S.channelMessages||{};S.channelMessages[t.ch]=S.channelMessages[t.ch]||[];
      if(typeof adoptChMsg==='function'){const row=adoptChMsg(r.j.message),L=S.channelMessages[t.ch],i=L.findIndex(x=>x&&row&&x[3]&&x[3]===row[3]);if(i>=0)L[i]=row;else L.push(row)}
    }else{
      const r=await api('POST','/api/conversations/'+t.id+'/messages',{mediaId:md.id,clientId:'m'+Date.now()});
      if(r.s!==200){T(errMsg(r,'发送失败'));return}
      /* 服务器推送可能比这里先到，按消息 id 去重，否则会出现两条 */
      if(typeof adoptMsg==='function'){S.messages=S.messages||{};const L=S.messages[t.id]=S.messages[t.id]||[];const m=adoptMsg(r.j.message),i=L.findIndex(x=>x[5]===m[5]);if(i>=0)L[i]=m;else L.push(m)}
      if(typeof loadConversations==='function')loadConversations().catch(()=>{});
    }
    S.forceBottom=Date.now();
    if(typeof render==='function')render();
    T(ok||'已发送');
  }catch(e){T(e&&e.message?e.message:'上传失败，请稍后再试')}
}
function cbPickFile(target,mode){
  if(typeof usingNet!=='function'||!usingNet()||!SESSION)return T('演示模式暂不支持此功能');
  const inp=document.createElement('input');inp.type='file';
  if(mode==='file')inp.accept='.pdf,.txt,.zip,.doc,.docx,.json,application/pdf,application/zip,text/plain';
  else inp.accept='image/*,video/mp4,video/webm,video/quicktime';
  if(mode==='camera')inp.setAttribute('capture','environment');
  inp.style.display='none';document.body.appendChild(inp);
  inp.onchange=()=>{const f=inp.files&&inp.files[0];inp.remove();if(f)cbSendMedia(target,f,f.name)};
  inp.click();
}
/* ---- 语音录制 ---- */
let CB_TICK=null;
function cbRecMime(){
  if(typeof MediaRecorder==='undefined'||!MediaRecorder.isTypeSupported)return '';
  for(const m of ['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/aac','audio/ogg;codecs=opus'])if(MediaRecorder.isTypeSupported(m))return m;
  return '';
}
function cbStopTick(){if(CB_TICK){clearInterval(CB_TICK);CB_TICK=null}}
function cbVoice(target){
  if(typeof usingNet!=='function'||!usingNet()||!SESSION)return T('演示模式暂不支持此功能');
  const cur=S.rec;
  if(cur&&cur.mr){if(cur.mr.state!=='inactive'){try{cur.mr.stop()}catch(e){}}return}
  if(typeof MediaRecorder==='undefined'||!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)return T('此设备不支持录音');
  S.cbp=null;
  navigator.mediaDevices.getUserMedia({audio:true}).then(stream=>{
    const mime=cbRecMime();
    let mr;try{mr=mime?new MediaRecorder(stream,{mimeType:mime}):new MediaRecorder(stream)}catch(e){stream.getTracks().forEach(t=>t.stop());T('此设备不支持录音');return}
    const chunks=[];const rec={mr,stream,target,t0:Date.now(),cancel:false};
    mr.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data)};
    mr.onstop=()=>{
      cbStopTick();stream.getTracks().forEach(t=>t.stop());
      const dur=Date.now()-rec.t0;S.rec=null;if(typeof render==='function')render();
      if(rec.cancel)return;
      if(dur<800){T('说话时间太短');return}
      const type=(mr.mimeType||mime||'audio/webm').split(';')[0];
      const blob=new Blob(chunks,{type});
      if(blob.size<200){T('说话时间太短');return}
      const ext=/mp4|aac|m4a/.test(type)?'m4a':/ogg/.test(type)?'ogg':'webm';
      cbSendMedia(target,blob,'voice.'+ext,'语音已发送');
    };
    mr.start(250);S.rec=rec;
    cbStopTick();CB_TICK=setInterval(()=>{const el=document.getElementById('cbrect');if(el)el.textContent=cbFmtDur(Date.now()-rec.t0);if(Date.now()-rec.t0>=119000&&mr.state!=='inactive'){try{mr.stop()}catch(e){}}},250);
    if(typeof render==='function')render();
  }).catch(e=>{
    const n=e&&e.name;
    T(n==='NotAllowedError'||n==='SecurityError'?'没有麦克风权限，请在系统设置里允许 VEXO 使用麦克风':n==='NotFoundError'?'没有找到麦克风':'无法开始录音');
  });
}
/* ---- 播放：页面每次重绘都会重建 DOM，所以用一个不挂在页面上的 Audio 播放，按钮状态按 CB_AU 画 ---- */
const CB_AU={a:null,mid:null,on:false};
const CB_TK={};
function cbTk(mid){const e=CB_TK[mid];return e&&e.exp>Date.now()+15000?e.t:null}
function cbPrefetch(root){
  if(typeof mediaTicket!=='function'||typeof SESSION==='undefined'||!SESSION)return;
  (root||document).querySelectorAll('.cbvoice[data-v]').forEach(b=>{const mid=b.dataset.v;if(cbTk(mid)||CB_TK[mid]&&CB_TK[mid].p)return;CB_TK[mid]={p:1};mediaTicket(mid).then(t=>{CB_TK[mid]=t?{t,exp:Date.now()+200e3}:null}).catch(()=>{CB_TK[mid]=null})});
}
function cbMark(){document.querySelectorAll('.cbvoice').forEach(b=>b.classList.toggle('on',CB_AU.on&&b.dataset.v===CB_AU.mid))}
function cbPlay(mid){
  if(CB_AU.a&&CB_AU.mid===mid&&!CB_AU.a.paused){CB_AU.a.pause();return}
  if(CB_AU.a){try{CB_AU.a.pause()}catch(e){}}
  const a=new Audio();a.preload='auto';CB_AU.a=a;CB_AU.mid=mid;CB_AU.on=false;
  a.onplay=()=>{if(CB_AU.a===a){CB_AU.on=true;cbMark()}};
  a.onpause=a.onended=()=>{if(CB_AU.a===a){CB_AU.on=false;cbMark()}};
  a.onerror=()=>{if(CB_AU.a===a){CB_AU.on=false;cbMark();T('语音暂时无法播放')}};
  const go=t=>{a.src=mediaFileUrl(mid,t,false);const p=a.play();if(p&&p.catch)p.catch(e=>{if(e&&e.name!=='AbortError')T('语音暂时无法播放')})};
  const t=cbTk(mid);
  if(t)return go(t);
  if(typeof mediaTicket!=='function')return;
  mediaTicket(mid).then(t2=>{if(!t2){T('语音暂时无法播放');return}CB_TK[mid]={t:t2,exp:Date.now()+200e3};if(CB_AU.a===a)go(t2)});
}
function cbViewImg(mid){
  const im=document.querySelector('img.cbimg[data-mid="'+mid+'"]');if(!im||!im.src)return;
  const o=document.createElement('div');o.className='cbview';o.innerHTML='<img alt="">';o.firstChild.src=im.src;
  o.addEventListener('click',()=>o.remove());document.body.appendChild(o);
}
function cbOpenFile(mid){
  if(typeof mediaTicket!=='function')return;
  mediaTicket(mid).then(t=>{if(!t){T('文件暂时无法打开');return}window.open(mediaFileUrl(mid,t,false),'_blank')});
}
Object.assign(A,{
  cbplus:v=>{S.cbp=S.cbp===v?null:v;if(S.cbp){const ta=document.activeElement;if(ta&&ta.blur)ta.blur()}},
  cbpick:v=>{const t=cbParse(v);S.cbp=null;cbPickFile(cbKey(v),t.rest[0]||'album')},
  cbstk:v=>{S.cbp=null;if(typeof stkp==='function')return stkp(v)},
  cbment:v=>{S.cbp=null;return A.ment(v)},
  cbgame:()=>{S.cbp=null;A.minigame()},
  media:v=>{const cur=S.st&&S.st[S.st.length-1];if(v)return cbPickFile(cbKey(v),'album');if(cur&&String(cur).startsWith('chat:'))return cbPickFile('cv|'+String(cur).slice(5),'album');T('请先打开一个会话')},
  voice:v=>{let target=v?cbKey(v):'';if(!target){const cur=S.st&&S.st[S.st.length-1];if(cur&&String(cur).startsWith('chat:'))target='cv|'+String(cur).slice(5)}if(!target&&!S.rec)return T('请先打开一个会话');cbVoice(target||S.rec.target)},
  voicecancel:()=>{const r=S.rec;if(!r)return;r.cancel=true;try{r.mr.stop()}catch(e){S.rec=null}},
  vplay:v=>{cbPlay(v)},
  cbimg:v=>{cbViewImg(v)},
  cbfile:v=>{cbOpenFile(v)},
});
/* 点输入框时收起功能面板（不整页重绘，免得键盘闪一下） */
document.addEventListener('focusin',e=>{
  const t=e.target;if(!t||!t.classList||!t.classList.contains('inta'))return;
  cbRememberNear();
  if(S.cbp){
    S.cbp=null;const row=t.closest('.inrow');if(row){row.classList.remove('cbopen');const p=row.nextElementSibling;if(p&&p.classList.contains('cbpanel'))p.remove();const b=row.querySelector('.cbplus');if(b){b.classList.remove('on');b.setAttribute('aria-expanded','false')}}
  }
  cbStickIfNear();
});
/* ---- 自动滚到底部 ---- */
let CB_TOUCH=0,CB_NEAR=false;
const CB_NEAR_PX=200;
['touchstart','wheel'].forEach(ev=>document.addEventListener(ev,e=>{if(e.target&&e.target.closest&&e.target.closest('.sc'))CB_TOUCH=Date.now()},{passive:true,capture:true}));
function cbNearOf(sc){return !!(sc&&sc.scrollHeight-sc.scrollTop-sc.clientHeight<CB_NEAR_PX)}
function cbChatSc(){
  const ta=document.querySelector('#v .inrow[data-k="chin"],#v .inrow[data-k="cmin"]');
  if(!ta)return null;
  const pg=ta.closest('.pg');if(!pg)return null;
  const sc=pg.querySelector(':scope > .sc');if(!sc)return null;
  const cur=S.st&&S.st[S.st.length-1];
  const near=cbNearOf(sc);
  return {sc,key:String(cur||'')+'|'+ta.dataset.k,n:sc.querySelectorAll('.mr,.cm').length,near,panel:!!pg.querySelector(':scope > .cbdock .cbpanel, :scope > .cbpanel')};
}
function cbRememberNear(){const c=cbChatSc();if(c)CB_NEAR=c.near;return !!(c&&c.near||CB_NEAR)}
function cbStick(sc){
  const t0=Date.now();
  /* 重绘会换掉整个列表，旧的滚动容器失效后改用当前页面上的那个 */
  const go=()=>{
    if(CB_TOUCH>t0)return;
    if(!sc||!sc.isConnected){const c=cbChatSc();if(!c)return;sc=c.sc}
    if(sc._virt&&typeof sc._virt.getTotalSize==='function'&&typeof sc._virt.scrollToOffset==='function'){
      try{sc._virt.scrollToOffset(sc._virt.getTotalSize(),{align:'start'})}catch(e){}
    }
    sc.scrollTop=sc.scrollHeight;
  };
  go();[16,60,200,450,900].forEach(ms=>setTimeout(go,ms));
  try{requestAnimationFrame(()=>{go();requestAnimationFrame(go)})}catch(e){}
  if(sc)sc.querySelectorAll('img,video').forEach(el=>{if(!(el.complete||el.readyState>0)){el.addEventListener('load',go,{once:true});el.addEventListener('loadedmetadata',go,{once:true})}});
}
function cbStickIfNear(){if(CB_NEAR||(S.forceBottom&&Date.now()-S.forceBottom<8000)){const c=cbChatSc();if(c)cbStick(c.sc)}}
function cbBindChrome(){
  if(cbBindChrome.done)return;
  cbBindChrome.done=1;
  const kick=()=>cbStickIfNear();
  try{
    const N=window.NovaNative;
    if(N&&N.Keyboard&&typeof N.Keyboard.addListener==='function'){
      const rememberThen=()=>{cbRememberNear();kick();[60,200,450].forEach(ms=>setTimeout(kick,ms))};
      N.Keyboard.addListener('keyboardWillShow',rememberThen).catch(()=>{});
      N.Keyboard.addListener('keyboardDidShow',kick).catch(()=>{});
      N.Keyboard.addListener('keyboardWillHide',rememberThen).catch(()=>{});
      N.Keyboard.addListener('keyboardDidHide',kick).catch(()=>{});
    }
  }catch(e){}
  if(window.visualViewport){
    visualViewport.addEventListener('resize',()=>{kick();[60,200,450].forEach(ms=>setTimeout(kick,ms))});
  }
  document.addEventListener('scroll',e=>{
    const sc=e.target;if(!sc||!sc.classList||!sc.classList.contains('sc'))return;
    if(sc.closest&&sc.closest('.pg')&&sc.closest('.pg').querySelector('.inrow[data-k="chin"],.inrow[data-k="cmin"]'))CB_NEAR=cbNearOf(sc);
  },true);
}
(function(){
  if(typeof render!=='function')return;
  const base=render;
  render=function(){
    let before=null;try{before=cbChatSc();if(before)CB_NEAR=before.near}catch(e){}
    /* S.cbp 在 render 之前已经改好了，不能靠 key 对比来判断面板有没有开关。
       若用户原本就在底部附近，先告诉 applyScroll 这次要滚到底，免得它按旧的 scrollTop 还原，把最新消息挡在面板后面。 */
    try{
      const willPanel=!!S.cbp;
      if(before&&before.near&&before.panel!==willPanel)S.bot=1;
    }catch(e){}
    const out=base.apply(this,arguments);
    try{cbBindChrome();cbPrefetch(document.getElementById('v'));if(CB_AU.mid)cbMark()}catch(e){}
    try{
      const after=cbChatSc();
      if(after){
        const same=before&&before.key===after.key;
        const panelToggled=same&&before.panel!==after.panel;
        /* 自己发的消息：这一轮重绘可能被推迟或消息还没回来，标记保留到消息出现在列表里（最多 8 秒） */
        const fb=S.forceBottom&&Date.now()-S.forceBottom<8000;
        if(fb||(same&&after.n>before.n&&before.near)||(panelToggled&&(before.near||CB_NEAR)))cbStick(after.sc);
        if(fb&&before&&after.n>before.n)S.forceBottom=0;
        CB_NEAR=after.near||(panelToggled&&(before.near||CB_NEAR));
      }
      if(S.forceBottom&&Date.now()-S.forceBottom>=8000)S.forceBottom=0;
    }catch(e){}
    return out;
  };
})();
/* 文字消息发出后也滚到底部 */
['send','cmsend'].forEach(n=>{const f=A[n];if(typeof f!=='function')return;A[n]=function(){S.forceBottom=Date.now();return f.apply(this,arguments)}});
/* 长消息列表是虚拟列表（32_libs.js 的 vhost），滚动或更新时会用缓存的 HTML 重建行，不经过 render()；
   新加回来的语音按钮要补上「正在播放」状态，并预取播放凭证 */
if(typeof MutationObserver!=='undefined'&&typeof document!=='undefined'){
  let cbMoQ=false;
  const cbMo=new MutationObserver(ms=>{
    if(cbMoQ)return;
    let hit=false;
    for(const m of ms){for(const n of m.addedNodes){if(n.nodeType===1&&(n.classList.contains('cbvoice')||n.querySelector('.cbvoice'))){hit=true;break}}if(hit)break}
    if(!hit)return;
    cbMoQ=true;
    Promise.resolve().then(()=>{cbMoQ=false;try{if(CB_AU.mid)cbMark();cbPrefetch(document.getElementById('v'))}catch(e){}});
  });
  const startMo=()=>{const v=document.getElementById('v');if(v)cbMo.observe(v,{childList:true,subtree:true})};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',startMo);else startMo();
}
