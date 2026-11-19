// 热榜：真实服务器 + 无头 Chromium，CDP 触摸（iPhone 390×844）。
// 官方接口全部用假 fetch，不访问外网。截图：设置 HOT_SHOTS=<目录>。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {startServer, register, launch} from './ui-helpers.mjs';

const SHOTS = process.env.HOT_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, {recursive: true});
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const wait = ms => new Promise(r => setTimeout(r, ms));

const V2EX = [
  {id: 88001, title: 'V2EX 热议：如何学习 Rust', url: 'https://www.v2ex.com/t/88001', replies: 128, member: {username: 'alice'}, created: 1700000000, content: 'SECRET_BODY_V2EX'},
  {id: 88002, title: '分享一套家用键盘', url: 'https://www.v2ex.com/t/88002', replies: 36, member: {username: 'bob'}, created: 1700001000, content: 'nope'},
];
const HN_TOP = [77001, 77002];
const HN_ITEMS = {
  77001: {id: 77001, title: 'Show HN: A tiny SQLite trick', url: 'https://example.com/hn-sqlite', by: 'pg', score: 512, time: 1700002000, text: 'SECRET_BODY_HN'},
  77002: {id: 77002, title: 'Ask HN: What are you working on?', by: 'dang', score: 90, time: 1700003000},
};

function hotFetch(url) {
  const u = String(url);
  if (u.includes('/api/topics/hot.json')) return {ok: true, status: 200, json: async () => V2EX};
  if (u.includes('/v0/topstories.json')) return {ok: true, status: 200, json: async () => HN_TOP};
  const m = u.match(/\/v0\/item\/(\d+)\.json/);
  if (m && HN_ITEMS[m[1]]) return {ok: true, status: 200, json: async () => HN_ITEMS[m[1]]};
  return {ok: false, status: 404, json: async () => ({})};
}

let S, browser, ctx, page, cdp;
const shot = async name => { if (SHOTS) await page.screenshot({path: join(SHOTS, name + '.png')}); };
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {type, touchPoints: type === 'touchEnd' ? [] : [{x, y, id: 1}]});
async function tapLoc(loc) {
  await loc.waitFor({state: 'attached', timeout: 10000});
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  await wait(150);
  const box = await loc.boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0, '找不到可点元素 ' + JSON.stringify(box));
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await touch('touchStart', x, y); await wait(40); await touch('touchEnd');
}
async function hideSplash() {
  await page.waitForFunction(() => !document.getElementById('vxsplash') || document.getElementById('vxsplash').classList.contains('out'), {timeout: 8000}).catch(() => {});
  await page.evaluate(() => { const el = document.getElementById('vxsplash'); if (el) el.remove(); });
}

test.before(async () => {
  S = await startServer({hotFetch, hotItemDelay: 0, hotInterval: 60 * 60 * 1000, scheduleAuto: false, hotAuto: false});
  browser = await launch();
  ctx = await browser.newContext({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: UA});
  page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e)));
  await page.goto(S.base + '/'); await page.waitForSelector('#gate');
  await register(page, 'hotui_1', 'hotui_1@qq.com');
  await page.waitForSelector('nav.fnav', {timeout: 15000});
  await hideSplash();
  await wait(400);
  cdp = await ctx.newCDPSession(page);
});
test.after(async () => { await browser?.close(); await S?.close(); });

test('社区页：热榜入口和小游戏并排，没有那排小图标', async () => {
  await tapLoc(page.locator('nav.fnav [data-a=tab][data-v=cm], nav [data-a=tab][data-v=cm]').first());
  await page.waitForSelector('[data-a=hot]', {timeout: 10000});
  await wait(300);
  const row = await page.evaluate(() => {
    const games = document.querySelector('[data-a=minigame]');
    const hot = document.querySelector('[data-a=hot]');
    const wrap = hot && hot.closest('.gmini-row');
    const gb = games && games.getBoundingClientRect();
    const hb = hot && hot.getBoundingClientRect();
    return {
      hasRow: !!(wrap && wrap.contains(games) && wrap.contains(hot)),
      gamesText: games ? games.innerText.replace(/\s+/g, ' ') : '',
      hotText: hot ? hot.innerText.replace(/\s+/g, ' ') : '',
      hasIcons: !!(games && games.querySelector('.gicons')),
      gamesH: gb && Math.round(gb.height),
      hotH: hb && Math.round(hb.height),
    };
  });
  assert.equal(row.hasRow, true, JSON.stringify(row));
  assert.match(row.hotText, /热榜/);
  assert.match(row.hotText, /V2EX|Hacker News|热门/);
  assert.equal(row.hasIcons, false);
  assert.ok(!/点开就/.test(row.gamesText) || /点开就能玩/.test(row.gamesText));
  assert.ok(!row.gamesText.includes('不用下载'));
  if (row.gamesH && row.hotH) assert.ok(Math.abs(row.gamesH - row.hotH) <= 16, '卡片高度差过大 ' + JSON.stringify(row));
  await shot('01-community-tiles');
});

