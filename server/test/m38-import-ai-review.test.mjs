// 服务端 2.1.0：外部帖先过 AI 审查再入库、AI 不可用时的安全默认、补审任务、管理端接口、导入量和头像。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X89QAAAAASUVORK5CYII=', 'base64');

// 假智谱：内容里有「赌博」或 BLOCKME 的条目判违规
function makeAi() {
  const ai = {calls: 0, items: 0, delayMs: 0, down: false};
  ai.fetch = async (url, opt) => {
    ai.calls++;
    if (ai.delayMs) await new Promise(r => setTimeout(r, ai.delayMs));
    if (ai.down) return new Response('{}', {status: 500});
    const body = JSON.parse(opt.body);
    const text = body.messages[1].content;
    const blocked = [];
    for (const line of text.split('\n')) {
      const m = /^\[(\d+)\] (.*)$/.exec(line);
      if (!m) continue;
      ai.items++;
      if (/赌博|BLOCKME/.test(m[2])) blocked.push({i: Number(m[1]), category: '赌博诈骗', reason: '赌博引流'});
    }
    return Response.json({choices: [{message: {content: JSON.stringify({blocked})}}]});
  };
  return ai;
}

// 可变的外部源：V2EX 最新 / 热门、HN 三个榜单
function makeSource() {
  const src = {v2ex: [], replies: {}, hnTop: [], hnItems: {}};
  src.addV2ex = (id, title, {content = '正文', user = 'u' + id, replies = []} = {}) => {
    src.v2ex.push({id, title, url: 'https://www.v2ex.com/t/' + id, content, created: 1730000000 + id,
      member: {username: user, avatar_large: 'https://cdn.v2ex.com/avatar/' + user + '.png'}});
    src.replies[id] = replies.map((r, i) => ({id: id * 100 + i, content: r, created: 1730000000 + i,
      member: {username: 'r' + id + '_' + i, avatar_normal: 'https://cdn.v2ex.com/avatar/r' + i + '.png'}}));
  };
  src.addHn = (id, title, kids = []) => {
    src.hnTop.push(id);
    src.hnItems[id] = {id, type: 'story', by: 'hn' + id, title, time: 1730001000 + id, kids: kids.map((_, i) => id * 100 + i)};
    kids.forEach((t, i) => { src.hnItems[id * 100 + i] = {id: id * 100 + i, type: 'comment', by: 'c' + i, text: t, time: 1730001001, parent: id}; });
  };
  src.fetch = async (url) => {
    const u = String(url);
    const json = v => ({ok: true, status: 200, json: async () => v});
    if (u.includes('cdn.v2ex.com')) return {ok: true, status: 200, headers: {get: () => 'image/png'}, arrayBuffer: async () => PNG};
    if (u.includes('/api/topics/latest.json')) return json(src.v2ex.slice().reverse());
    if (u.includes('/api/topics/hot.json')) return json(src.v2ex.slice(0, 5));
    if (u.includes('/api/replies/show.json')) return json(src.replies[Number(/topic_id=(\d+)/.exec(u)[1])] || []);
    if (u.includes('/v0/topstories.json')) return json(src.hnTop.slice());
    if (u.includes('/v0/newstories.json') || u.includes('/v0/beststories.json')) return json([]);
    const m = /\/v0\/item\/(\d+)\.json/.exec(u);
    if (m && src.hnItems[Number(m[1])]) return json(src.hnItems[Number(m[1])]);
    return {ok: false, status: 404, json: async () => ({})};
  };
  return src;
}

