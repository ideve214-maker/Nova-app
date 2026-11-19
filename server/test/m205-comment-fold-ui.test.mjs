// 评论折叠（#7 移植到 feat/v2-user）：真实服务器 + 无头 Chromium，触摸点击（iPhone 390×844）。
// 一级评论下的回复（含楼中楼，平铺）超过 3 条时默认只显示前 3 条 +「展开 N 条回复」；点开显示全部、按钮变「收起回复」；
// 3 条及以下没有按钮；展开状态在重新渲染后保持；回复楼中楼后自动展开所在的一级评论。
// 截图：设置 COMMENTS_SHOTS=<目录> 时保存。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {startServer, register, launch} from './ui-helpers.mjs';

const SHOTS = process.env.COMMENTS_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, {recursive: true});
const wait = ms => new Promise(r => setTimeout(r, ms));
let S, browser, page, pid, rootA, rootB, deep;
const shot = async n => { if (SHOTS) await page.screenshot({path: join(SHOTS, n + '.png')}); };
const api = (m, u, b) => page.evaluate(async ([m, u, b]) => { const r = await api(m, u, b); return {s: r.s, j: r.j}; }, [m, u, b]);
const addC = async (text, parentId) => { const r = await api('POST', `/api/posts/${pid}/comments`, {text, parentId}); assert.equal(r.s, 200, '发评论 ' + text + ' ' + JSON.stringify(r.j)); return (r.j.comment || r.j.c || r.j).id; };
const thread = id => page.evaluate(id => {
  const row = document.querySelector(`#cbox .cm[data-cid="${id}"]`); const th = row && row.closest('.cthread');
  const btn = th && th.querySelector(':scope > .crep');
  return {rows: th ? th.querySelectorAll(':scope > .cm').length : (row ? 1 : 0), btn: btn ? btn.innerText.trim() : null, open: btn ? btn.dataset.open : null};
}, String(id));

test.before(async () => {
  S = await startServer(); browser = await launch();
  const ctx = await browser.newContext({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true, deviceScaleFactor: 2});
  page = await ctx.newPage(); page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e)));
  await page.goto(S.base + '/'); await page.waitForSelector('#gate');
  await register(page, 'fold_1', 'fold_1@qq.com');
  await wait(1500);
  await page.tap('#v [data-a=compose]'); await page.waitForSelector('[data-d=pin]');
  await page.fill('[data-d=pin]', '评论折叠测试帖'); await page.click('[data-a=pub]');
  await page.waitForFunction(() => !document.querySelector('[data-d=pin]') && document.body.innerText.includes('评论折叠测试帖'));
  pid = await page.getAttribute('#v [data-a=post]', 'data-v');
  rootA = await addC('一级评论 A');
  let last = rootA;
  for (let i = 1; i <= 5; i++) last = await addC('A 的回复 ' + i, i === 4 ? last : rootA);   // 第 5 条是楼中楼（回复第 4 条）
  deep = last;
  rootB = await addC('一级评论 B');
  for (let i = 1; i <= 3; i++) await addC('B 的回复 ' + i, rootB);
  await page.tap(`#v [data-a=post][data-v="${pid}"]`);
  await page.waitForFunction(() => document.querySelector('#cbox') && document.body.innerText.includes('一级评论 B'));
  await wait(400);
});
test.after(async () => { await browser?.close(); await S?.close(); });

test('超过 3 条回复默认收起：只显示前 3 条和「展开 2 条回复」', async () => {
  const t = await thread(rootA); await shot('01-fold-collapsed');
  assert.equal(t.rows, 1 + 3, '一级评论 + 前 3 条回复');
  assert.equal(t.btn, '展开 2 条回复'); assert.equal(t.open, '0');
  const txt = await page.innerText('#cbox');
  assert.ok(txt.includes('A 的回复 3') && !txt.includes('A 的回复 4') && !txt.includes('A 的回复 5'));
});

test('3 条及以下不显示按钮，全部显示', async () => {
  const t = await thread(rootB);
  assert.equal(t.rows, 1 + 3); assert.equal(t.btn, null);
});

test('点「展开」显示全部（含楼中楼），按钮变「收起回复」；再点收起', async () => {
  await page.tap(`#cbox .cm[data-cid="${rootA}"] ~ .crep`); await wait(400);
  let t = await thread(rootA); await shot('02-fold-expanded');
  assert.equal(t.rows, 1 + 5); assert.equal(t.btn, '收起回复'); assert.equal(t.open, '1');
  assert.ok((await page.innerText('#cbox')).includes('A 的回复 5'));
  await page.tap(`#cbox .cm[data-cid="${rootA}"] ~ .crep`); await wait(400);
  t = await thread(rootA); await shot('03-fold-collapsed-again');
  assert.equal(t.rows, 1 + 3); assert.equal(t.btn, '展开 2 条回复');
});

test('展开状态在重新渲染后保持', async () => {
  await page.tap(`#cbox .cm[data-cid="${rootA}"] ~ .crep`); await wait(300);
  await page.evaluate(() => render(true)); await wait(300);
  assert.equal((await thread(rootA)).open, '1');
  await page.tap(`#cbox .cm[data-cid="${rootA}"] ~ .crep`); await wait(300);
  assert.equal((await thread(rootA)).open, '0');
});

test('回复楼中楼后自动展开所在的一级评论', async () => {
  // 被收起的那条（第 5 条，楼中楼）不在页面上，用第 3 条回复的「回复」按钮
  const third = await page.evaluate(id => { const th = document.querySelector(`#cbox .cm[data-cid="${id}"]`).closest('.cthread'); return [...th.querySelectorAll(':scope > .cm')][3].dataset.cid; }, String(rootA));
  await page.tap(`#cbox .cm[data-cid="${third}"] [data-a=rp]`);
  await page.fill('[data-d=cin]', '新的楼中楼回复'); await page.tap('[data-a=cs]');
  await page.waitForFunction(() => document.querySelector('#cbox').innerText.includes('新的楼中楼回复'));
  await wait(300);
  const t = await thread(rootA); await shot('04-fold-auto-open-after-reply');
  assert.equal(t.open, '1'); assert.equal(t.rows, 1 + 6); assert.equal(t.btn, '收起回复');
  assert.deepEqual(page.errors, [], '页面无报错');
});
