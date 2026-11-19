// 导入帖出现在首页：来源标记、原作者头像和名字、查看原帖、评论可见，可点赞/收藏/评论。点击作者不打开虚假主页。
// 截图：设置 IMPORT_SHOTS=<目录>。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {startServer, register, launch} from './ui-helpers.mjs';

const SHOTS = process.env.IMPORT_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, {recursive: true});
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const wait = ms => new Promise(r => setTimeout(r, ms));

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X89QAAAAASUVORK5CYII=',
  'base64',
);

function importFetch(url) {
  const u = String(url);
  if (u.includes('cdn.v2ex.com')) {
    return {ok: true, status: 200, headers: {get: k => k.toLowerCase() === 'content-type' ? 'image/png' : null}, arrayBuffer: async () => PNG};
  }
  if (u.includes('/api/topics/hot.json')) {
    return {ok: true, status: 200, json: async () => ([{
      id: 4242, title: '导入界面测试：V2EX 标题', url: 'https://www.v2ex.com/t/4242',
      content: '这是导入的 V2EX 正文，用来检查首页卡片。', created: Math.floor(Date.now() / 1000) - 60,
      member: {username: 'Livid', avatar_normal: 'https://cdn.v2ex.com/avatar.png'},
    }])};
  }
  if (u.includes('/api/replies/show.json')) {
    return {ok: true, status: 200, json: async () => ([
      {id: 77, content: '导入的第一条评论', created: Math.floor(Date.now() / 1000) - 30, member: {username: 'alice'}},
    ])};
  }
  if (u.includes('/v0/topstories.json')) {
    return {ok: true, status: 200, json: async () => [88001]};
  }
  if (u.includes('/v0/item/88001.json')) {
    return {ok: true, status: 200, json: async () => ({
      id: 88001, type: 'story', by: 'pg', title: 'Show HN: Import UI test',
      url: 'https://example.com/hn-ui', time: Math.floor(Date.now() / 1000) - 90, kids: [88002],
    })};
  }
  if (u.includes('/v0/item/88002.json')) {
    return {ok: true, status: 200, json: async () => ({
      id: 88002, type: 'comment', by: 'johndoe', text: 'HN imported comment', time: Math.floor(Date.now() / 1000) - 80, parent: 88001,
    })};
  }
  return {ok: false, status: 404, json: async () => ({})};
}

let S, browser, ctx, page, cdp, v2id, hnid;
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
async function goHome() {
  await page.evaluate(() => { S.tab = 'home'; S.st = []; S.sh = null; if (typeof render === 'function') render(true); });
  await page.waitForSelector('nav.fnav', {timeout: 10000});
  await wait(300);
}

test.before(async () => {
  S = await startServer({importFetch, importAuto: false, importDelayMs: 0});
  const run = await S.srv.importFeed.run();
  assert.equal(run.v2ex.ok, true, JSON.stringify(run));
  assert.equal(run.hn.ok, true, JSON.stringify(run));
  const rows = S.srv.db.prepare('SELECT id, source FROM posts WHERE source IS NOT NULL').all();
  v2id = rows.find(r => r.source === 'v2ex')?.id;
  hnid = rows.find(r => r.source === 'hn')?.id;
  assert.ok(v2id && hnid, '导入后应有 V2EX 和 HN 帖 ' + JSON.stringify(rows));

  browser = await launch();
  ctx = await browser.newContext({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: UA});
  page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e)));
  await page.goto(S.base + '/');
  await page.waitForSelector('#gate', {timeout: 15000});
  await register(page, 'impui', 'impui@qq.com');
  await page.waitForFunction(() => /导入界面测试：V2EX 标题|Show HN: Import UI test/.test(document.body.innerText || ''), {timeout: 15000});
  cdp = await ctx.newCDPSession(page);
  await wait(400);
});
test.after(async () => { await browser?.close(); await S?.close(); });

