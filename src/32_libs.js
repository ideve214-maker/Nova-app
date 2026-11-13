/* DOMPurify 已在 esc()。这里接虚拟列表、看图、下拉刷新、本地缓存、错误上报、键盘和状态栏。 */
function secureTransportOn(){
  try{
    const v=window.NOVA_SECURE_TRANSPORT;
    return v===true||v===1||v==='1'||v==='true'||v==='on';
  }catch(e){return false}
}
function bugsinkOn(){
  try{
    const v=window.NOVA_BUGSINK;
    return v===true||v===1||v==='1'||v==='true'||v==='on';
  }catch(e){return false}
}

function bootBugsink(){
  if(bootBugsink.done)return;
  if(!bugsinkOn())return;
  const dsn=String(window.NOVA_BUGSINK_DSN||'').trim();
  if(!dsn||!window.NovaSentry||typeof NovaSentry.init!=='function')return;
  bootBugsink.done=1;
  try{NovaSentry.init({dsn, tracesSampleRate:0, sendDefaultPii:false, environment:'nova'})}catch(e){}
}

function novaDb(){
  if(novaDb._db)return novaDb._db;
  if(typeof Dexie==='undefined')return null;
  const db=new Dexie('nova_r5');
  db.version(1).stores({posts:'id', msgs:'id'});
  novaDb._db=db;
  return db;
}
async function cacheWriteFeed(list){
  const db=novaDb(); if(!db||!Array.isArray(list))return;
  try{await db.posts.clear(); await db.posts.bulkPut(list.map(p=>({id:String(p.id), json:JSON.stringify(p)})))}catch(e){}
}
async function cacheReadFeed(){
  const db=novaDb(); if(!db)return null;
  try{const rows=await db.posts.toArray(); if(!rows.length)return null; return rows.map(r=>JSON.parse(r.json))}catch(e){return null}
}
async function cacheWriteMsgs(id, list){
  const db=novaDb(); if(!db||!id||!Array.isArray(list))return;
  try{await db.msgs.put({id:String(id), json:JSON.stringify(list)})}catch(e){}
}
async function cacheReadMsgs(id){
  const db=novaDb(); if(!db||!id)return null;
  try{const row=await db.msgs.get(String(id)); return row?JSON.parse(row.json):null}catch(e){return null}
}

function bootKeyboard(){
  if(bootKeyboard.done)return;
  bootKeyboard.done=1;
  const setKb=n=>{document.documentElement.style.setProperty('--kb', Math.max(0, n||0)+'px')};
  const N=window.NovaNative;
  const native=!!(N&&N.Capacitor&&N.Capacitor.isNativePlatform&&N.Capacitor.isNativePlatform());
  if(native&&N.Keyboard){
    N.Keyboard.setResizeMode({mode:N.KeyboardResize.None}).catch(()=>{});
    N.Keyboard.setScroll({isDisabled:true}).catch(()=>{});
    N.Keyboard.addListener('keyboardWillShow', info=>setKb(info&&info.keyboardHeight)).catch(()=>{});
    N.Keyboard.addListener('keyboardDidShow', info=>setKb(info&&info.keyboardHeight)).catch(()=>{});
    N.Keyboard.addListener('keyboardWillHide', ()=>setKb(0)).catch(()=>{});
  }else if(window.visualViewport){
    const sync=()=>{
      const vv=window.visualViewport;
      const gap=Math.max(0, window.innerHeight-vv.height-vv.offsetTop);
      setKb(gap>80?gap:0);
    };
    visualViewport.addEventListener('resize', sync);
    visualViewport.addEventListener('scroll', sync);
  }
  if(native&&N.StatusBar){
    N.StatusBar.setOverlaysWebView({overlay:true}).catch(()=>{});
    const apply=()=>{
      const light=document.documentElement.dataset.theme==='light';
      N.StatusBar.setStyle({style: light?N.Style.Light:N.Style.Dark}).catch(()=>{});
    };
    apply();
    bootKeyboard.applyBar=apply;
  }
}

function openPhoto(src, w, h){
  if(!window.PhotoSwipe||!src)return;
  const pswp=new PhotoSwipe({
    dataSource:[{src, width:w||1600, height:h||1200}],
    bgOpacity:0.92,
    showHideAnimationType:'zoom',
  });
  pswp.init();
}

