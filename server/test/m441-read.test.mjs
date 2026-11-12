// M4.4.1 已读回执：按会话和消息维护已读游标。不假装「已送达」。
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

test('已读游标按消息前进；对方能看到已读；游标不会后退', async () => {
  const a = await acc('ra'), b = await acc('rb');
  srv.friends.setAccepted(a.id, b.id);
  const cv = (await call('POST', '/api/conversations', {kind: 'dm', userId: b.id}, a.tok)).j.conversation;
  const m1 = (await call('POST', '/api/conversations/' + cv.id + '/messages', {text: '第一', clientId: 'r1'}, a.tok)).j.message;
  const m2 = (await call('POST', '/api/conversations/' + cv.id + '/messages', {text: '第二', clientId: 'r2'}, a.tok)).j.message;
  // 刚发出：A 看到已发送，不是已读，也不是假装的已送达
  assert.equal(m1.status, '已发送');
  const before = await call('GET', '/api/conversations/' + cv.id + '/messages', null, a.tok);
  assert.ok(before.j.messages.every(m => m.status === '已发送'));
  assert.ok(before.j.messages.every(m => m.readCount === 0));
  const rd = await call('POST', '/api/conversations/' + cv.id + '/read', {messageId: m1.id}, b.tok);
  assert.equal(rd.s, 200, JSON.stringify(rd.j));
  assert.equal(rd.j.lastReadMessageId, m1.id);
  const mid = await call('GET', '/api/conversations/' + cv.id + '/messages', null, a.tok);
  const a1 = mid.j.messages.find(m => m.id === m1.id);
  const a2 = mid.j.messages.find(m => m.id === m2.id);
  assert.equal(a1.status, '已读');
  assert.ok(a1.readBy.includes(b.id));
  assert.equal(a2.status, '已发送', '第二还没被读');
  // 游标不后退
  const back = await call('POST', '/api/conversations/' + cv.id + '/read', {messageId: m1.id}, b.tok);
  assert.equal(back.j.lastReadMessageId, m1.id);
  await call('POST', '/api/conversations/' + cv.id + '/read', {messageId: m2.id}, b.tok);
  const all = await call('GET', '/api/conversations/' + cv.id + '/messages', null, a.tok);
  assert.ok(all.j.messages.every(m => m.status === '已读'));
  // 非成员不能标记
  const c = await acc('rc');
  assert.equal((await call('POST', '/api/conversations/' + cv.id + '/read', {messageId: m2.id}, c.tok)).s, 404);
});
