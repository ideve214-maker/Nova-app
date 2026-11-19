// 帖子收藏数（#10 移植到 2.0.5）：真实服务器 + 无头 Chromium，用 CDP 派发真实触摸事件（iPhone 390×844）。
// 覆盖：别人已收藏时数字是 1，自己点一下变成 2 并亮起，再点回到 1 并熄灭，再点又是 2；刷新后仍是 2 亮；
//       从 0 点一下变成 1；不在首页列表、只在 postCache / 推流里的帖子点收藏也有反应；收藏页能看到该帖。
// 截图：设置 FAVCOUNT_SHOTS=<目录> 时保存。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {startServer, register, launch} from './ui-helpers.mjs';

const SHOTS = process.env.FAVCOUNT_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, {recursive: true});
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const wait = ms => new Promise(r => setTimeout(r, ms));
let S, browser, ctx, page, cdp, A, orig, lone, cached;

const shot = async name => { if (SHOTS) await page.screenshot({path: join(SHOTS, name + '.png')}); };
const call = async (m, p, body, tok) => {
  const r = await fetch(S.base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  let j = null; try { j = await r.json(); } catch {}
  return {s: r.status, j};
};
const bm = id => page.evaluate(id => {
  const el = document.querySelector(`#v [data-a=xbm][data-v="${id}"]`);
  if (!el) return null;
  const p = typeof findPost === 'function' ? findPost(id) : null;
  return {
    on: el.classList.contains('on'),
    text: (el.querySelector('span')?.innerText || '').trim(),
    label: el.getAttribute('aria-label') || '',
    saved: typeof isSaved === 'function' && isSaved('post', String(id)),
    bookmarkCount: p && p.bookmarkCount,
  };
}, id);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {type, touchPoints: type === 'touchEnd' ? [] : [{x, y, id: 1}]});
async function goHome() {
  await page.evaluate(() => { S.st = []; S.tab = 'home'; if (typeof A !== 'undefined' && A.tab) A.tab('home'); if (typeof render === 'function') render(true); });
  await page.waitForSelector('nav.fnav, #app .fnav');
  await wait(400);
}
async function tapSel(sel) {
  const loc = page.locator(sel).first();
  await loc.waitFor({state: 'attached', timeout: 8000});
  await loc.scrollIntoViewIfNeeded();
  await wait(200);
  const box = await loc.boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0, '找不到可点元素 ' + sel + ' box=' + JSON.stringify(box));
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await touch('touchStart', x, y); await wait(40); await touch('touchEnd');
}
async function tapBm(id) { await tapSel(`#v [data-a=xbm][data-v="${id}"]`); }
async function waitBm(id, {on, text}, label, timeout = 8000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeout) {
    last = await bm(id);
    if (last && last.on === on && last.text === String(text)) return last;
    await wait(80);
  }
  assert.fail(`${label}：期望 亮=${on} 数字=${text}，实际 ${JSON.stringify(last)}`);
}

test.before(async () => {
  S = await startServer(); browser = await launch();
  A = (await call('POST', '/api/auth/register', {agree: true, username: 'fvsrc_1', email: 'fvsrc_1@qq.com', password: 'Passw0rd123'}));
  assert.equal(A.s, 200, JSON.stringify(A.j));
  const C = await call('POST', '/api/auth/register', {agree: true, username: 'fvsrc_c', email: 'fvsrc_c@qq.com', password: 'Passw0rd123'});
  assert.equal(C.s, 200, JSON.stringify(C.j));
  const p1 = await call('POST', '/api/posts', {text: '收藏数测试原帖：已有一个人收藏'}, A.j.token);
  assert.equal(p1.s, 200); orig = p1.j.post.id;
  assert.equal((await call('POST', '/api/me/saved', {kind: 'post', target: orig, title: 'x'}, C.j.token)).j.bookmarkCount, 1);
  const p2 = await call('POST', '/api/posts', {text: '收藏数测试：还没有人收藏'}, A.j.token);
  assert.equal(p2.s, 200); lone = p2.j.post.id;
  const p3 = await call('POST', '/api/posts', {text: '收藏数测试：只在缓存里的帖子'}, A.j.token);
  assert.equal(p3.s, 200); cached = p3.j.post.id;
  assert.equal((await call('POST', '/api/me/saved', {kind: 'post', target: cached, title: 'x'}, C.j.token)).j.bookmarkCount, 1);

  ctx = await browser.newContext({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: UA});
  page = await ctx.newPage(); page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e)));
  await page.goto(S.base + '/'); await page.waitForSelector('#gate');
  await register(page, 'fvui_1', 'fvui_1@qq.com');
  await page.waitForFunction(() => document.body.innerText.includes('收藏数测试原帖'), null, {timeout: 15000});
  await wait(500);
  cdp = await ctx.newCDPSession(page);
});
test.after(async () => { await browser?.close(); await S?.close(); });

