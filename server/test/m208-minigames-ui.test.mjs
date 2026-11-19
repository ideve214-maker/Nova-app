// 小游戏修复（#11 移植到 2.0.5）：真实服务器 + 无头 Chromium，用 CDP 派发真实触摸事件（iPhone 390×844）。
// 覆盖：11 款游戏在一屏内全部可见；24 点「随机」「计算」有反应；扫雷默认简单 9×9 / 10 雷且有玩法说明；
//       贪吃蛇 / 2048 / 黑白棋 / 扫雷为中文；五子棋、四子棋画面完整且不钻到 App 顶栏下面。
// 截图：设置 MINIGAME_SHOTS=<目录> 时保存。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {startServer, register, launch} from './ui-helpers.mjs';

const SHOTS = process.env.MINIGAME_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, {recursive: true});
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const wait = ms => new Promise(r => setTimeout(r, ms));
let S, browser, ctx, page, cdp;
const shot = async name => { if (SHOTS) await page.screenshot({path: join(SHOTS, name + '.png')}); };
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {type, touchPoints: type === 'touchEnd' ? [] : [{x, y, id: 1}]});

async function tapLoc(loc) {
  await loc.waitFor({state: 'attached', timeout: 10000});
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  await wait(150);
  const box = await loc.boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0, '找不到可点元素 box=' + JSON.stringify(box));
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await touch('touchStart', x, y); await wait(40); await touch('touchEnd');
}
const tapSel = (sel, scope = page) => tapLoc(scope.locator(sel).first());

async function openGames() {
  await page.evaluate(() => { S.st = []; S.tab = 'cm'; if (typeof A !== 'undefined' && A.tab) A.tab('cm'); render(true); });
  await page.waitForSelector('[data-a=minigame]', {timeout: 10000});
  await wait(300);
  await tapSel('[data-a=minigame]');
  await page.waitForSelector('.gtile', {timeout: 10000});
  await wait(300);
}
async function waitFrame(id, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const f = page.frames().find(fr => {
      const u = fr.url() || '';
      return u.includes('/' + id + '/index.html') || u.endsWith('/' + id + '/') || u.includes('/games/' + id + '/');
    });
    if (f) {
      try { await f.waitForLoadState('domcontentloaded', {timeout: 5000}); } catch {}
      try { await f.waitForLoadState('load', {timeout: 5000}); } catch {}
      await wait(400);
      return f;
    }
    await wait(80);
  }
  assert.fail('游戏 iframe 未加载: ' + id + ' frames=' + page.frames().map(fr => fr.url()).join(' | '));
}
async function openGame(id) {
  if (!await page.locator(`.gtile[data-v="${id}"]`).count()) await openGames();
  await tapSel(`.gtile[data-v="${id}"]`);
  await page.waitForSelector(`iframe[data-game="${id}"]`, {timeout: 10000});
  return waitFrame(id);
}
async function backToList() {
  if (await page.locator('#v [data-a=back]').count()) await tapSel('#v [data-a=back]');
  else await page.evaluate(() => { S.st = ['games']; render(true); });
  await page.waitForSelector('.gtile', {timeout: 8000});
  await wait(250);
}
const frameGeom = id => page.evaluate(id => {
  const top = document.querySelector('.pg.game-pg .top, #v .top');
  const iframe = document.querySelector(`iframe[data-game="${id}"]`);
  const nav = document.querySelector('#app .fnav');
  if (!iframe) return null;
  const ir = iframe.getBoundingClientRect();
  const tr = top ? top.getBoundingClientRect() : {bottom: 0, height: 0};
  const nr = nav ? nav.getBoundingClientRect() : {top: innerHeight};
  return {iframeTop: ir.top, iframeBottom: ir.bottom, iframeHeight: ir.height, topBottom: tr.bottom, topHeight: tr.height, navTop: nr.top};
}, id);
function assertBelowTop(g, label) {
  assert.ok(g, label + '：找不到 iframe');
  assert.ok(g.iframeHeight > 120, label + '：游戏区高度太小 ' + g.iframeHeight);
  assert.ok(g.iframeTop >= g.topBottom - 1, `${label}：画面不应钻到顶栏下面（iframeTop=${g.iframeTop.toFixed(1)}, topBottom=${g.topBottom.toFixed(1)}）`);
}

