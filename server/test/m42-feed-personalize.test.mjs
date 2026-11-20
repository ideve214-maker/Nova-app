// 服务端 2.1.2：偏好、不感兴趣、行为上报，以及「为你推荐」排序。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';
import {isInternalAccount} from '../internal-account.mjs';
import {isRecQuery} from '../feed-personalize.mjs';

let seq = 0;
async function boot(opts = {}) {
  const srv = createApp({
    adminUsername: 'ops_feed', adminPassword: 'OpsFeedPass1!',
    importAuto: false, scheduleAuto: false,
    feedEnv: {FEED_SIGNALS_RPM: '60', FEED_SIGNALS_EVENTS_RPM: '2000', FEED_HIDE_RPM: '120', ...(opts.feedEnv || {})},
    ...opts,
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const call = async (m, p, body, tok) => {
    const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
    let j = null; try { j = await r.json(); } catch {}
    return {s: r.status, j};
  };
  const acc = async (n) => {
    const u = n + (++seq);
    const r = await call('POST', '/api/auth/register', {agree: true, username: u, email: u + '@qq.com', password: 'Passw0rd123'});
    assert.equal(r.s, 200, JSON.stringify(r.j));
    return {tok: r.j.token, id: r.j.user.id, username: u};
  };
  const close = () => new Promise(r => { srv.close(r); srv.closeAllConnections?.(); });
  return {srv, call, acc, close, db: srv.db, base};
}

test('isInternalAccount 在 065 落地前默认 false；badge=internal 视为内部账号', () => {
  assert.equal(isInternalAccount(null), false);
  assert.equal(isInternalAccount({id: 1}), false);
  assert.equal(isInternalAccount({id: 1, badge: 'internal'}), true);
  assert.equal(isRecQuery({}), true);
  assert.equal(isRecQuery({feed: 'rec'}), true);
  assert.equal(isRecQuery({feed: 'follow'}), false);
  assert.equal(isRecQuery({feed: 'topic'}), false);
  assert.equal(isRecQuery({author: 'me'}), false);
});

test('GET/PUT /api/me/interests：默认空、校验分类和来源、PUT 会把 onboarded 设为 true；需登录', async () => {
  const b = await boot();
  try {
    assert.equal((await b.call('GET', '/api/me/interests')).s, 401);
    assert.equal((await b.call('PUT', '/api/me/interests', {like: ['tech']})).s, 401);
    const u = await b.acc('int');
    const g0 = await b.call('GET', '/api/me/interests', null, u.tok);
    assert.equal(g0.s, 200, JSON.stringify(g0.j));
    assert.deepEqual({like: g0.j.like, dislike: g0.j.dislike, hiddenSources: g0.j.hiddenSources, onboarded: g0.j.onboarded},
      {like: [], dislike: [], hiddenSources: [], onboarded: false});
    const badC = await b.call('PUT', '/api/me/interests', {like: ['sports']}, u.tok);
    assert.equal(badC.s, 400);
    assert.equal(badC.j.error.code, 'BAD_CATEGORY');
    const badS = await b.call('PUT', '/api/me/interests', {hiddenSources: ['not-a-source']}, u.tok);
    assert.equal(badS.s, 400);
    assert.equal(badS.j.error.code, 'BAD_SOURCE');
    const ok = await b.call('PUT', '/api/me/interests', {like: ['tech', 'game', 'tech'], dislike: ['crypto'], hiddenSources: ['sspai', 'hn']}, u.tok);
    assert.equal(ok.s, 200, JSON.stringify(ok.j));
    assert.deepEqual(ok.j.like, ['tech', 'game']);
    assert.deepEqual(ok.j.dislike, ['crypto']);
    assert.deepEqual(ok.j.hiddenSources, ['sspai', 'hn']);
    assert.equal(ok.j.onboarded, true);
    const g1 = await b.call('GET', '/api/me/interests', null, u.tok);
    assert.deepEqual({like: g1.j.like, dislike: g1.j.dislike, hiddenSources: g1.j.hiddenSources, onboarded: g1.j.onboarded},
      {like: ok.j.like, dislike: ok.j.dislike, hiddenSources: ok.j.hiddenSources, onboarded: ok.j.onboarded});
    // 同一分类在喜欢和不喜欢里时，不喜欢优先
    const overlap = await b.call('PUT', '/api/me/interests', {like: ['tech', 'life'], dislike: ['tech']}, u.tok);
    assert.ok(!overlap.j.like.includes('tech'));
    assert.ok(overlap.j.dislike.includes('tech'));
    assert.equal(overlap.j.onboarded, true);
  } finally { await b.close(); }
});

test('POST /api/feed/not-interested：按帖子隐藏、按分类加入 dislike、按来源加入 hiddenSources', async () => {
  const b = await boot();
  try {
    const u = await b.acc('hid');
    const v = await b.acc('hidv');
    const p = await b.call('POST', '/api/posts', {text: '一条游戏帖', category: 'game'}, v.tok);
    assert.equal(p.s, 200);
    const id = p.j.post.id;
    const bad = await b.call('POST', '/api/feed/not-interested', {postId: id, reason: 'nope'}, u.tok);
    assert.equal(bad.s, 400);
    assert.equal(bad.j.error.code, 'BAD_REASON');
    const missing = await b.call('POST', '/api/feed/not-interested', {postId: 'po_nope', reason: 'post'}, u.tok);
    assert.equal(missing.s, 404);
    const hide = await b.call('POST', '/api/feed/not-interested', {postId: id, reason: 'post'}, u.tok);
    assert.equal(hide.s, 200, JSON.stringify(hide.j));
    const rec = await b.call('GET', '/api/posts?feed=rec', null, u.tok);
    assert.ok(!rec.j.posts.some(x => x.id === id), '隐藏的帖不应出现在推荐里');
    const p2 = await b.call('POST', '/api/posts', {text: '另一条游戏帖', category: 'game'}, v.tok);
    const cat = await b.call('POST', '/api/feed/not-interested', {postId: p2.j.post.id, reason: 'category'}, u.tok);
    assert.equal(cat.s, 200);
    assert.ok(cat.j.interests.dislike.includes('game'));
    b.db.prepare("INSERT INTO posts(id,author_id,text,created_at,updated_at,audience,source,source_id,source_url,ext_author_name,category) VALUES('po_sspai_x',?,'少数派稿',?,?, 'public','sspai','s1','https://sspai.com/a','作者','tech')").run(v.id, Date.now(), Date.now());
    const src = await b.call('POST', '/api/feed/not-interested', {postId: 'po_sspai_x', reason: 'source'}, u.tok);
    assert.equal(src.s, 200, JSON.stringify(src.j));
    assert.ok(src.j.interests.hiddenSources.includes('sspai'));
    const rec2 = await b.call('GET', '/api/posts?feed=rec', null, u.tok);
    assert.ok(!rec2.j.posts.some(x => x.id === 'po_sspai_x'));
  } finally { await b.close(); }
});

test('POST /api/feed/signals：批量上报、截断 dwell、忽略未知帖、超过 100 条返回 400、内部账号不学习', async () => {
  const b = await boot();
  try {
    const u = await b.acc('sig');
    const v = await b.acc('sigv');
    const p = await b.call('POST', '/api/posts', {text: '科技长文', category: 'tech'}, v.tok);
    const id = p.j.post.id;
    assert.equal((await b.call('POST', '/api/feed/signals', {events: 'x'}, u.tok)).s, 400);
    const too = await b.call('POST', '/api/feed/signals', {events: Array.from({length: 101}, () => ({postId: id, action: 'view', dwellMs: 10}))}, u.tok);
    assert.equal(too.s, 400);
    assert.equal(too.j.error.code, 'TOO_MANY_EVENTS');
    const badA = await b.call('POST', '/api/feed/signals', {events: [{postId: id, action: 'click'}]}, u.tok);
    assert.equal(badA.s, 400);
    assert.equal(badA.j.error.code, 'BAD_ACTION');
    const ok = await b.call('POST', '/api/feed/signals', {events: [
      {postId: id, action: 'view', dwellMs: 900000, at: Date.now()},
      {postId: id, action: 'like'},
      {postId: 'po_missing', action: 'open', dwellMs: 1000},
    ]}, u.tok);
    assert.equal(ok.s, 200, JSON.stringify(ok.j));
    assert.deepEqual(ok.j, {ok: true, accepted: 2});
    const row = b.db.prepare('SELECT dwell_ms FROM feed_signals WHERE user_id=? AND action=?').get(u.id, 'view');
    assert.equal(row.dwell_ms, 600000);
    const sc = b.db.prepare('SELECT score FROM user_category_scores WHERE user_id=? AND category=?').get(u.id, 'tech');
    assert.ok(sc && sc.score > 0);

    // 内部账号不上兴趣分
    const ai = await b.acc('sigai');
    b.db.prepare("UPDATE users SET badge='internal' WHERE id=?").run(ai.id);
    const tok = (await b.call('POST', '/api/auth/login', {username: ai.username, email: ai.username + '@qq.com', password: 'Passw0rd123'}));
    // 当前会话里的 user 可能还没有 badge：直接用新登录令牌
    const login = tok.s === 200 ? tok : await b.call('POST', '/api/auth/login', {username: ai.username, password: 'Passw0rd123'});
    const aiTok = login.j && login.j.token || ai.tok;
    // 刷新后再发信号：auth 读库应带上 badge
    const r2 = await b.call('POST', '/api/feed/signals', {events: [{postId: id, action: 'like'}, {postId: id, action: 'save'}]}, aiTok);
    assert.equal(r2.s, 200, JSON.stringify(r2.j));
    assert.equal(r2.j.accepted, 2);
    const aiScore = b.db.prepare('SELECT score FROM user_category_scores WHERE user_id=? AND category=?').get(ai.id, 'tech');
    assert.ok(!aiScore, '内部账号不应写入兴趣分');
  } finally { await b.close(); }
});

test('为你推荐：喜欢的分类靠前，不喜欢的靠后，关注流和话题流不受影响；新用户保持时间倒序', async () => {
  const b = await boot();
  try {
    const author = await b.acc('rkauthor');
    const viewer = await b.acc('rkview');
    const followee = await b.acc('rkfol');
    // 先写一批不同分类的帖，间隔一点时间，避免完全同一毫秒
    const made = {};
    for (const [cat, text] of [['life', '生活帖 L1'], ['tech', '科技帖 T1'], ['game', '游戏帖 G1'], ['tech', '科技帖 T2'], ['finance', '财经帖 F1']]) {
      const r = await b.call('POST', '/api/posts', {text, category: cat}, author.tok);
      assert.equal(r.s, 200, text);
      made[text] = r.j.post.id;
    }
    await b.call('POST', '/api/posts', {text: '关注的人发的生活帖', category: 'life'}, followee.tok);
    await b.call('POST', '/api/posts', {text: '今天 #摄影 出片了', category: 'life'}, author.tok);

    // 新用户、没有偏好：推荐里能看到这些帖（默认行为）
    const fresh = await b.call('GET', '/api/posts?feed=rec', null, viewer.tok);
    assert.equal(fresh.s, 200);
    const freshTexts = fresh.j.posts.map(p => p.text);
    assert.ok(freshTexts.includes('科技帖 T1') && freshTexts.includes('生活帖 L1'));

    await b.call('PUT', '/api/me/interests', {like: ['tech'], dislike: ['finance']}, viewer.tok);
    const rec = await b.call('GET', '/api/posts?feed=rec&limit=20', null, viewer.tok);
    assert.equal(rec.s, 200, JSON.stringify(rec.j));
    const texts = rec.j.posts.map(p => p.text);
    const iT1 = texts.indexOf('科技帖 T1');
    const iT2 = texts.indexOf('科技帖 T2');
    const iF = texts.indexOf('财经帖 F1');
    const iL = texts.indexOf('生活帖 L1');
    assert.ok(iT1 >= 0 && iT2 >= 0 && iF >= 0 && iL >= 0, texts.join(','));
    assert.ok(iT1 < iF && iT2 < iF, '喜欢的科技应排在不喜欢的财经前面: ' + texts.join(' | '));

    // 关注流仍只含自己和已关注的人，且不被推荐排序打乱过滤
    await b.call('POST', '/api/follows', {userId: followee.id}, viewer.tok);
    const fol = await b.call('GET', '/api/posts?feed=follow', null, viewer.tok);
    const folTexts = fol.j.posts.map(p => p.text);
    assert.ok(folTexts.includes('关注的人发的生活帖'));
    assert.ok(!folTexts.includes('科技帖 T1'));

    const topic = await b.call('GET', '/api/posts?feed=topic', null, viewer.tok);
    assert.ok(topic.j.posts.some(p => p.text.includes('#摄影')));
    assert.ok(!topic.j.posts.some(p => p.text === '科技帖 T1'));

    // 行为学习：给游戏帖很强的正反馈。清空自选偏好后，按兴趣分排序，游戏应排在财经前面。
    const sig = await b.call('POST', '/api/feed/signals', {events: [
      {postId: made['游戏帖 G1'], action: 'open'},
      {postId: made['游戏帖 G1'], action: 'like'},
      {postId: made['游戏帖 G1'], action: 'save'},
      {postId: made['游戏帖 G1'], action: 'share'},
      {postId: made['游戏帖 G1'], action: 'view', dwellMs: 120000},
    ]}, viewer.tok);
    assert.equal(sig.s, 200, JSON.stringify(sig.j));
    await b.call('PUT', '/api/me/interests', {like: [], dislike: ['finance']}, viewer.tok);
    const rec2 = await b.call('GET', '/api/posts?feed=rec&limit=20', null, viewer.tok);
    const texts2 = rec2.j.posts.map(p => p.text);
    assert.ok(texts2.indexOf('游戏帖 G1') < texts2.indexOf('财经帖 F1'), texts2.join(' | '));
    const sc = b.db.prepare('SELECT score FROM user_category_scores WHERE user_id=? AND category=?').get(viewer.id, 'game');
    assert.ok(sc && sc.score > 0);
  } finally { await b.close(); }
});

test('signals 超限返回 429；推荐探索约两成来自非最爱分类', async () => {
  const b = await boot({feedEnv: {FEED_SIGNALS_RPM: '2', FEED_SIGNALS_EVENTS_RPM: '20', FEED_HIDE_RPM: '30', FEED_EXPLORE_RATIO: '0.2'}});
  try {
    const u = await b.acc('rl');
    const v = await b.acc('rlv');
    const p = await b.call('POST', '/api/posts', {text: '限速帖', category: 'life'}, v.tok);
    const ev = {events: [{postId: p.j.post.id, action: 'view', dwellMs: 10}]};
    assert.equal((await b.call('POST', '/api/feed/signals', ev, u.tok)).s, 200);
    assert.equal((await b.call('POST', '/api/feed/signals', ev, u.tok)).s, 200);
    const limited = await b.call('POST', '/api/feed/signals', ev, u.tok);
    assert.equal(limited.s, 429);
    assert.equal(limited.j.error.code, 'RATE_LIMIT');

    // 探索：喜欢 tech，池子里 tech 和 life 都很多，首页应掺进非 tech
    const author = await b.acc('expa');
    const viewer = await b.acc('expv');
    for (let i = 0; i < 16; i++) {
      assert.equal((await b.call('POST', '/api/posts', {text: 'T-' + i, category: 'tech'}, author.tok)).s, 200);
      assert.equal((await b.call('POST', '/api/posts', {text: 'L-' + i, category: 'life'}, author.tok)).s, 200);
    }
    await b.call('PUT', '/api/me/interests', {like: ['tech']}, viewer.tok);
    const rec = await b.call('GET', '/api/posts?feed=rec&limit=20', null, viewer.tok);
    const cats = rec.j.posts.map(p => p.category);
    const lifeN = cats.filter(c => c === 'life').length;
    const techN = cats.filter(c => c === 'tech').length;
    assert.ok(techN >= 10, '主兴趣仍应占多数: ' + cats.join(','));
    assert.ok(lifeN >= 2 && lifeN <= 8, '约两成探索槽来自非最爱分类: ' + cats.join(','));
  } finally { await b.close(); }
});
