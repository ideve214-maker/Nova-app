// V2EX / HN 导入：模拟 fetch。覆盖去重、删除后不再导入、评论入库、失败时保留旧数据、首页可见、互动。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';
import {htmlToText, isAllowedAvatarHost, isReservedImportIdentity, SOURCE_LABEL, IMPORT_USERNAME} from '../import-feed.mjs';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X89QAAAAASUVORK5CYII=',
  'base64',
);

const V2EX_HOT = [
  {
    id: 1001, title: 'V2EX 测试帖标题', url: 'https://www.v2ex.com/t/1001',
    content: '这是 V2EX 正文。', created: 1730000000,
    member: {username: 'Livid', avatar_normal: 'https://cdn.v2ex.com/avatar.png'},
  },
  {
    id: 1002, title: '另一篇', url: 'https://www.v2ex.com/t/1002',
    content: '第二篇。', created: 1730000100,
    member: {username: 'jay', avatar_normal: 'https://cdn.v2ex.com/jay.png'},
  },
];
const V2EX_REPLIES = {
  1001: [
    {id: 11, content: '第一条评论', created: 1730000001, member: {username: 'alice'}},
    {id: 12, content: '第二条评论', created: 1730000002, member: {username: 'bob'}},
  ],
  1002: [{id: 21, content: '只有一条', created: 1730000101, member: {username: 'carol'}}],
};
const HN_ITEMS = {
  9001: {
    id: 9001, type: 'story', by: 'pg', title: 'Show HN: A test story',
    url: 'https://example.com/hn', time: 1730001000, kids: [9101, 9102],
  },
  9101: {id: 9101, type: 'comment', by: 'johndoe', text: 'HN <i>first</i> comment', time: 1730001001, parent: 9001},
  9102: {id: 9102, type: 'comment', by: 'jane', text: 'HN second', time: 1730001002, parent: 9001},
};

function mockFetch({failHot = false, failTop = false, failAll = false, calls} = {}) {
  const log = calls || [];
  return async (url, opts = {}) => {
    const u = String(url);
    log.push(u);
    if (failAll) throw new Error('network down');
    if (u.includes('cdn.v2ex.com')) {
      return {ok: true, status: 200, headers: {get: k => k.toLowerCase() === 'content-type' ? 'image/png' : null}, arrayBuffer: async () => PNG};
    }
    if (u.includes('/api/topics/hot.json')) {
      if (failHot) throw new Error('v2ex down');
      return {ok: true, status: 200, json: async () => V2EX_HOT};
    }
    if (u.includes('/api/replies/show.json')) {
      const m = u.match(/topic_id=(\d+)/);
      const id = m ? Number(m[1]) : 0;
      return {ok: true, status: 200, json: async () => V2EX_REPLIES[id] || []};
    }
    if (u.includes('/v0/topstories.json')) {
      if (failTop) throw new Error('hn down');
      return {ok: true, status: 200, json: async () => [9001]};
    }
    const im = u.match(/\/v0\/item\/(\d+)\.json/);
    if (im) {
      const item = HN_ITEMS[Number(im[1])];
      if (!item) return {ok: false, status: 404, json: async () => null};
      return {ok: true, status: 200, json: async () => item};
    }
    return {ok: false, status: 404, json: async () => ({})};
  };
}

