// AI 官方内部账号（Cc）：建号、身份标识、计数、通知、只进公开小组、不私聊、推流开关、来源限制、RSS 解析、防照抄、日志分页、头像路径、紧急停止。
// 模型和 RSS 全部用本地假实现，不访问外网。头像用真实 DiceBear + sharp 本地生成（不联网）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';
import {createAiPersonas, DEFAULT_SETTINGS, PERSONA_BADGE, avatarPathOf, AVATAR_ROUTE_RE} from '../ai-personas.mjs';
import {parseFeed, cleanUrl, toSimplified, overlapRatio, composePost, politicsAllowed, postCategoryOf, POST_CATEGORIES, DEFAULT_SOURCES} from '../ai-personas-feeds.mjs';
import {PENDING} from '../ai-personas-adapter.mjs';
import {avatarJpeg} from '../ai-personas-avatar.mjs';

let T = Date.UTC(2026, 10, 21, 4, 0, 0);   // 北京时间 12:00，不在静默时段
const clock = () => T;
const RSS = `<?xml version="1.0"?><rss><channel><title>中新网</title>
<item><title>某地举办科技博览会 展出多款新产品</title><link>https://www.chinanews.com.cn/a/1.shtml?utm_source=x</link><guid>g1</guid><description>&lt;p&gt;博览会为期三天，吸引大量观众。&lt;/p&gt;</description><pubDate>${new Date(T - 3600e3).toUTCString()}</pubDate></item>
<item><title>第二条新闻标题</title><link>https://www.chinanews.com.cn/a/2.shtml</link><guid>g2</guid><description>第二条摘要内容</description><pubDate>${new Date(T - 7200e3).toUTCString()}</pubDate></item>
</channel></rss>`;
const feedFetch = async () => new Response(RSS, {status: 200, headers: {'content-type': 'application/rss+xml'}});
let aiReply = () => '这类展会最有意思的还是能看到小公司的点子，大家觉得哪些产品会真的走进生活？';
const llmCalls = [];
const llm = async (messages, opts) => { llmCalls.push({messages, opts}); return {role: 'assistant', content: JSON.stringify({text: aiReply(messages)})}; };

let srv, base, P, boostViews = 0;
function make(extra = {}) {
  return createAiPersonas(srv.db, {now: clock, env: {}, posts: srv.posts, comments: srv.comments, saved: srv.saved, postStats: srv.postStats,
    communities: srv.communities, notifications: srv.notifications, profile: srv.profile, media: srv.media, blockwords: srv.blockwords,
    hashtags: srv.hashtags, adminAi: srv.adminAi, llm, feedFetch, ...extra});
}
async function call(m, p, body, tok) {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  let j = null; try { j = await r.json(); } catch {}
  return {s: r.status, j};
}
let seq = 0;
async function human() {
  const u = 'real' + (++seq);
  const r = await call('POST', '/api/auth/register', {agree: true, username: u, email: u + '@x.test', password: 'Passw0rd123'});
  assert.equal(r.s, 200, JSON.stringify(r.j));
  return {id: r.j.user.id, tok: r.j.token, row: srv.db.prepare('SELECT * FROM users WHERE id=?').get(r.j.user.id)};
}
const adminAuth = () => ({admin: {id: 1}, token: 't'});
const R = () => P.routes({adminAuth});

test.before(async () => {
  srv = createApp({clock, aiFetch: async () => { throw new Error('offline'); }});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  srv.postStats.onView(() => { boostViews++; });
  P = make();
});
test.after(() => srv.close());

test('默认设置：关闭、0 个账号、glm-4.7-flash、推流开关默认 true、数量不设上限', () => {
  const s = P.settings();
  assert.equal(s.enabled, false); assert.equal(s.targetCount, 0); assert.equal(s.model, 'glm-4.7-flash');
  assert.equal(s.countAiViewsForBoost, true);
  const o = P.saveSettings({id: 1}, {targetCount: 100000});
  assert.equal(o.settings.targetCount, 100000);
  P.saveSettings({id: 1}, {targetCount: 0});
  assert.throws(() => P.saveSettings({id: 1}, {targetCount: -1}), e => e.code === 'BAD_COUNT');
});

