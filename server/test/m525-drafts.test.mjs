// M5.2.5 消息草稿：按账号隔离，切换会话互不影响。
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

test('草稿按会话保存，切换互不影响；按账号隔离；清空后消失', async () => {
  const a = await acc('dra'), b = await acc('drb'), c = await acc('drc');
  srv.friends.setAccepted(a.id, b.id);
  srv.friends.setAccepted(a.id, c.id);
  const ab = (await call('POST', '/api/conversations', {kind: 'dm', userId: b.id}, a.tok)).j.conversation;
  const ac = (await call('POST', '/api/conversations', {kind: 'dm', userId: c.id}, a.tok)).j.conversation;
  const p1 = await call('PUT', '/api/conversations/' + ab.id + '/draft', {text: '给 B 的未发消息'}, a.tok);
  assert.equal(p1.s, 200, JSON.stringify(p1.j));
  assert.equal(p1.j.draft.text, '给 B 的未发消息');
  const p2 = await call('PUT', '/api/conversations/' + ac.id + '/draft', {text: '给 C 的另一条'}, a.tok);
  assert.equal(p2.j.draft.text, '给 C 的另一条');
  const g1 = await call('GET', '/api/conversations/' + ab.id + '/draft', null, a.tok);
  const g2 = await call('GET', '/api/conversations/' + ac.id + '/draft', null, a.tok);
  assert.equal(g1.j.draft.text, '给 B 的未发消息');
  assert.equal(g2.j.draft.text, '给 C 的另一条');
  const asB = await call('GET', '/api/conversations/' + ab.id + '/draft', null, b.tok);
  assert.equal(asB.s, 200);
  assert.ok(!asB.j.draft.text, 'B 看不到 A 的草稿');
  const all = await call('GET', '/api/drafts', null, a.tok);
  assert.equal(all.j.drafts.length, 2);
  const clr = await call('DELETE', '/api/conversations/' + ab.id + '/draft', null, a.tok);
  assert.equal(clr.j.cleared, true);
  assert.ok(!clr.j.draft.text);
  const empty = await call('PUT', '/api/conversations/' + ac.id + '/draft', {text: '  '}, a.tok);
  assert.equal(empty.j.cleared, true);
  assert.equal((await call('GET', '/api/drafts', null, a.tok)).j.drafts.length, 0);
});

test('非成员不能读写草稿', async () => {
  const a = await acc('drd'), b = await acc('dre'), c = await acc('drf');
  srv.friends.setAccepted(a.id, b.id);
  const ab = (await call('POST', '/api/conversations', {kind: 'dm', userId: b.id}, a.tok)).j.conversation;
  assert.equal((await call('PUT', '/api/conversations/' + ab.id + '/draft', {text: '偷写'}, c.tok)).s, 404);
  assert.equal((await call('GET', '/api/conversations/' + ab.id + '/draft', null, c.tok)).s, 404);
});