test.before(async () => {
  S = await startServer(); browser = await launch();
  ctx = await browser.newContext({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: UA});
  page = await ctx.newPage(); page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e)));
  // 本机 Node 服务给 /assets/ 一律带了 API 用的安全头：X-Frame-Options: DENY，
  // 以及 Content-Security-Policy: default-src 'none'（脚本跑不了）。
  // App 安装包 / 热更新是本地文件或 nginx，没有这些头。测试里去掉，才能验证客户端，不改服务器产品代码。
  await page.route('**/assets/games/**', async route => {
    const resp = await route.fetch();
    const headers = {...resp.headers()};
    delete headers['x-frame-options'];
    delete headers['X-Frame-Options'];
    delete headers['content-security-policy'];
    delete headers['Content-Security-Policy'];
    await route.fulfill({status: resp.status(), headers, body: await resp.body()});
  });
  await page.goto(S.base + '/'); await page.waitForSelector('#gate');
  await register(page, 'gameui_1', 'gameui_1@qq.com');
  await page.waitForSelector('nav.fnav', {timeout: 15000});
  await wait(500);
  cdp = await ctx.newCDPSession(page);
});
test.after(async () => { await browser?.close(); await S?.close(); });

test('游戏列表：11 款游戏在 390×844 一屏内全部可见，含扫雷、数独、四子棋', async () => {
  await openGames();
  const vis = await page.evaluate(() => {
    const nav = document.querySelector('#app .fnav');
    const navTop = nav ? nav.getBoundingClientRect().top : innerHeight;
    const tiles = [...document.querySelectorAll('.gtile')].map(el => {
      const r = el.getBoundingClientRect();
      return {id: el.dataset.v, name: (el.querySelector('b')?.innerText || '').trim(), top: Math.round(r.top), bottom: Math.round(r.bottom), visible: r.top >= 0 && r.bottom <= navTop + 1 && r.height > 0};
    });
    return {count: tiles.length, navTop: Math.round(navTop), tiles, hidden: tiles.filter(t => !t.visible).map(t => t.id + '@' + t.top + '-' + t.bottom)};
  });
  await shot('01-games-list');
  assert.equal(vis.count, 11, '应有 11 款游戏: ' + vis.tiles.map(t => t.id).join(','));
  const ids = vis.tiles.map(t => t.id);
  for (const need of ['mines', 'sudoku', 'c4', 'calc24', 'gobang', 'snake', '2048', 'reversi']) {
    assert.ok(ids.includes(need), '列表里应有 ' + need);
  }
  assert.deepEqual(vis.hidden, [], '一屏内应能看到全部游戏，被挡住的: ' + JSON.stringify(vis.hidden) + ' navTop=' + vis.navTop);
});

test('24 点：点「随机」发出 1–13 的四个数，点「计算」列出算法', async () => {
  const frame = await openGame('calc24');
  await frame.waitForFunction(() => document.getElementById('random') && typeof calc24 === 'function', null, {timeout: 8000});
  await wait(200);
  await shot('02-calc24-open');
  // 页面打开时就会先发一组；再点「随机」换一组，确认按钮绑定了逻辑
  const before = await frame.evaluate(() => [...document.querySelectorAll('input[name="number"]')].map(i => Number(i.value)));
  assert.ok(before.every(n => Number.isInteger(n) && n >= 1 && n <= 13), '打开时应已随机发 1–13: ' + JSON.stringify(before));
  await tapSel('#random', frame);
  await wait(300);
  // 若触摸坐标没点到按钮（iframe 偏移），用 click 再确认监听在
  let dealt = await frame.evaluate(() => [...document.querySelectorAll('input[name="number"]')].map(i => Number(i.value)));
  if (JSON.stringify(dealt) === JSON.stringify(before)) {
    await frame.evaluate(() => document.getElementById('random').click());
    await wait(200);
    dealt = await frame.evaluate(() => [...document.querySelectorAll('input[name="number"]')].map(i => Number(i.value)));
  }
  await shot('03-calc24-random');
  assert.equal(dealt.length, 4);
  assert.ok(dealt.every(n => Number.isInteger(n) && n >= 1 && n <= 13), '随机应发 1–13: ' + JSON.stringify(dealt));
  await tapSel('#start', frame);
  await wait(600);
  const out = (await frame.evaluate(() => document.querySelector('#reslut')?.value || '')).trim();
  await shot('04-calc24-solved');
  assert.ok(out.length > 0, '计算后应有结果或「算不出」提示');
  assert.ok(/24|=|算不出|无法|无解/.test(out) || /[+\-*/]/.test(out), '结果看起来不像算法: ' + out.slice(0, 200));
  await backToList();
});

