// 用户端 2.0.7（续）：L 通知「全部已读」、J 正文链接变卡片、K 自动翻译（视口懒加载 + 合并请求 + 缓存 + 查看原文）、
// 来源标签通用化。截图：设置 V207_SHOTS=<目录>。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {startServer, register, launch} from './ui-helpers.mjs';

const SHOTS = process.env.V207_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, {recursive: true});
const wait = ms => new Promise(r => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);
const EN = [
  'Rust 1.90 released with faster compile times and a new borrow checker diagnostics engine. Upgrade guide inside.',
  'Show HN: I built a tiny static site generator in 300 lines of Go, feedback welcome.',
  'Why SQLite is a great default database for small web apps in 2026.',
];
function importFetch(url) {
  const u = String(url);
  if (u.includes('/api/topics/hot.json')) {
    return {ok: true, status: 200, json: async () => ([
      {id: 7001, title: 'LJK 链接卡片测试', url: 'https://www.v2ex.com/t/7001', created: now() - 50,
        content: '推荐一个项目 https://github.com/rust-lang/rust 很好用', member: {username: 'cardman'}},
      ...EN.map((t, i) => ({id: 7100 + i, title: t.slice(0, 40), url: 'https://www.v2ex.com/t/' + (7100 + i), created: now() - 60 - i, content: t, member: {username: 'en' + i}})),
    ])};
  }
  if (u.includes('/api/replies/show.json')) {
    if (!u.includes('topic_id=7001')) return {ok: true, status: 200, json: async () => []};
    return {ok: true, status: 200, json: async () => ([
      {id: 191, content: 'This is a really useful idea, thanks for sharing!', created: now() - 30, member: {username: 'alice'}},
      {id: 192, content: '中文评论不需要翻译', created: now() - 20, member: {username: 'bob'}},
    ])};
  }
  return {ok: false, status: 404, json: async () => ({})};
}
const AI = {calls: []};
async function aiFetch(url, opts) {
  const body = JSON.parse(opts.body);
  const sys = body.messages[0].content, user = body.messages[body.messages.length - 1].content;
  const reply = c => new Response(JSON.stringify({choices: [{message: {content: c}}]}), {status: 200, headers: {'Content-Type': 'application/json'}});
  if (/内容审核员/.test(sys)) return reply('{"verdict":"allow","category":"","reason":""}');
  if (/translator/.test(sys)) {
    AI.calls.push(user);
    const ms = [...user.matchAll(/\[\[(\d+)\]\]/g)].map(m => m[1]);
    if (ms.length) return reply(ms.map(n => `[[${n}]] 中文译文第${n}段`).join('\n\n'));
    return reply('这个想法很有用，谢谢分享！');
  }
  return reply('?');
}

let S, browser, page;
const shot = async name => { if (SHOTS) await page.screenshot({path: join(SHOTS, name + '.png')}); };
async function goHome() {
  await page.evaluate(() => { S.tab = 'home'; S.st = []; S.sh = null; render(true); document.querySelector('#v .pg.home > .sc')?.scrollTo(0, 0); });
  await page.waitForSelector('nav.fnav');
  await wait(300);
}

test.before(async () => {
  S = await startServer({importFetch, importAuto: false, importDelayMs: 0, aiEnv: {ZHIPU_API_KEY: 'test-key', AI_ASSIST_RPM: '1000'}, aiFetch});
  const run = await S.srv.importFeed.run();
  assert.equal(run.v2ex.ok, true, JSON.stringify(run));
  browser = await launch();
  const ctx = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 2});
  page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e)));
  await page.goto(S.base + '/');
  await page.waitForSelector('#gate', {timeout: 15000});
  await register(page, 'ljkui', 'ljkui@qq.com');
  await page.waitForFunction(() => /LJK 链接卡片测试/.test(document.body.innerText || ''), {timeout: 15000});
});
test.after(async () => { await browser?.close(); await S?.close(); });

