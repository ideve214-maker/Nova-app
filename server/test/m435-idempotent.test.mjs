// M4.3.5 消息幂等与离线补拉：重发不重复入库；离线期间消息能补齐。
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

test('同一 clientId 并发重发只入库一次，返回同一条消息', async () => {
  const a = await acc('ia'), b = await acc('ib');
  srv.friends.setAccepted(a.id, b.id);
  const cv = (await call('POST', '/api/conversations', {kind: 'dm', userId: b.id}, a.tok)).j.conversation;
  const body = {text: '只应出现一次', clientId: 'retry-same-001'};
  const rs = await Promise.all([
    call('POST', '/api/conversations/' + cv.id + '/messages', body, a.tok),
    call('POST', '/api/conversations/' + cv.id + '/messages', body, a.tok),
    call('POST', '/api/conversations/' + cv.id + '/messages', body, a.tok),
  ]);
  assert.ok(rs.every(r => r.s === 200), JSON.stringify(rs.map(r => r.j)));
  const ids = rs.map(r => r.j.message.id);
  assert.equal(new Set(ids).size, 1, '三个响应必须是同一条: ' + ids);
  assert.ok(rs.filter(r => r.j.idempotent).length >= 1, '至少一次标明幂等');
  const n = srv.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id=? AND deleted_at IS NULL').get(cv.id);
  assert.equal(n.n, 1);
  const list = await call('GET', '/api/conversations/' + cv.id + '/messages', null, b.tok);
  assert.equal(list.j.messages.length, 1);
  assert.equal(list.j.messages[0].text, '只应出现一次');
  // 不同 clientId 是新消息
  const other = await call('POST', '/api/conversations/' + cv.id + '/messages', {text: '只应出现一次', clientId: 'retry-same-002'}, a.tok);
  assert.equal(other.s, 200);
  assert.notEqual(other.j.message.id, ids[0]);
  assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id=?').get(cv.id).n, 2);
});

test('离线期间对方发的消息可用 after 一次补齐，不丢不重', async () => {
  const a = await acc('oa'), b = await acc('ob');
  srv.friends.setAccepted(a.id, b.id);
  const cv = (await call('POST', '/api/conversations', {kind: 'dm', userId: b.id}, a.tok)).j.conversation;
  const first = (await call('POST', '/api/conversations/' + cv.id + '/messages', {text: '在线时', clientId: 'c0'}, a.tok)).j.message;
  // 模拟 B 离线，A 连发 5 条
  const sent = [];
  for (let i = 1; i <= 5; i++) {
    const r = await call('POST', '/api/conversations/' + cv.id + '/messages', {text: '离线' + i, clientId: 'off-' + i}, a.tok);
    assert.equal(r.s, 200);
    sent.push(r.j.message.id);
  }
  const pull = await call('GET', '/api/conversations/' + cv.id + '/messages?after=' + encodeURIComponent(first.createdAt + ':' + first.id) + '&limit=50', null, b.tok);
  assert.equal(pull.s, 200);
  assert.deepEqual(pull.j.messages.map(m => m.text), ['离线1', '离线2', '离线3', '离线4', '离线5']);
  assert.deepEqual(pull.j.messages.map(m => m.id), sent);
  const last = pull.j.messages[pull.j.messages.length - 1];
  const again = await call('GET', '/api/conversations/' + cv.id + '/messages?after=' + encodeURIComponent(last.createdAt + ':' + last.id), null, b.tok);
  assert.equal(again.j.messages.length, 0);
  // 把已有页与补拉合并，id 不重复
  const hist = await call('GET', '/api/conversations/' + cv.id + '/messages?limit=100', null, b.tok);
  const allIds = hist.j.messages.map(m => m.id);
  assert.equal(allIds.length, new Set(allIds).size);
  assert.equal(allIds.length, 6);
});
