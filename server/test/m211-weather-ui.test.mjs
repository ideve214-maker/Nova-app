// 每日天气帖：真实服务器 + 无头 Chromium，CDP 触摸（iPhone 390×844）。
// 外网请求全部用假 fetch。截图：设置 WEATHER_SHOTS=<目录>。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {startServer, register, launch} from './ui-helpers.mjs';

const SHOTS = process.env.WEATHER_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, {recursive: true});
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const wait = ms => new Promise(r => setTimeout(r, ms));

const ENV = {NOVA_QWEATHER_HOST: 'abc.qweatherapi.com', NOVA_QWEATHER_KEY: 'test-key'};
const BEIJING = {id: '101010100', name: '北京', adm1: '北京市', adm2: '北京', country: '中国', lat: '39.90', lon: '116.41'};
const SHANGHAI = {id: '101020100', name: '上海', adm1: '上海市', adm2: '上海', country: '中国', lat: '31.23', lon: '121.47'};

function weatherFetch(url) {
  const u = String(url);
  if (u.includes('/geo/v2/city/lookup')) {
    const m = u.match(/[?&]location=([^&]+)/);
    const q = m ? decodeURIComponent(m[1]) : '';
    const list = /上海|121\.47/.test(q) ? [SHANGHAI] : [BEIJING];
    return {ok: true, status: 200, json: async () => ({code: '200', location: list})};
  }
  if (u.includes('/weather/v1/current/')) {
    const sh = /31\.23/.test(u);
    return {ok: true, status: 200, json: async () => ({
      validTime: '2026-11-19T15:00+08:00',
      condition: {code: 100, text: sh ? '多云' : '晴'},
      temperature: sh ? 22 : 18, feelsLike: sh ? 21 : 16, humidity: 0.4,
      wind: {scale: 2, direction: {compass: '北'}},
    })};
  }
  if (u.includes('/weather/v1/daily/')) {
    return {ok: true, status: 200, json: async () => ({days: [
      {forecastStartTime: '2026-11-19T00:00+08:00', temperatureMax: 20, temperatureMin: 8, daytime: {condition: {code: 100, text: '晴'}}},
      {forecastStartTime: '2026-11-20T00:00+08:00', temperatureMax: 19, temperatureMin: 9, daytime: {condition: {code: 101, text: '多云'}}},
    ]})};
  }
  return {ok: false, status: 404, json: async () => ({})};
}

const weatherOpts = {
  weatherFetch,
  weatherEnv: ENV,
  weatherIpLookup: {lookup: async () => null},
};

async function openHome(page, base) {
  await page.goto(base + '/');
  await page.waitForSelector('nav.fnav, #gate', {timeout: 15000});
  if (await page.locator('#gate').count()) {
    // session 丢失才需要重新登录；本测试会在 before 里注册
  }
  await page.waitForSelector('nav.fnav', {timeout: 15000});
  await page.evaluate(() => {
    S.tab = 'home'; S.st = []; S.sh = null;
    if (typeof render === 'function') render(true);
  });
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

test.before(async () => {
  S = await startServer(weatherOpts);
  browser = await launch();
  ctx = await browser.newContext({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: UA});
  page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e)));
  await page.goto(S.base + '/'); await page.waitForSelector('#gate');
  await register(page, 'wxui_1', 'wxui_1@qq.com');
  await page.waitForSelector('nav.fnav', {timeout: 15000});
  await wait(400);
  cdp = await ctx.newCDPSession(page);
});
test.after(async () => { await browser?.close(); await S?.close(); });

test('当天第一次打开：首页动态流顶部出现今日天气帖', async () => {
  await page.evaluate(() => { S.tab = 'home'; S.st = []; if (typeof render === 'function') render(true); });
  await page.waitForFunction(() => !!document.querySelector('article.wx-fcard'), {timeout: 10000});
  await wait(200);
  await shot('01-home-first-open');
  const info = await page.evaluate(() => {
    const card = document.querySelector('article.wx-fcard');
    const feed = card && card.parentElement;
    const firstPost = feed && [...feed.querySelectorAll('article.fcard')];
    const text = card ? card.innerText.replace(/\s+/g, ' ') : '';
    return {
      text,
      title: card && card.querySelector('.fn, b')?.innerText,
      hasLike: !!(card && card.querySelector('[data-a=like],[data-a=re],[data-a=rp],[data-a=sav],[data-a=cm]')),
      hasAttr: /和风天气/.test(text),
      hasAttrLink: !!(card && [...card.querySelectorAll('a')].some(a => /qweather\.com/.test(a.getAttribute('href') || ''))),
      firstIsWeather: !!(firstPost && firstPost[0] && firstPost[0].classList.contains('wx-fcard')),
      dismiss: !!(card && card.querySelector('[data-a=wxdismiss]')),
      shown: localStorage.getItem('nova_weather_shown_on'),
    };
  });
  assert.equal(info.title, '今日天气');
  assert.match(info.text, /北京|晴|18/);
  assert.ok(info.hasAttr, '应署名和风天气: ' + info.text);
  assert.ok(info.hasAttrLink, '应链接到和风天气');
  assert.equal(info.hasLike, false, '不应有点赞评论转帖');
  assert.ok(info.firstIsWeather, '应在动态流最上面');
  assert.ok(info.dismiss, '应有关闭按钮');
  assert.ok(info.shown, '应记下今天已显示');
});