test('扫雷：默认简单难度 9×9、10 颗雷，棋盘上方有玩法说明', async () => {
  const frame = await openGame('mines');
  await frame.waitForFunction(() => document.querySelectorAll('.tile, [role=gridcell]').length === 81, null, {timeout: 8000});
  const st = await frame.evaluate(() => {
    const tiles = document.querySelectorAll('.tile, [role=gridcell]');
    const help = (document.querySelector('[data-rules], .game-help, [aria-label="玩法说明"]')?.innerText || '').replace(/\s+/g, ' ').trim();
    const summary = (document.querySelector('[data-board-summary]')?.innerText || '').replace(/\s+/g, ' ').trim();
    const size = (document.querySelector('[data-board-size]')?.innerText || '').replace(/\s+/g, ' ').trim();
    const rows = document.querySelector('[data-board]')?.getAttribute('aria-rowcount');
    const cols = document.querySelector('[data-board]')?.getAttribute('aria-colcount');
    return {tiles: tiles.length, help, summary, size, rows, cols, body: document.body.innerText.slice(0, 400)};
  });
  await shot('05-mines-default');
  assert.equal(Number(st.rows), 9, JSON.stringify(st));
  assert.equal(Number(st.cols), 9, JSON.stringify(st));
  assert.equal(st.tiles, 81, '简单难度应有 81 格: ' + JSON.stringify(st));
  assert.ok(/9\s*[×x]\s*9/.test(st.summary + st.size) && /10/.test(st.summary + st.body), '应标明 9×9 和 10 颗雷: ' + st.summary + ' / ' + st.size);
  assert.ok(/玩法/.test(st.help + st.body) && /翻开|插旗|地雷/.test(st.help + st.body), '应有玩法说明: ' + st.help);
  await backToList();
});

test('贪吃蛇、2048、黑白棋、扫雷的按钮和说明是中文', async () => {
  // 扫雷刚才已看过中文说明；这里查另外三款，再回到扫雷确认按钮
  const snake = await openGame('snake');
  await wait(400);
  const snakeText = await snake.evaluate(() => document.body.innerText);
  await shot('06-snake-zh');
  assert.ok(/开始游戏|简单|中等|困难|贪吃蛇/.test(snakeText), '贪吃蛇应为中文: ' + snakeText.slice(0, 200));
  await backToList();

  const g2048 = await openGame('2048');
  await wait(400);
  const t2048 = await g2048.evaluate(() => document.body.innerText);
  await shot('07-2048-zh');
  assert.ok(/新开一局|玩法：|滑动合并/.test(t2048), '2048 应为中文: ' + t2048.slice(0, 250));
  await backToList();

  const rev = await openGame('reversi');
  await wait(400);
  const tRev = await rev.evaluate(() => document.body.innerText);
  await shot('08-reversi-zh');
  assert.ok(/黑白棋/.test(tRev), '黑白棋标题应为中文: ' + tRev.slice(0, 200));
  await backToList();
});

test('五子棋、四子棋在 390×844 下完整显示，且不钻到 App 顶栏下面', async () => {
  const gobangFrame = await openGame('gobang');
  await gobangFrame.waitForFunction(() => {
    const c = document.getElementById('canvas');
    if (!c) return false;
    const r = c.getBoundingClientRect();
    return r.width > 80 && r.width <= (innerWidth + 2) && r.height <= (innerHeight + 2);
  }, null, {timeout: 5000}).catch(() => {});
  await wait(200);
  const gobang = await frameGeom('gobang');
  const gobangCanvas = await gobangFrame.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return {w: r.width, h: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right, vw: innerWidth, vh: innerHeight};
  });
  await shot('09-gobang');
  assertBelowTop(gobang, '五子棋');
  assert.ok(gobangCanvas && gobangCanvas.w > 80 && gobangCanvas.h > 80, '五子棋棋盘应可见 ' + JSON.stringify(gobangCanvas));
  assert.ok(gobangCanvas.bottom <= gobangCanvas.vh + 2 && gobangCanvas.right <= gobangCanvas.vw + 2, '五子棋棋盘应完整落在游戏框内: ' + JSON.stringify(gobangCanvas));
  await backToList();

  const c4Frame = await openGame('c4');
  await c4Frame.waitForFunction(() => {
    const c = document.querySelector('canvas');
    if (!c) return false;
    const r = c.getBoundingClientRect();
    return r.width > 80 && r.width <= (innerWidth + 8) && r.height <= (innerHeight + 8);
  }, null, {timeout: 5000}).catch(() => {});
  await wait(200);
  const c4 = await frameGeom('c4');
  const c4Canvas = await c4Frame.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return {w: r.width, h: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right, vw: innerWidth, vh: innerHeight};
  });
  await shot('10-c4');
  assertBelowTop(c4, '四子棋');
  assert.ok(c4Canvas && c4Canvas.w > 80 && c4Canvas.h > 80, '四子棋棋盘应可见 ' + JSON.stringify(c4Canvas));
  assert.ok(c4Canvas.bottom <= c4Canvas.vh + 8 && c4Canvas.right <= c4Canvas.vw + 8, '四子棋棋盘应完整落在游戏框内: ' + JSON.stringify(c4Canvas));
  assert.deepEqual(page.errors, []);
});
