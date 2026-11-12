// M5.2.1 消息引用回复：可跳转到原消息；原消息删除后引用状态清楚。
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
function befriend(a, b) { srv.friends.setAccepted(a.id, b.id); }
async function dm(a, b) {
  befriend(a, b);
  return (await call('POST', '/api/conversations', {kind: 'dm', userId: b.id}, a.tok)).j.conversation;
}

test('引用同一会话的消息，响应带原作者与正文，并可定位到原 id', async () => {
  const a = await acc('ra'), b = await acc('rb');
  const cv = await dm(a, b);
  const orig = await call('POST', '/api/conversations/' + cv.id + '/messages', {text: '这是原话'}, a.tok);
  assert.equal(orig.s, 200);
  const r = await call('POST', '/api/conversations/' + cv.id + '/messages', {text: '回你一句', replyToId: orig.j.message.id}, b.tok);
  assert.equal(r.s, 200, JSON.stringify(r.j));
  const q = r.j.message.replyTo;
  assert.ok(q);
  assert.equal(q.id, orig.j.message.id);
  assert.equal(q.state, 'ok');
  assert.equal(q.deleted, false);
  assert.equal(q.text, '这是原话');
  assert.equal(q.author.id, a.id);
  const hist = await call('GET', '/api/conversations/' + cv.id + '/messages', null, a.tok);
  const got = hist.j.messages.find(m => m.id === r.j.message.id);
  assert.equal(got.replyTo.id, orig.j.message.id);
  assert.equal(got.replyTo.text, '这是原话');
});

test('原消息撤回或删除后，引用状态为 deleted，不返回原文', async () => {
  const a = await acc('rd'), b = await acc('re');
  const cv = await dm(a, b);
  const orig = await call('POST', '/api/conversations/' + cv.id + '/messages', {text: '秘密内容不要再出现'}, a.tok);
  const r = await call('POST', '/api/conversations/' + cv.id + '/messages', {text: '引用后撤回', replyToId: orig.j.message.id}, b.tok);
  assert.equal(r.j.message.replyTo.state, 'ok');
  const rec = await call('POST', '/api/messages/' + orig.j.message.id + '/recall', {}, a.tok);
  assert.equal(rec.s, 200, JSON.stringify(rec.j));
  const hist = await call('GET', '/api/conversations/' + cv.id + '/messages', null, b.tok);
  const got = hist.j.messages.find(m => m.id === r.j.message.id);
  assert.equal(got.replyTo.state, 'deleted');
  assert.equal(got.replyTo.deleted, true);
  assert.equal(got.replyTo.text, '');
  assert.doesNotMatch(JSON.stringify(got.replyTo), /秘密内容/);
  // 原消息本身也标为已删除
  const gone = hist.j.messages.find(m => m.id === orig.j.message.id);
  assert.equal(gone.deleted, true);
  assert.equal(gone.text, '');
});

test('不能引用其他会话的消息；不存在的 id 被拒', async () => {
  const a = await acc('rx'), b = await acc('ry'), c = await acc('rz');
  const cv1 = await dm(a, b);
  const cv2 = await dm(a, c);
  const m1 = await call('POST', '/api/conversations/' + cv1.id + '/messages', {text: '只在这边'}, a.tok);
  const bad = await call('POST', '/api/conversations/' + cv2.id + '/messages', {text: '跨会话', replyToId: m1.j.message.id}, a.tok);
  assert.equal(bad.s, 400);
  assert.equal(bad.j.error.code, 'BAD_REPLY');
  const miss = await call('POST', '/api/conversations/' + cv1.id + '/messages', {text: '无', replyToId: 'mg_nope'}, a.tok);
  assert.equal(miss.s, 400);
});
