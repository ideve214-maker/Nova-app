// M4.1.1 动态表结构与发帖 API：帖子真实入库；服务端确认后再算发布成功。
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
async function acc(name) {
  const u = (name || 'u') + (++seq), r = await call('POST', '/api/auth/register', {username: u, email: u + '@x.test', password: 'Passw0rd123'});
  assert.equal(r.s, 200, JSON.stringify(r.j));
  return {tok: r.j.token, id: r.j.user.id, username: r.j.user.username};
}

test('未登录不能发帖或读动态', async () => {
  assert.equal((await call('POST', '/api/posts', {text: 'hi'})).s, 401);
  assert.equal((await call('GET', '/api/posts')).s, 401);
});

test('发帖真实入库，响应里带回帖子；库中有记录；空内容和超长被拒', async () => {
  const a = await acc('poster');
  const empty = await call('POST', '/api/posts', {text: '   '}, a.tok);
  assert.equal(empty.s, 400); assert.equal(empty.j.error.code, 'BAD_TEXT');
  const r = await call('POST', '/api/posts', {text: '今晚只留一句。'}, a.tok);
  assert.equal(r.s, 200, JSON.stringify(r.j));
  assert.ok(r.j.post.id.startsWith('po_'));
  assert.equal(r.j.post.text, '今晚只留一句。');
  assert.equal(r.j.post.author.id, a.id);
  assert.equal(r.j.post.author.username, a.username);
  assert.equal(r.j.post.mine, true);
  assert.equal(r.j.idempotent, false);
  const row = srv.db.prepare('SELECT * FROM posts WHERE id=?').get(r.j.post.id);
  assert.ok(row); assert.equal(row.text, '今晚只留一句。'); assert.equal(row.author_id, a.id); assert.equal(row.deleted_at, null);
  const got = await call('GET', '/api/posts/' + r.j.post.id, null, a.tok);
  assert.equal(got.s, 200); assert.equal(got.j.post.text, '今晚只留一句。');
  const too = await call('POST', '/api/posts', {text: '哈'.repeat(281)}, a.tok);
  assert.equal(too.s, 403); assert.equal(too.j.error.code, 'TEXT_TOO_LONG');
  assert.equal(srv.db.prepare('SELECT COUNT(*) c FROM posts WHERE author_id=?').get(a.id).c, 1);
});

test('同一 clientId 重发不重复入库，返回原先那条', async () => {
  const a = await acc('idem');
  const b = {text: '同一句话只留一次。', clientId: 'c-same-1'};
  const r1 = await call('POST', '/api/posts', b, a.tok);
  const r2 = await call('POST', '/api/posts', b, a.tok);
  assert.equal(r1.s, 200); assert.equal(r2.s, 200);
  assert.equal(r1.j.post.id, r2.j.post.id);
  assert.equal(r2.j.idempotent, true);
  assert.equal(srv.db.prepare('SELECT COUNT(*) c FROM posts WHERE author_id=?').get(a.id).c, 1);
});

test('列表只含已入库且未删除的帖；别人的帖也能在推荐里看到', async () => {
  const a = await acc('la'), b = await acc('lb');
  await call('POST', '/api/posts', {text: 'A 的句子'}, a.tok);
  await call('POST', '/api/posts', {text: 'B 的句子'}, b.tok);
  const list = await call('GET', '/api/posts', null, a.tok);
  assert.equal(list.s, 200);
  const texts = list.j.posts.map(p => p.text);
  assert.ok(texts.includes('A 的句子') && texts.includes('B 的句子'));
  const mine = await call('GET', '/api/posts?author=me', null, a.tok);
  assert.ok(mine.j.posts.every(p => p.author.id === a.id));
  assert.ok(mine.j.posts.some(p => p.text === 'A 的句子'));
  assert.ok(!mine.j.posts.some(p => p.text === 'B 的句子'));
});