test('点卡片打开天气详情，能搜城市', async () => {
  await tapLoc(page.locator('article.wx-fcard .fbd, article.wx-fcard [data-a=weather]').first());
  await page.waitForSelector('.wx-pg, #wxq', {timeout: 10000});
  await wait(200);
  await shot('02-weather-detail');
  const det = await page.evaluate(() => ({
    title: document.querySelector('.wx-pg h1, .top h1')?.innerText || '',
    body: document.body.innerText,
    attr: document.querySelector('.wx-attr')?.innerText || '',
  }));
  assert.match(det.title, /天气/);
  assert.match(det.body, /北京|18|晴/);
  assert.match(det.attr, /和风天气/);

  await page.fill('#wxq', '上海');
  await page.waitForSelector('.wx-city', {timeout: 8000});
  await tapLoc(page.locator('.wx-city').first());
  await page.waitForFunction(() => /上海/.test(document.body.innerText || ''), {timeout: 8000});
  await wait(200);
  await shot('03-weather-shanghai');
  const sh = await page.locator('.wx-loc, .wx-pg').first().innerText();
  assert.match(sh, /上海/);
});

test('同一天再打开：不再出现天气帖（会话关掉后）', async () => {
  const page2 = await ctx.newPage();
  page2.errors = [];
  page2.on('pageerror', e => page2.errors.push(String(e)));
  await page2.goto(S.base + '/');
  await page2.waitForSelector('nav.fnav, #gate', {timeout: 15000});
  if (await page2.locator('#gate').count()) {
    // 若 gate 还在，说明这个 context 的会话在内存里不在 localStorage；用已登录的 token 不太方便。
    // 同一 context 共享 localStorage；登录态若在 localStorage，应已进首页。
  }
  await page2.waitForSelector('nav.fnav', {timeout: 15000});
  await page2.waitForFunction(() => !document.getElementById('vxsplash'), {timeout: 8000}).catch(() => {});
  await page2.evaluate(() => {
    S.tab = 'home'; S.st = []; S.sh = null;
    if (S.wx) { S.wx.keepInFeed = false; S.wx.dismissed = false; }
    if (typeof render === 'function') render(true);
  });
  await wait(600);
  const shown = await page2.evaluate(() => ({
    date: localStorage.getItem('nova_weather_shown_on'),
    today: (typeof wxToday === 'function' ? wxToday() : null),
    card: !!document.querySelector('article.wx-fcard'),
  }));
  await page2.screenshot({path: SHOTS ? join(SHOTS, '04-second-open-same-day.png') : '/tmp/wx-second.png'}).catch(() => {});
  assert.ok(shown.date, '同一天应已有显示记录');
  assert.equal(shown.card, false, '同一天再次打开不应再出现: ' + JSON.stringify(shown));
  assert.deepEqual(page2.errors, []);
  await page2.close();
});

test('跨天再打开：天气帖会再出现', async () => {
  const page3 = await ctx.newPage();
  await page3.goto(S.base + '/');
  await page3.waitForSelector('nav.fnav', {timeout: 15000});
  await page3.waitForFunction(() => !document.getElementById('vxsplash'), {timeout: 8000}).catch(() => {});
  await page3.evaluate(() => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    const z = n => String(n).padStart(2, '0');
    localStorage.setItem('nova_weather_shown_on', d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()));
    S.tab = 'home'; S.st = []; S.sh = null;
    if (typeof S.wx === 'object') S.wx = null;
    if (typeof render === 'function') render(true);
  });
  await page3.waitForFunction(() => !!document.querySelector('article.wx-fcard'), {timeout: 10000});
  if (SHOTS) await page3.screenshot({path: join(SHOTS, '05-next-day.png')});
  const ok = await page3.evaluate(() => document.querySelector('article.wx-fcard .fn, article.wx-fcard b')?.innerText);
  assert.equal(ok, '今日天气');
  await page3.close();
});

test('没配密钥：首页不显示天气帖；社区页也没有天气入口', async () => {
  const S2 = await startServer({weatherEnv: {}, weatherFetch, weatherIpLookup: {lookup: async () => null}});
  const ctx2 = await browser.newContext({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: UA});
  const p2 = await ctx2.newPage();
  try {
    await p2.goto(S2.base + '/'); await p2.waitForSelector('#gate');
    await register(p2, 'wxui_nokey', 'wxui_nokey@qq.com');
    await p2.waitForSelector('nav.fnav', {timeout: 15000});
    await p2.evaluate(() => { S.tab = 'home'; S.st = []; if (typeof render === 'function') render(true); });
    await wait(800);
    const home = await p2.evaluate(() => !!document.querySelector('article.wx-fcard'));
    if (SHOTS) await p2.screenshot({path: join(SHOTS, '06-unkeyed-home.png')});
    assert.equal(home, false, '没配密钥时首页不应出现天气帖');
    await p2.evaluate(() => { S.tab = 'cm'; S.st = []; if (typeof A !== 'undefined' && A.tab) A.tab('cm'); else if (typeof render === 'function') render(true); });
    await wait(400);
    const cm = await p2.evaluate(() => ({
      tile: !!document.querySelector('[data-a=weather], .wx-fcard, .gmini-row [data-a=weather]'),
      text: /今日天气|天气卡片/.test(document.body.innerText || ''),
    }));
    if (SHOTS) await p2.screenshot({path: join(SHOTS, '07-unkeyed-community.png')});
    assert.equal(cm.tile, false, '社区页不应有天气入口');
  } finally {
    await ctx2.close();
    await S2.close();
  }
  assert.deepEqual(page.errors.filter(e => !/Failed to load resource/.test(e)), []);
});