test('点开热榜：V2EX 列表有标题热度作者和原帖链接，没有正文', async () => {
  if (!await page.locator('[data-a=hot]').count()) {
    await tapLoc(page.locator('nav.fnav [data-a=tab][data-v=cm]').first());
    await page.waitForSelector('[data-a=hot]');
  }
  await tapLoc(page.locator('[data-a=hot]'));
  await page.waitForSelector('.hot-item', {timeout: 10000});
  await wait(300);
  const info = await page.evaluate(() => {
    const text = (document.querySelector('.hot-pg') || document.body).innerText;
    const items = [...document.querySelectorAll('.hot-item')].map(el => ({
      title: (el.querySelector('.hot-title') || el).textContent.trim(),
      href: (el.querySelector('.hot-title, .hot-orig') || {}).href || '',
      meta: (el.querySelector('.hot-meta') || {}).textContent || '',
    }));
    const src = document.querySelector('.hot-src a');
    const attr = (document.querySelector('.hot-attr') || {}).innerText || '';
    const on = (document.querySelector('.seg [data-a=hotseg].on') || {}).dataset?.v;
    return {text, items, src: src && {label: src.textContent, href: src.href}, attr, on};
  });
  assert.equal(info.on, 'v2ex');
  assert.ok(info.items.length >= 2, JSON.stringify(info.items));
  assert.equal(info.items[0].title, 'V2EX 热议：如何学习 Rust');
  assert.ok(info.items[0].href.includes('v2ex.com/t/88001'));
  assert.match(info.items[0].meta, /128/);
  assert.match(info.items[0].meta, /alice/);
  assert.ok(!info.text.includes('SECRET_BODY'));
  assert.equal(info.src && info.src.label, 'V2EX');
  assert.ok(info.src && info.src.href.includes('v2ex.com'));
  assert.match(info.attr, /mofish|官方/);
  await shot('02-v2ex-list');
});

test('Hacker News 标签：标题保持英文，并链到原帖', async () => {
  await tapLoc(page.locator('[data-a=hotseg][data-v=hn]'));
  await page.waitForFunction(() => document.querySelector('.hot-item .hot-title') && /Show HN|Ask HN/.test(document.querySelector('.hot-item .hot-title').textContent), {timeout: 10000});
  await wait(250);
  const info = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.hot-item')].map(el => ({
      title: el.querySelector('.hot-title')?.textContent.trim(),
      href: el.querySelector('.hot-title')?.href,
      meta: el.querySelector('.hot-meta')?.textContent || '',
    }));
    const text = (document.querySelector('.hot-pg') || document.body).innerText;
    const on = document.querySelector('.seg [data-a=hotseg].on')?.dataset?.v;
    const src = document.querySelector('.hot-src a');
    return {items, text, on, src: src && {label: src.textContent, href: src.href}};
  });
  assert.equal(info.on, 'hn');
  assert.equal(info.items[0].title, 'Show HN: A tiny SQLite trick');
  assert.ok(info.items[0].href.includes('example.com/hn-sqlite'));
  assert.ok(info.items.some(i => i.title === 'Ask HN: What are you working on?'));
  const ask = info.items.find(i => i.title.startsWith('Ask HN'));
  assert.ok(ask.href.includes('news.ycombinator.com/item?id=77002'));
  assert.ok(!info.text.includes('SECRET_BODY_HN'));
  assert.equal(info.src && info.src.label, 'Hacker News');
  await shot('03-hn-list');
});
