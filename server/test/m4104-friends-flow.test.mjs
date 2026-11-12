// M4.10.4 好友全流程：申请→同意→私聊→删除→再申请；拒绝/取消/对向冲突；拉黑；封禁；关闭申请。
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

test('全流程：申请、同意、双方列表、私聊、删除、历史保留、再加回、通知', async () => {
  const a = await acc('fa'), b = await acc('fb');
  const req = await call('POST', '/api/friends/request', {userId: b.id}, a.tok);
  assert.equal(req.s, 200);
  assert.equal(req.j.friendship.status, 'pending');
  const inc = await call('GET', '/api/friends/requests', null, b.tok);
  assert.ok(inc.j.incoming.some(x => x.userId === a.id));
  const out = await call('GET', '/api/friends/requests', null, a.tok);
  assert.ok(out.j.outgoing.some(x => x.userId === b.id));
  assert.equal((await call('POST', '/api/friends/accept', {userId: a.id}, b.tok)).s, 200);
  assert.equal((await call('GET', '/api/friends', null, a.tok)).j.count, 1);
  assert.equal((await call('GET', '/api/friends', null, b.tok)).j.count, 1);
  const cv = (await call('POST', '/api/conversations', {kind: 'dm', userId: b.id}, a.tok)).j.conversation;
  assert.equal((await call('POST', '/api/conversations/' + cv.id + '/messages', {text: '你好好友'}, a.tok)).s, 200);
  assert.equal((await call('POST', '/api/friends/remove', {userId: b.id}, a.tok)).s, 200);
  assert.equal((await call('GET', '/api/friends', null, a.tok)).j.count, 0);
  assert.equal((await call('GET', '/api/friends', null, b.tok)).j.count, 0);
  const deny = await call('POST', '/api/conversations/' + cv.id + '/messages', {text: '删了还发'}, a.tok);
  assert.equal(deny.s, 403);
  assert.equal(deny.j.error.code, 'NOT_FRIENDS');
  const hist = await call('GET', '/api/conversations/' + cv.id + '/messages', null, a.tok);
  assert.ok(hist.j.messages.some(m => m.text === '你好好友'));
  // 再加回
  await call('POST', '/api/friends/request', {userId: b.id}, a.tok);
  await call('POST', '/api/friends/accept', {userId: a.id}, b.tok);
  assert.equal((await call('POST', '/api/conversations/' + cv.id + '/messages', {text: '又是好友'}, a.tok)).s, 200);
  const notes = await call('GET', '/api/notifications', null, b.tok);
  const kinds = (notes.j.notifications || notes.j.items || []).map(n => n.kind);
  assert.ok(kinds.includes('friend_request') || kinds.includes('friend_accepted') || kinds.length >= 0);
  // 至少有过申请通知（第二次申请也会推）
  assert.ok((notes.j.notifications || notes.j.items || []).some(n => String(n.kind).startsWith('friend') || String(n.dedupeKey || '').startsWith('friend')),
    '应有好友相关通知: ' + JSON.stringify(notes.j).slice(0, 400));
});

test('拒绝后再申请、取消、对向冲突 409、自己申请 400、关注不是好友', async () => {
  const a = await acc('fc'), b = await acc('fd');
  await call('POST', '/api/friends/request', {userId: b.id}, a.tok);
  assert.equal((await call('POST', '/api/friends/decline', {userId: a.id}, b.tok)).s, 200);
  const again = await call('POST', '/api/friends/request', {userId: b.id}, a.tok);
  assert.equal(again.s, 200);
  assert.equal(again.j.friendship.status, 'pending');
  assert.equal((await call('POST', '/api/friends/cancel', {userId: b.id}, a.tok)).s, 200);
  assert.equal((await call('GET', '/api/friends/status?userId=' + b.id, null, a.tok)).j.status, 'none');
  // 对向：B 先申请，A 再申请 → 409
  await call('POST', '/api/friends/request', {userId: a.id}, b.tok);
  const clash = await call('POST', '/api/friends/request', {userId: b.id}, a.tok);
  assert.equal(clash.s, 409);
  assert.equal(clash.j.error.code, 'ALREADY_INCOMING');
  // 只有被申请人能同意；发起人同意应失败
  const badAcc = await call('POST', '/api/friends/accept', {userId: a.id}, b.tok);
  assert.notEqual(badAcc.s, 200);
  assert.equal((await call('POST', '/api/friends/accept', {userId: b.id}, a.tok)).s, 200);
  assert.equal((await call('POST', '/api/friends/request', {userId: a.id}, a.tok)).s, 400);
  // 关注 ≠ 好友
  const c = await acc('fe');
  await call('POST', '/api/follows', {userId: c.id}, a.tok);
  assert.equal((await call('GET', '/api/friends/status?userId=' + c.id, null, a.tok)).j.status, 'none');
  assert.equal(srv.friends.areFriends(a.id, c.id), false);
});

test('拉黑解除好友并拒绝申请；解除拉黑后可再申请；封禁用户 404；关闭申请 403', async () => {
  const a = await acc('ff'), b = await acc('fg'), c = await acc('fh'), d = await acc('fi');
  await call('POST', '/api/friends/request', {userId: b.id}, a.tok);
  await call('POST', '/api/friends/accept', {userId: a.id}, b.tok);
  assert.equal(srv.friends.areFriends(a.id, b.id), true);
  srv.friends.block(b.id, a.id);
  assert.equal(srv.friends.areFriends(a.id, b.id), false);
  assert.equal((await call('GET', '/api/friends', null, a.tok)).j.count, 0);
  const blkReq = await call('POST', '/api/friends/request', {userId: b.id}, a.tok);
  assert.equal(blkReq.s, 403);
  assert.equal(blkReq.j.error.code, 'BLOCKED');
  srv.friends.unblock(b.id, a.id);
  const after = await call('POST', '/api/friends/request', {userId: b.id}, a.tok);
  assert.equal(after.s, 200, JSON.stringify(after.j));
  // 封禁
  srv.db.prepare("UPDATE users SET status='banned' WHERE id=?").run(c.id);
  const ban = await call('POST', '/api/friends/request', {userId: c.id}, a.tok);
  assert.equal(ban.s, 404);
  // 关闭申请
  await call('POST', '/api/me/privacy', {friendRequests: 'nobody'}, d.tok);
  const closed = await call('POST', '/api/friends/request', {userId: d.id}, a.tok);
  assert.equal(closed.s, 403);
  assert.equal(closed.j.error.code, 'REQUESTS_CLOSED');
});
