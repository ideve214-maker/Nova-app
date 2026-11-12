// M4.4.2 未读数与会话列表：发送/收到/已读/切会话后数量一致。
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
async function unread(tok, id) {
  const r = await call('GET', '/api/conversations', null, tok);
  const c = r.j.conversations.find(x => x.id === id);
  return c ? c.unread : -1;
}

test('自己发的消息不计未读；对方收到后未读增加；已读或标记到最新后清零', async () => {
  const a = await acc('ua'), b = await acc('ub');
  srv.friends.setAccepted(a.id, b.id);
  const cv = (await call('POST', '/api/conversations', {kind: 'dm', userId: b.id}, a.tok)).j.conversation;
  await call('POST', '/api/conversations/' + cv.id + '/messages', {text: '一', clientId: 'u1'}, a.tok);
  await call('POST', '/api/conversations/' + cv.id + '/messages', {text: '二', clientId: 'u2'}, a.tok);
  assert.equal(await unread(a.tok, cv.id), 0, '发送者自己未读应为 0');
  assert.equal(await unread(b.tok, cv.id), 2);
  const rd = await call('POST', '/api/conversations/' + cv.id + '/read', {}, b.tok); // 标到最新
  assert.equal(rd.s, 200);
  assert.equal(rd.j.unread, 0);
  assert.equal(await unread(b.tok, cv.id), 0);
  // 再来一条
  await call('POST', '/api/conversations/' + cv.id + '/messages', {text: '三', clientId: 'u3'}, a.tok);
  assert.equal(await unread(b.tok, cv.id), 1);
  assert.equal(await unread(a.tok, cv.id), 0);
  // B 回复，A 未读 +1，B 仍 1（还没读「三」）
  await call('POST', '/api/conversations/' + cv.id + '/messages', {text: '回', clientId: 'u4'}, b.tok);
  assert.equal(await unread(a.tok, cv.id), 1);
  assert.equal(await unread(b.tok, cv.id), 1);
  await call('POST', '/api/conversations/' + cv.id + '/read', {}, a.tok);
  await call('POST', '/api/conversations/' + cv.id + '/read', {}, b.tok);
  assert.equal(await unread(a.tok, cv.id), 0);
  assert.equal(await unread(b.tok, cv.id), 0);
});
