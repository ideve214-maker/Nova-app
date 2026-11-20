// 用户端 2.0.7（续）：AI 内部账号角标 / 官方内部账号 / 私信提示；个性化推荐（兴趣选择、不感兴趣、行为上报、接口缺失时静默）。
// 服务端还没有 ai 字段和 2.1.2 的偏好接口：用 page.route 给返回补 ai:true，并模拟 /api/me/interests 和 /api/feed/*。截图：V207_SHOTS=<目录>。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {startServer, register, launch} from './ui-helpers.mjs';

const SHOTS = process.env.V207_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, {recursive: true});
const wait = ms => new Promise(r => setTimeout(r, ms));
let S, browser, page, bot, botPost;
const shot = async name => { if (SHOTS) await page.screenshot({path: join(SHOTS, name + '.png')}); };
const REAL = !!process.env.AIM_REAL;
const MOCK = {real: [], interests: {like: [], dislike: [], hiddenSources: [], onboarded: false}, puts: [], signals: [], ni: [], off: false};
const call = async (m, p, body, tok) => {
  const r = await fetch(S.base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  return {s: r.status, j: await r.json().catch(() => ({}))};
};
function markAi(o) {
  if (Array.isArray(o)) { o.forEach(markAi); return; }
  if (!o || typeof o !== 'object') return;
  if (o.username === 'aibot' && o.id != null) { o.ai = true; o.badge = 'internal'; }
  for (const k of Object.keys(o)) markAi(o[k]);
}
const T0 = () => page.evaluate(() => { const t = document.querySelector('#tt'); return t ? t.textContent : ''; });

test.before(async () => {
  S = await startServer({importAuto: false});
  const r = await call('POST', '/api/auth/register', {agree: true, username: 'aibot', email: 'aibot@x.test', password: 'Passw0rd123', displayName: '小V 科技观察'});
  assert.equal(r.s, 200, JSON.stringify(r.j));
  bot = {tok: r.j.token, id: r.j.user.id};
  botPost = (await call('POST', '/api/posts', {text: '今天 Rust 1.90 发布了，编译速度又快了一截。', clientId: 'aib1'}, bot.tok)).j.post;
  await call('POST', '/api/posts/' + botPost.id + '/comments', {text: 'AI 账号自己来补一句：升级指南见官网。'}, bot.tok);
  browser = await launch();
  const ctx = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 2});
  page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e)));
  await page.route('**/api/**', async route => {
    const req = route.request(), u = new URL(req.url()), m = req.method();
    if (/event-stream/.test(req.headers()['accept'] || '') || /\/(events|stream|sse)\b/.test(u.pathname)) return route.continue();
    if (REAL && !MOCK.off && /^\/api\/(me\/interests|feed\/(signals|not-interested))$/.test(u.pathname)) {
      // 连真服务端（2.1.2）：照常转发，记下请求体和状态
      const resp = await route.fetch(); const txt = await resp.text();
      const b = JSON.parse(req.postData() || 'null');
      MOCK.real.push({path: u.pathname, m, status: resp.status(), body: b, resp: txt.slice(0, 300)});
      if (u.pathname === '/api/me/interests' && m === 'PUT') MOCK.puts.push(b);
      if (u.pathname === '/api/feed/signals') MOCK.signals.push(...((b && b.events) || []));
      if (u.pathname === '/api/feed/not-interested') MOCK.ni.push(b);
      return route.fulfill({response: resp, body: txt});
    }
    if (u.pathname === '/api/me/interests') {
      if (MOCK.off) return route.fulfill({status: 404, contentType: 'application/json', body: '{"error":{"code":"NOT_FOUND"}}'});
      if (m === 'PUT') { const b = JSON.parse(req.postData() || '{}'); MOCK.puts.push(b); MOCK.interests = {...MOCK.interests, ...b}; }
      return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(MOCK.interests)});
    }
    if (u.pathname === '/api/feed/signals') { MOCK.signals.push(...(JSON.parse(req.postData() || '{}').events || [])); return route.fulfill({status: 200, contentType: 'application/json', body: '{"ok":true}'}); }
    if (u.pathname === '/api/feed/not-interested') { MOCK.ni.push(JSON.parse(req.postData() || '{}')); return route.fulfill({status: 200, contentType: 'application/json', body: '{"ok":true}'}); }
    if (/^\/api\/(friends\/request|conversations)$/.test(u.pathname) && m === 'POST' && (req.postData() || '').includes(String(bot.id))) {
      return route.fulfill({status: 403, contentType: 'application/json', body: '{"error":{"code":"INTERNAL_ACCOUNT","message":"INTERNAL_ACCOUNT"}}'});
    }
    const resp = await route.fetch();
    const ct = resp.headers()['content-type'] || '';
    if (!ct.includes('json')) return route.fulfill({response: resp});
    let j; try { j = await resp.json(); } catch { return route.fulfill({response: resp}); }
    markAi(j);
    return route.fulfill({response: resp, body: JSON.stringify(j)});
  });
  await page.goto(S.base + '/');
  await page.waitForSelector('#gate', {timeout: 15000});
  await register(page, 'aimui', 'aimui@qq.com');
});
test.after(async () => { await browser?.close(); await S?.close(); });

