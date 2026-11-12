// M4.1.2 编辑/删除自己的动态：权限由服务端校验；他人内容不能越权。
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
  const r = await call('POST', '/api/auth/register', {agree:true, username: u, email: u + '@x.test', password: 'Passw0rd123'});
  return {tok: r.j.token, id: r.j.user.id};
}

test('作者可以编辑自己的帖，修改后入库且标为已编辑；重新读取仍是新正文', async () => {
  const a = await acc('ed');
  const p = (await call('POST', '/api/posts', {text: '原稿'}, a.tok)).j.post;
  const e = await call('POST', '/api/posts/' + p.id + '/edit', {text: '改过的句子'}, a.tok);
  assert.equal(e.s, 200, JSON.stringify(e.j));
  assert.equal(e.j.post.text, '改过的句子');
  assert.equal(e.j.post.edited, true);
  const row = srv.db.prepare('SELECT * FROM posts WHERE id=?').get(p.id);
  assert.equal(row.text, '改过的句子');
  assert.ok(row.updated_at > row.created_at);
  const got = await call('GET', '/api/posts/' + p.id, null, a.tok);
  assert.equal(got.j.post.text, '改过的句子');
});

test('作者可以删除自己的帖：之后读取 404，列表不再出现，库中保留软删除', async () => {
  const a = await acc('del');
  const p = (await call('POST', '/api/posts', {text: '准备删掉'}, a.tok)).j.post;
  const d = await call('POST', '/api/posts/' + p.id + '/delete', {}, a.tok);
  assert.equal(d.s, 200); assert.equal(d.j.deleted, p.id);
  assert.equal((await call('GET', '/api/posts/' + p.id, null, a.tok)).s, 404);
  const list = await call('GET', '/api/posts?author=me', null, a.tok);
  assert.ok(!list.j.posts.some(x => x.id === p.id));
  const row = srv.db.prepare('SELECT * FROM posts WHERE id=?').get(p.id);
  assert.ok(row.deleted_at);
  assert.equal((await call('POST', '/api/posts/' + p.id + '/delete', {}, a.tok)).s, 404);
  assert.equal((await call('POST', '/api/posts/' + p.id + '/edit', {text: '还想改'}, a.tok)).s, 404);
});

test('不能编辑或删除别人的帖；未登录 401；空内容和超长被拒', async () => {
  const a = await acc('ow'), b = await acc('ot');
  const p = (await call('POST', '/api/posts', {text: '别人的句子'}, a.tok)).j.post;
  const ed = await call('POST', '/api/posts/' + p.id + '/edit', {text: '我改你的'}, b.tok);
  assert.equal(ed.s, 403); assert.equal(ed.j.error.code, 'FORBIDDEN');
  const dl = await call('POST', '/api/posts/' + p.id + '/delete', {}, b.tok);
  assert.equal(dl.s, 403); assert.equal(dl.j.error.code, 'FORBIDDEN');
  const still = srv.db.prepare('SELECT * FROM posts WHERE id=?').get(p.id);
  assert.equal(still.text, '别人的句子'); assert.equal(still.deleted_at, null);
  assert.equal((await call('POST', '/api/posts/' + p.id + '/edit', {text: 'x'})).s, 401);
  assert.equal((await call('POST', '/api/posts/' + p.id + '/edit', {text: '  '}, a.tok)).s, 400);
  assert.equal((await call('POST', '/api/posts/' + p.id + '/edit', {text: '哈'.repeat(281)}, a.tok)).j.error.code, 'TEXT_TOO_LONG');
  const after = await call('GET', '/api/posts/' + p.id, null, a.tok);
  assert.equal(after.j.post.text, '别人的句子');
  assert.equal(after.j.post.edited, false);
});
