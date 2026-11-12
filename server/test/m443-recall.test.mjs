// M4.4.3 撤回：2 分钟时间窗；只能撤回自己的；双方都看到已撤回占位。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';

let srv, base, seq = 0, t = 1_700_000_000_000;
test.before(async () => {
  srv = createApp({clock: () => t});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
});
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

test('两分钟内作者可撤回，双方看到占位且看不到原文；超时或他人不能撤回', async () => {
  const a = await acc('ca'), b = await acc('cb');
  srv.friends.setAccepted(a.id, b.id);
  const cv = (await call('POST', '/api/conversations', {kind: 'dm', userId: b.id}, a.tok)).j.conversation;
  t += 1000;
  const msg = (await call('POST', '/api/conversations/' + cv.id + '/messages', {text: '秘密内容', clientId: 'rc1'}, a.tok)).j.message;
  assert.equal((await call('POST', '/api/messages/' + msg.id + '/recall', {}, b.tok)).s, 403);
  const ok = await call('POST', '/api/messages/' + msg.id + '/recall', {}, a.tok);
  assert.equal(ok.s, 200, JSON.stringify(ok.j));
  assert.equal(ok.j.message.deleted, true);
  assert.equal(ok.j.message.text, '');
  const asB = await call('GET', '/api/conversations/' + cv.id + '/messages', null, b.tok);
  const seen = asB.j.messages.find(m => m.id === msg.id);
  assert.ok(seen); assert.equal(seen.deleted, true); assert.equal(seen.text, '');
  const asA = (await call('GET', '/api/conversations/' + cv.id + '/messages', null, a.tok)).j.messages.find(m => m.id === msg.id);
  assert.equal(asA.deleted, true); assert.equal(asA.text, '');
  // 幂等
  assert.equal((await call('POST', '/api/messages/' + msg.id + '/recall', {}, a.tok)).s, 200);
  // 超时
  t += 1000;
  const msg2 = (await call('POST', '/api/conversations/' + cv.id + '/messages', {text: '过期的', clientId: 'rc2'}, a.tok)).j.message;
  t += 2 * 60 * 1000 + 1;
  const exp = await call('POST', '/api/messages/' + msg2.id + '/recall', {}, a.tok);
  assert.equal(exp.s, 400); assert.equal(exp.j.error.code, 'RECALL_EXPIRED');
  const still = (await call('GET', '/api/conversations/' + cv.id + '/messages', null, b.tok)).j.messages.find(m => m.id === msg2.id);
  assert.equal(still.deleted, false); assert.equal(still.text, '过期的');
});
