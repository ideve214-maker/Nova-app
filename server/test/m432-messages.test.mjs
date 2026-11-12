// M4.3.2 发送消息与历史读取：消息真实入库；按会话游标分页。
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
function befriend(a, b) { srv.friends.setAccepted(a.id, b.id); }

test('消息入库后才返回成功；非成员不能发或读；空文本拒绝', async () => {
  const a = await acc('ma'), b = await acc('mb'), c = await acc('mc');
  befriend(a, b);
  const cv = (await call('POST', '/api/conversations', {kind: 'dm', userId: b.id}, a.tok)).j.conversation;
  const empty = await call('POST', '/api/conversations/' + cv.id + '/messages', {text: '  '}, a.tok);
  assert.equal(empty.s, 400);
  const s = await call('POST', '/api/conversations/' + cv.id + '/messages', {text: '你好，这是第一条'}, a.tok);
  assert.equal(s.s, 200, JSON.stringify(s.j));
  const msg = s.j.message;
  assert.ok(msg.id.startsWith('mg_'));
  assert.equal(msg.text, '你好，这是第一条');
  assert.equal(msg.author.id, a.id);
  assert.equal(msg.mine, true);
  const row = srv.db.prepare('SELECT * FROM messages WHERE id=?').get(msg.id);
  assert.equal(row.text, '你好，这是第一条');
  assert.equal(Number(row.author_id), Number(a.id));
  const asB = await call('GET', '/api/conversations/' + cv.id + '/messages', null, b.tok);
  assert.equal(asB.s, 200);
  assert.equal(asB.j.messages.length, 1);
  assert.equal(asB.j.messages[0].id, msg.id);
  assert.equal(asB.j.messages[0].mine, false);
  assert.equal((await call('POST', '/api/conversations/' + cv.id + '/messages', {text: '偷听'}, c.tok)).s, 404);
  assert.equal((await call('GET', '/api/conversations/' + cv.id + '/messages', null, c.tok)).s, 404);
  const list = await call('GET', '/api/conversations', null, b.tok);
  assert.equal(list.j.conversations[0].lastMessage.text, '你好，这是第一条');
});

test('历史按游标分页，顺序稳定，页面不重叠', async () => {
  const a = await acc('pa'), b = await acc('pb');
  let t = 1_700_000_000_000;
  srv.close();
  srv = createApp({clock: () => t});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  const a2 = await acc('p2a'), b2 = await acc('p2b');
  befriend(a2, b2);
  const cv = (await call('POST', '/api/conversations', {kind: 'dm', userId: b2.id}, a2.tok)).j.conversation;
  const ids = [];
  for (let i = 0; i < 7; i++) {
    t += 1000;
    const r = await call('POST', '/api/conversations/' + cv.id + '/messages', {text: '第' + (i + 1) + '条'}, a2.tok);
    assert.equal(r.s, 200, JSON.stringify(r.j));
    ids.push(r.j.message.id);
  }
  const p1 = await call('GET', '/api/conversations/' + cv.id + '/messages?limit=3', null, b2.tok);
  assert.equal(p1.s, 200);
  assert.equal(p1.j.messages.length, 3);
  assert.equal(p1.j.hasMore, true);
  assert.deepEqual(p1.j.messages.map(m => m.text), ['第5条', '第6条', '第7条']);
  const p2 = await call('GET', '/api/conversations/' + cv.id + '/messages?limit=3&cursor=' + encodeURIComponent(p1.j.nextCursor), null, b2.tok);
  assert.equal(p2.j.messages.length, 3);
  assert.deepEqual(p2.j.messages.map(m => m.text), ['第2条', '第3条', '第4条']);
  const overlap = p1.j.messages.map(m => m.id).filter(id => p2.j.messages.some(m => m.id === id));
  assert.deepEqual(overlap, []);
  const p3 = await call('GET', '/api/conversations/' + cv.id + '/messages?limit=3&cursor=' + encodeURIComponent(p2.j.nextCursor), null, b2.tok);
  assert.deepEqual(p3.j.messages.map(m => m.text), ['第1条']);
  assert.equal(p3.j.hasMore, false);
  // after：从第4条之后补拉更新
  const cur4 = p2.j.messages[2]; // 第4条
  t += 1000;
  await call('POST', '/api/conversations/' + cv.id + '/messages', {text: '第8条'}, b2.tok);
  const nw = await call('GET', '/api/conversations/' + cv.id + '/messages?after=' + encodeURIComponent(cur4.createdAt + ':' + cur4.id), null, a2.tok);
  assert.deepEqual(nw.j.messages.map(m => m.text), ['第5条', '第6条', '第7条', '第8条']);
});
