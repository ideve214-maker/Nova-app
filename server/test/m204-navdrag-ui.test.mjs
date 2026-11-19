// 2.0.5 底部标签栏拖动回归（#24 之后手指拖不动）：真实服务器 + 无头 Chromium，用 CDP 派发真实触摸事件（iPhone 390×844）。
// 覆盖：按住胶囊左右拖跟手、松手吸附最近标签、始终只有一块玻璃胶囊、拖动途中整页重绘不中断、内容还在惯性滚动时松手同样吸附、
//       轻点标签照常切换、鼠标拖动照常可用。
// 截图：设置 NAVDRAG_SHOTS=<目录> 时把拖动中途和松手后的画面存下来。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {startServer, register, launch} from './ui-helpers.mjs';

const SHOTS = process.env.NAVDRAG_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, {recursive: true});
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const wait = ms => new Promise(r => setTimeout(r, ms));
let S, browser, ctx, page, cdp;

const shot = async name => { if (SHOTS) await page.screenshot({path: join(SHOTS, name + '.png')}); };
const state = () => page.evaluate(() => {
  const n = document.querySelector('#app .fnav'), p = n && n.querySelector(':scope > .tgpill');
  const pr = p && p.getBoundingClientRect();
  const btns = [...n.querySelectorAll(':scope > button[data-a=tab]')].map(b => { const r = b.getBoundingClientRect(); return {v: b.dataset.v, cx: r.left + r.width / 2, cy: r.top + r.height / 2, on: b.classList.contains('on')}; });
  return {tab: S.tab, pills: document.querySelectorAll('.tgpill').length, pillCx: pr ? pr.left + pr.width / 2 : null, drag: !!(TG.drag && TG.drag.moved), btns};
});
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {type, touchPoints: type === 'touchEnd' ? [] : [{x, y, id: 1}]});
// 手指从 x0 拖到 x1，每步回调一次（返回 false 停止记录）
async function swipe(x0, x1, y, {steps = 14, step = 22, during} = {}) {
  await touch('touchStart', x0, y); await wait(30);
  const frames = [];
  for (let k = 1; k <= steps; k++) {
    const x = x0 + (x1 - x0) * k / steps;
    await touch('touchMove', x, y); await wait(step);
    if (during) await during(k, x);
    if (k % 4 === 0 || k === steps) frames.push({k, x, ...(await state())});
  }
  return frames;
}
const release = async () => { await touch('touchEnd'); await wait(650); };
const assertFollows = (frames, label) => {
  for (const f of frames) {
    assert.ok(f.drag, `${label}：第 ${f.k} 步手指还按着，拖动不应结束`);
    assert.ok(Math.abs(f.pillCx - f.x) < 30 || f.x < 40 || f.x > 350, `${label}：第 ${f.k} 步胶囊应跟手（手指 ${Math.round(f.x)}，胶囊 ${Math.round(f.pillCx)}）`);
    assert.equal(f.pills, 1, `${label}：拖动中只能有一块玻璃胶囊`);
  }
};
const assertSnapped = (st, v, label) => {
  const b = st.btns.find(x => x.v === v);
  assert.equal(st.tab, v, `${label}：松手后应切到 ${v}`);
  assert.ok(Math.abs(st.pillCx - b.cx) <= 2, `${label}：胶囊应居中吸附在 ${v}（胶囊 ${st.pillCx.toFixed(1)}，标签 ${b.cx.toFixed(1)}）`);
  assert.equal(st.pills, 1, `${label}：只能有一块玻璃胶囊`);
  assert.equal(st.btns.filter(x => x.on).length, 1, `${label}：只能有一个高亮标签`);
};

test.before(async () => {
  S = await startServer(); browser = await launch();
  ctx = await browser.newContext({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: UA});
  page = await ctx.newPage(); page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e)));
  await page.goto(S.base + '/'); await page.waitForSelector('#gate');
  await register(page, 'navdrag_1', 'navdrag_1@qq.com');
  await page.waitForFunction(() => { const b = document.querySelector('#app .fnav > button[data-a=tab]'); if (!b) return false; const r = b.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return e && e.closest('.fnav'); }, null, {timeout: 20000});
  await wait(500);
  cdp = await ctx.newCDPSession(page);
});
test.after(async () => { await browser?.close(); await S?.close(); });

