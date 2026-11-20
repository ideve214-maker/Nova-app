// 2.1.2 管理端内容列表带分类/来源，支持筛选，以及管理员改分类。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';

let srv, base, seq = 0, adm, db;
test.before(async () => {
  srv = createApp({adminUsername: 'ops_cat', adminPassword: 'OpsCatPass1!', importAuto: false, scheduleAuto: false});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  db = srv.db;
  adm = (await call('POST', '/api/admin/auth/login', {username: 'ops_cat', password: 'OpsCatPass1!'})).j.token;
});
test.after(() => srv.close());
const call = async (m, p, body, tok) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  let j = null; try { j = await r.json(); } catch {}
  return {s: r.status, j};
};
async function acc(n) {
  const u = n + (++seq);
  const r = await call('POST', '/api/auth/register', {agree: true, username: u, email: u + '@x.test', password: 'Passw0rd123'});
  return {tok: r.j.token, id: r.j.user.id, u};
}
function insertImport(authorId, {id, source, text, category, at}) {
  const t = at || Date.now();
  db.prepare(`INSERT INTO posts(id,author_id,text,created_at,updated_at,audience,source,source_id,source_url,ext_author_name,category)
    VALUES(?,?,?,?,?,'public',?,?,?,?,?)`).run(id, authorId, text, t, t, source, id, 'https://example.com/' + id, '作者', category);
}

test('内容列表和营销帖列表带 category / source / sourceLabel；用户帖为用户，外部帖用来源目录名', async () => {
  const a = await acc('meta');
  const user = await call('POST', '/api/posts', {text: '用户科技帖-标签', category: 'tech'}, a.tok);
  assert.equal(user.s, 200, JSON.stringify(user.j));
  const uid = user.j.post.id;
  insertImport(a.id, {id: 'po_sspai_lab', source: 'sspai', text: '少数派外部帖-标签', category: 'tech'});

  const content = await call('GET', '/api/admin/content?type=post&q=' + encodeURIComponent('标签'), null, adm);
  assert.equal(content.s, 200, JSON.stringify(content.j));
  const uRow = content.j.items.find(i => i.id === uid);
  const eRow = content.j.items.find(i => i.id === 'po_sspai_lab');
  assert.ok(uRow && eRow, JSON.stringify(content.j.items));
  assert.equal(uRow.category, 'tech');
  assert.equal(uRow.source, 'user');
  assert.equal(uRow.sourceLabel, '用户');
  assert.equal(eRow.category, 'tech');
  assert.equal(eRow.source, 'sspai');
  assert.equal(eRow.sourceLabel, '少数派');

  const mk = await call('GET', '/api/admin/marketing/posts?q=' + encodeURIComponent('标签'), null, adm);
  assert.equal(mk.s, 200, JSON.stringify(mk.j));
  const mu = mk.j.posts.find(i => i.id === uid);
  const me = mk.j.posts.find(i => i.id === 'po_sspai_lab');
  assert.ok(mu && me, JSON.stringify(mk.j.posts));
  assert.equal(mu.source, 'user');
  assert.equal(mu.sourceLabel, '用户');
  assert.equal(me.source, 'sspai');
  assert.equal(me.sourceLabel, '少数派');
  assert.equal(mu.category, 'tech');
  assert.equal(me.category, 'tech');
});