function bindPull(){
  if(typeof PullToRefresh==='undefined')return;
  try{if(PullToRefresh.destroyAll)PullToRefresh.destroyAll()}catch(e){}
  const sc=document.querySelector('#v .sc');
  if(!sc||sc.classList.contains('game-frame'))return;
  try{
    PullToRefresh.init({
      mainElement:'#v .sc',
      triggerElement:'#v .sc',
      distThreshold:64,
      distMax:90,
      distReload:50,
      instructionsPullToRefresh:'下拉刷新',
      instructionsReleaseToRefresh:'松开刷新',
      instructionsRefreshing:'刷新中',
      shouldPullToRefresh(){
        const el=document.querySelector('#v .sc');
        const kb=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--kb'))||0;
        return !!(el&&el.scrollTop<=0&&!document.querySelector('#v .pn')&&kb<40);
      },
      onRefresh(){
        const cur=S.st&&S.st[S.st.length-1];
        if(!cur&&S.tab==='home'&&typeof loadFeed==='function')return Promise.resolve(loadFeed()).then(()=>{if(typeof render==='function')render()});
        if(cur&&String(cur).startsWith('post:')&&typeof loadComments==='function')return Promise.resolve(loadComments(String(cur).slice(5))).then(()=>{if(typeof render==='function')render()});
        if(cur&&String(cur).startsWith('chat:')&&typeof loadMessages==='function')return Promise.resolve(loadMessages(String(cur).slice(5))).then(()=>{if(typeof render==='function')render()});
        if(!cur&&S.tab==='chat'&&typeof loadConversations==='function')return Promise.resolve(loadConversations()).then(()=>{if(typeof render==='function')render()});
      },
    });
  }catch(e){}
}

function virtualize(sc, nodes, estimate){
  const TV=window.TanVirtual;
  if(!TV||!sc||nodes.length<8)return;
  const html=nodes.map(n=>n.outerHTML);
  const host=document.createElement('div');
  host.className='vhost';
  nodes[0].parentNode.insertBefore(host, nodes[0]);
  nodes.forEach(n=>n.remove());
  const v=new TV.Virtualizer({
    count:html.length,
    getScrollElement:()=>sc,
    estimateSize:()=>estimate,
    overscan:4,
    scrollToFn:TV.elementScroll,
    observeElementRect:TV.observeElementRect,
    observeElementOffset:TV.observeElementOffset,
    onChange(){paint()},
  });
  function paint(){
    const items=v.getVirtualItems();
    host.style.height=v.getTotalSize()+'px';
    host.innerHTML=items.map(vi=>`<div data-index="${vi.index}" style="position:absolute;top:0;left:0;width:100%;transform:translateY(${vi.start}px)">${html[vi.index]}</div>`).join('');
    items.forEach(vi=>{
      const el=host.querySelector('[data-index="'+vi.index+'"]');
      if(el)try{v.measureElement(el)}catch(e){}
    });
  }
  try{v._didMount()}catch(e){}
  try{v._willUpdate()}catch(e){}
  paint();
  if(sc.classList.contains('msg'))sc.scrollTop=sc.scrollHeight;
}

function afterRender(){
  bootBugsink();
  bootKeyboard();
  if(bootKeyboard.applyBar)bootKeyboard.applyBar();
  const sc=document.querySelector('#v .sc');
  if(sc&&!sc.classList.contains('game-frame')){
    const cards=[...sc.querySelectorAll(':scope > .fcard')];
    if(cards.length>=8)virtualize(sc, cards, 280);
    const msgs=[...sc.querySelectorAll(':scope > .mr')];
    if(msgs.length>=8)virtualize(sc, msgs, 72);
    const box=sc.querySelector('#cbox');
    if(box){
      const rows=[...box.querySelectorAll(':scope > .cm, :scope > .cthread')];
      if(rows.length>=8)virtualize(sc, rows, 96);
    }
  }
  bindPull();
}

document.addEventListener('click', e=>{
  const img=e.target.closest&&e.target.closest('.fmedia img, img.zoomimg');
  if(!img||!img.src)return;
  e.preventDefault();
  e.stopPropagation();
  openPhoto(img.currentSrc||img.src, img.naturalWidth, img.naturalHeight);
}, true);

document.addEventListener('touchmove', e=>{
  const t=e.target;
  if(t.closest&&t.closest('.sc, .pn, .cropstage, .pswp, iframe, .game-frame'))return;
  if(e.cancelable)e.preventDefault();
}, {passive:false});
