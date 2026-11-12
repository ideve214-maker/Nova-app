// M4.4.6 静音：用户级静音状态同步；不影响消息存储。
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

test('静音只属于自己且可同步；对方发消息仍入库，未读仍计', async () => {
  const a = await acc('mu'), b = await acc('mv');
  srv.friends.setAccepted(a.id, b.id);
  const cv = (await call('POST', '/api/conversations', {kind: 'dm', userId: b.id}, a.tok)).j.conversation;
  const mu = await call('POST', '/api/conversations/' + cv.id + '/mute', {mute: true}, a.tok);
  assert.equal(mu.s, 200); assert.equal(mu.j.muted, true);
  const asA = (await call('GET', '/api/conversations/' + cv.id, null, a.tok)).j.conversation;
  const asB = (await call('GET', '/api/conversations/' + cv.id, null, b.tok)).j.conversation;
  assert.equal(asA.muted, true);
  assert.equal(asB.muted, false, '静音是用户级，不影响对方');
  const sent = await call('POST', '/api/conversations/' + cv.id + '/messages', {text: '静音后仍入库', clientId: 'mu1'}, b.tok);
  assert.equal(sent.s, 200);
  const row = srv.db.prepare('SELECT * FROM messages WHERE id=?').get(sent.j.message.id);
  assert.equal(row.text, '静音后仍入库');
  const list = (await call('GET', '/api/conversations', null, a.tok)).j.conversations.find(x => x.id === cv.id);
  assert.equal(list.muted, true);
  assert.ok(list.unread >= 1, '静音不影响未读计数');
  const off = await call('POST', '/api/conversations/' + cv.id + '/mute', {mute: false}, a.tok);
  assert.equal(off.j.muted, false);
  assert.equal((await call('GET', '/api/conversations/' + cv.id, null, a.tok)).j.conversation.muted, false);
});
