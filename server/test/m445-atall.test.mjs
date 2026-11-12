// M4.4.5 @所有人：仅群主/管理员可发；消息带 atAll；成员收到高亮字段。
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

test('群成员不能@所有人；管理员可以，接收端带 atAll 且未读增加', async () => {
  const o = await acc('ao'), ad = await acc('aa'), m = await acc('am');
  const g = (await call('POST', '/api/conversations', {kind: 'group', name: '通知群', userIds: [ad.id, m.id]}, o.tok)).j.conversation;
  await call('POST', '/api/conversations/' + g.id + '/role', {userId: ad.id, role: '管理员'}, o.tok);
  const deny = await call('POST', '/api/conversations/' + g.id + '/messages', {text: '@所有人 成员不能发', clientId: 'at1'}, m.tok);
  assert.equal(deny.s, 403); assert.equal(deny.j.error.code, 'AT_ALL_FORBIDDEN');
  const n0 = srv.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id=?').get(g.id).n;
  const ok = await call('POST', '/api/conversations/' + g.id + '/messages', {text: '@所有人 明天开会', clientId: 'at2'}, ad.tok);
  assert.equal(ok.s, 200, JSON.stringify(ok.j));
  assert.equal(ok.j.message.atAll, true);
  assert.ok(ok.j.message.text.includes('@所有人'));
  const asM = await call('GET', '/api/conversations/' + g.id + '/messages', null, m.tok);
  const hit = asM.j.messages.find(x => x.id === ok.j.message.id);
  assert.equal(hit.atAll, true);
  const list = await call('GET', '/api/conversations', null, m.tok);
  const cv = list.j.conversations.find(x => x.id === g.id);
  assert.ok(cv.unread >= 1);
  assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id=?').get(g.id).n, n0 + 1);
});