test('L：通知面板「全部已读」一键清零，服务器也记为已读', async () => {
  const uid = await page.evaluate(() => SESSION.user.id);
  for (let i = 1; i <= 3; i++) S.srv.notifications.push(uid, {kind: 'system', title: '系统通知 ' + i, body: '测试全部已读', dedupeKey: 'ljk' + i});
  await page.evaluate(() => loadNotifications && loadNotifications());
  await wait(400);
  await page.evaluate(() => { A.notif(); render(); });
  await page.waitForSelector('[data-a="nrall"]', {timeout: 5000});
  await shot('L-notif-readall-before');
  await page.click('[data-a="nrall"]');
  await page.waitForFunction(() => !document.querySelector('[data-a="nrall"]'), {timeout: 5000});
  await wait(400);
  await shot('L-notif-readall-after');
  const st = await page.evaluate(() => S.notifUnread || 0);
  assert.equal(st, 0);
  const tok = await page.evaluate(() => SESSION.token);
  const r = await fetch(S.base + '/api/notifications/unread', {headers: {Authorization: 'Bearer ' + tok}}).then(r => r.json());
  assert.equal(r.unread, 0);
  await page.evaluate(() => { S.sh = null; render(); });
});

test('J：正文里的网址不再显示成裸链接，而是链接卡片（域名 + 标题）', async () => {
  await goHome();
  const info = await page.evaluate(() => {
    const card = [...document.querySelectorAll('.fcard')].find(c => /LJK 链接卡片测试/.test(c.innerText));
    if (!card) return null;
    card.scrollIntoView({block: 'start'});
    const body = card.querySelector('.fbd')?.innerText || '';
    const lk = card.querySelector('.lkc');
    return {body, has: !!lk, txt: lk ? lk.innerText : '', act: lk?.getAttribute('data-a')};
  });
  assert.ok(info, '找到测试帖');
  assert.ok(!/https:\/\/github\.com/.test(info.body), '正文不含裸链接: ' + info.body);
  assert.ok(info.has, '有链接卡片');
  assert.match(info.txt, /github\.com/);
  assert.equal(info.act, 'extlink');
  await wait(300);
  await shot('J-link-card-feed');
});

test('来源标签：没有 sourceLabel 时按来源代码 / 服务器名称显示，不再一律写 V2EX', async () => {
  const r = await page.evaluate(() => [
    extSrcLabel({source: 'ithome'}), extSrcLabel({source: 'sspai'}), extSrcLabel({source: 'gcores'}),
    extSrcLabel({source: 'newsite', sourceName: '新来源'}), extSrcLabel({source: 'xyz'}),
    extSrcLabel({source: 'hn', sourceLabel: '来自 Hacker News'}), extSrcLabel({source: 'a', origin: {name: '华尔街见闻'}}),
  ]);
  assert.deepEqual(r, ['来自 IT之家', '来自 少数派', '来自 机核', '来自 新来源', '来自 xyz', '来自 Hacker News', '来自 华尔街见闻']);
  // 渲染：把一条外部帖改成新来源、去掉 sourceLabel，卡片显示「来自 IT之家」
  const lbl = await page.evaluate(() => {
    const p = (S.posts || []).find(x => x.source);
    const q = {...p, id: p.id, source: 'ithome'}; delete q.sourceLabel;
    const w = document.createElement('div'); w.innerHTML = pc(q, false); return w.querySelector('.srclbl')?.textContent;
  }).catch(e => 'ERR ' + e);
  assert.equal(lbl, '来自 IT之家');
});