test('建号：内部标识、简介「官方内部账号」、头像、拒绝好友请求；分批创建', async () => {
  P.saveSettings({id: 1}, {enabled: true, targetCount: 3});
  const r = await P.ensureCount();
  assert.equal(r.created, 3);
  const {accounts} = P.listAccounts({});
  assert.equal(accounts.length, 3);
  for (const a of accounts) {
    const u = srv.db.prepare('SELECT * FROM users WHERE id=?').get(a.userId);
    assert.equal(u.badge, PERSONA_BADGE);
    assert.match(a.bio, /^官方内部账号/);
    assert.match(a.username, /^vx_in_/);
    assert.ok(a.avatar.mediaId, '有头像'); assert.equal(a.avatar.kind, 'image'); assert.equal(a.avatar.image, a.avatar.path);
    assert.equal(a.avatar.path, avatarPathOf(a.userId));
    assert.ok(AVATAR_ROUTE_RE.test(a.avatar.path)); assert.ok(a.avatar.path.startsWith('/'));
    assert.match(a.avatar.fallback, /^data:image\/svg\+xml/);
    assert.ok(a.avatar.letter && a.avatar.color);
  }
});

test('真人发帖后 AI 浏览 / 点赞 / 收藏 / 转帖 / 评论：计数里算上 AI，并给真人推通知', async () => {
  const h = await human();
  const post = srv.posts.create(h.row, {text: '今天去看了科技展，人好多，有几个机器人挺好玩的，分享一下照片'}).post;
  const ai = P.listAccounts({}).accounts[0];
  const before = boostViews;
  for (const kind of ['like', 'favorite', 'repost', 'comment']) {
    const r = await P.tick({force: true, kind, userId: ai.userId, skipFeeds: true});
    assert.ok(r.actions.some(a => a.kind === kind && a.ok), kind + ' ' + JSON.stringify(r.actions));
  }
  assert.ok(boostViews > before, 'AI 浏览按真人计入推流（countAiViewsForBoost 默认 true）');
  const p = srv.posts.get(h.row, post.id).post;
  assert.equal(p.viewCount, 1);
  assert.equal(p.bookmarkCount, 1);
  assert.equal(p.repostCount, 1);
  assert.ok(p.reactions.reduce((a, b) => a + b, 0) >= 1);
  const kinds = srv.db.prepare('SELECT kind FROM notifications WHERE user_id=? AND actor_id=?').all(h.id, ai.userId).map(r => r.kind).sort();
  assert.deepEqual(kinds, ['comment', 'react', 'repost', 'save']);
  // 同一动作不重复
  const again = await P.tick({force: true, kind: 'like', userId: ai.userId, skipFeeds: true});
  assert.ok(!again.actions.some(a => a.kind === 'like' && a.ok));
});

test('countAiViewsForBoost=false：浏览照样计数，但不消耗推流', async () => {
  const h = await human();
  const post = srv.posts.create(h.row, {text: '第二条真人动态，内容足够长可以评论一下吧'}).post;
  P.saveSettings({id: 1}, {countAiViewsForBoost: false});
  const ai = P.listAccounts({}).accounts[1];
  const before = boostViews;
  await P.tick({force: true, kind: 'browse', userId: ai.userId, skipFeeds: true});
  assert.equal(boostViews, before);
  assert.equal(srv.db.prepare('SELECT COUNT(*) n FROM post_views WHERE user_id=?').get(ai.userId).n >= 1, true);
  P.saveSettings({id: 1}, {countAiViewsForBoost: true});
  assert.ok(post.id);
});

test('回复真人在 AI 帖子下的文字评论，并通知', async () => {
  const ai = P.listAccounts({}).accounts[2];
  const aiUser = srv.db.prepare('SELECT * FROM users WHERE id=?').get(ai.userId);
  const post = srv.posts.create(aiUser, {text: 'AI 账号的一条帖子，讨论一下周末去哪玩'}).post;
  const h = await human();
  const c = srv.comments.add(h.row, post.id, {text: '我推荐去郊外爬山，空气好'}).comment;
  aiReply = () => '爬山不错！有推荐的路线吗？';
  const r = await P.tick({force: true, kind: 'reply', userId: ai.userId, skipFeeds: true});
  assert.ok(r.actions.some(a => a.kind === 'reply' && a.ok), JSON.stringify(r.actions));
  const reply = srv.db.prepare('SELECT * FROM post_comments WHERE parent_id=? AND author_id=?').get(c.id, ai.userId);
  assert.ok(reply);
  assert.ok(srv.db.prepare("SELECT 1 FROM notifications WHERE user_id=? AND actor_id=? AND kind='reply'").get(h.id, ai.userId));
  assert.equal(llmCalls.at(-1).opts.model, 'glm-4.7-flash');
});

