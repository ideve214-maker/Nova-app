// 极简测试框架：真启动无头 Chromium，真点击 dist/nova_v5.html
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../dist/nova_v5.html');
let browser, passed = 0, failed = [], current = '';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
async function start() { browser = await chromium.launch(); }
async function stop() { await browser.close(); }
async function open(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: !!opts.touch, isMobile: !!opts.touch, userAgent: opts.ua, reducedMotion: opts.reduced ? 'reduce' : 'no-preference', acceptDownloads: true });
  const page = await ctx.newPage();
  page.errors = []; page.reqs = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') page.errors.push(m.text()); });
  page.on('request', r => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) page.reqs.push(r.url()); });
  await page.addInitScript(opts.init || (() => {
    window.__vib = []; Navigator.prototype.vibrate = function (p) { window.__vib.push(p); return true; };
  }));
  if (opts.initExtra) await page.addInitScript(opts.initExtra);
  await page.goto(URL);
  await page.waitForFunction(() => document.querySelector('nav'));
  page.ctx = ctx;
  return page;
}
const wait = ms => new Promise(r => setTimeout(r, ms));
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); } else { failed.push(current + ' :: ' + msg); console.log('  ✗ ' + msg); }
}
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + (JSON.stringify(a) === JSON.stringify(b) ? '' : `（实际 ${JSON.stringify(a)}，期望 ${JSON.stringify(b)}）`)); }
async function group(name, fn) {
  current = name; console.log('\n■ ' + name);
  try { await fn(); } catch (e) { failed.push(name + ' :: 异常 ' + e.message); console.log('  ✗ 异常 ' + e.message); }
}
function summary() { console.log(`\n通过 ${passed} 项，失败 ${failed.length} 项`); failed.forEach(f => console.log(' - ' + f)); return failed.length; }
// 直接用 CDP 派发触摸事件，模拟手指拖动
async function drag(page, pts, step = 16) {
  const c = await page.ctx.newCDPSession(page);
  const send = (type, p) => c.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p[0], y: p[1] }] : [] });
  await send('touchStart', pts[0]);
  for (let i = 1; i < pts.length; i++) { await send('touchMove', pts[i]); await wait(step); }
  return { end: () => send('touchEnd'), c };
}
module.exports = { start, stop, open, wait, ok, eq, group, summary, drag, IPHONE_UA };
