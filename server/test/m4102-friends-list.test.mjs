// M4.10.2 删除好友与好友列表：双方同步；删除后不能再发私聊；历史消息保留。
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
async function befriend(a, b) {
  await call('POST', '/api/friends/request', {userId: b.id}, a.tok);
  const r = await call('POST', '/api/friends/accept', {userId: a.id}, b.tok);
  assert.equal(r.s, 200, JSON.stringify(r.j));
}

test('列表对双方一致；删除后双方都不再看到对方；非好友删除 404', async () => {
  const a = await acc('la'), b = await acc('lb'), c = await acc('lc');
  await befriend(a, b);
  await befriend(a, c);
  const la = await call('GET', '/api/friends', null, a.tok);
  assert.equal(la.j.count, 2);
  const ids = la.j.friends.map(f => f.userId).sort();
  assert.deepEqual(ids, [b.id, c.id].sort());
  const rm = await call('POST', '/api/friends/remove', {userId: b.id}, a.tok);
  assert.equal(rm.s, 200);
  assert.equal(rm.j.removed, true);
  const la2 = await call('GET', '/api/friends', null, a.tok);
  const lb2 = await call('GET', '/api/friends', null, b.tok);
  assert.equal(la2.j.count, 1);
  assert.equal(la2.j.friends[0].userId, c.id);
  assert.equal(lb2.j.count, 0);
  assert.equal(srv.friends.areFriends(a.id, b.id), false);
  assert.equal(srv.friends.areFriends(a.id, c.id), true);
  assert.equal((await call('POST', '/api/friends/remove', {userId: b.id}, a.tok)).s, 404);
  assert.equal((await call('POST', '/api/friends/remove', {userId: a.id}, a.tok)).s, 400);
});

test('删除好友后不能再发私聊；会话与历史消息仍在。再加好友后可以继续发', async () => {
  const a = await acc('ld'), b = await acc('le');
  await befriend(a, b);
  const cv = (await call('POST', '/api/conversations', {kind: 'dm', userId: b.id}, a.tok)).j.conversation;
  const s = await call('POST', '/api/conversations/' + cv.id + '/messages', {text: '还是好友时说的'}, a.tok);
  assert.equal(s.s, 200);
  await call('POST', '/api/friends/remove', {userId: b.id}, a.tok);
  const deny = await call('POST', '/api/conversations/' + cv.id + '/messages', {text: '删了还想发'}, a.tok);
  assert.equal(deny.s, 403);
  assert.equal(deny.j.error.code, 'NOT_FRIENDS');
  const hist = await call('GET', '/api/conversations/' + cv.id + '/messages', null, a.tok);
  assert.equal(hist.s, 200);
  assert.ok(hist.j.messages.some(m => m.text === '还是好友时说的'), '历史应保留');
  const list = await call('GET', '/api/conversations', null, a.tok);
  assert.ok(list.j.conversations.some(c => c.id === cv.id), '会话仍在列表里');
  // 重新加好友
  await befriend(a, b);
  const ok = await call('POST', '/api/conversations/' + cv.id + '/messages', {text: '又是好友了'}, a.tok);
  assert.equal(ok.s, 200);
});