test('触摸拖动：胶囊跟手，松手吸附到最近的标签并切换', async () => {
  let st = await state(); await shot('01-start');
  const a = st.btns[0], b = st.btns[3];
  const frames = await swipe(a.cx, b.cx, a.cy, {during: async k => { if (k === 7) await shot('02-drag-mid'); }});
  assertFollows(frames, '向右拖');
  await shot('03-drag-end-finger-down');
  await release(); st = await state(); await shot('04-after-release');
  assertSnapped(st, b.v, '向右拖');
});

test('触摸拖动：向左拖，停在两个标签交界附近松手，吸附到离手指最近的那个', async () => {
  let st = await state();
  const from = st.btns.find(x => x.on), to = st.btns[1], next = st.btns[2];
  const stopX = to.cx + (next.cx - to.cx) * 0.35;           // 偏向 to 一侧
  const frames = await swipe(from.cx, stopX, from.cy);
  assertFollows(frames, '向左拖');
  await release(); st = await state(); await shot('05-left-release-between');
  assertSnapped(st, to.v, '交界附近松手');
});

test('拖动途中整页重绘：手势不中断，仍然跟手并吸附', async () => {
  let st = await state();
  const a = st.btns.find(x => x.on), b = st.btns[st.btns.length - 1];
  const frames = await swipe(a.cx, b.cx, a.cy, {during: async k => { if (k === 3 || k === 9) await page.evaluate(() => render(true)); }});
  assertFollows(frames, '重绘中拖');
  await release(); st = await state();
  assertSnapped(st, b.v, '重绘中拖');
});

test('内容还在惯性滚动时拖动并松手：行为相同', async () => {
  await page.evaluate(() => A.tab('home')).then(() => page.evaluate(() => render(true))); await wait(600);
  // 在内容区快速上滑制造惯性滚动
  await page.evaluate(() => { const sc = document.querySelector('#v .sc'); if (sc) { const pad = document.createElement('div'); pad.style.height = '4000px'; pad.id = 'navdrag-pad'; sc.appendChild(pad); } });
  await touch('touchStart', 200, 600); for (let i = 1; i <= 6; i++) { await touch('touchMove', 200, 600 - i * 70); await wait(8); } await touch('touchEnd');
  const busy = await page.evaluate(() => typeof scrollBusy === 'function' ? !!scrollBusy() : null);
  let st = await state();
  const a = st.btns.find(x => x.on), b = st.btns[2];
  const frames = await swipe(a.cx, b.cx, a.cy, {steps: 8, step: 16});
  assertFollows(frames, '滚动中拖');
  await touch('touchEnd'); await wait(120);
  st = await state(); await shot('06-release-while-scrolling');
  assertSnapped(st, b.v, `滚动中松手（松手时内容滚动中=${busy}）`);
  await wait(900); st = await state();
  assertSnapped(st, b.v, '滚动停下后');
});

test('轻点标签照常切换（不是拖动）', async () => {
  let st = await state();
  const t = st.btns[0];
  await touch('touchStart', t.cx, t.cy); await wait(40); await touch('touchEnd'); await wait(650);
  st = await state();
  assertSnapped(st, t.v, '轻点');
});

test('鼠标拖动照常可用', async () => {
  let st = await state();
  const a = st.btns.find(x => x.on), b = st.btns[3];
  await page.mouse.move(a.cx, a.cy); await page.mouse.down();
  for (let k = 1; k <= 10; k++) { await page.mouse.move(a.cx + (b.cx - a.cx) * k / 10, a.cy); await wait(16); }
  const mid = await state(); assert.ok(mid.drag && Math.abs(mid.pillCx - b.cx) < 30, '鼠标拖动胶囊跟手');
  await page.mouse.up(); await wait(650);
  assertSnapped(await state(), b.v, '鼠标拖动');
  assert.deepEqual(page.errors, [], '页面无报错');
});