test('M：更新后第一次打开弹出兴趣选择，选好后 PUT /api/me/interests', async () => {
  await page.waitForSelector('.ichip', {timeout: 15000});
  await shot('M-interest-picker-first');
  await page.click('.ichip[data-v="tech"]');
  await page.click('.ichip[data-v="game"]');
  await page.click('.ichip[data-v="crypto"]'); await page.click('.ichip[data-v="crypto"]'); // 第二下：不想看
  await wait(150);
  await shot('M-interest-picker-picked');
  await page.click('[data-a="intsave"]');
  await page.waitForFunction(() => !document.querySelector('.ichip'), {timeout: 5000});
  assert.equal(MOCK.puts.length, 1);
  assert.deepEqual(MOCK.puts[0], {like: ['tech', 'game'], dislike: ['crypto'], hiddenSources: [], onboarded: true});
  // 设置里有「兴趣偏好」一行
  await page.evaluate(() => { S.tab = 'me'; S.st = ['set']; S.sh = null; render(true); });
  await page.waitForFunction(() => /兴趣偏好/.test(document.body.innerText));
  assert.match(await page.evaluate(() => document.body.innerText), /科技、游戏/);
});

test('AI 角标：帖子、评论、资料页头像右下角有「AI」；资料页显示「官方内部账号」、昵称旁不另加章；私信/加好友提示', async () => {
  await page.evaluate(() => { S.tab = 'home'; S.st = []; S.sh = null; render(true); });
  await page.waitForFunction(() => [...document.querySelectorAll('.fcard')].some(c => /Rust 1\.90/.test(c.innerText) && c.querySelector('.aibg')), {timeout: 15000});
  await page.evaluate(() => [...document.querySelectorAll('.fcard')].find(c => /Rust 1\.90/.test(c.innerText)).scrollIntoView({block: 'center'}));
  await wait(200);
  await shot('AI-badge-feed');
  await page.evaluate(id => Promise.resolve(A.post(id)).then(() => render()), botPost.id);
  await page.waitForFunction(() => /升级指南/.test(document.body.innerText), {timeout: 10000});
  await wait(300);
  const cmHas = await page.evaluate(() => [...document.querySelectorAll('.aibg')].length);
  assert.ok(cmHas >= 2, '帖子详情 + 评论都有角标 ' + cmHas);
  await shot('AI-badge-post-comment');
  await page.evaluate(id => Promise.resolve(A.user(String(id))).then(() => render()), bot.id);
  await page.waitForFunction(() => /官方内部账号/.test(document.body.innerText), {timeout: 10000});
  const pf = await page.evaluate(() => ({tag: document.querySelector('.intag')?.textContent, obg: !!document.querySelector('.nmb .obg-internal'), badge: !!document.querySelector('.aibg')}));
  assert.equal(pf.tag, '官方内部账号'); assert.equal(pf.obg, false); assert.ok(pf.badge);
  await wait(200);
  await shot('AI-profile-internal');
  await page.click('[data-a="dm"]');
  await wait(200);
  assert.equal(await T0(), '这是官方内部账号，不接收私信');
  const fr = await page.$('[data-a="frequest"]');
  if (fr) { await fr.click(); await wait(200); assert.equal(await T0(), '这是官方内部账号，不接收私信'); }
  // 服务端 403 INTERNAL_ACCOUNT 也显示同一句
  const em = await page.evaluate(() => errMsg({s: 403, j: {error: {code: 'INTERNAL_ACCOUNT', message: 'INTERNAL_ACCOUNT'}}}, 'x'));
  assert.equal(em, '这是官方内部账号，不接收私信');
});

