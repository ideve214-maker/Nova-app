// 用户端 2.0.7：评论翻译（逐条 + 输入框「译」）、帖子分享（链接卡片 / 图片卡片）、正文图片链接显示成图片、
// 首页每 2 分钟自动刷新、外部帖发帖人与评论人头像。截图：设置 V207_SHOTS=<目录>。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {startServer, register, launch} from './ui-helpers.mjs';

const SHOTS = process.env.V207_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, {recursive: true});
const wait = ms => new Promise(r => setTimeout(r, ms));
const AVJ = readFileSync(new URL('../../assets/av-zhou.jpg', import.meta.url));
const now = () => Math.floor(Date.now() / 1000);
let BASE = '', extra = [];

function importFetch(url) {
  const u = String(url);
  if (u.includes('cdn.v2ex.com')) return {ok: true, status: 200, headers: {get: k => k.toLowerCase() === 'content-type' ? 'image/jpeg' : null}, arrayBuffer: async () => AVJ};
  if (u.includes('/api/topics/hot.json')) {
    return {ok: true, status: 200, json: async () => ([{
      id: 5001, title: '2.0.7 图片测试：V2EX 帖子', url: 'https://www.v2ex.com/t/5001', created: now() - 60,
      content: `看看这张图：\n![截图](${BASE}/assets/bg-river.jpg)\n还有一张直链 ${BASE}/assets/av-me.jpg 结束。`,
      member: {username: 'Livid', avatar_normal: 'https://cdn.v2ex.com/avatar/livid.png'},
    }, ...extra])};
  }
  if (u.includes('/api/replies/show.json')) {
    return {ok: true, status: 200, json: async () => ([
      {id: 91, content: 'This is a really useful idea, thanks for sharing!', created: now() - 30, member: {username: 'alice', avatar_normal: 'https://cdn.v2ex.com/avatar/alice.png'}},
      {id: 92, content: '没有头像的评论人', created: now() - 20, member: {username: 'bob'}},
    ])};
  }
  if (u.includes('/v0/topstories.json')) return {ok: true, status: 200, json: async () => [99001]};
  if (u.includes('/v0/item/99001.json')) return {ok: true, status: 200, json: async () => ({id: 99001, type: 'story', by: 'pg', title: 'Show HN: avatar test', url: 'https://example.com/x', time: now() - 90, kids: [99002]})};
  if (u.includes('/v0/item/99002.json')) return {ok: true, status: 200, json: async () => ({id: 99002, type: 'comment', by: 'johndoe', text: 'HN comment', time: now() - 80, parent: 99001})};
  return {ok: false, status: 404, json: async () => ({})};
}
const AI = {calls: []};
async function aiFetch(url, opts) {
  const body = JSON.parse(opts.body);
  const sys = body.messages[0].content, user = body.messages[body.messages.length - 1].content;
  AI.calls.push({sys, user});
  const reply = c => new Response(JSON.stringify({choices: [{message: {content: c}}]}), {status: 200, headers: {'Content-Type': 'application/json'}});
  if (/内容审核员/.test(sys)) return reply('{"verdict":"allow","category":"","reason":""}');
  if (/translator/.test(sys)) return reply(/English/.test(sys) ? 'This feature is great, thank you!' : '这个想法很有用，谢谢分享！');
  return reply('?');
}

let S, browser, page, v2id;
const shot = async name => { if (SHOTS) await page.screenshot({path: join(SHOTS, name + '.png')}); };
const act = (a, v) => page.evaluate(([a, v]) => { const r = A[a](v); return Promise.resolve(r).then(() => render()); }, [a, v]);
async function goHome() {
  await page.evaluate(() => { S.tab = 'home'; S.st = []; S.sh = null; render(true); document.querySelector('#v .pg.home > .sc')?.scrollTo(0, 0); });
  await page.waitForSelector('nav.fnav');
  await wait(300);
}