test('category 与 source 在分页前用 SQL 筛选；非法分类 400 BAD_CATEGORY', async () => {
  const a = await acc('filt');
  const t = Date.now();
  const life = [];
  for (let i = 0; i < 3; i++) {
    const r = await call('POST', '/api/posts', {text: '筛选生活帖-' + i + '-' + a.u, category: 'life'}, a.tok);
    assert.equal(r.s, 200, JSON.stringify(r.j));
    life.push(r.j.post.id);
  }
  const game = await call('POST', '/api/posts', {text: '筛选游戏帖-' + a.u, category: 'game'}, a.tok);
  assert.equal(game.s, 200);
  insertImport(a.id, {id: 'po_ithome_' + a.u, source: 'ithome', text: '筛选生活帖-外部-' + a.u, category: 'life', at: t + 10});

  const q = encodeURIComponent('筛选生活帖-');
  const page = await call('GET', `/api/admin/content?type=post&category=life&source=user&q=${q}&limit=2`, null, adm);
  assert.equal(page.s, 200, JSON.stringify(page.j));
  assert.equal(page.j.items.length, 2);
  assert.ok(page.j.items.every(i => i.category === 'life' && i.source === 'user'));
  assert.ok(!page.j.items.some(i => i.id === game.j.post.id || String(i.id).startsWith('po_ithome_')));
  assert.ok(page.j.nextCursor, '筛选后仍应按分页截断');

  const ext = await call('GET', `/api/admin/content?type=post&source=ithome&q=${encodeURIComponent('筛选生活帖-外部-')}`, null, adm);
  assert.equal(ext.s, 200);
  assert.ok(ext.j.items.some(i => i.id === 'po_ithome_' + a.u && i.source === 'ithome' && i.sourceLabel === 'IT之家'));
  assert.ok(ext.j.items.every(i => i.source === 'ithome'));

  const allExt = await call('GET', `/api/admin/content?type=post&source=external&category=life&q=${q}`, null, adm);
  assert.equal(allExt.s, 200);
  assert.ok(allExt.j.items.some(i => i.id === 'po_ithome_' + a.u));
  assert.ok(allExt.j.items.every(i => i.source !== 'user'));

  const mkUser = await call('GET', `/api/admin/marketing/posts?category=life&source=user&q=${q}&limit=2`, null, adm);
  assert.equal(mkUser.s, 200, JSON.stringify(mkUser.j));
  assert.equal(mkUser.j.posts.length, 2);
  assert.ok(mkUser.j.posts.every(i => i.category === 'life' && i.source === 'user'));

  const bad = await call('GET', '/api/admin/content?type=post&category=sports', null, adm);
  assert.equal(bad.s, 400);
  assert.equal(bad.j.error.code, 'BAD_CATEGORY');
  const badMk = await call('GET', '/api/admin/marketing/posts?category=sports', null, adm);
  assert.equal(badMk.s, 400);
  assert.equal(badMk.j.error.code, 'BAD_CATEGORY');
});

test('POST /api/admin/posts/:id/category 可改可清空，写入审计；非法分类 400，不存在 404', async () => {
  const a = await acc('chg');
  const p = await call('POST', '/api/posts', {text: '待改分类', category: 'life'}, a.tok);
  assert.equal(p.s, 200);
  const id = p.j.post.id;
  assert.equal((await call('POST', `/api/admin/posts/${id}/category`, {category: 'tech'})).s, 401);
  const set = await call('POST', `/api/admin/posts/${id}/category`, {category: 'tech'}, adm);
  assert.equal(set.s, 200, JSON.stringify(set.j));
  assert.deepEqual(set.j, {ok: true, post: {id, category: 'tech'}});
  const listed = await call('GET', '/api/admin/content?type=post&q=' + encodeURIComponent('待改分类'), null, adm);
  assert.equal(listed.j.items.find(i => i.id === id).category, 'tech');

  const clr = await call('POST', `/api/admin/posts/${id}/category`, {category: null}, adm);
  assert.equal(clr.s, 200, JSON.stringify(clr.j));
  assert.deepEqual(clr.j, {ok: true, post: {id, category: null}});
  const after = await call('GET', '/api/admin/content?type=post&q=' + encodeURIComponent('待改分类'), null, adm);
  assert.equal(after.j.items.find(i => i.id === id).category, null);

  const bad = await call('POST', `/api/admin/posts/${id}/category`, {category: 'sports'}, adm);
  assert.equal(bad.s, 400);
  assert.equal(bad.j.error.code, 'BAD_CATEGORY');
  const miss = await call('POST', '/api/admin/posts/po_no_such/category', {category: 'tech'}, adm);
  assert.equal(miss.s, 404);
  assert.equal(miss.j.error.code, 'NOT_FOUND');

  const audit = await call('GET', '/api/admin/audit?action=admin.post.category', null, adm);
  assert.equal(audit.s, 200);
  assert.ok(audit.j.audits.some(x => x.action === 'admin.post.category' && String(x.target || x.object || '').includes(id)), JSON.stringify(audit.j.audits.slice(0, 5)));
});
