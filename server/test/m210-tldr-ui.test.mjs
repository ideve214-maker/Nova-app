// 命令速查（tldr-pages）：真实服务器 + 无头 Chromium，CDP 触摸（iPhone 390×844）。
// 服务器的外网请求全部用假 fetch，不访问 GitHub。截图：设置 TLDR_SHOTS=<目录>。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {startServer, register, launch} from './ui-helpers.mjs';

const SHOTS = process.env.TLDR_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, {recursive: true});
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const wait = ms => new Promise(r => setTimeout(r, ms));

const LS_ZH = `# ls

> 列出目录内容。

- 列出当前目录的文件：

  \`ls\`

- 列出全部文件，包括隐藏文件：

  \`ls -a\`
`;
const INDEX = {commands: [
  {name: 'ls', platform: ['common', 'linux'], language: ['en', 'zh']},
  {name: 'git', platform: ['common'], language: ['en', 'zh']},
  {name: 'curl', platform: ['common'], language: ['en']},
]};

function tldrFetch(url) {
  const u = String(url);
  if (u.includes('index.json')) {
    return {ok: true, status: 200, json: async () => INDEX, text: async () => JSON.stringify(INDEX)};
  }
  if (u.includes('pages.zh/common/ls.md') || u.endsWith('/pages.zh/common/ls.md')) {
    return {ok: true, status: 200, json: async () => ({}), text: async () => LS_ZH};
  }
  return {ok: false, status: 404, json: async () => ({}), text: async () => 'not found'};
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
  S = await startServer({tldrFetch});
  browser = await launch();
  ctx = await browser.newContext({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: UA});
  page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e)));
  await page.goto(S.base + '/'); await page.waitForSelector('#gate');
  await register(page, 'tldrui_1', 'tldrui_1@qq.com');
  await page.waitForSelector('nav.fnav', {timeout: 15000});
  await wait(400);
  cdp = await ctx.newCDPSession(page);
});
test.after(async () => { await browser?.close(); await S?.close(); });

test('社区页：命令速查入口和小游戏并排', async () => {
  await page.evaluate(() => { S.tab = 'cm'; S.st = []; if (typeof A !== 'undefined' && A.tab) A.tab('cm'); else if (typeof render === 'function') render(true); });
  await page.waitForSelector('[data-a=minigame], [data-a=tldr]', {timeout: 10000});
  await wait(300);
  const row = await page.evaluate(() => {
    const games = document.querySelector('[data-a=minigame]');
    const tldr = document.querySelector('[data-a=tldr]');
    const wrap = tldr && tldr.closest('.gmini-row');
    const gb = games && games.getBoundingClientRect();
    const tb = tldr && tldr.getBoundingClientRect();
    return {
      hasRow: !!(wrap && wrap.contains(games) && wrap.contains(tldr)),
      gamesText: games ? games.innerText.replace(/\s+/g, ' ') : '',
      tldrText: tldr ? tldr.innerText.replace(/\s+/g, ' ') : '',
      hasIcons: !!(games && games.querySelector('.gicons')),
      gamesH: gb && Math.round(gb.height),
      tldrH: tb && Math.round(tb.height),
      sideBySide: !!(gb && tb && Math.abs(gb.top - tb.top) < 20 && tb.left > gb.right - 2),
    };
  });
  await shot('01-community-entry');
  assert.ok(row.hasRow, '应在同一行里：小游戏和命令速查');
  assert.match(row.gamesText, /小游戏/);
  assert.match(row.gamesText, /点开就能玩/);
  assert.ok(!/点开就…/.test(row.gamesText), '简介不应被截断: ' + row.gamesText);
  assert.equal(row.hasIcons, false, '小游戏卡片不应再有一排小图标');
  assert.match(row.tldrText, /命令速查/);
  assert.ok(row.sideBySide, '两个入口应并排 ' + JSON.stringify(row));
  assert.ok(Math.abs((row.gamesH||0)-(row.tldrH||0))<=4, '两张卡片应大致同高 ' + JSON.stringify(row));
});

test('打开命令速查，能搜到 ls 并看到署名', async () => {
  if (!await page.locator('[data-a=tldr]').count()) {
    await page.evaluate(() => { S.tab = 'cm'; S.st = []; render(true); });
    await page.waitForSelector('[data-a=tldr]');
  }
  await tapLoc(page.locator('[data-a=tldr]').first());
  await page.waitForSelector('#tldrq, .tldr-list, .tldr-pg', {timeout: 10000});
  // 等目录加载
  await page.waitForFunction(() => document.querySelector('#tldrlist .tldr-item, .tldr-err, .tldr-list .tldr-item'), {timeout: 10000});
  await wait(200);
  await shot('02-tldr-index');
  const idx = await page.evaluate(() => ({
    title: document.querySelector('.tldr-pg h1, .top h1')?.innerText || '',
    names: [...document.querySelectorAll('#tldrlist .tldr-item b, .tldr-item b')].map(e => e.innerText),
    attr: document.querySelector('.tldr-attr')?.innerText || '',
    hrefs: [...document.querySelectorAll('.tldr-attr a')].map(a => a.getAttribute('href')),
  }));
  assert.match(idx.title, /命令速查/);
  assert.ok(idx.names.includes('ls'), '目录应含 ls: ' + idx.names.join(','));
  assert.match(idx.attr, /tldr-pages/);
  assert.match(idx.attr, /CC BY 4.0/);
  assert.ok(idx.hrefs.some(h => /tldr-pages\/tldr/.test(h || '')), '应链接到 tldr-pages 仓库');
});

test('点开 ls：中文说明、例子和原文链接', async () => {
  const item = page.locator('[data-a=tldrcmd][data-v=ls], .tldr-item[data-v=ls]').first();
  if (!await item.count()) {
    await page.fill('#tldrq', 'ls');
    await page.waitForSelector('[data-a=tldrcmd][data-v=ls]', {timeout: 8000});
  }
  await tapLoc(page.locator('[data-a=tldrcmd][data-v=ls]').first());
  await page.waitForSelector('.tldr-card, .tldr-ex', {timeout: 10000});
  await wait(200);
  await shot('03-tldr-ls');
  const card = await page.evaluate(() => ({
    title: document.querySelector('.tldr-card h2')?.innerText || '',
    desc: document.querySelector('.tldr-desc')?.innerText || '',
    codes: [...document.querySelectorAll('.tldr-ex code')].map(e => e.innerText),
    attr: document.querySelector('.tldr-card .tldr-attr, .tldr-attr')?.innerText || '',
    pageHref: [...document.querySelectorAll('.tldr-attr a')].map(a => a.getAttribute('href')),
  }));
  assert.equal(card.title, 'ls');
  assert.match(card.desc, /列出目录内容/);
  assert.ok(card.codes.includes('ls') && card.codes.includes('ls -a'), JSON.stringify(card.codes));
  assert.match(card.attr, /CC BY 4.0/);
  assert.ok(card.pageHref.some(h => /pages\.zh\/common\/ls\.md/.test(h || '')), '应链到中文原文 ' + card.pageHref.join(','));
});

test('找不到的命令会给出明确说明', async () => {
  await page.evaluate(async () => {
    S.st = ['tldr'];
    if (typeof loadTldrSearch === 'function') await loadTldrSearch('no-such-cmd-xyz');
    render(true);
  });
  await page.waitForFunction(() => /没有找到/.test(document.body.innerText || ''), null, {timeout: 8000});
  await shot('04-tldr-empty');
  const txt = await page.locator('.tldr-pg .em, .tldr-err').first().innerText();
  assert.match(txt, /没有找到/);
  assert.deepEqual(page.errors, []);
});