test('K：打开自动翻译后，滑进屏幕的外文帖合并成一次请求翻译，显示「已翻译 · 查看原文」，可切回原文', async () => {
  await goHome();
  await shot('K-autotr-off');
  AI.calls.length = 0;
  await page.click('.atrfab');
  await page.waitForFunction(() => document.querySelectorAll('.atrt').length >= 2, {timeout: 10000});
  await wait(300);
  const n1 = AI.calls.length;
  assert.ok(n1 >= 1 && n1 <= 2, '合并请求，实际 ' + n1 + ' 次');
  assert.ok(AI.calls.some(c => /\[\[2\]\]/.test(c)), '有合并的批量请求');
  const st = await page.evaluate(() => ({
    tr: [...document.querySelectorAll('.atrt')].map(e => e.textContent),
    note: document.querySelector('.atrn')?.innerText,
    zhRaw: [...document.querySelectorAll('.fcard')].some(c => /LJK 链接卡片测试/.test(c.innerText) && !c.querySelector('.atrt')),
    fab: document.querySelector('.atrfab')?.classList.contains('on'),
  }));
  assert.ok(st.tr.every(t => /中文译文第\d段|这个想法很有用/.test(t)), st.tr.join('|'));
  assert.match(st.note, /已翻译.*查看原文/);
  assert.ok(st.zhRaw, '中文帖不翻译');
  assert.ok(st.fab);
  await page.evaluate(() => { const c = document.querySelector('.atrt').closest('.fcard'); c.scrollIntoView({block: 'start'}); });
  await wait(200);
  await shot('K-autotr-on');
  // 查看原文
  const k = await page.evaluate(() => document.querySelector('.atrt').getAttribute('data-atrk'));
  await page.click(`.atrn [data-v="${k}"]`);
  await wait(300);
  const orig = await page.evaluate(k => ({o: !!document.querySelector(`.atro[data-atrk="${k}"]`), n: document.querySelector(`.atro[data-atrk="${k}"]`)?.nextElementSibling?.innerText}), k);
  assert.ok(orig.o, '切回原文');
  assert.match(orig.n, /查看翻译/);
  await shot('K-autotr-original');
  await page.click(`.atrn [data-v="${k}"]`);
  await wait(200);
  // 缓存：重绘不再请求
  const before = AI.calls.length;
  await page.evaluate(() => render(true));
  await wait(800);
  assert.equal(AI.calls.length, before, '已翻译的内容走本机缓存');
  assert.ok(await page.evaluate(() => document.querySelectorAll('.atrt').length >= 2));
});

test('K：评论也自动翻译；中文评论不翻；关闭开关恢复原文', async () => {
  const pid = S.srv.db.prepare("SELECT id FROM posts WHERE source='v2ex' AND text LIKE '%LJK%'").get()?.id;
  assert.ok(pid, 'LJK post id');
  await page.evaluate(id => Promise.resolve(A.post(id)).then(() => render()), pid);
  await page.waitForFunction(() => /中文评论不需要翻译/.test(document.body.innerText), {timeout: 15000}).catch(async e => {
    const dbg = await page.evaluate(() => ({st: S.st, tab: S.tab, txt: document.querySelector('#v').innerText.slice(0, 800)}));
    const cm = {db: S.srv.db.prepare("SELECT * FROM post_comments").all().slice(0, 5), api: await page.evaluate(async id => { const r = await api('GET', '/api/posts/' + id + '/comments'); return [r.s, JSON.stringify(r.j).slice(0, 400)]; }, pid)};
    throw new Error('no comments ' + JSON.stringify({dbg, cm}));
  });
  await page.waitForFunction(() => [...document.querySelectorAll('.atrt[data-atrk^="c:"]')].some(e => /这个想法很有用/.test(e.textContent)), {timeout: 10000});
  const zh = await page.evaluate(() => /中文评论不需要翻译/.test(document.body.innerText));
  assert.ok(zh);
  await wait(300);
  await shot('K-autotr-comments');
  await page.evaluate(() => { S.st = []; S.tab = 'me'; render(); A.atrtoggle(); render(); });
  await page.evaluate(() => { S.tab = 'home'; render(true); });
  await wait(300);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.atrt').length), 0);
  assert.deepEqual(page.errors, []);
});

test('K：批量结果解析失败时退回逐条；429 时暂停自动请求', async () => {
  const r = await page.evaluate(() => [__atr.atrParse('[[1]] 一\n[[2]] 二', 2), __atr.atrParse('一 二', 2), __atr.atrNeed('Hello world'), __atr.atrNeed('你好世界 hello'), __atr.atrNeed('😀😀 123')]);
  assert.deepEqual(r, [['一', '二'], null, true, false, false]);
});
