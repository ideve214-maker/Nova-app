// M2.6.5 退出其他设备：其他令牌服务端失效；当前设备是否保留有明确返回。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';

let srv, base;
test.before(async () => { srv = createApp(); await new Promise(r => srv.listen(0, r)); base = 'http://127.0.0.1:' + srv.address().port; });
test.after(() => srv.close());
const call = async (m, p, body, tok) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  return {s: r.status, j: await r.json()};
};
let n = 0;
const mk = async () => { const u = 'rv_' + (++n); const r = await call('POST', '/api/auth/register', {agree:true, username: u, email: u + '@x.test', password: 'Passw0rd123'}); return {id: r.j.user.id, tok: r.j.token, u}; };

test('退出其他设备：其他令牌立即 401，当前设备仍登录，返回 revoked 与 keptCurrent', async () => {
  const {tok, u} = await mk();
  const t2 = (await call('POST', '/api/auth/login', {account: u, password: 'Passw0rd123'})).j.token;
  const t3 = (await call('POST', '/api/auth/login', {account: u, password: 'Passw0rd123'})).j.token;
  const r = await call('POST', '/api/me/sessions/revoke-others', {}, tok);
  assert.equal(r.s, 200);
  assert.equal(r.j.revoked, 2);
  assert.equal(r.j.kept, 1);
  assert.equal(r.j.keptCurrent, true);
  assert.equal((await call('GET', '/api/me', null, tok)).s, 200);
  assert.equal((await call('GET', '/api/me', null, t2)).s, 401);
  assert.equal((await call('GET', '/api/me', null, t3)).s, 401);
  assert.equal((await call('GET', '/api/me/sessions', null, tok)).j.sessions.length, 1);
  assert.equal((await call('GET', '/api/me/sessions', null, tok)).j.sessions[0].current, true);
});

test('退出指定设备；不能退出当前设备；不能退出别人的设备', async () => {
  const a = await mk(), b = await mk();
  const t2 = (await call('POST', '/api/auth/login', {account: a.u, password: 'Passw0rd123'})).j.token;
  const list = (await call('GET', '/api/me/sessions', null, a.tok)).j.sessions;
  const cur = list.find(s => s.current), other = list.find(s => !s.current);
  assert.equal((await call('POST', '/api/me/sessions/revoke', {id: cur.id}, a.tok)).j.error.code, 'CURRENT_SESSION');
  assert.equal((await call('GET', '/api/me', null, a.tok)).s, 200);
  const ok = await call('POST', '/api/me/sessions/revoke', {id: other.id}, a.tok);
  assert.equal(ok.s, 200); assert.equal(ok.j.revoked, 1);
  assert.equal((await call('GET', '/api/me', null, t2)).s, 401);
  const bSid = (await call('GET', '/api/me/sessions', null, b.tok)).j.sessions[0].id;
  assert.equal((await call('POST', '/api/me/sessions/revoke', {id: bSid}, a.tok)).s, 404);
  assert.equal((await call('GET', '/api/me', null, b.tok)).s, 200);
  assert.equal((await call('POST', '/api/me/sessions/revoke-others', {userId: a.id}, b.tok)).j.revoked, 0, 'B 不能踢 A');
  assert.equal((await call('GET', '/api/me', null, a.tok)).s, 200);
});