test('别人已收藏时数字是 1；点一下变成 2 并亮起，再点回到 1 并熄灭，再点又是 2', async () => {
  const start = await bm(orig);
  assert.ok(start, '首页看得到收藏按钮');
  assert.equal(start.on, false, '自己还没收藏');
  assert.equal(start.text, '1', '别人已收藏，数字应为 1（这是旧 bug 会卡住的起点）');
  await shot('01-start-count-1');

  await tapBm(orig);
  const t2 = await waitBm(orig, {on: true, text: '2'}, '第一次点收藏');
  await shot('02-after-save-2-on');
  assert.equal(t2.saved, true);
  assert.equal((await call('GET', '/api/posts/' + orig, null, A.j.token)).j.post.bookmarkCount, 2);

  await tapBm(orig);
  const t1 = await waitBm(orig, {on: false, text: '1'}, '取消收藏');
  await shot('03-after-unsave-1-off');
  assert.equal(t1.saved, false);
  assert.equal((await call('GET', '/api/posts/' + orig, null, A.j.token)).j.post.bookmarkCount, 1);

  await tapBm(orig);
  await waitBm(orig, {on: true, text: '2'}, '再次收藏');
  await shot('04-save-again-2-on');
});

test('刷新后收藏状态和数字保持（仍是 2 并亮起）', async () => {
  await page.reload();
  await page.waitForSelector('nav');
  await page.waitForFunction(() => document.body.innerText.includes('收藏数测试原帖'), null, {timeout: 15000});
  await wait(500);
  // CDP session is tied to the page; recreate after reload
  cdp = await ctx.newCDPSession(page);
  const st = await waitBm(orig, {on: true, text: '2'}, '刷新后', 15000);
  await shot('05-after-reload-2-on');
  assert.equal(st.saved, true);
});

test('从 0 点一下变成 1 并亮起', async () => {
  await goHome();
  await page.waitForFunction(() => document.body.innerText.includes('还没有人收藏'), null, {timeout: 10000});
  const start = await bm(lone);
  assert.ok(start, '看得到未收藏帖的按钮');
  assert.equal(start.on, false);
  assert.equal(start.text, '', '0 不显示数字');
  await tapBm(lone);
  await waitBm(lone, {on: true, text: '1'}, '从 0 收藏');
  await shot('06-from-zero-to-1');
});

test('不在首页列表、只在缓存 / 推流里的帖子，点收藏也有反应并更新数字', async () => {
  await goHome();
  await page.waitForFunction(() => document.body.innerText.includes('只在缓存里的帖子'), null, {timeout: 10000});
  const found = await page.evaluate(id => !!(typeof findPost === 'function' && findPost(id)), cached);
  assert.ok(found, '首页加载后应能找到缓存测试帖');
  await page.evaluate(id => {
    const p = findPost(id);
    S.postCache = S.postCache || {};
    S.postCache[id] = p;
    S.boosts = [p];
    if (Array.isArray(S.posts)) S.posts = S.posts.filter(x => String(x.id) !== String(id));
    if (D && Array.isArray(D.p)) D.p = D.p.filter(x => String(x.id) !== String(id));
    const f = typeof feedSrc === 'function' ? feedSrc() : null;
    if (Array.isArray(f)) {
      const i = f.findIndex(x => String(x.id) === String(id));
      if (i >= 0) f.splice(i, 1);
    }
    S.st = ['post:' + id];
    render(true);
  }, cached);
  await page.waitForFunction(() => document.body.innerText.includes('只在缓存里的帖子') && document.querySelector('#v [data-a=xbm]'), null, {timeout: 8000});
  await wait(300);
  const start = await bm(cached);
  assert.equal(start && start.text, '1', '缓存帖初始数字应为 1: ' + JSON.stringify(start));
  assert.equal(start.on, false);
  await shot('07-cached-post-before');
  await tapBm(cached);
  await waitBm(cached, {on: true, text: '2'}, '缓存/推流帖收藏');
  await shot('08-cached-post-saved-2');
  assert.equal((await call('GET', '/api/posts/' + cached, null, A.j.token)).j.post.bookmarkCount, 2);
});

test('我的收藏页能看到刚收藏的帖子', async () => {
  await page.evaluate(async () => {
    S.sh = null;
    S.st = ['saved'];
    if (typeof loadSaved === 'function') await loadSaved();
    render(true);
  });
  await page.waitForSelector('#savedp', {timeout: 8000});
  await wait(400);
  const text = await page.evaluate(() => document.querySelector('#savedp')?.innerText || document.querySelector('#v')?.innerText || '');
  await shot('09-saved-page');
  assert.ok(text.includes('收藏数测试原帖') || text.includes('已有一个人收藏'), '收藏页应有原帖: ' + text.slice(0, 400));
  assert.deepEqual(page.errors, []);
});