test('首页混排导入帖：来源标记、原作者、查看原帖；社区页没有热榜入口', async () => {
  await goHome();
  const info = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#v .fcard[data-src]')];
    return cards.map(el => ({
      src: el.getAttribute('data-src'),
      text: (el.innerText || '').replace(/\s+/g, ' ').trim(),
      label: !!el.querySelector('.srclbl'),
      link: !!(el.querySelector('[data-a=extlink]')),
      authorClick: (el.querySelector('.fhd [data-a=extauthor]') || {}).getAttribute?.('data-v') || '',
    }));
  });
  const v = info.find(c => c.src === 'v2ex');
  const h = info.find(c => c.src === 'hn');
  assert.ok(v, '首页有 V2EX 卡片 ' + JSON.stringify(info));
  assert.ok(h, '首页有 HN 卡片 ' + JSON.stringify(info));
  assert.ok(v.label && v.link, 'V2EX 有来源标记和查看原帖');
  assert.match(v.text, /来自 V2EX/);
  assert.match(v.text, /Livid/);
  assert.match(v.text, /查看原帖/);
  assert.match(v.authorClick, /^ext:v2ex:/);
  assert.ok(h.label && h.link);
  assert.match(h.text, /来自 HN/);
  assert.match(h.text, /pg/);
  assert.match(h.text, /Show HN: Import UI test/);
  await shot('01-home-imported-posts');

  await page.evaluate(() => { S.tab = 'cm'; S.st = []; S.sh = null; if (typeof render === 'function') render(true); });
  await wait(300);
  const cm = await page.evaluate(() => (document.body.innerText || ''));
  assert.ok(!/热榜/.test(cm), '社区页不应出现热榜入口');
  await shot('02-community-no-hot-tile');
  await goHome();
});

test('点击外部作者不打开主页；打开帖子能看到导入的评论；可点赞、收藏、评论', async () => {
  await goHome();
  const author = page.locator(`#v .fcard[data-src=v2ex] [data-a=extauthor]`).first();
  await tapLoc(author);
  await wait(400);
  const afterAuthor = await page.evaluate(() => ({
    stack: (S.st || []).slice(),
    tab: S.tab,
    text: (document.body.innerText || '').slice(0, 800),
  }));
  assert.ok(!(afterAuthor.stack || []).some(s => String(s).startsWith('user:')), '不应进入用户主页 ' + JSON.stringify(afterAuthor.stack));
  await shot('03-author-no-fake-profile');

  await tapLoc(page.locator(`#v .fcard[data-src=v2ex] .fbd, #v .fcard[data-src=v2ex] [data-a=post]`).first());
  await page.waitForFunction(() => /导入的第一条评论/.test(document.body.innerText || ''), {timeout: 10000});
  await shot('04-post-with-imported-comment');
  const onPost = await page.evaluate(() => (document.body.innerText || ''));
  assert.match(onPost, /alice/);
  assert.match(onPost, /导入的第一条评论/);
  assert.match(onPost, /来自 V2EX/);

  const pid = v2id;
  await tapLoc(page.locator(`[data-a=xlike][data-v="${pid}"]`).first());
  await page.waitForFunction(id => {
    const el = document.querySelector(`[data-a=xlike][data-v="${id}"]`);
    return el && el.classList.contains('on');
  }, pid, {timeout: 8000});
  await shot('05-liked');

  await tapLoc(page.locator(`[data-a=xbm][data-v="${pid}"]`).first());
  await page.waitForFunction(id => {
    const el = document.querySelector(`[data-a=xbm][data-v="${id}"]`);
    return el && el.classList.contains('on');
  }, pid, {timeout: 8000});
  await shot('06-favorited');

  const box = page.locator('textarea[data-d=cin]');
  if (await box.count()) {
    await box.fill('我来评一句');
    await wait(100);
    await tapLoc(page.locator('[data-a=cs]').first());
    await page.waitForFunction(() => /我来评一句/.test(document.body.innerText || ''), {timeout: 10000});
  } else {
    // 详情页评论框可能要用别的选择器，退到 API 已覆盖，这里再试聚焦
    await page.evaluate(() => {
      const i = document.querySelector('textarea[data-d=cin], #cbox textarea, textarea.cta');
      if (i) { i.focus(); i.value = '我来评一句'; i.dispatchEvent(new Event('input', {bubbles: true})); }
    });
    await wait(100);
    if (await page.locator('[data-a=cs]').count()) await tapLoc(page.locator('[data-a=cs]').first());
    await page.waitForFunction(() => /我来评一句/.test(document.body.innerText || ''), {timeout: 10000});
  }
  await shot('07-user-comment');
  assert.ok(!(page.errors || []).length, 'page errors: ' + (page.errors || []).join('; '));
});
