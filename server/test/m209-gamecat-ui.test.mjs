// 小游戏分类浏览（feat/mini-games-categories 移植到 2.0.5 + #11）：真实服务器 + 无头 Chromium，CDP 触摸（iPhone 390×844）。
// 覆盖：「全部 / 棋类 / 益智 / 休闲」分段；全部页按分区展示全部 11 款；各分类只显示对应游戏；点开游戏仍按需加载 iframe。
// 截图：设置 GAMECAT_SHOTS=<目录> 时保存。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {startServer, register, launch} from './ui-helpers.mjs';

const SHOTS = process.env.GAMECAT_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, {recursive: true});
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const wait = ms => new Promise(r => setTimeout(r, ms));
const BOARD = ['gobang', 'c4', 'reversi', 'chess'];
const PUZZLE = ['mines', '2048', 'calc24', 'sudoku', 'solitaire'];
const CASUAL = ['snake', 'tower'];
const ALL = BOARD.concat(PUZZLE, CASUAL);
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
  await page.evaluate(() => { S.gameCat = 'all'; S.st = []; S.tab = 'cm'; if (typeof A !== 'undefined' && A.tab) A.tab('cm'); render(true); });
  await page.waitForSelector('[data-a=minigame]', {timeout: 10000});
  await wait(300);
  await tapSel('[data-a=minigame]');
  await page.waitForSelector('.gtile, [data-a=gcat]', {timeout: 10000});
  await wait(300);
}
async function tapCat(id) {
  await tapSel(`.gcat-seg [data-a=gcat][data-v="${id}"], [data-a=gcat][data-v="${id}"]`);
  await page.waitForFunction(id => {
    const on = document.querySelector('[data-a=gcat].on, [data-a=gcat][aria-selected="true"]');
    return on && on.dataset.v === id;
  }, id, {timeout: 8000});
  await wait(250);
}
const tiles = () => page.evaluate(() => {
  const nav = document.querySelector('#app .fnav');
  const navTop = nav ? nav.getBoundingClientRect().top : innerHeight;
  const list = [...document.querySelectorAll('.gtile')].map(el => {
    const r = el.getBoundingClientRect();
    return {id: el.dataset.v, name: (el.querySelector('b')?.innerText || '').trim(), top: Math.round(r.top), bottom: Math.round(r.bottom), visible: r.top >= 0 && r.bottom <= navTop + 1 && r.height > 0};
  });
  const tabs = [...document.querySelectorAll('[data-a=gcat]')].map(b => ({id: b.dataset.v, name: b.innerText.trim(), on: b.classList.contains('on')}));
  const secs = [...document.querySelectorAll('.gsec')].map(el => el.innerText.trim());
  return {ids: list.map(t => t.id), names: list.map(t => t.name), hidden: list.filter(t => !t.visible).map(t => t.id), count: list.length, tabs, secs, navTop: Math.round(navTop)};
});

test.before(async () => {
  S = await startServer(); browser = await launch();
  ctx = await browser.newContext({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: UA});
  page = await ctx.newPage(); page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e)));
  // 与 m208 相同：本机 Node 给 /assets/ 带了 X-Frame-Options 和 default-src 'none'，测试里去掉才能打开游戏 iframe。不改服务器产品代码。
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
  await register(page, 'gcatui_1', 'gcatui_1@qq.com');
  await page.waitForSelector('nav.fnav', {timeout: 15000});
  await wait(500);
  cdp = await ctx.newCDPSession(page);
});
test.after(async () => { await browser?.close(); await S?.close(); });

test('全部页：有「全部 / 棋类 / 益智 / 休闲」分段，按分区展示全部 11 款', async () => {
  await openGames();
  const st = await tiles();
  await shot('01-all-sections');
  assert.deepEqual(st.tabs.map(t => t.id), ['all', 'board', 'puzzle', 'casual']);
  assert.deepEqual(st.tabs.map(t => t.name), ['全部', '棋类', '益智', '休闲']);
  assert.equal(st.tabs.find(t => t.on)?.id, 'all');
  assert.deepEqual(st.secs, ['棋类', '益智', '休闲']);
  assert.equal(st.count, 11, '全部页应有 11 款: ' + st.ids.join(','));
  assert.deepEqual(st.ids, ALL, '全部页应按 棋类→益智→休闲 排列: ' + st.ids.join(','));
  assert.deepEqual(st.hidden, [], '全部页在 390×844 一屏内应能看到全部游戏，被挡住的: ' + JSON.stringify(st.hidden) + ' navTop=' + st.navTop);
});

test('棋类：只显示五子棋、四子棋、黑白棋、中国象棋', async () => {
  await tapCat('board');
  const st = await tiles();
  await shot('02-board');
  assert.equal(st.tabs.find(t => t.on)?.id, 'board');
  assert.deepEqual(st.ids, BOARD);
  assert.deepEqual(st.secs, [], '分类页不再重复分区标题');
  assert.deepEqual(st.hidden, [], '棋类 4 款应全部可见');
});

test('益智：只显示扫雷、2048、24点、数独、纸牌接龙', async () => {
  await tapCat('puzzle');
  const st = await tiles();
  await shot('03-puzzle');
  assert.equal(st.tabs.find(t => t.on)?.id, 'puzzle');
  assert.deepEqual(st.ids, PUZZLE);
  assert.deepEqual(st.hidden, [], '益智 5 款应全部可见');
});

test('休闲：只显示贪吃蛇、盖楼；再切回全部仍是 11 款', async () => {
  await tapCat('casual');
  const st = await tiles();
  await shot('04-casual');
  assert.equal(st.tabs.find(t => t.on)?.id, 'casual');
  assert.deepEqual(st.ids, CASUAL);
  await tapCat('all');
  const back = await tiles();
  await shot('05-back-to-all');
  assert.equal(back.tabs.find(t => t.on)?.id, 'all');
  assert.deepEqual(back.ids, ALL);
});

test('点开游戏仍按需用 iframe 加载，且不钻到顶栏下面', async () => {
  if (!await page.locator('.gtile[data-v="mines"]').count()) await openGames();
  await tapCat('puzzle');
  await tapSel('.gtile[data-v="mines"]');
  await page.waitForSelector('iframe[data-game="mines"]', {timeout: 10000});
  const start = Date.now();
  let frame;
  while (Date.now() - start < 12000) {
    frame = page.frames().find(fr => (fr.url() || '').includes('/mines/'));
    if (frame) break;
    await wait(80);
  }
  assert.ok(frame, '应出现扫雷 iframe（按需加载）');
  try { await frame.waitForLoadState('domcontentloaded', {timeout: 8000}); } catch {}
  await wait(400);
  const g = await page.evaluate(() => {
    const top = document.querySelector('.pg.game-pg .top, #v .top');
    const iframe = document.querySelector('iframe[data-game="mines"]');
    if (!iframe) return null;
    const ir = iframe.getBoundingClientRect();
    const tr = top ? top.getBoundingClientRect() : {bottom: 0};
    return {iframeTop: ir.top, iframeHeight: ir.height, topBottom: tr.bottom, src: iframe.getAttribute('src')};
  });
  await shot('06-open-mines');
  assert.ok(g && g.iframeHeight > 120, '游戏区高度太小 ' + JSON.stringify(g));
  assert.ok(g.iframeTop >= g.topBottom - 1, '画面不应钻到顶栏下面 ' + JSON.stringify(g));
  assert.ok(/assets\/games\/mines\/index\.html/.test(g.src || ''), 'iframe 应按需指向这一款: ' + g.src);
  assert.deepEqual(page.errors, []);
});