test.before(async () => {
  S = await startServer({importFetch, importAuto: false, importDelayMs: 0, aiEnv: {ZHIPU_API_KEY: 'test-key', AI_ASSIST_RPM: '1000'}, aiFetch});
  BASE = S.base;
  const run = await S.srv.importFeed.run();
  assert.equal(run.v2ex.ok, true, JSON.stringify(run));
  v2id = S.srv.db.prepare("SELECT id FROM posts WHERE source='v2ex'").get().id;
  browser = await launch();
  const ctx = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 2});
  page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e)));
  // App 里页面不在服务器域名下：显式设置 API 根，检查外部头像的相对地址会被补全
  await page.addInitScript(b => { window.NOVA_API_BASE = b; }, S.base);
  await page.goto(S.base + '/');
  await page.waitForSelector('#gate', {timeout: 15000});
  await register(page, 'v207ui', 'v207ui@qq.com');
  await page.waitForFunction(() => /2\.0\.7 图片测试/.test(document.body.innerText || ''), {timeout: 15000});
});
test.after(async () => { await browser?.close(); await S?.close(); });

test('txSplit：Markdown 图片和图片直链拆出来，普通链接放进链接卡片', async () => {
  const r = await page.evaluate(() => [
    txSplit('a ![x](https://i.imgur.com/abc.png) b'),
    txSplit('看 https://example.com/a.JPG?x=1，和 https://example.com/page'),
    txSplit('label (https://cdn.v2ex.com/x/y.gif)'),
    txSplit('纯文字'),
  ]);
  assert.deepEqual(r[0].imgs, ['https://i.imgur.com/abc.png']); assert.equal(r[0].t, 'a  b');
  assert.deepEqual(r[1].imgs, ['https://example.com/a.JPG?x=1']); assert.doesNotMatch(r[1].t, /https:\/\/example\.com\/page/); assert.deepEqual(r[1].links, ['https://example.com/page']);
  assert.deepEqual(r[2].imgs, ['https://cdn.v2ex.com/x/y.gif']); assert.equal(r[2].t, 'label');
  assert.deepEqual(r[3], {t: '纯文字', imgs: []});
});

test('外部帖正文里的图片链接显示成图片；发帖人头像（代理图片 / 首字母）', async () => {
  await goHome();
  await page.locator('#v .fcard[data-src=v2ex]').first().scrollIntoViewIfNeeded();
  await page.waitForFunction(() => [...document.querySelectorAll('#v .fcard[data-src=v2ex] .fmedia img')].filter(i => i.complete && i.naturalWidth > 0).length >= 2, {timeout: 10000});
  const info = await page.evaluate(() => {
    const c = document.querySelector('#v .fcard[data-src=v2ex]'), h = document.querySelector('#v .fcard[data-src=hn]');
    const av = c.querySelector('.fhd .av img'), hav = h.querySelector('.fhd .av img');
    return {body: c.querySelector('.fbd').innerText, imgs: [...c.querySelectorAll('.fmedia img')].map(i => i.getAttribute('src')),
      av: av.getAttribute('src'), avOk: av.naturalWidth > 0, hav: hav.getAttribute('src'), havOk: hav.naturalWidth > 0};
  });
  assert.equal(info.imgs.length, 2, JSON.stringify(info));
  assert.ok(!/\]\(|vexo-v\.png|vexo-lockup\.png/.test(info.body), '正文不应再显示图片链接 ' + info.body);
  assert.ok(info.av.startsWith(S.base + '/api/import/avatar'), '相对头像地址按 API 根补全 ' + info.av);
  assert.ok(info.avOk, 'V2EX 头像加载成功');
  assert.match(info.hav, /^data:image\/svg/); assert.ok(info.havOk, 'HN 首字母头像');
  await page.locator('#v .fcard[data-src=v2ex]').first().screenshot({path: SHOTS ? join(SHOTS, '03-image-links-in-post.png') : undefined}).catch(() => {});
  await shot('05a-home-external-avatars');
});

