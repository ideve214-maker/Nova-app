import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const shots = '/tmp/nova-r6-shots';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const TOL = 8;
const results = [];

function mime(p){
  const e=path.extname(p).toLowerCase();
  return ({'.html':'text/html;charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.woff':'font/woff','.woff2':'font/woff2','.gif':'image/gif','.ico':'image/x-icon','.mp3':'audio/mpeg','.wav':'audio/wav'})[e]||'application/octet-stream';
}
function startServer(){
  return new Promise((resolve,reject)=>{
    const srv=http.createServer((req,res)=>{
      const u=decodeURIComponent((req.url||'/').split('?')[0]);
      let p=path.normalize(path.join(root, u==='/'?'/nova_v5.html':u));
      if(!p.startsWith(root)){res.writeHead(403);res.end();return}
      fs.readFile(p,(err,data)=>{
        if(err){res.writeHead(err.code==='ENOENT'?404:500);res.end();return}
        res.writeHead(200,{'content-type':mime(p),'cache-control':'no-store'});
        res.end(data);
      });
    });
    srv.listen(0,'127.0.0.1',()=>resolve(srv));
    srv.on('error',reject);
  });
}

function rec(name, ok, detail=''){
  results.push({name,ok,detail});
  console.log((ok?'  ✓ ':'  ✗ ')+name+(detail?' — '+detail:''));
}

async function boot(page){
  await page.waitForFunction(()=>document.querySelector('nav'),{timeout:8000});
  await page.waitForTimeout(80);
}

async function y(page){
  return page.evaluate(()=>{const sc=document.querySelector('#v .sc');return sc?Math.round(sc.scrollTop):0});
}
async function maxY(page){
  return page.evaluate(()=>{const sc=document.querySelector('#v .sc');if(!sc)return 0;return Math.max(0,sc.scrollHeight-sc.clientHeight)});
}
async function setY(page, n){
  await page.evaluate(v=>{
    const sc=document.querySelector('#v .sc');
    if(!sc)return;
    if(sc._virt&&typeof sc._virt.scrollToOffset==='function'){
      try{sc._virt.scrollToOffset(v,{align:'start'})}catch(e){}
    }
    sc.scrollTop=v;
  }, n);
  await page.waitForTimeout(200);
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  await page.waitForTimeout(120);
  return y(page);
}
async function settle(page, ms=200){
  await page.waitForTimeout(ms);
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
}
async function click(page, sel){
  const loc=page.locator(sel).first();
  await loc.waitFor({state:'visible',timeout:4000});
  await loc.click();
  await settle(page);
}
async function clickInView(page, sel){
  const ok=await page.evaluate(s=>{
    const sc=document.querySelector('#v .sc');
    const nodes=[...document.querySelectorAll(s)];
    const cr=sc?sc.getBoundingClientRect():{top:0,bottom:innerHeight,left:0,right:innerWidth};
    const visible=nodes.filter(n=>{
      const r=n.getBoundingClientRect();
      return r.bottom>cr.top+24 && r.top<cr.bottom-24 && r.right>cr.left+8 && r.left<cr.right-8;
    });
    const el=visible[Math.floor(visible.length/2)]||visible[0];
    if(!el)return false;
    el.click();
    return true;
  }, sel);
  if(!ok){
    const loc=page.locator(sel).first();
    await loc.waitFor({state:'visible',timeout:4000});
    await loc.click({force:true});
  }
  await settle(page,240);
}
async function back(page){
  await click(page, '.top [data-a=back], [data-a=back]');
}
async function tab(page, id){
  await click(page, `nav [data-a=tab][data-v="${id}"]`);
}
async function ensureScroll(page, min=120){
  return maxY(page);
}
function close(a,b,tol=TOL){return Math.abs(a-b)<=tol}

