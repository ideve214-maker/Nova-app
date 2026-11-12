// M4.4.4 置顶：私人置顶和房间公共置顶分开；角色权限正确。
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

test('公共置顶需群主或管理员；私人置顶只有自己看得见；公共最多 5 条', async () => {
  const o = await acc('po'), ad = await acc('pa'), m = await acc('pm');
  const g = (await call('POST', '/api/conversations', {kind: 'group', name: '置顶群', userIds: [ad.id, m.id]}, o.tok)).j.conversation;
  await call('POST', '/api/conversations/' + g.id + '/role', {userId: ad.id, role: '管理员'}, o.tok);
  const msgs = [];
  for (let i = 0; i < 6; i++) {
    msgs.push((await call('POST', '/api/conversations/' + g.id + '/messages', {text: 'p' + i, clientId: 'p' + i}, o.tok)).j.message);
  }
  // 成员不能公共置顶
  assert.equal((await call('POST', '/api/messages/' + msgs[0].id + '/pin', {kind: 'public'}, m.tok)).s, 403);
  // 成员可以私人置顶，别人看不见
  const priv = await call('POST', '/api/messages/' + msgs[0].id + '/pin', {kind: 'personal'}, m.tok);
  assert.equal(priv.s, 200, JSON.stringify(priv.j));
  assert.ok(priv.j.personalPins.includes(msgs[0].id));
  const asO = await call('GET', '/api/conversations/' + g.id, null, o.tok);
  assert.ok(!asO.j.conversation.personalPins.includes(msgs[0].id));
  assert.ok(!asO.j.conversation.publicPins.includes(msgs[0].id));
  const asM = await call('GET', '/api/conversations/' + g.id, null, m.tok);
  assert.ok(asM.j.conversation.personalPins.includes(msgs[0].id));
  // 管理员公共置顶
  assert.equal((await call('POST', '/api/messages/' + msgs[0].id + '/pin', {kind: 'public'}, ad.tok)).s, 200);
  for (let i = 1; i < 5; i++) {
    assert.equal((await call('POST', '/api/messages/' + msgs[i].id + '/pin', {kind: 'public'}, o.tok)).s, 200);
  }
  const lim = await call('POST', '/api/messages/' + msgs[5].id + '/pin', {kind: 'public'}, o.tok);
  assert.equal(lim.s, 400); assert.equal(lim.j.error.code, 'PIN_LIMIT');
  // 取消后可再顶
  assert.equal((await call('POST', '/api/messages/' + msgs[0].id + '/unpin', {kind: 'public'}, o.tok)).s, 200);
  assert.equal((await call('POST', '/api/messages/' + msgs[5].id + '/pin', {kind: 'public'}, o.tok)).s, 200);
  const all = (await call('GET', '/api/conversations/' + g.id, null, m.tok)).j.conversation;
  assert.equal(all.publicPins.length, 5);
  assert.ok(all.publicPins.includes(msgs[5].id));
  assert.ok(!all.publicPins.includes(msgs[0].id));
});
