// M5.2.3 表情反应：同用户同一表情幂等；计数与撤销正确。
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
async function dm(a, b) {
  srv.friends.setAccepted(a.id, b.id);
  return (await call('POST', '/api/conversations', {kind: 'dm', userId: b.id}, a.tok)).j.conversation;
}

test('添加反应幂等，多人计数累加，撤销只减自己的', async () => {
  const a = await acc('rxa'), b = await acc('rxb');
  const cv = await dm(a, b);
  const msg = (await call('POST', '/api/conversations/' + cv.id + '/messages', {text: '看这个'}, a.tok)).j.message;
  const r1 = await call('POST', '/api/messages/' + msg.id + '/react', {emoji: '👍'}, a.tok);
  assert.equal(r1.s, 200, JSON.stringify(r1.j));
  assert.equal(r1.j.added, true);
  assert.equal(r1.j.already, false);
  const like = r1.j.message.reactions.find(x => x.emoji === '👍');
  assert.equal(like.count, 1);
  assert.equal(like.me, true);
  const r2 = await call('POST', '/api/messages/' + msg.id + '/react', {emoji: '👍'}, a.tok);
  assert.equal(r2.s, 200);
  assert.equal(r2.j.already, true);
  assert.equal(r2.j.added, false);
  assert.equal(r2.j.message.reactions.find(x => x.emoji === '👍').count, 1);
  const r3 = await call('POST', '/api/messages/' + msg.id + '/react', {emoji: '👍'}, b.tok);
  assert.equal(r3.j.message.reactions.find(x => x.emoji === '👍').count, 2);
  await call('POST', '/api/messages/' + msg.id + '/react', {emoji: '😄'}, b.tok);
  const hist = await call('GET', '/api/conversations/' + cv.id + '/messages', null, a.tok);
  const m = hist.j.messages.find(x => x.id === msg.id);
  assert.equal(m.reactions.find(x => x.emoji === '👍').count, 2);
  assert.equal(m.reactions.find(x => x.emoji === '😄').count, 1);
  assert.equal(m.reactions.find(x => x.emoji === '👍').me, true);
  assert.equal(m.reactions.find(x => x.emoji === '😄').me, false);
  const un = await call('POST', '/api/messages/' + msg.id + '/unreact', {emoji: '👍'}, a.tok);
  assert.equal(un.s, 200);
  assert.equal(un.j.removed, true);
  assert.equal(un.j.message.reactions.find(x => x.emoji === '👍').count, 1);
  assert.equal(un.j.message.reactions.find(x => x.emoji === '👍').me, false);
  const un2 = await call('POST', '/api/messages/' + msg.id + '/unreact', {emoji: '👍'}, a.tok);
  assert.equal(un2.j.removed, false);
  assert.equal(un2.j.already, true);
  assert.equal(un2.j.message.reactions.find(x => x.emoji === '👍').count, 1);
});

test('非成员不能反应；已删除消息不能反应；非法表情被拒', async () => {
  const a = await acc('rxc'), b = await acc('rxd'), c = await acc('rxe');
  const cv = await dm(a, b);
  const msg = (await call('POST', '/api/conversations/' + cv.id + '/messages', {text: 'x'}, a.tok)).j.message;
  assert.equal((await call('POST', '/api/messages/' + msg.id + '/react', {emoji: '👍'}, c.tok)).s, 404);
  assert.equal((await call('POST', '/api/messages/' + msg.id + '/react', {emoji: ''}, a.tok)).s, 400);
  assert.equal((await call('POST', '/api/messages/' + msg.id + '/react', {emoji: 'x'.repeat(20)}, a.tok)).s, 400);
  await call('POST', '/api/messages/' + msg.id + '/recall', {}, a.tok);
  assert.equal((await call('POST', '/api/messages/' + msg.id + '/react', {emoji: '👍'}, a.tok)).s, 404);
});
