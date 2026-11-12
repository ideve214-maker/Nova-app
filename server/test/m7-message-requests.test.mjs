// M7 陌生人消息请求：非好友先进入请求箱；接受前不能正常会话；删除与拉黑分离。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';

let srv, base, seq = 0;
test.before(async () => { srv = createApp(); await new Promise(r => srv.listen(0, '127.0.0.1', r)); base = 'http://127.0.0.1:' + srv.address().port; });
test.after(() => srv.close());
const call = async (m, p, body, tok) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  let j = {}; try { j = await r.json(); } catch {}
  return {s: r.status, j};
};
async function acc(n) {
  const u = n + (++seq);
  const r = await call('POST', '/api/auth/register', {agree:true, username: u, email: u + '@x.test', password: 'Passw0rd123'});
  return {tok: r.j.token, id: r.j.user.id, username: r.j.user.username};
}

test('陌生人不能直接开会话；可发消息请求；接收者在请求箱看到；发送者看不到已读状态字段以外的处理', async () => {
  const a = await acc('ma'), b = await acc('mb');
  const dm = await call('POST', '/api/conversations', {kind: 'dm', userId: b.id}, a.tok);
  assert.equal(dm.s, 403, JSON.stringify(dm.j));
  assert.equal(dm.j.error && dm.j.error.code, 'NOT_FRIENDS');
  const s = await call('POST', '/api/message-requests', {userId: b.id, text: '你好，明天见！'}, a.tok);
  assert.equal(s.s, 200, JSON.stringify(s.j));
  assert.equal(s.j.request.status, 'pending');
  assert.equal(s.j.request.firstMessage, '你好，明天见！');
  const inbox = await call('GET', '/api/message-requests', null, b.tok);
  assert.equal(inbox.s, 200, JSON.stringify(inbox.j));
  assert.equal(inbox.j.pendingCount, 1);
  assert.equal(inbox.j.requests[0].firstMessage, '你好，明天见！');
  assert.equal(inbox.j.requests[0].incoming, true);
  const out = await call('GET', '/api/message-requests?box=out', null, a.tok);
  assert.equal(out.j.requests.length, 1);
  // A 还不能开会话
  assert.equal((await call('POST', '/api/conversations', {kind: 'dm', userId: b.id}, a.tok)).s, 403);
});

test('接受后建立正式会话并可互发；删除不拉黑，拉黑阻止再发', async () => {
  const a = await acc('aa'), b = await acc('ab'), c = await acc('ac');
  const s = await call('POST', '/api/message-requests', {userId: b.id, text: '申请一下'}, a.tok);
  assert.equal(s.s, 200);
  const id = s.j.request.id;
  const accp = await call('POST', '/api/message-requests/' + id + '/accept', {}, b.tok);
  assert.equal(accp.s, 200, JSON.stringify(accp.j));
  assert.equal(accp.j.request.status, 'accepted');
  assert.ok(accp.j.conversation && accp.j.conversation.id);
  const dm = await call('POST', '/api/conversations', {kind: 'dm', userId: b.id}, a.tok);
  assert.equal(dm.s, 200, JSON.stringify(dm.j));
  const msg = await call('POST', '/api/conversations/' + dm.j.conversation.id + '/messages', {text: '正式消息'}, a.tok);
  assert.equal(msg.s, 200, JSON.stringify(msg.j));

  const s2 = await call('POST', '/api/message-requests', {userId: c.id, text: '你好 C'}, a.tok);
  assert.equal(s2.s, 200);
  const del = await call('POST', '/api/message-requests/' + s2.j.request.id + '/delete', {}, c.tok);
  assert.equal(del.s, 200, JSON.stringify(del.j));
  assert.equal(del.j.deleted, true);
  // 删除后可再请求（状态回到 pending）
  const s3 = await call('POST', '/api/message-requests', {userId: c.id, text: '再试一次'}, a.tok);
  assert.equal(s3.s, 200, JSON.stringify(s3.j));
  const blk = await call('POST', '/api/message-requests/' + s3.j.request.id + '/block', {}, c.tok);
  assert.equal(blk.s, 200, JSON.stringify(blk.j));
  assert.equal(blk.j.blocked, true);
  const again = await call('POST', '/api/message-requests', {userId: c.id, text: '还想发'}, a.tok);
  assert.equal(again.s, 403, JSON.stringify(again.j));
});

test('互相关注可直接私聊，不必走请求', async () => {
  const a = await acc('fa'), b = await acc('fb');
  assert.equal((await call('POST', '/api/follows', {userId: b.id}, a.tok)).s, 200);
  assert.equal((await call('POST', '/api/follows', {userId: a.id}, b.tok)).s, 200);
  const dm = await call('POST', '/api/conversations', {kind: 'dm', userId: b.id}, a.tok);
  assert.equal(dm.s, 200, JSON.stringify(dm.j));
});
