// M4.1.5 动态列表分页与回归：游标分页、重复请求和并发操作可控。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';

let srv, base, seq = 0;
test.before(async () => { srv = createApp(); await new Promise(r => srv.listen(0, '127.0.0.1', r)); base = 'http://127.0.0.1:' + srv.address().port; });
test.after(() => srv.close());
const call = async (m, p, body, tok) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  return {s: r.status, j: await r.json()};
};
async function acc(n) {
  const u = n + (++seq);
  const r = await call('POST', '/api/auth/register', {username: u, email: u + '@x.test', password: 'Passw0rd123'});
  return {tok: r.j.token, id: r.j.user.id};
}

test('游标分页：页之间不重复、合在一起是全部，顺序稳定；坏游标 400', async () => {
  const a = await acc('pg');
  const ids = [];
  for (let i = 0; i < 25; i++) {
    const r = await call('POST', '/api/posts', {text: '第 ' + i + ' 句', clientId: 'p' + i}, a.tok);
    assert.equal(r.s, 200, JSON.stringify(r.j));
    ids.push(r.j.post.id);
  }
  const p1 = await call('GET', '/api/posts?author=me&limit=10', null, a.tok);
  assert.equal(p1.j.posts.length, 10);
  assert.ok(p1.j.nextCursor);
  const p2 = await call('GET', '/api/posts?author=me&limit=10&cursor=' + p1.j.nextCursor, null, a.tok);
  const p3 = await call('GET', '/api/posts?author=me&limit=10&cursor=' + p2.j.nextCursor, null, a.tok);
  const all = [...p1.j.posts, ...p2.j.posts, ...p3.j.posts];
  assert.equal(all.length, 25);
  const seen = new Set(all.map(p => p.id));
  assert.equal(seen.size, 25, '页之间没有重复');
  ids.forEach(id => assert.ok(seen.has(id)));
  // 再要同一页，结果一致
  const p1b = await call('GET', '/api/posts?author=me&limit=10', null, a.tok);
  assert.deepEqual(p1b.j.posts.map(p => p.id), p1.j.posts.map(p => p.id));
  assert.equal(p3.j.nextCursor, null);
  assert.equal((await call('GET', '/api/posts?cursor=po_nope', null, a.tok)).s, 400);
});

test('并发发帖全部入库；同一 clientId 并发只留一条', async () => {
  const a = await acc('cc');
  const jobs = Array.from({length: 12}, (_, i) => call('POST', '/api/posts', {text: '并发 ' + i, clientId: 'par-' + i}, a.tok));
  const rs = await Promise.all(jobs);
  assert.ok(rs.every(r => r.s === 200));
  const n = srv.db.prepare('SELECT COUNT(*) c FROM posts WHERE author_id=? AND deleted_at IS NULL').get(a.id).c;
  assert.equal(n, 12);
  const same = await Promise.all([
    call('POST', '/api/posts', {text: '只一次', clientId: 'same-x'}, a.tok),
    call('POST', '/api/posts', {text: '只一次', clientId: 'same-x'}, a.tok),
    call('POST', '/api/posts', {text: '只一次', clientId: 'same-x'}, a.tok),
  ]);
  assert.ok(same.every(r => r.s === 200));
  const ids = new Set(same.map(r => r.j.post.id));
  assert.equal(ids.size, 1);
  assert.ok(same.some(r => r.j.idempotent === true) || same.every(r => r.j.post.id === same[0].j.post.id));
  assert.equal(srv.db.prepare('SELECT COUNT(*) c FROM posts WHERE author_id=? AND client_id=?').get(a.id, 'same-x').c, 1);
});

test('回归：发帖、编辑、评论、表态、关注后列表和分页仍然一致', async () => {
  const a = await acc('rg'), b = await acc('rh');
  const p = (await call('POST', '/api/posts', {text: '原稿'}, a.tok)).j.post;
  await call('POST', '/api/posts/' + p.id + '/edit', {text: '改过'}, a.tok);
  await call('POST', '/api/posts/' + p.id + '/comments', {text: '评'}, b.tok);
  await call('POST', '/api/posts/' + p.id + '/react', {index: 1}, b.tok);
  await call('POST', '/api/follows', {userId: a.id}, b.tok);
  const got = await call('GET', '/api/posts/' + p.id, null, b.tok);
  assert.equal(got.j.post.text, '改过');
  assert.equal(got.j.post.commentCount, 1);
  assert.equal(got.j.post.reactions[1], 1);
  const feed = await call('GET', '/api/posts?feed=follow', null, b.tok);
  assert.ok(feed.j.posts.some(x => x.id === p.id));
  // 并发表态不把计数加到超过人数
  await Promise.all([0, 1, 2].map(() => call('POST', '/api/posts/' + p.id + '/react', {index: 1}, b.tok)));
  const after = await call('GET', '/api/posts/' + p.id, null, a.tok);
  assert.ok(after.j.post.reactions[1] <= 2);
});
