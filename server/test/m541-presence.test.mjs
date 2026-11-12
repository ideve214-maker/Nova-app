// M5.4.1 在线状态：在线/离开/隐身；隐私设置优先。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';

let srv, base, seq = 0, t0;
test.before(async () => {
  t0 = Date.now();
  srv = createApp({clock: () => t0});
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

test('隐身与 nobody 对外一律离线；friends 仅好友可见；自己能看到真实状态', async () => {
  const a = await acc('pra'), b = await acc('prb'), c = await acc('prc');
  srv.friends.setAccepted(a.id, b.id);
  await call('POST', '/api/me/presence/ping', {}, a.tok);
  // 默认可见范围为好友
  const asB = await call('GET', '/api/users/' + a.id + '/presence', null, b.tok);
  assert.equal(asB.s, 200, JSON.stringify(asB.j));
  assert.equal(asB.j.presence.state, 'online');
  const asC = await call('GET', '/api/users/' + a.id + '/presence', null, c.tok);
  assert.equal(asC.j.presence.state, 'offline');
  assert.equal(asC.j.presence.lastSeen, null);
  // 隐身：好友也只能看到离线，自己看到 invisible
  const inv = await call('PUT', '/api/me/presence', {mode: 'invisible'}, a.tok);
  assert.equal(inv.s, 200);
  assert.equal(inv.j.presence.state, 'invisible');
  assert.equal(inv.j.presence.self, true);
  assert.equal((await call('GET', '/api/users/' + a.id + '/presence', null, b.tok)).j.presence.state, 'offline');
  assert.equal((await call('GET', '/api/users/' + a.id + '/presence', null, b.tok)).j.presence.lastSeen, null);
  assert.equal((await call('GET', '/api/me/presence', null, a.tok)).j.presence.state, 'invisible');
  // everyone + away
  await call('PUT', '/api/me/presence', {mode: 'away', visibility: 'everyone'}, a.tok);
  assert.equal((await call('GET', '/api/users/' + a.id + '/presence', null, c.tok)).j.presence.state, 'away');
  await call('PUT', '/api/me/presence', {mode: 'online', visibility: 'nobody'}, a.tok);
  await call('POST', '/api/me/presence/ping', {}, a.tok);
  assert.equal((await call('GET', '/api/users/' + a.id + '/presence', null, b.tok)).j.presence.state, 'offline');
  assert.equal((await call('GET', '/api/me/presence', null, a.tok)).j.presence.state, 'online');
});
