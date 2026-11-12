// M4.8 公开拉黑 API：拉黑解除好友并阻断私聊；列表；取消拉黑后可再申请。
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
  return {tok: r.j.token, id: r.j.user.id, u};
}

test('拉黑、列表、幂等；解除拉黑；不能拉黑自己；需登录', async () => {
  const a = await acc('ba'), b = await acc('bb');
  await call('POST', '/api/friends/request', {userId: b.id}, a.tok);
  await call('POST', '/api/friends/accept', {userId: a.id}, b.tok);
  assert.equal(srv.friends.areFriends(a.id, b.id), true);
  assert.equal((await call('POST', '/api/blocks', {userId: b.id})).s, 401);
  const blk = await call('POST', '/api/blocks', {userId: b.id}, a.tok);
  assert.equal(blk.s, 200, JSON.stringify(blk.j));
  assert.equal(blk.j.blocked, true);
  assert.equal(srv.friends.areFriends(a.id, b.id), false);
  assert.equal(srv.friends.isBlocked(a.id, b.id), true);
  const again = await call('POST', '/api/blocks', {userId: b.id}, a.tok);
  assert.equal(again.s, 200);
  const list = await call('GET', '/api/blocks', null, a.tok);
  assert.equal(list.s, 200);
  assert.ok(list.j.blocks.some(x => x.userId === b.id));
  assert.equal((await call('GET', '/api/blocks', null, b.tok)).j.blocks.length, 0);
  assert.equal((await call('POST', '/api/blocks', {userId: a.id}, a.tok)).s, 400);
  assert.equal((await call('POST', '/api/friends/request', {userId: a.id}, b.tok)).s, 403);
  const cv = await call('POST', '/api/conversations', {kind: 'dm', userId: b.id}, a.tok);
  assert.equal(cv.s, 403);
  const ub = await call('POST', '/api/blocks/remove', {userId: b.id}, a.tok);
  assert.equal(ub.s, 200);
  assert.equal(ub.j.blocked, false);
  assert.equal(srv.friends.isBlocked(a.id, b.id), false);
  assert.equal((await call('GET', '/api/blocks', null, a.tok)).j.blocks.length, 0);
  const req = await call('POST', '/api/friends/request', {userId: b.id}, a.tok);
  assert.equal(req.s, 200, JSON.stringify(req.j));
});