test('评论人头像；评论逐条翻译（英→中）；输入框「译」中→英后发送', async () => {
  await act('post', v2id);
  await page.waitForFunction(() => /This is a really useful idea/.test(document.body.innerText || ''), {timeout: 10000});
  await wait(300);
  const avs = await page.evaluate(() => [...document.querySelectorAll('#cbox .cm')].map(c => { const i = c.querySelector('.av img'); return {t: c.innerText.slice(0, 30), src: i && i.getAttribute('src'), ok: !!(i && i.naturalWidth > 0)}; }));
  const alice = avs.find(a => /alice/.test(a.t)), bob = avs.find(a => /bob/.test(a.t));
  assert.ok(alice && alice.ok && alice.src.includes('/api/import/avatar'), JSON.stringify(avs));
  assert.ok(bob && bob.ok && /^data:image\/svg/.test(bob.src), JSON.stringify(avs));
  await shot('05b-comment-avatars');

  const btn = page.locator('#cbox .cm', {hasText: 'This is a really useful idea'}).locator('[data-a=trc]');
  assert.equal(await btn.innerText(), '翻译');
  await btn.click();
  await page.waitForFunction(() => /这个想法很有用，谢谢分享/.test(document.querySelector('#cbox')?.innerText || ''), {timeout: 10000});
  assert.ok(AI.calls.some(c => /Simplified Chinese/.test(c.sys) && /really useful idea/.test(c.user)), '走 /api/ai/translate，自动翻成中文');
  assert.equal(await btn.innerText(), '隐藏翻译');
  await shot('01a-comment-translate-en-zh');

  await page.fill('[data-d=cin]', '这个功能很棒，谢谢！');
  await page.click('[data-a=trcin]');
  await page.waitForFunction(() => S.d.cin === 'This feature is great, thank you!', {timeout: 10000});
  await page.waitForFunction(() => document.querySelector('[data-d=cin]').value === 'This feature is great, thank you!');
  assert.ok(AI.calls.some(c => /English/.test(c.sys) && /这个功能很棒/.test(c.user)), '中文草稿翻成英文');
  await shot('01b-comment-input-zh-en');
  assert.equal(await page.locator('[data-for=cin]').isDisabled(), false);
  await page.click('[data-for=cin]');
  await page.waitForFunction(() => /This feature is great, thank you!/.test(document.querySelector('#cbox')?.innerText || ''), {timeout: 10000});
});

test('分享：链接卡片标题 + 图片卡片', async () => {
  await wait(2300);
  await act('xshare', v2id);
  await page.waitForSelector('[data-a=xposter]');
  const sheet = await page.evaluate(() => document.querySelector('.shcard')?.innerText || '');
  assert.match(sheet, /2\.0\.7 图片测试：V2EX 帖子 · VEXO/);
  assert.match(sheet, /Livid · 来自 V2EX/);
  // 服务端没有声明 features.postSharePage 时沿用原来的帖子链接
  assert.match(await page.evaluate(id => postShareLink(id), v2id), /#\/post\//);
  await shot('02a-share-sheet');
  await page.click('[data-a=xposter]');
  await page.waitForFunction(() => { const i = document.querySelector('img.shposter'); return i && i.complete && i.naturalWidth === 1080; }, {timeout: 15000});
  await shot('02b-share-poster');
  if (SHOTS) await page.locator('img.shposter').screenshot({path: join(SHOTS, '02c-share-poster-image.png')});
  await page.evaluate(() => { S.sh = null; render(); });
});

test('首页每 2 分钟自动刷新：默认 120 秒；在顶部时直接换上新帖', async () => {
  assert.equal(await page.evaluate(() => FEED_AUTO_MS), 120000);
  await goHome();
  const before = await page.evaluate(() => (S.posts || []).length);
  extra = Array.from({length: 19}, (_, i) => ({id: 6000 + i, title: '自动刷新新帖 ' + (i + 1), url: 'https://www.v2ex.com/t/' + (6000 + i), content: '内容 ' + i, created: now() - i, member: {username: 'u' + i}}));
  const run = await S.srv.importFeed.run();
  assert.ok(run.v2ex.imported >= 19, JSON.stringify(run.v2ex));
  await page.evaluate(() => feedAutoTick());
  // 在顶部：直接换上；已经往下滑：顶部出现「有 N 条新动态」，点了再换上（不打断阅读）
  await page.waitForFunction(n => (S.posts || []).length >= n + 19 || (S.feedPending && S.feedPending.n >= 19), before, {timeout: 10000});
  if (await page.evaluate(() => !!S.feedPending)) {
    await page.waitForSelector('.newpill');
    assert.match(await page.locator('.newpill').innerText(), /有 19 条新动态/);
    await shot('04a-feed-auto-refresh-pill');
    await page.click('.newpill');
  }
  await page.waitForFunction(n => (S.posts || []).length >= n + 19 && /自动刷新新帖/.test(document.body.innerText || ''), before, {timeout: 10000});
  await shot('04b-feed-auto-refresh-new-posts');
  assert.deepEqual(page.errors, []);
});
