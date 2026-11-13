import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';

const afterRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const beforeRoot = process.env.BEFORE_ROOT || '/tmp/nova-r5-dist/dist';
let root = afterRoot;
const out = '/workspace/nova-shots/r6';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const PREVIEW = 'https://47.239.0.90/preview-07d59f5af6cb9a1c/user/';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

const sizes = [
  {id:'375x667', w:375, h:667, dpr:2, ua:IPHONE, label:'iphone'},
  {id:'390x844', w:390, h:844, dpr:3, ua:IPHONE, label:'iphone'},
  {id:'430x932', w:430, h:932, dpr:3, ua:IPHONE, label:'iphone'},
  {id:'360x800', w:360, h:800, dpr:3, ua:ANDROID, label:'android'},
];

function mime(p){
  const e=path.extname(p).toLowerCase();
  return ({'.html':'text/html;charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.woff2':'font/woff2','.gif':'image/gif','.ico':'image/x-icon'})[e]||'application/octet-stream';
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
async function boot(page){
  await page.waitForFunction(()=>document.querySelector('nav')||document.querySelector('#gate')||document.querySelector('#offline'),{timeout:12000});
  await page.waitForTimeout(200);
}
async function layoutInfo(page){
  return page.evaluate(()=>{
    const app=document.querySelector('#app')||document.body;
    const sc=document.querySelector('#v .sc');
    const vp=document.querySelector('meta[name=viewport]');
    const cs=app?getComputedStyle(app):{};
    return {
      inner: [window.innerWidth, window.innerHeight],
      app: app?[Math.round(app.getBoundingClientRect().width), Math.round(app.getBoundingClientRect().height)]:[],
      maxWidth: cs.maxWidth, width: cs.width, height: cs.height,
      viewport: vp?vp.getAttribute('content'):'',
      scW: sc?sc.clientWidth:0, scH: sc?sc.clientHeight:0,
      htmlOverflow: getComputedStyle(document.documentElement).overflow,
    };
  });
}
async function shotPages(page, prefix, sizeId){
  const go = async (name, fn)=>{
    if(fn) await fn();
    await page.waitForTimeout(180);
    const file=path.join(out, `${prefix}-${sizeId}-${name}.png`);
    await page.screenshot({path:file, fullPage:false});
    const info=await layoutInfo(page);
    const fill = info.app[0]===info.inner[0] && Math.abs(info.app[1]-info.inner[1])<=2;
    console.log(`  ${prefix} ${sizeId} ${name} app=${info.app} viewport=${info.inner} maxW=${info.maxWidth} fill=${fill}`);
    return {name, file, info, fill};
  };
  const rows=[];
  rows.push(await go('home', null));
  rows.push(await go('community', async()=>{await page.locator('nav [data-a=tab][data-v=cm]').click(); await page.waitForTimeout(200)}));
  rows.push(await go('games', async()=>{
    const b=page.locator('[data-a=minigame]');
    if(await b.count()){await b.click(); await page.waitForTimeout(250)}
  }));
  // back to tabs
  const back=page.locator('[data-a=back]').first();
  if(await back.count()){await back.click(); await page.waitForTimeout(150)}
  rows.push(await go('chat', async()=>{await page.locator('nav [data-a=tab][data-v=chat]').click(); await page.waitForTimeout(200)}));
  rows.push(await go('profile', async()=>{await page.locator('nav [data-a=tab][data-v=me]').click(); await page.waitForTimeout(200)}));
  rows.push(await go('settings', async()=>{
    const b=page.locator('[data-a=go][data-v=set]').first();
    if(await b.count()){await b.click(); await page.waitForTimeout(250)}
  }));
  return rows;
}

async function main(){
  fs.mkdirSync(out,{recursive:true});
  const browser=await chromium.launch({executablePath:CHROME, args:['--no-sandbox','--disable-dev-shm-usage']});
  const notes=[];

  // Live preview metadata (login wall; layout baseline is local r5 below)
  console.log('\n■ live preview probe');
  {
    const sz=sizes.find(s=>s.id==='390x844');
    const ctx=await browser.newContext({
      viewport:{width:sz.w,height:sz.h}, deviceScaleFactor:sz.dpr,
      isMobile:true, hasTouch:true, userAgent:sz.ua, locale:'zh-CN',
      reducedMotion:'reduce', ignoreHTTPSErrors:true,
    });
    const page=await ctx.newPage();
    try{
      const resp=await page.goto(PREVIEW,{waitUntil:'domcontentloaded', timeout:20000});
      const headers=resp?await resp.allHeaders():{};
      const vp=await page.locator('meta[name=viewport]').getAttribute('content');
      const maxW=await page.evaluate(()=>getComputedStyle(document.querySelector('#app')||document.body).maxWidth);
      notes.push({lastModified:headers['last-modified']||'', contentLength:headers['content-length']||'', viewport:vp, maxWidth:maxW, status:resp&&resp.status(), url:PREVIEW});
      console.log('  preview meta', notes[0]);
      await boot(page);
      await page.screenshot({path:path.join(out,'before-live-preview-390x844-login.png'), fullPage:false});
    }catch(e){ console.log('  preview probe failed', e.message) }
    await ctx.close();
  }

  // Local r5 (before) then r6 (after)
  root = beforeRoot;
  const srvBefore=await startServer();
  const urlBefore=`http://127.0.0.1:${srvBefore.address().port}/nova_v5.html`;
  console.log('\n■ local r5 (before)', urlBefore);
  for(const sz of sizes){
    const ctx=await browser.newContext({
      viewport:{width:sz.w,height:sz.h}, deviceScaleFactor:sz.dpr,
      isMobile:true, hasTouch:true, userAgent:sz.ua, locale:'zh-CN',
      reducedMotion:'reduce',
    });
    const page=await ctx.newPage();
    await page.goto(urlBefore,{waitUntil:'domcontentloaded'});
    await boot(page);
    await shotPages(page, 'before', sz.id);
    await ctx.close();
  }
  srvBefore.close();

  root = afterRoot;
  const srv=await startServer();
  const url=`http://127.0.0.1:${srv.address().port}/nova_v5.html`;
  console.log('\n■ local r6 (after)', url);
  for(const sz of sizes){
    const ctx=await browser.newContext({
      viewport:{width:sz.w,height:sz.h}, deviceScaleFactor:sz.dpr,
      isMobile:true, hasTouch:true, userAgent:sz.ua, locale:'zh-CN',
      reducedMotion:'reduce',
    });
    const page=await ctx.newPage();
    await page.goto(url,{waitUntil:'domcontentloaded'});
    await boot(page);
    await shotPages(page, 'after', sz.id);
    await ctx.close();
  }
  srv.close();
  await browser.close();
  fs.writeFileSync(path.join(out,'preview-meta.json'), JSON.stringify(notes,null,2));
  console.log('\nshots in', out);
}
main().catch(e=>{console.error(e);process.exit(2)});