let seq = 0;
async function boot(opts = {}) {
  const calls = [];
  const srv = createApp({
    importFetch: opts.importFetch || mockFetch({calls, ...opts.mock}),
    importAuto: false,
    importDelayMs: 0,
    importLimit: opts.importLimit ?? 20,
    importCommentLimit: opts.importCommentLimit ?? 10,
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  return {srv, base, calls, close: () => new Promise(r => { srv.close(r); srv.closeAllConnections?.(); })};
}
const call = async (base, m, p, body, tok) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  let j = null; try { j = await r.json(); } catch {}
  return {s: r.status, j};
};
async function acc(base, n) {
  const u = n + (++seq);
  const r = await call(base, 'POST', '/api/auth/register', {agree: true, username: u, email: u + '@qq.com', password: 'Passw0rd123'});
  assert.equal(r.s, 200, JSON.stringify(r.j));
  return {tok: r.j.token, id: r.j.user.id};
}

test('htmlToText 去掉标签并还原实体', () => {
  assert.equal(htmlToText('HN <i>first</i> comment'), 'HN first comment');
  assert.equal(htmlToText('a<br>b'), 'a\nb');
  assert.equal(htmlToText('x &amp; y'), 'x & y');
  assert.equal(isAllowedAvatarHost('https://cdn.v2ex.com/a.png'), true);
  assert.equal(isAllowedAvatarHost('https://evil.example/a.png'), false);
  assert.equal(isReservedImportIdentity('vexo_import', 'a@b.c'), true);
});

test('导入后首页能看到带来源标记的帖和评论；可点赞收藏评论', async () => {
  const b = await boot();
  try {
    const who = await acc(b.base, 'imp');
    const run = await b.srv.importFeed.run();
    assert.equal(run.v2ex.ok, true, JSON.stringify(run));
    assert.equal(run.hn.ok, true);
    assert.equal(run.v2ex.imported, 2);
    assert.equal(run.hn.imported, 1);
    assert.ok(run.v2ex.comments >= 2);
    assert.ok(run.hn.comments >= 2);

    const feed = await call(b.base, 'GET', '/api/posts?limit=20', null, who.tok);
    assert.equal(feed.s, 200);
    const posts = feed.j.posts || [];
    const v = posts.find(p => p.source === 'v2ex' && p.sourceUrl && p.sourceUrl.includes('/t/1001'));
    const h = posts.find(p => p.source === 'hn');
    assert.ok(v, '首页有 V2EX 帖');
    assert.ok(h, '首页有 HN 帖');
    assert.equal(v.sourceLabel, SOURCE_LABEL.v2ex);
    assert.equal(v.author.displayName, 'Livid');
    assert.equal(v.author.external, true);
    assert.match(String(v.author.id), /^ext:v2ex:/);
    assert.equal(v.mine, false);
    assert.match(v.text, /V2EX 测试帖标题/);
    assert.equal(h.sourceLabel, SOURCE_LABEL.hn);
    assert.equal(h.author.displayName, 'pg');
    assert.match(h.text, /Show HN: A test story/); // 英文标题保持原文
    assert.match(h.text, /example.com\/hn/);

    const cm = await call(b.base, 'GET', '/api/posts/' + v.id + '/comments', null, who.tok);
    assert.equal(cm.s, 200);
    const names = (cm.j.comments || []).map(c => c.author.displayName);
    assert.ok(names.includes('alice'));
    assert.ok(names.includes('bob'));
    assert.equal(cm.j.comments[0].author.external, true);
    assert.equal(cm.j.comments[0].source, 'v2ex');

    const like = await call(b.base, 'POST', '/api/posts/' + v.id + '/react', {index: 0}, who.tok);
    assert.equal(like.s, 200, JSON.stringify(like.j));
    assert.ok((like.j.reactions || like.j.post?.reactions || [1])[0] >= 1 || like.j.ok);

    const fav = await call(b.base, 'POST', '/api/me/saved', {kind: 'post', target: v.id, title: 't'}, who.tok);
    assert.equal(fav.s, 200, JSON.stringify(fav.j));
    assert.ok((fav.j.bookmarkCount || 0) >= 1);

    const add = await call(b.base, 'POST', '/api/posts/' + v.id + '/comments', {text: '本站用户留言'}, who.tok);
    assert.equal(add.s, 200, JSON.stringify(add.j));
    assert.equal(add.j.comment.text, '本站用户留言');
    assert.equal(add.j.comment.mine, true);
    assert.ok(!add.j.comment.source);
  } finally { await b.close(); }
});

test('同一源再跑一遍会去重，不会新增帖', async () => {
  const b = await boot();
  try {
    const r1 = await b.srv.importFeed.run();
    const r2 = await b.srv.importFeed.run();
    assert.equal(r1.v2ex.imported, 2);
    assert.equal(r1.hn.imported, 1);
    assert.equal(r2.v2ex.imported, 0);
    assert.equal(r2.hn.imported, 0);
    assert.ok(r2.v2ex.skipped >= 2);
    const n = b.srv.db.prepare("SELECT COUNT(*) n FROM posts WHERE source IS NOT NULL AND deleted_at IS NULL").get().n;
    assert.equal(n, 3);
  } finally { await b.close(); }
});

test('管理端删除或隐藏后不会再导入（deleted stays deleted）', async () => {
  const b = await boot();
  try {
    await b.srv.importFeed.run();
    const row = b.srv.db.prepare("SELECT * FROM posts WHERE source='v2ex' AND source_id='1001'").get();
    assert.ok(row);
    b.srv.db.prepare('UPDATE posts SET deleted_at=?, admin_hidden=1 WHERE id=?').run(Date.now(), row.id);
    const r2 = await b.srv.importFeed.run();
    assert.ok(r2.v2ex.deletedKept >= 1, JSON.stringify(r2));
    const again = b.srv.db.prepare("SELECT * FROM posts WHERE source='v2ex' AND source_id='1001'").get();
    assert.equal(again.id, row.id);
    assert.ok(again.deleted_at);
    assert.equal(again.admin_hidden, 1);
    const who = await acc(b.base, 'del');
    const feed = await call(b.base, 'GET', '/api/posts?limit=20', null, who.tok);
    assert.ok(!(feed.j.posts || []).some(p => p.id === row.id));
  } finally { await b.close(); }
});

test('拉取失败时保留上一轮已导入的数据', async () => {
  let mode = 'ok';
  const fetchFn = async (url, opts) => {
    if (mode === 'fail') throw new Error('network down');
    return mockFetch()(url, opts);
  };
  const srv = createApp({importFetch: fetchFn, importAuto: false, importDelayMs: 0});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  try {
    const r1 = await srv.importFeed.run();
    assert.equal(r1.v2ex.ok, true);
    const n1 = srv.db.prepare("SELECT COUNT(*) n FROM posts WHERE source IS NOT NULL").get().n;
    assert.equal(n1, 3);
    mode = 'fail';
    const r2 = await srv.importFeed.run();
    assert.equal(r2.v2ex.ok, false);
    assert.equal(r2.hn.ok, false);
    const n2 = srv.db.prepare("SELECT COUNT(*) n FROM posts WHERE source IS NOT NULL").get().n;
    assert.equal(n2, n1);
    const who = await acc(base, 'keep');
    const feed = await call(base, 'GET', '/api/posts?limit=20', null, who.tok);
    assert.equal((feed.j.posts || []).filter(p => p.source).length, 3);
  } finally {
    await new Promise(r => { srv.close(r); srv.closeAllConnections?.(); });
  }
});

test('系统账号不能注册也不能登录', async () => {
  const b = await boot();
  try {
    const r = await call(b.base, 'POST', '/api/auth/register', {agree: true, username: IMPORT_USERNAME, email: 'other@qq.com', password: 'Passw0rd123'});
    assert.equal(r.s, 409, JSON.stringify(r.j));
    const e = await call(b.base, 'POST', '/api/auth/register', {agree: true, username: 'notimport', email: 'vexo-import@vexo.invalid', password: 'Passw0rd123'});
    assert.equal(e.s, 409);
  } finally { await b.close(); }
});

test('迁移按完整文件名记账：已执行 057–061 的库仍会跑 056 和 062', async () => {
  const {mkdtempSync, mkdirSync, writeFileSync, rmSync} = await import('node:fs');
  const {join} = await import('node:path');
  const {tmpdir} = await import('node:os');
  const {openDb} = await import('../db.mjs');

  const dir = mkdtempSync(join(tmpdir(), 'nova-mig-'));
  const first = join(dir, 'first');
  const second = join(dir, 'all');
  const dbPath = join(dir, 't.db');
  mkdirSync(first);
  mkdirSync(second);
  const init = `CREATE TABLE IF NOT EXISTS posts(id TEXT PRIMARY KEY, author_id INTEGER, text TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS post_comments(id TEXT PRIMARY KEY, post_id TEXT, author_id INTEGER, text TEXT, created_at INTEGER);
`;
  const applied = [
    '057_admin_ai.sql',
    '058_admin_ads.sql',
    '059_ai_auto_ads.sql',
    '060_ai_providers_quota.sql',
    '061_ai_failover.sql',
  ];
  writeFileSync(join(first, '001_init.sql'), init);
  for (const n of applied) writeFileSync(join(first, n), '-- applied\n');

  const db1 = openDb(dbPath, {migrationsDir: first});
  const done1 = db1.prepare('SELECT name FROM schema_migrations ORDER BY name').all().map(r => r.name);
  db1.close();
  assert.deepEqual(done1, ['001_init.sql', ...applied]);

  writeFileSync(join(second, '001_init.sql'), init);
  writeFileSync(join(second, '056_post_repost.sql'), 'ALTER TABLE posts ADD COLUMN repost_of TEXT;\n');
  for (const n of applied) writeFileSync(join(second, n), '-- already applied\n');
  writeFileSync(join(second, '062_import_feed.sql'), 'ALTER TABLE posts ADD COLUMN source TEXT;\nALTER TABLE post_comments ADD COLUMN source TEXT;\n');

  const db2 = openDb(dbPath, {migrationsDir: second});
  const done2 = new Set(db2.prepare('SELECT name FROM schema_migrations').all().map(r => r.name));
  const cols = db2.prepare('PRAGMA table_info(posts)').all().map(r => r.name);
  const ccols = db2.prepare('PRAGMA table_info(post_comments)').all().map(r => r.name);
  db2.close();
  rmSync(dir, {recursive: true, force: true});
  assert.ok(done2.has('056_post_repost.sql'), '056 should still apply by filename');
  assert.ok(done2.has('062_import_feed.sql'), '062 should apply');
  assert.ok(cols.includes('repost_of'));
  assert.ok(cols.includes('source'));
  assert.ok(ccols.includes('source'));
});

function abortErr() {
  const e = new Error('This operation was aborted');
  e.name = 'AbortError';
  return e;
}

test('V2EX 评论当轮中断后会退避重试；仍失败则留下帖子，下次运行补回评论', async () => {
  let replies1001 = 0;
  let replies1002 = 0;
  const fetchFn = async (url, opts) => {
    const u = String(url);
    if (u.includes('/api/replies/show.json') && u.includes('topic_id=1001')) {
      replies1001++;
      if (replies1001 <= 2) throw abortErr(); // 前两次中断，第三次成功（当轮重试）
    }
    if (u.includes('/api/replies/show.json') && u.includes('topic_id=1002')) {
      replies1002++;
      if (replies1002 <= 3) throw abortErr(); // 第一轮三次都中断，第二轮才成功（补回）
    }
    return mockFetch()(url, opts);
  };
  const srv = createApp({
    importFetch: fetchFn, importAuto: false, importDelayMs: 0, importRetryDelayMs: 0,
    importRetries: 3,
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  try {
    const r1 = await srv.importFeed.run();
    assert.equal(r1.v2ex.ok, true, JSON.stringify(r1));
    assert.equal(r1.v2ex.imported, 2);
    const p1 = srv.db.prepare("SELECT * FROM posts WHERE source='v2ex' AND source_id='1001'").get();
    const p2 = srv.db.prepare("SELECT * FROM posts WHERE source='v2ex' AND source_id='1002'").get();
    assert.ok(p1 && p2, '帖子在评论失败时也要入库');
    const c1 = srv.db.prepare("SELECT COUNT(*) n FROM post_comments WHERE post_id=?").get(p1.id).n;
    const c2 = srv.db.prepare("SELECT COUNT(*) n FROM post_comments WHERE post_id=?").get(p2.id).n;
    assert.equal(c1, 2, '1001 当轮重试成功应写入评论');
    assert.equal(c2, 0, '1002 当轮三次都中断，评论应缺失');
    assert.ok(replies1001 >= 3, '1001 应重试到第三次, got ' + replies1001);
    assert.equal(replies1002, 3, '1002 第一轮应尝试 3 次, got ' + replies1002);

    const r2 = await srv.importFeed.run();
    assert.equal(r2.v2ex.imported, 0, '第二轮不应再新增帖');
    const c2b = srv.db.prepare("SELECT COUNT(*) n FROM post_comments WHERE post_id=?").get(p2.id).n;
    assert.equal(c2b, 1, '第二轮应给 1002 补回评论');
    const texts = srv.db.prepare("SELECT text FROM post_comments WHERE post_id=?").all(p2.id).map(r => r.text);
    assert.ok(texts.includes('只有一条'));
    assert.ok(replies1002 >= 4, '第二轮应再次请求 1002 评论');

    const who = await acc(base, 'bfill');
    const cm = await call(base, 'GET', '/api/posts/' + p2.id + '/comments', null, who.tok);
    assert.equal(cm.s, 200);
    assert.ok((cm.j.comments || []).some(c => c.author.displayName === 'carol'));
  } finally {
    await new Promise(r => { srv.close(r); srv.closeAllConnections?.(); });
  }
});

test('V2EX 评论超时日志写明 topic 与将在下轮重试', async () => {
  const {createImportFeed} = await import('../import-feed.mjs');
  const {openDb} = await import('../db.mjs');
  const logs = [];
  const db = openDb(':memory:');
  let n = 0;
  const fetchFn = async (url) => {
    const u = String(url);
    if (u.includes('/api/topics/hot.json')) return {ok: true, status: 200, json: async () => [V2EX_HOT[0]]};
    if (u.includes('/api/replies/show.json')) {
      n++;
      throw abortErr();
    }
    if (u.includes('/v0/topstories.json')) return {ok: true, status: 200, json: async () => []};
    return {ok: false, status: 404, json: async () => ({})};
  };
  const feed = createImportFeed(db, {
    fetchFn, importAuto: false, delayMs: 0, retryDelayMs: 0, retries: 2,
    repliesTimeoutMs: 45_000, log: (...a) => logs.push(a.map(String).join(' ')),
  });
  const r = await feed.run();
  assert.equal(r.v2ex.imported, 1);
  const comments = db.prepare("SELECT COUNT(*) n FROM post_comments").get().n;
  assert.equal(comments, 0);
  const line = logs.find(s => s.includes('import v2ex replies topic=1001'));
  assert.ok(line, 'expected clear log, got ' + JSON.stringify(logs));
  assert.match(line, /timeout\/aborted after 45000ms/);
  assert.match(line, /will retry on next run/);
  assert.equal(n, 2);
  db.close();
});