async function boot({env = {AI_API_KEY: 'test-key-not-real', AI_RPM: '1000', AI_RPD: '100000'}} = {}) {
  const ai = makeAi();
  const src = makeSource();
  const srv = createApp({
    adminUsername: 'ops_ir', adminPassword: 'OpsIrPass1!',
    importFetch: src.fetch, importAuto: false, importDelayMs: 0, importRetryDelayMs: 0, importRetries: 1,
    aiEnv: env, aiFetch: ai.fetch,
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const call = async (m, p, body, tok) => {
    const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
    let j = null; try { j = await r.json(); } catch {}
    return {s: r.status, j};
  };
  const adm = (await call('POST', '/api/admin/auth/login', {username: 'ops_ir', password: 'OpsIrPass1!'})).j.token;
  const close = () => new Promise(r => { srv.close(r); srv.closeAllConnections?.(); });
  return {srv, ai, src, env, call, adm, close, db: srv.db};
}
const count = (db, sql, ...a) => db.prepare(sql).get(...a).n;

test('不合格的外部帖和评论不入库；被拒的不再拉取、不再送审；审查记录带 origin / originUrl / action', async () => {
  const b = await boot();
  try {
    b.src.addV2ex(1, '正常帖', {replies: ['好评论', '加我赌博群', '另一条']});
    b.src.addV2ex(2, '线上赌博平台招代理');
    b.src.addHn(10, 'Show HN: ok', ['nice', 'BLOCKME spam']);
    const r1 = await b.srv.importFeed.run();
    assert.equal(r1.v2ex.imported, 1, JSON.stringify(r1));
    assert.equal(r1.v2ex.rejected, 1);
    assert.equal(r1.v2ex.commentsRejected, 1);
    assert.equal(r1.hn.imported, 1);
    assert.equal(r1.hn.commentsRejected, 1);
    assert.equal(count(b.db, "SELECT COUNT(*) n FROM posts WHERE source='v2ex' AND source_id='2'"), 0, '违规帖不入库');
    assert.equal(count(b.db, "SELECT COUNT(*) n FROM post_comments WHERE text LIKE '%赌博%' OR text LIKE '%BLOCKME%'"), 0, '违规评论不入库');
    assert.equal(count(b.db, "SELECT COUNT(*) n FROM post_comments WHERE source IS NOT NULL"), 3);
    assert.equal(count(b.db, "SELECT COUNT(*) n FROM posts WHERE source IS NOT NULL AND ai_review='pass'"), 2, '入库的标记为已审');
    // 第二轮：被拒的帖不再送审
    const before = b.ai.items;
    const r2 = await b.srv.importFeed.run();
    assert.equal(r2.v2ex.imported, 0);
    assert.ok(r2.v2ex.rejectedKept >= 1);
    assert.equal(b.ai.items, before, '第二轮没有新内容要审');
    // 审查记录
    const lg = await b.call('GET', '/api/admin/ai-moderation?kind=import', null, b.adm);
    assert.equal(lg.s, 200, JSON.stringify(lg.j));
    const logs = lg.j.logs;
    assert.ok(logs.length >= 4);
    assert.ok(logs.every(x => ['import', 'import_comment', 'backfill', 'backfill_comment'].includes(x.kind)));
    const rej = logs.find(x => x.kind === 'import' && x.action === 'rejected');
    assert.ok(rej, JSON.stringify(logs));
    assert.equal(rej.origin, 'v2ex');
    assert.equal(rej.originUrl, 'https://www.v2ex.com/t/2');
    assert.equal(rej.verdict, 'block');
    assert.ok(logs.some(x => x.kind === 'import_comment' && x.action === 'rejected' && x.origin === 'hn'));
    assert.ok(logs.some(x => x.kind === 'import' && x.action === 'stored'));
    const all = await b.call('GET', '/api/admin/ai-moderation', null, b.adm);
    assert.equal(all.s, 200);
    assert.ok('origin' in all.j.logs[0] && 'action' in all.j.logs[0]);
    // 卡片统计
    const st = await b.call('GET', '/api/admin/ai-moderation/import', null, b.adm);
    assert.equal(st.s, 200);
    for (const k of ['job', 'settings', 'stats']) assert.ok(k in st.j, k);
    assert.equal(st.j.stats.rejectedPostsToday, 1);
    assert.equal(st.j.stats.rejectedCommentsToday, 2);
    assert.equal(st.j.stats.passedPostsToday, 2);
    assert.equal(st.j.stats.unreviewedPosts, 0);
    assert.equal(st.j.job, null);
    assert.deepEqual(st.j.settings, {enabled: true, reviewComments: true, onAiDown: 'skip', autoBackfill: true});
  } finally { await b.close(); }
});

test('AI 不可用（没配密钥）时默认不入库，下一轮 AI 恢复后再审入库；onAiDown=keyword 时只过屏蔽词', async () => {
  const env = {AI_RPM: '1000', AI_RPD: '100000'};
  const b = await boot({env});
  try {
    b.src.addV2ex(1, '正常帖 A', {replies: ['评论']});
    b.src.addV2ex(2, '正常帖 B');
    const r1 = await b.srv.importFeed.run();
    assert.equal(r1.v2ex.imported, 0, JSON.stringify(r1));
    assert.ok(r1.v2ex.pending >= 1);
    assert.equal(r1.aiDown, true);
    assert.equal(count(b.db, 'SELECT COUNT(*) n FROM posts WHERE source IS NOT NULL'), 0);
    env.AI_API_KEY = 'test-key-not-real';
    const r2 = await b.srv.importFeed.run();
    assert.equal(r2.v2ex.imported, 2, JSON.stringify(r2));
    assert.equal(r2.v2ex.comments, 1);
    // keyword 兜底
    delete env.AI_API_KEY;
    const set = await b.call('POST', '/api/admin/ai-moderation/import', {onAiDown: 'keyword'}, b.adm);
    assert.equal(set.s, 200, JSON.stringify(set.j));
    assert.equal(set.j.settings.onAiDown, 'keyword');
    assert.equal((await b.call('POST', '/api/admin/ai-moderation/import', {onAiDown: 'xx'}, b.adm)).s, 400);
    b.src.addV2ex(3, '关键词模式下的正常帖');
    const r3 = await b.srv.importFeed.run();
    assert.equal(r3.v2ex.imported, 1, JSON.stringify(r3));
    const row = b.db.prepare("SELECT ai_review FROM posts WHERE source='v2ex' AND source_id='3'").get();
    assert.equal(row.ai_review, null, '关键词兜底入库的仍算未经 AI 审，之后会补审');
  } finally { await b.close(); }
});

test('审查总开关关闭时直接入库；补审任务：不合格帖隐藏、不合格评论删除；409；停止', async () => {
  const b = await boot();
  try {
    const off = await b.call('POST', '/api/admin/ai-moderation/import', {enabled: false, autoBackfill: false}, b.adm);
    assert.equal(off.j.settings.enabled, false);
    b.src.addV2ex(1, '老帖正常', {replies: ['正常评论', '老评论赌博']});
    b.src.addV2ex(2, '老帖赌博');
    for (let i = 3; i <= 8; i++) b.src.addV2ex(i, '老帖 ' + i);
    const r1 = await b.srv.importFeed.run();
    assert.equal(r1.v2ex.imported, 8);
    assert.equal(b.ai.calls, 0, '关闭时不调 AI');
    await b.call('POST', '/api/admin/ai-moderation/import', {enabled: true}, b.adm);
    let st = (await b.call('GET', '/api/admin/ai-moderation/import', null, b.adm)).j;
    assert.equal(st.stats.unreviewedPosts, 8);
    assert.equal(st.stats.unreviewedComments, 2);
    assert.equal((await b.call('POST', '/api/admin/ai-moderation/import/backfill', {scope: 'nope'}, b.adm)).s, 400);
    const go = await b.call('POST', '/api/admin/ai-moderation/import/backfill', {scope: 'v2ex'}, b.adm);
    assert.equal(go.s, 200, JSON.stringify(go.j));
    assert.equal(go.j.job.status, 'running');
    assert.equal(go.j.job.scope, 'v2ex');
    assert.equal(go.j.job.total, 8);
    const job = await b.srv.aiReview.waitJob();
    assert.equal(job.status, 'done');
    assert.equal(job.done, 8);
    assert.equal(job.hiddenPosts, 1);
    assert.equal(job.removedComments, 1);
    assert.equal(job.passedPosts, 7);
    assert.equal(job.skipped, 0);
    const bad = b.db.prepare("SELECT * FROM posts WHERE source='v2ex' AND source_id='2'").get();
    assert.ok(bad.deleted_at && bad.admin_hidden === 1 && bad.ai_review === 'block');
    assert.match(bad.admin_reason, /AI 补审未通过/);
    const bc = b.db.prepare("SELECT * FROM post_comments WHERE text LIKE '%赌博%'").get();
    assert.ok(bc.deleted_at && bc.admin_hidden === 1);
    st = (await b.call('GET', '/api/admin/ai-moderation/import', null, b.adm)).j;
    assert.equal(st.stats.unreviewedPosts, 0);
    assert.equal(st.stats.unreviewedComments, 0);
    assert.equal(st.job.status, 'done');
    const lg = (await b.call('GET', '/api/admin/ai-moderation?kind=import', null, b.adm)).j.logs;
    assert.ok(lg.some(x => x.kind === 'backfill' && x.action === 'hidden' && x.originUrl === 'https://www.v2ex.com/t/2'));
    assert.ok(lg.some(x => x.kind === 'backfill_comment' && x.action === 'removed'));
    // 被补审下架的不会被再次导入
    const r2 = await b.srv.importFeed.run();
    assert.equal(r2.v2ex.imported, 0);
    // 慢 AI：任务进行中再启动 → 409；停止后 stopped
    await b.call('POST', '/api/admin/ai-moderation/import', {enabled: false}, b.adm);
    for (let i = 20; i < 30; i++) b.src.addV2ex(i, '新一批 ' + i);
    await b.srv.importFeed.run();
    await b.call('POST', '/api/admin/ai-moderation/import', {enabled: true}, b.adm);
    b.ai.delayMs = 30;
    const g2 = await b.call('POST', '/api/admin/ai-moderation/import/backfill', {scope: 'all'}, b.adm);
    assert.equal(g2.j.job.total, 10);
    const dup = await b.call('POST', '/api/admin/ai-moderation/import/backfill', {scope: 'all'}, b.adm);
    assert.equal(dup.s, 409);
    assert.equal(dup.j.error.code, 'JOB_RUNNING');
    const stop = await b.call('POST', '/api/admin/ai-moderation/import/backfill/stop', {}, b.adm);
    assert.equal(stop.s, 200);
    const j2 = await b.srv.aiReview.waitJob();
    assert.equal(j2.status, 'stopped');
    assert.ok(j2.done < 10);
    assert.ok(j2.finishedAt);
  } finally { await b.close(); }
});

test('补审时 AI 不可用：计入 skipped，保持未审', async () => {
  const b = await boot();
  try {
    await b.call('POST', '/api/admin/ai-moderation/import', {enabled: false}, b.adm);
    b.src.addV2ex(1, '帖一'); b.src.addV2ex(2, '帖二');
    await b.srv.importFeed.run();
    await b.call('POST', '/api/admin/ai-moderation/import', {enabled: true}, b.adm);
    b.ai.down = true;
    await b.call('POST', '/api/admin/ai-moderation/import/backfill', {scope: 'all'}, b.adm);
    const job = await b.srv.aiReview.waitJob();
    assert.equal(job.status, 'done');
    assert.equal(job.skipped, 2);
    assert.ok(job.error);
    assert.equal(count(b.db, 'SELECT COUNT(*) n FROM posts WHERE source IS NOT NULL AND ai_review IS NULL AND deleted_at IS NULL'), 2);
  } finally { await b.close(); }
});

test('导入量：已有帖不占名额，每轮每个来源最多新入库 20 帖；审查前后数量；作者和评论者都有头像', async () => {
  const b = await boot();
  try {
    for (let i = 1; i <= 30; i++) b.src.addV2ex(i, (i % 10 === 0 ? '赌博 ' : '话题 ') + i, {replies: ['回复一 ' + i, '回复二 ' + i]});
    for (let i = 1; i <= 30; i++) b.src.addHn(1000 + i, (i % 10 === 0 ? 'BLOCKME ' : 'Story ') + i, ['c1', 'c2', 'c3']);
    const r1 = await b.srv.importFeed.run();
    // 最新榜倒序：30、20、10 三个被拒，要看 23 个候选才凑够 20 个新帖
    assert.equal(r1.v2ex.imported, 20, JSON.stringify(r1.v2ex));
    assert.equal(r1.v2ex.rejected, 3);
    assert.equal(r1.v2ex.scanned, 23);
    assert.equal(r1.hn.imported, 20, JSON.stringify(r1.hn));
    assert.ok(r1.hn.rejected >= 2);
    assert.ok(r1.total.imported >= 20, '一轮至少 20 帖');
    assert.equal(r1.v2ex.comments, 40);
    assert.equal(r1.hn.comments, 60);
    // 第二轮：剩下的继续入库（以前已有帖也算名额，第二轮几乎没有新帖）
    const r2 = await b.srv.importFeed.run();
    assert.equal(r2.v2ex.imported, 30 - 20 - 3, JSON.stringify(r2.v2ex));
    assert.equal(r2.hn.imported, 30 - 20 - 3, JSON.stringify(r2.hn));
    // 头像：V2EX 作者和评论者走本站代理；HN 没有头像，用字母头像
    const reg = await b.call('POST', '/api/auth/register', {agree: true, username: 'avatar_u', email: 'avatar_u@qq.com', password: 'Passw0rd123'});
    const tok = reg.j.token;
    const feed = (await b.call('GET', '/api/posts?limit=50', null, tok)).j.posts;
    const v = feed.find(p => p.source === 'v2ex');
    const h = feed.find(p => p.source === 'hn');
    assert.match(v.author.avatar.image, /^\/api\/import\/avatar\?u=/);
    assert.match(h.author.avatar.image, /^data:image\/svg\+xml/);
    const vc = (await b.call('GET', '/api/posts/' + v.id + '/comments', null, tok)).j.comments;
    assert.ok(vc.length >= 2);
    assert.ok(vc.every(c => /^\/api\/import\/avatar\?u=/.test(c.author.avatar.image)));
    const hc = (await b.call('GET', '/api/posts/' + h.id + '/comments', null, tok)).j.comments;
    assert.ok(hc.length >= 1 && hc.every(c => /^data:image\/svg\+xml/.test(c.author.avatar.image)));
  } finally { await b.close(); }
});

test('默认每 2 分钟一轮', async () => {
  const {readFileSync} = await import('node:fs');
  const src = readFileSync(new URL('../index.mjs', import.meta.url), 'utf8');
  assert.match(src, /NOVA_IMPORT_INTERVAL_MS'\) \|\| 2 \* 60 \* 1000/);
});