test('通知：AI 账号的转帖 / 收藏通知显示「昵称 转发了你的帖子 / 收藏了你的帖子」，头像带 AI 角标，点开进帖子；未知类型也能显示', async () => {
  const me = await page.evaluate(() => ({id: SESSION.user.id, tok: SESSION.token}));
  const mine = (await call('POST', '/api/posts', {text: '我的帖子：等 AI 来转发和收藏', clientId: 'aimn1'}, me.tok)).j.post;
  S.srv.notifications.push(me.id, {kind: 'repost', title: '有人转发了你的动态', body: '', refType: 'post', refId: mine.id, actorId: bot.id, dedupeKey: 'repost:' + mine.id + ':' + bot.id});
  S.srv.notifications.push(me.id, {kind: 'save', title: '有人收藏了你的动态', body: '', refType: 'post', refId: mine.id, actorId: bot.id, dedupeKey: 'save:' + mine.id + ':' + bot.id});
  S.srv.notifications.push(me.id, {kind: 'brand_new_kind', title: '', body: '', dedupeKey: 'unk1'});
  await page.evaluate(() => { S.tab = 'home'; S.st = []; S.sh = null; render(true); });
  await page.evaluate(() => loadNotifications());
  await page.evaluate(() => { A.notif(); render(); });
  await page.waitForFunction(() => /转发了你的帖子/.test(document.body.innerText), {timeout: 8000});
  const t = await page.evaluate(() => document.body.innerText);
  assert.match(t, /(小V 科技观察|aibot) 转发了你的帖子/);
  assert.match(t, /(小V 科技观察|aibot) 收藏了你的帖子/);
  assert.match(t, /新通知/);
  assert.ok(await page.evaluate(() => document.querySelectorAll('.nav .aibg').length >= 2), '通知头像带 AI 角标');
  await wait(200);
  await shot('AI-notif-repost-save');
  await page.evaluate(() => { const el = [...document.querySelectorAll('[data-a]')].find(e => /转发了你的帖子/.test(e.innerText) && e.getAttribute('data-a') !== 'nrall'); el.click(); });
  await page.waitForFunction(() => /等 AI 来转发和收藏/.test(document.querySelector('#v').innerText) && (S.st || []).some(x => String(x).startsWith('post:')), {timeout: 8000});
});

test('M：帖子 … 菜单「不感兴趣」：上报并从首页移除；停留时长和点赞批量上报 /api/feed/signals', async () => {
  await page.evaluate(() => { S.tab = 'home'; S.st = []; S.sh = null; render(true); document.querySelector('#v .pg.home > .sc')?.scrollTo(0, 0); });
  await page.waitForFunction(() => /Rust 1\.90/.test(document.body.innerText), {timeout: 10000});
  await page.evaluate(() => [...document.querySelectorAll('.fcard')].find(c => /Rust 1\.90/.test(c.innerText)).scrollIntoView({block: 'center'}));
  await wait(1500);
  await page.evaluate(id => { A.xlike(String(id)); render(); }, botPost.id);
  await page.evaluate(async () => { sigStopAll(); await sigFlush(false); });
  const view = MOCK.signals.find(e => e.postId === botPost.id && e.action === 'view');
  assert.ok(view && view.dwellMs >= 1000 && view.at > 0, JSON.stringify(MOCK.signals));
  assert.ok(MOCK.signals.some(e => e.postId === botPost.id && e.action === 'like'));
  await page.evaluate(id => { A.more(String(id)); render(); }, botPost.id);
  await page.waitForSelector('[data-a="niset"]');
  await shot('M-not-interested-menu');
  await page.click('[data-a="niset"][data-v^="post|"]');
  await wait(400);
  assert.deepEqual(MOCK.ni[0], {postId: botPost.id, reason: 'post'});
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.fcard')].some(c => /Rust 1\.90/.test(c.innerText))), false);
  await page.evaluate(async () => { await sigFlush(false); });
  assert.ok(MOCK.signals.some(e => e.postId === botPost.id && e.action === 'hide'));
  if (REAL) {
    const bad = MOCK.real.filter(x => x.status !== 200);
    assert.deepEqual(bad, [], '真服务端都返回 200');
    console.log('REAL calls', JSON.stringify(MOCK.real.map(x => [x.m, x.path, x.status, x.resp.slice(0, 120)])));
  }
});

test('M：服务端没有偏好接口（404）时静默：不弹窗、设置里不显示、菜单里没有「不感兴趣」', async () => {
  MOCK.off = true;
  const r = await page.evaluate(async () => { __int.sup = null; await intLoad(true); return {sup: __int.sup, row: intRow(), ni: niItems({id: 1, a: '5', x: 'x'})}; });
  assert.deepEqual(r, {sup: false, row: '', ni: ''});
  assert.deepEqual(page.errors, []);
});
