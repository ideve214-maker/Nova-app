// M4.3.3 私聊好友门槛：默认只有双向好友可建立/继续私聊；封禁/拉黑时阻断。
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

test('非好友不能建立私聊；成为双向好友后可以；删除好友后不能继续发消息', async () => {
  const a = await acc('fa'), b = await acc('fb'), c = await acc('fc');
  const deny = await call('POST', '/api/conversations', {kind: 'dm', userId: b.id}, a.tok);
  assert.equal(deny.s, 403, JSON.stringify(deny.j));
  assert.equal(deny.j.error.code, 'NOT_FRIENDS');
  // 群聊不受好友门槛限制
  const g = await call('POST', '/api/conversations', {kind: 'group', name: '不必好友', userIds: [b.id, c.id]}, a.tok);
  assert.equal(g.s, 200, JSON.stringify(g.j));
  srv.friends.setAccepted(a.id, b.id);
  const ok = await call('POST', '/api/conversations', {kind: 'dm', userId: b.id}, a.tok);
  assert.equal(ok.s, 200);
  const id = ok.j.conversation.id;
  const sent = await call('POST', '/api/conversations/' + id + '/messages', {text: '还是好友时'}, a.tok);
  assert.equal(sent.s, 200);
  srv.friends.remove(a.id, b.id);
  const again = await call('POST', '/api/conversations/' + id + '/messages', {text: '已经不是好友'}, a.tok);
  assert.equal(again.s, 403);
  assert.equal(again.j.error.code, 'NOT_FRIENDS');
  const reopen = await call('POST', '/api/conversations', {kind: 'dm', userId: b.id}, a.tok);
  assert.equal(reopen.s, 403);
  // 单向关注不是好友
  await call('POST', '/api/follows', {userId: c.id}, a.tok);
  const fol = await call('POST', '/api/conversations', {kind: 'dm', userId: c.id}, a.tok);
  assert.equal(fol.s, 403);
  assert.equal(fol.j.error.code, 'NOT_FRIENDS');
});

test('任一方拉黑即阻断建立和继续私聊；对方账号被封禁则无法建立', async () => {
  const a = await acc('ba'), b = await acc('bb'), c = await acc('bc');
  srv.friends.setAccepted(a.id, b.id);
  srv.friends.setAccepted(a.id, c.id);
  srv.friends.block(b.id, a.id); // B 拉黑 A
  const d1 = await call('POST', '/api/conversations', {kind: 'dm', userId: b.id}, a.tok);
  assert.equal(d1.s, 403); assert.equal(d1.j.error.code, 'BLOCKED');
  const d2 = await call('POST', '/api/conversations', {kind: 'dm', userId: a.id}, b.tok);
  assert.equal(d2.s, 403); assert.equal(d2.j.error.code, 'BLOCKED');
  // 先建会话再拉黑：不能继续发
  const cv = (await call('POST', '/api/conversations', {kind: 'dm', userId: c.id}, a.tok)).j.conversation;
  assert.equal((await call('POST', '/api/conversations/' + cv.id + '/messages', {text: '拉黑前'}, a.tok)).s, 200);
  srv.friends.block(a.id, c.id);
  const after = await call('POST', '/api/conversations/' + cv.id + '/messages', {text: '拉黑后'}, a.tok);
  assert.equal(after.s, 403); assert.equal(after.j.error.code, 'BLOCKED');
  const fromC = await call('POST', '/api/conversations/' + cv.id + '/messages', {text: '对方也发不了'}, c.tok);
  assert.equal(fromC.s, 403); assert.equal(fromC.j.error.code, 'BLOCKED');
  // 封禁账号
  const d = await acc('bd');
  srv.friends.setAccepted(a.id, d.id);
  srv.db.prepare("UPDATE users SET status='banned' WHERE id=?").run(d.id);
  const ban = await call('POST', '/api/conversations', {kind: 'dm', userId: d.id}, a.tok);
  assert.equal(ban.s, 404);
});