async function caseRestore(page, name, {prep, enter, leave}={}){
  if(prep)await prep();
  const room=await ensureScroll(page, 160);
  if(room<80){rec(name,false,'page not scrollable even after pad (max='+room+')');return}
  const target=Math.min(room, Math.max(120, Math.round(room*0.7)));
  const saved=await setY(page, target);
  if(saved<40){rec(name,false,'could not scroll (got '+saved+', max='+room+')');return}
  await enter();
  await leave();
  await settle(page,320);
  const after=await y(page);
  rec(name, close(after,saved), `saved=${saved} after=${after} max=${room}`);
}

async function sbInfo(page, sel, frame=null){
  const ctx=frame||page;
  return ctx.evaluate(s=>{
    const el=typeof s==='string'?document.querySelector(s):s;
    if(!el)return null;
    const cs=getComputedStyle(el);
    return {
      sel:s,
      clientWidth:el.clientWidth, offsetWidth:el.offsetWidth,
      clientHeight:el.clientHeight, offsetHeight:el.offsetHeight,
      scrollHeight:el.scrollHeight, scrollWidth:el.scrollWidth,
      scrollbarWidth:cs.scrollbarWidth, overflowY:cs.overflowY, overflowX:cs.overflowX
    };
  }, sel);
}

async function main(){
  fs.mkdirSync(shots,{recursive:true});
  const srv=await startServer();
  const port=srv.address().port;
  const url=`http://127.0.0.1:${port}/nova_v5.html`;
  const browser=await chromium.launch({executablePath:CHROME, args:['--no-sandbox','--disable-dev-shm-usage']});
  const ctx=await browser.newContext({viewport:{width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:2, reducedMotion:'reduce', locale:'zh-CN'});
  const page=await ctx.newPage();
  page.on('pageerror', e=>console.log('  [pageerror]', e.message));
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await boot(page);
  // pad demo feed so virtualizer kicks in (>=8 already, make it taller)
  await page.evaluate(()=>{
    if(typeof D==='undefined'||!D.p)return;
    for(let i=0;i<16;i++)D.p.push({id:'r6p'+i,a:'me',t:'刚刚',x:'用于测试滚动位置的填充动态 '+(i+1)+'。多写几句让卡片更高一些。',r:[0,0,0,0,0,0],m:-1});
    if(typeof render==='function')render();
  });
  await settle(page,120);

  console.log('\n■ 滚动位置恢复');

  await caseRestore(page, '设置：滑到底部 → 打开隐私 → 返回', {
    prep: async()=>{await tab(page,'me'); await click(page,'[data-a=go][data-v=set], .top [data-a=go][data-v=set]');},
    enter: async()=>{await click(page,'#privrow, [data-a=priv]');},
    leave: async()=>{await back(page);}
  });

  await caseRestore(page, '设置：滑到底部 → 打开账号安全 → 返回', {
    prep: async()=>{ /* already on set */ },
    enter: async()=>{await click(page,'#secrow, [data-a=sec]');},
    leave: async()=>{await back(page);}
  });

  // leave settings back to me
  await back(page);

  await caseRestore(page, '我的：滚动后打开设置再返回', {
    prep: async()=>{await tab(page,'me');},
    enter: async()=>{await click(page,'[data-a=go][data-v=set]');},
    leave: async()=>{await back(page);}
  });

  await caseRestore(page, '动态：滚动后打开帖子再返回（虚拟列表）', {
    prep: async()=>{await tab(page,'home');},
    enter: async()=>{
      // click a mid-list post comment button if visible, else first
      await clickInView(page,'.sc .fcard [data-a=post], .sc [data-a=post][data-v]');
    },
    leave: async()=>{await back(page);}
  });

  await caseRestore(page, '社区列表：滚动后打开小组再返回', {
    prep: async()=>{await tab(page,'cm');},
    enter: async()=>{await clickInView(page,'.gcard [data-a=cm], [data-a=cm][data-v]');},
    leave: async()=>{await back(page);}
  });

  await caseRestore(page, '聊天列表：滚动后打开会话再返回', {
    prep: async()=>{
      await tab(page,'chat');
      await page.evaluate(()=>{
        if(!D.cv)return;
        for(let i=0;i<12;i++){
          const id='r6cv'+i;
          if(!D.cv.some(c=>c.id===id))D.cv.push({id,g:0,n:'测试会话 '+(i+1),mem:['zhou'],u:0});
        }
        if(typeof render==='function')render();
      });
      await settle(page);
    },
    enter: async()=>{await clickInView(page,'.sc [data-a=conv]');},
    leave: async()=>{await back(page);}
  });

  await caseRestore(page, '小游戏宫格：滚动后进入游戏再返回', {
    prep: async()=>{await tab(page,'cm'); await click(page,'[data-a=minigame]');},
    enter: async()=>{await clickInView(page,'[data-a=game]');},
    leave: async()=>{await back(page);}
  });
  await back(page); // leave games to cm

  // Tab positions
  await tab(page,'home');
  const homeMax=await ensureScroll(page,160);
  const homeY=await setY(page, Math.min(homeMax, 200));
  await tab(page,'me');
  const meMax=await ensureScroll(page,160);
  const meY=await setY(page, Math.min(meMax, 180));
  await tab(page,'home');
  await settle(page,240);
  rec('Tab：首页滚动后切到「我的」再回来', close(await y(page), homeY), `home saved=${homeY} after=${await y(page)}`);
  await tab(page,'me');
  await settle(page,240);
  rec('Tab：「我的」滚动后切走再回来', close(await y(page), meY), `me saved=${meY} after=${await y(page)}`);

  // Feed segments
  await tab(page,'home');
  await click(page,'.seg [data-a=feed][data-v=rec], [data-a=feed][data-v=rec]');
  const recMax=await ensureScroll(page,160);
  const recY=await setY(page, Math.min(recMax, 220));
  await click(page,'[data-a=feed][data-v=follow]');
  await settle(page,200);
  await ensureScroll(page,160);
  const folY=await setY(page, 80);
  await click(page,'[data-a=feed][data-v=rec]');
  await settle(page,240);
  rec('分段：推荐滚动后切到关注再回来', close(await y(page), recY), `rec saved=${recY} after=${await y(page)}`);
  await click(page,'[data-a=feed][data-v=follow]');
  await settle(page,240);
  rec('分段：关注滚动后切走再回来', close(await y(page), folY), `follow saved=${folY} after=${await y(page)}`);

  // Pull to refresh goes to top
  await tab(page,'home');
  await click(page,'[data-a=feed][data-v=rec]');
  await ensureScroll(page,160);
  await setY(page, 200);
  await page.evaluate(()=>{S.ptr=1; if(typeof render==='function')render()});
  await settle(page,240);
  rec('下拉刷新后回到顶部', (await y(page))<=TOL, 'after='+await y(page));

  // Fresh open starts at top
  await tab(page,'me');
  await click(page,'[data-a=go][data-v=set]');
  await ensureScroll(page,160);
  const setY1=await setY(page, await maxY(page));
  await back(page);
  await click(page,'[data-a=go][data-v=set]');
  await settle(page,240);
  rec('再次打开设置从顶部开始（非返回）', (await y(page))<=TOL, `prev=${setY1} fresh=${await y(page)}`);
  await back(page);

  // Community segments
  await tab(page,'cm');
  await click(page,'[data-a=cmseg][data-v=d]');
  await ensureScroll(page,160);
  const cmY=await setY(page, 100);
  await click(page,'[data-a=cmseg][data-v=j]');
  await settle(page,200);
  await click(page,'[data-a=cmseg][data-v=d]');
  await settle(page,240);
  rec('社区分段：发现滚动后切到已加入再回来', close(await y(page), cmY), `saved=${cmY} after=${await y(page)}`);

  console.log('\n■ 滚动条');
  await tab(page,'home');
  await ensureScroll(page,200);
  await setY(page, 180);
  await page.screenshot({path:shots+'/home-scrolled.png', fullPage:false});
  await tab(page,'me');
  await click(page,'[data-a=go][data-v=set]');
  await ensureScroll(page,200);
  await setY(page, await maxY(page));
  await page.screenshot({path:shots+'/settings-scrolled.png', fullPage:false});

  for(const sel of ['html','body','#app','#v .sc']){
    const info=await sbInfo(page, sel);
    if(!info){rec('滚动条：'+sel,false,'missing');continue}
    const noGutter=info.clientWidth===info.offsetWidth;
    const hidden=info.scrollbarWidth==='none' || info.scrollbarWidth===0 || info.scrollbarWidth==='0px';
    rec(`滚动条隐藏 ${sel}`, noGutter && (hidden || sel!=='#v .sc' || noGutter),
      `clientW=${info.clientWidth} offsetW=${info.offsetWidth} scrollbar-width=${info.scrollbarWidth} overflowY=${info.overflowY}`);
  }
  // scrolling still works
  const before=await y(page);
  await setY(page, Math.max(0, before-40));
  const mid=await y(page);
  rec('隐藏滚动条后仍可滚动', mid!==before || (await maxY(page))===0, `before=${before} mid=${mid}`);

  // sheet
  await page.evaluate(()=>{if(typeof A!=='undefined'&&A.panel){A.panel();render()}});
  await settle(page,200);
  const pn=await sbInfo(page,'.pn');
  if(pn){
    rec('滚动条隐藏 .pn 弹层', pn.clientWidth===pn.offsetWidth, `clientW=${pn.clientWidth} offsetW=${pn.offsetWidth} sw=${pn.scrollbarWidth}`);
  }else rec('滚动条隐藏 .pn 弹层', false, 'sheet not open');
  await page.evaluate(()=>{S.sh=null;if(typeof render==='function')render()});
  await settle(page);

  // games wrapper + iframe
  await back(page).catch(()=>{});
  await tab(page,'cm');
  await click(page,'[data-a=minigame]');
  await click(page,'[data-a=game][data-v="2048"], [data-a=game]');
  await settle(page,400);
  const gf=await sbInfo(page,'.game-frame, .sc.game-frame');
  if(gf) rec('滚动条隐藏 .game-frame', gf.clientWidth===gf.offsetWidth, `clientW=${gf.clientWidth} offsetW=${gf.offsetWidth} sw=${gf.scrollbarWidth}`);
  else rec('滚动条隐藏 .game-frame', false, 'missing');
  const frame=page.frameLocator('iframe[data-game], .game-frame iframe').first();
  try{
    const bodySw=await frame.locator('body').evaluate(el=>{
      const cs=getComputedStyle(el);
      const html=document.documentElement;
      const hs=getComputedStyle(html);
      return {body:cs.scrollbarWidth, html:hs.scrollbarWidth, clientW:el.clientWidth, offsetW:el.offsetWidth, hClient:html.clientWidth, hOffset:html.offsetWidth};
    });
    rec('滚动条隐藏 游戏 iframe 文档', (bodySw.body==='none'||bodySw.html==='none') && bodySw.hClient===bodySw.hOffset,
      JSON.stringify(bodySw));
  }catch(e){
    rec('滚动条隐藏 游戏 iframe 文档', false, String(e.message||e));
  }
  await page.screenshot({path:shots+'/game-2048.png', fullPage:false});

  await browser.close();
  srv.close();
  const fail=results.filter(r=>!r.ok);
  console.log(`\n通过 ${results.filter(r=>r.ok).length} 项，失败 ${fail.length} 项`);
  fail.forEach(f=>console.log(' - '+f.name+' :: '+f.detail));
  process.exit(fail.length?1:0);
}

main().catch(e=>{console.error(e);process.exit(2)});
