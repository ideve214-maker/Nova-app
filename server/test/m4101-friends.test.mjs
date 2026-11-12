// M4.10.1 好友申请/同意/拒绝/取消：双向状态机；重复申请幂等。
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
  return {tok: r.j.token, id: r.j.user.id, u};
}

test('申请、同意：双方成为好友；重复申请/同意幂等；自己申请 400', async () => {
  const a = await acc('fa'), b = await acc('fb');
  assert.equal((await call('POST', '/api/friends/request', {userId: a.id}, a.tok)).s, 400);
  const r1 = await call('POST', '/api/friends/request', {userId: b.id}, a.tok);
  assert.equal(r1.s, 200, JSON.stringify(r1.j));
  assert.equal(r1.j.friendship.status, 'pending');
  assert.equal(r1.j.friendship.userId, b.id);
  assert.equal(r1.j.friendship.requestedBy, a.id);
  assert.equal(r1.j.friendship.incoming, false);
  const r2 = await call('POST', '/api/friends/request', {userId: b.id}, a.tok);
  assert.equal(r2.s, 200);
  assert.equal(r2.j.idempotent, true);
  const inc = await call('GET', '/api/friends/requests', null, b.tok);
  assert.equal(inc.s, 200);
  assert.equal(inc.j.incoming.length, 1);
  assert.equal(inc.j.incoming[0].userId, a.id);
  assert.equal(inc.j.incoming[0].incoming, true);
  const out = await call('GET', '/api/friends/requests', null, a.tok);
  assert.equal(out.j.outgoing.length, 1);
  const ac = await call('POST', '/api/friends/accept', {userId: a.id}, b.tok);
  assert.equal(ac.s, 200, JSON.stringify(ac.j));
  assert.equal(ac.j.friendship.status, 'accepted');
  assert.equal((await call('POST', '/api/friends/accept', {userId: a.id}, b.tok)).j.idempotent, true);
  assert.equal((await call('POST', '/api/friends/request', {userId: b.id}, a.tok)).j.friendship.status, 'accepted');
  assert.ok(srv.friends.areFriends(a.id, b.id));
  const la = await call('GET', '/api/friends', null, a.tok);
  const lb = await call('GET', '/api/friends', null, b.tok);
  assert.equal(la.j.friends.length, 1);
  assert.equal(la.j.friends[0].userId, b.id);
  assert.equal(lb.j.friends[0].userId, a.id);
  const n = await call('GET', '/api/notifications', null, b.tok);
  assert.ok(n.j.notifications.some(x => x.kind === 'friend_request'), JSON.stringify(n.j));
  const n2 = await call('GET', '/api/notifications', null, a.tok);
  assert.ok(n2.j.notifications.some(x => x.kind === 'friend_accepted'));
});

test('对方已申请时再申请返回 409；只能被申请人同意或拒绝；发起人可取消', async () => {
  const a = await acc('fc'), b = await acc('fd'), c = await acc('fe');
  await call('POST', '/api/friends/request', {userId: b.id}, a.tok);
  const clash = await call('POST', '/api/friends/request', {userId: a.id}, b.tok);
  assert.equal(clash.s, 409);
  assert.equal(clash.j.error.code, 'ALREADY_INCOMING');
  assert.equal((await call('POST', '/api/friends/accept', {userId: b.id}, a.tok)).s, 404);
  assert.equal((await call('POST', '/api/friends/decline', {userId: a.id}, c.tok)).s, 404);
  const dec = await call('POST', '/api/friends/decline', {userId: a.id}, b.tok);
  assert.equal(dec.s, 200);
  assert.equal(dec.j.friendship.status, 'declined');
  // 被拒后可再申请
  const again = await call('POST', '/api/friends/request', {userId: b.id}, a.tok);
  assert.equal(again.s, 200, JSON.stringify(again.j));
  assert.equal(again.j.friendship.status, 'pending');
  const can = await call('POST', '/api/friends/cancel', {userId: b.id}, a.tok);
  assert.equal(can.s, 200);
  assert.equal(can.j.cancelled, true);
  const empty = await call('GET', '/api/friends/requests', null, b.tok);
  assert.equal(empty.j.incoming.length, 0);
  assert.equal((await call('POST', '/api/friends/cancel', {userId: b.id}, a.tok)).s, 404);
});

test('拉黑或对方关闭申请时不能发；不存在的用户 404；关注不算好友', async () => {
  const a = await acc('ff'), b = await acc('fg'), c = await acc('fh');
  srv.friends.block(b.id, a.id);
  const blk = await call('POST', '/api/friends/request', {userId: b.id}, a.tok);
  assert.equal(blk.s, 403);
  assert.equal(blk.j.error.code, 'BLOCKED');
  await call('POST', '/api/me/privacy', {friendRequests: 'nobody'}, c.tok);
  const closed = await call('POST', '/api/friends/request', {userId: c.id}, a.tok);
  assert.equal(closed.s, 403);
  assert.equal(closed.j.error.code, 'REQUESTS_CLOSED');
  assert.equal((await call('POST', '/api/friends/request', {userId: 999999}, a.tok)).s, 404);
  await call('POST', '/api/follows', {userId: b.id}, a.tok);
  const st = await call('GET', '/api/friends/status?userId=' + b.id, null, a.tok);
  assert.equal(st.j.status, 'none');
  assert.equal(srv.friends.areFriends(a.id, b.id), false);
  assert.equal((await call('POST', '/api/friends/request', {}, a.tok)).s, 400);
  assert.equal((await call('GET', '/api/friends', null)).s, 401);
});