test('只加入公开小组，私密小组不进；不私聊、不进群聊、不建小组', async () => {
  const h = await human();
  const pub = srv.communities.create(h.row, {name: '公开小组', visibility: 'public'}).community;
  const priv = srv.communities.create(h.row, {name: '私密小组', visibility: 'private'}).community;
  for (const a of P.listAccounts({}).accounts) await P.tick({force: true, kind: 'join_group', userId: a.userId, skipFeeds: true});
  const ids = P.listAccounts({}).accounts.map(a => a.userId);
  const mem = srv.db.prepare(`SELECT community_id FROM community_members WHERE user_id IN (${ids.join(',')})`).all().map(r => r.community_id);
  assert.ok(mem.includes(pub.id));
  assert.ok(!mem.includes(priv.id));
  assert.equal(srv.db.prepare(`SELECT COUNT(*) n FROM communities WHERE owner_id IN (${ids.join(',')})`).get().n, 0);
  for (const t of ['conversations', 'conversation_members', 'chat_members', 'messages']) {
    const cols = srv.db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
    const col = cols.find(c => ['user_id', 'author_id', 'sender_id'].includes(c));
    if (col) assert.equal(srv.db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE ${col} IN (${ids.join(',')})`).get().n, 0, t);
  }
  // 在小组文字频道发言；最后一条是 AI 时不接
  aiReply = () => '大家好，第一次来，请多关照';
  const r = await P.tick({force: true, kind: 'group_post', userId: ids[0], skipFeeds: true});
  assert.ok(r.actions.some(a => a.kind === 'group_post' && a.ok), JSON.stringify(r.actions));
  const r2 = await P.tick({force: true, kind: 'group_post', userId: ids[1], skipFeeds: true});
  assert.ok(!r2.actions.some(a => a.kind === 'group_post' && a.ok));
});

test('发帖：读新闻写自己的看法 + 来源链接；照抄原文会被拒', async () => {
  // 发帖挑新闻是在最新几条里随机挑的，所以「照抄」要照抄这次提示里真正给到的那条，链接也按实际用掉的那条核对（不能写死第几条）。
  const ai = P.listAccounts({}).accounts[0];
  P.saveSettings({id: 1}, {categories: ['news']});
  await P.feeds.refreshAll();
  const echoPrompt = (messages) => { const j = JSON.parse(messages.at(-1).content); return j.title + ' ' + j.summary; };
  aiReply = echoPrompt;   // 照抄
  const bad = await P.tick({force: true, kind: 'post', userId: ai.userId, skipFeeds: true});
  const rej = bad.actions.find(a => a.kind === 'post');
  assert.ok(rej && !rej.ok, JSON.stringify(bad.actions));
  aiReply = () => '这种展会其实最能看出一个城市的创新活力，希望以后多一些面向普通人的体验区，而不只是看看。';
  const ok = await P.tick({force: true, kind: 'post', userId: ai.userId, skipFeeds: true});
  const a = ok.actions.find(x => x.kind === 'post' && x.ok);
  assert.ok(a, JSON.stringify(ok.actions));
  const p = srv.db.prepare('SELECT * FROM posts WHERE id=?').get(a.refId);
  const item = srv.db.prepare('SELECT * FROM ai_feed_items WHERE used_post_id=?').get(a.refId);
  assert.ok(item, '用掉的新闻记了 used_post_id');
  assert.match(item.url, /^https:\/\/www\.chinanews\.com\.cn\/a\/[12]\.shtml$/, '链接去掉了 utm 参数');
  assert.ok(p.text.endsWith('\n\n来源：' + item.url), p.text);
  assert.ok([...p.text].length <= 280);
  assert.equal(p.category, 'news', '用 2.1.2 的 posts.category');
  assert.equal(srv.posts.get(srv.db.prepare('SELECT * FROM users WHERE id=?').get(ai.userId), a.refId).post.category, 'news');
});

test('来源：政治类只允许中新网；没有 ESPN；分类映射', async () => {
  assert.ok(politicsAllowed('https://www.chinanews.com.cn/rss/china.xml'));
  assert.ok(!politicsAllowed('https://feeds.bbci.co.uk/news/politics/rss.xml'));
  await assert.rejects(() => R()['POST /api/admin/ai/personas/sources']({}, {name: 'x', url: 'https://feeds.bbci.co.uk/x.xml', category: 'politics'}), e => e.code === 'POLITICS_SOURCE');
  assert.ok(!DEFAULT_SOURCES.some(s => /espn/i.test(s.url)));
  assert.equal(postCategoryOf('politics'), 'news'); assert.equal(postCategoryOf('sports'), 'news'); assert.equal(postCategoryOf('economy'), 'finance');
  for (const c of ['news', 'politics', 'sports', 'economy', 'tech', 'game', 'crypto', 'life']) assert.ok(POST_CATEGORIES.includes(postCategoryOf(c)));
});

test('RSS 解析 + 繁转简 + 重合度 + 拼链接', async () => {
  const items = parseFeed(RSS);
  assert.equal(items.length, 2);
  assert.equal(items[0].summary, '博览会为期三天，吸引大量观众。');
  assert.equal(items[0].url, 'https://www.chinanews.com.cn/a/1.shtml', '去掉 utm 跟踪参数');
  assert.equal(cleanUrl('https://a.b/c?id=3&utm_medium=y&fbclid=z'), 'https://a.b/c?id=3');
  assert.equal(await toSimplified('這是國際新聞報導'), '这是国际新闻报导');
  assert.ok(overlapRatio('某地举办科技博览会展出多款新产品', '某地举办科技博览会 展出多款新产品') > 0.9);
  assert.ok(overlapRatio('我觉得这个展会挺有意思的，值得去看看', '某地举办科技博览会 展出多款新产品') < 0.3);
  const t = composePost('看'.repeat(400), 'https://a.b/c');
  assert.equal([...t].length, 280); assert.ok(t.endsWith('来源：https://a.b/c'));
});

test('日志分页：before = 上一页最后一条的 id', () => {
  const r = R();
  const p1 = r['GET /api/admin/ai/personas/log']({query: {limit: 2}});
  assert.equal(p1.log.length, 2);
  assert.equal(p1.nextBefore, p1.log[1].id);
  const p2 = r['GET /api/admin/ai/personas/log']({query: {limit: 2, before: p1.nextBefore}});
  assert.ok(p2.log.every(x => x.id < p1.nextBefore));
});

test('头像文件处理：管理员可取，非内部账号 404', async () => {
  const ai = P.listAccounts({}).accounts[0];
  const res = {h: null, s: 0, body: null, writeHead(s, h) { this.s = s; this.h = h; }, end(b) { this.body = b; }};
  P.serveAvatar({method: 'GET'}, res, ai.userId, {adminAuth});
  assert.equal(res.s, 200); assert.equal(res.h['Content-Type'], 'image/jpeg');
  const res2 = {...res, writeHead(s, h) { this.s = s; this.h = h; }, end(b) { this.body = b; }};
  P.serveAvatar({method: 'GET'}, res2, 999999, {adminAuth});
  assert.equal(res2.s, 404);
  const res3 = {...res, writeHead(s) { this.s = s; }, end() {}};
  P.serveAvatar({method: 'GET'}, res3, ai.userId, {adminAuth: () => { throw new Error('no'); }});
  assert.equal(res3.s, 401);
});

test('紧急停止：关开关、暂停全部、可隐藏 AI 帖子和撤销互动；之后定时轮不再动作', async () => {
  const r = R()['POST /api/admin/ai/personas/stop-all']({}, {hideContent: true, undoInteractions: true});
  assert.equal(r.settings.enabled, false);
  assert.ok(r.paused >= 1);
  assert.ok(r.hiddenPosts >= 1);
  assert.ok(r.removedInteractions >= 1);
  const t = await P.tick();
  assert.equal(t.skipped, 'disabled');
  assert.equal(P.start(), false, '没有 AI_PERSONAS=1 不启动定时器');
});

test('退役多余账号；PENDING 列表完整', async () => {
  P.saveSettings({id: 1}, {enabled: true, targetCount: 1});
  R()['POST /api/admin/ai/personas/accounts/:userId']({params: {userId: P.listAccounts({}).accounts[0].userId}}, {status: 'active'});
  const r = await P.ensureCount();
  assert.equal(r.retired, 2);
  assert.equal(P.listAccounts({status: 'retired'}).accounts.length, 2);
  P.saveSettings({id: 1}, {enabled: false});
  assert.deepEqual(PENDING.map(p => p.fn), ['createPost', 'repost', 'comment', 'like', 'favorite', 'view', 'joinGroup', 'channelMessage', 'llm', 'audit']);
  assert.equal(DEFAULT_SETTINGS.limits.aiConcurrency, 2);
});

test('真头像：DiceBear Notionists / Lorelei → JPEG', async () => {
  for (const s of ['notionists', 'lorelei']) {
    const b = await avatarJpeg(s, 'seed-1');
    assert.equal(b[0], 0xff); assert.equal(b[1], 0xd8); assert.ok(b.length > 1000);
  }
});
