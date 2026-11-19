// 转帖内嵌原帖（#8 移植到 2.0.5）：真实服务器 + 无头 Chromium，触摸点击（iPhone 390×844）。
// 直接转帖：上方一行「你 转帖了」+ 原帖卡片（作者、正文）；点卡片打开原帖详情；转帖面板可「撤销转帖」，撤销后能再转；
// 引用转帖：单独编辑页，评论在上、卡片在下，不进入普通发帖草稿；原帖删除后卡片显示「原帖已删除」。
// 截图：设置 REPOST_SHOTS=<目录> 时保存。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {startServer, register, launch} from './ui-helpers.mjs';

const SHOTS = process.env.REPOST_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, {recursive: true});
const wait = ms => new Promise(r => setTimeout(r, ms));
let S, browser, page, B, orig;
const shot = async n => { if (SHOTS) await page.screenshot({path: join(SHOTS, n + '.png')}); };
const call = async (m, p, body, tok) => {
  const r = await fetch(S.base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  let j = null; try { j = await r.json(); } catch {}
  return {s: r.status, j};
};
const cards = () => page.evaluate(() => [...document.querySelectorAll('#v .fcard.rp')].map(c => ({
  plain: c.classList.contains('plain'), top: (c.querySelector('.rptop')?.innerText || '').replace(/\s+/g, ' ').trim(),
  body: (c.querySelector('.fbd')?.innerText || '').trim(), embed: (c.querySelector('.rpc')?.innerText || '').replace(/\s+/g, ' ').trim(),
  del: !!c.querySelector('.rpc.del'), embedAfterBody: (() => { const b = c.querySelector('.fbd'), e = c.querySelector('.rpc'); return !!(b && e && (b.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING)); })(),
})));
const sheet = () => page.evaluate(() => [...document.querySelectorAll('[data-a=xrtgo],[data-a=xrtundo],[data-a=xquote]')].map(b => b.dataset.a));
const home = async () => { await page.tap('nav [data-a=tab][data-v=home], nav [data-v=home]').catch(() => {}); await wait(600); };

test.before(async () => {
  S = await startServer(); browser = await launch();
  const r = await call('POST', '/api/auth/register', {agree: true, username: 'rpsrc_1', email: 'rpsrc_1@qq.com', password: 'Passw0rd123'});
  assert.equal(r.s, 200, JSON.stringify(r.j)); B = {tok: r.j.token, id: r.j.user.id};
  const p = await call('POST', '/api/posts', {text: '嵌入测试原帖：今天天气很好'}, B.tok);
  assert.equal(p.s, 200); orig = p.j.post.id;
  const ctx = await browser.newContext({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true, deviceScaleFactor: 2});
  page = await ctx.newPage(); page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e)));
  await page.goto(S.base + '/'); await page.waitForSelector('#gate');
  await register(page, 'rpui_1', 'rpui_1@qq.com');
  await page.waitForFunction(() => document.body.innerText.includes('嵌入测试原帖'), null, {timeout: 15000});
  await wait(500);
});
test.after(async () => { await browser?.close(); await S?.close(); });

test('直接转帖：出现「你 转帖了」+ 原帖卡片（作者、正文）', async () => {
  await page.tap(`#v [data-a=xrt][data-v="${orig}"]`); await page.waitForSelector('[data-a=xrtgo]');
  await shot('01-repost-sheet');
  await page.tap('[data-a=xrtgo]');
  await page.waitForFunction(() => document.querySelector('#v .fcard.rp.plain .rpc'), null, {timeout: 10000}); await wait(400);
  const c = (await cards())[0]; await shot('02-repost-plain-card');
  assert.ok(c.plain, '直接转帖'); assert.match(c.top, /你\s*转帖了/);
  assert.ok(c.embed.includes('嵌入测试原帖') && c.embed.includes('rpsrc_1'), '卡片里有原帖作者和正文: ' + c.embed);
  const g = await call('GET', '/api/posts/' + orig, null, B.tok);
  assert.equal(g.j.post.repostCount, 1);
});

test('点卡片打开原帖详情', async () => {
  await page.tap('#v .fcard.rp.plain .rpc'); await wait(800);
  await shot('03-embed-open-detail');
  const st = await page.evaluate(() => S.st[S.st.length - 1]);
  assert.equal(st, 'post:' + orig);
  await page.tap('#v [data-a=back]'); await wait(600);
});

test('转帖面板：已转过显示「撤销转帖」；撤销后可以再转', async () => {
  await page.tap(`#v .fcard:not(.rp) [data-a=xrt][data-v="${orig}"]`); await page.waitForSelector('[data-a=xrtundo]');
  assert.deepEqual(await sheet(), ['xrtundo', 'xquote']); await shot('04-sheet-undo');
  await page.tap('[data-a=xrtundo]');
  await page.waitForFunction(() => !document.querySelector('#v .fcard.rp'), null, {timeout: 10000}); await wait(400);
  assert.equal((await call('GET', '/api/posts/' + orig, null, B.tok)).j.post.repostCount, 0);
  await page.tap(`#v [data-a=xrt][data-v="${orig}"]`); await page.waitForSelector('[data-a=xrtgo]');
  await page.tap('[data-a=xrtgo]');
  await page.waitForFunction(() => document.querySelector('#v .fcard.rp.plain'), null, {timeout: 10000});
  assert.equal((await call('GET', '/api/posts/' + orig, null, B.tok)).j.post.repostCount, 1);
});

test('引用转帖：单独编辑页，评论在上、卡片在下；不进入普通发帖草稿', async () => {
  await page.tap(`#v .fcard:not(.rp) [data-a=xrt][data-v="${orig}"]`); await page.waitForSelector('[data-a=xquote]');
  await page.tap('[data-a=xquote]'); await page.waitForSelector('[data-d=qin]'); await wait(300);
  assert.ok(await page.$('.compose-pg .rpc'), '编辑页里预览原帖卡片'); await shot('05-quote-editor');
  await page.fill('[data-d=qin]', '说得好，转给大家');
  await page.tap('[data-a=quotego]');
  await page.waitForFunction(() => [...document.querySelectorAll('#v .fcard.rp .fbd')].some(b => b.innerText.includes('说得好')), null, {timeout: 10000}); await wait(400);
  const q = (await cards()).find(c => c.body.includes('说得好')); await shot('06-quote-card');
  assert.ok(!q.plain && q.embedAfterBody && q.embed.includes('嵌入测试原帖'));
  await page.tap('#v [data-a=compose]'); await page.waitForSelector('[data-d=pin]');
  assert.equal(await page.inputValue('[data-d=pin]'), '', '普通发帖框是空的');
  assert.equal(await page.evaluate(() => localStorage.getItem('nova_compose_draft') || ''), '');
  await page.tap('[data-a=compx]').catch(async () => { await page.tap('#v [data-a=back]'); }); await wait(500);
});

test('原帖删除后，转帖卡片显示「原帖已删除」', async () => {
  assert.equal((await call('POST', '/api/posts/' + orig + '/delete', {}, B.tok)).s, 200);
  await page.reload(); await page.waitForSelector('nav'); await wait(3000);
  await page.waitForFunction(() => document.querySelector('#v .fcard.rp'), null, {timeout: 10000});
  const cs = await cards(); await shot('07-orig-deleted');
  assert.ok(cs.length >= 2 && cs.every(c => c.del && c.embed.includes('原帖已删除')), JSON.stringify(cs));
  assert.deepEqual(page.errors, []);
});
