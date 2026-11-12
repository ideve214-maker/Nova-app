import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';

let srv, base;
test.before(async () => { srv = createApp(); await new Promise(r => srv.listen(0, r)); base = 'http://127.0.0.1:' + srv.address().port; });
test.after(() => srv.close());
const call = async (m, p, body, tok) => { const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined}); return {s: r.status, j: await r.json()}; };
const U = {agree:true, username: 'alice_01', email: 'Alice@Example.com', password: 'Passw0rd123'};

test('注册成功并返回令牌，邮箱统一小写', async () => {
  const r = await call('POST', '/api/auth/register', U);
  assert.equal(r.s, 200); assert.ok(r.j.token.startsWith('nv_')); assert.equal(r.j.user.email, 'alice@example.com');
  assert.equal(r.j.user.role, 'user'); assert.equal(r.j.user.vip, false); assert.equal(r.j.user.password_hash, undefined);
});
test('库中没有明文密码，令牌也只存哈希', async () => {
  const row = srv.db.prepare('SELECT * FROM users WHERE username=?').get('alice_01');
  assert.ok(row.password_hash.startsWith('scrypt$')); assert.ok(!JSON.stringify(row).includes('Passw0rd123'));
  const t = (await call('POST', '/api/auth/login', {account: 'alice_01', password: U.password})).j.token;
  const all = JSON.stringify(srv.db.prepare('SELECT * FROM sessions').all()); assert.ok(!all.includes(t));
});
test('重复注册、弱密码、坏邮箱、坏用户名被拒', async () => {
  assert.equal((await call('POST', '/api/auth/register', {agree:true, ...U, username: 'Alice_01', email: 'other@x.com'})).j.error.code, 'EXISTS');
  assert.equal((await call('POST', '/api/auth/register', {agree:true, ...U, username: 'other_x'})).j.error.code, 'EXISTS');
  assert.equal((await call('POST', '/api/auth/register', {agree:true, ...U, username: 'bob_1', email: 'b@x.com', password: 'abcdefgh'})).j.error.code, 'WEAK_PASSWORD');
  assert.equal((await call('POST', '/api/auth/register', {agree:true, ...U, username: 'bob_1', email: 'nope'})).j.error.code, 'BAD_EMAIL');
  assert.equal((await call('POST', '/api/auth/register', {agree:true, ...U, username: 'a b', email: 'c@x.com'})).j.error.code, 'BAD_USERNAME');
});
test('用邮箱或用户名都能登录；/api/me 需要令牌', async () => {
  const a = await call('POST', '/api/auth/login', {account: 'ALICE@example.com', password: U.password}); assert.equal(a.s, 200);
  assert.equal((await call('POST', '/api/auth/login', {account: 'Alice_01', password: U.password})).s, 200);
  assert.equal((await call('GET', '/api/me')).s, 401);
  const me = await call('GET', '/api/me', null, a.j.token); assert.equal(me.j.user.username, 'alice_01');
});
test('退出后令牌立即失效', async () => {
  const t = (await call('POST', '/api/auth/login', {account: 'alice_01', password: U.password})).j.token;
  assert.equal((await call('POST', '/api/auth/logout', {}, t)).s, 200); assert.equal((await call('GET', '/api/me', null, t)).s, 401);
});
test('改密码：旧密码错误被拒；成功后其他设备下线、旧密码失效', async () => {
  const t1 = (await call('POST', '/api/auth/login', {account: 'alice_01', password: U.password})).j.token;
  const t2 = (await call('POST', '/api/auth/login', {account: 'alice_01', password: U.password})).j.token;
  assert.equal((await call('POST', '/api/me/password', {oldPassword: 'wrong', newPassword: 'NewPass456'}, t1)).s, 401);
  assert.equal((await call('POST', '/api/me/password', {oldPassword: U.password, newPassword: 'NewPass456'}, t1)).s, 200);
  assert.equal((await call('GET', '/api/me', null, t2)).s, 401); assert.equal((await call('GET', '/api/me', null, t1)).s, 200);
  assert.equal((await call('POST', '/api/auth/login', {account: 'alice_01', password: U.password})).s, 401);
  assert.equal((await call('POST', '/api/auth/login', {account: 'alice_01', password: 'NewPass456'})).s, 200);
});
test('连续输错5次锁定账号，错误提示不泄露账号是否存在', async () => {
  const ghost = await call('POST', '/api/auth/login', {account: 'ghost_user', password: 'Whatever123'});
  const real = await call('POST', '/api/auth/login', {account: 'alice_01', password: 'bad'});
  assert.equal(ghost.j.error.message, real.j.error.message);
  for (let i = 0; i < 3; i++) await call('POST', '/api/auth/login', {account: 'alice_01', password: 'bad'});
  assert.equal((await call('POST', '/api/auth/login', {account: 'alice_01', password: 'bad'})).s, 401); // 第5次触发锁定
  const locked = await call('POST', '/api/auth/login', {account: 'alice_01', password: 'NewPass456'});
  assert.equal(locked.s, 429); assert.equal(locked.j.error.code, 'LOCKED');
});
test('被封禁账号不能登录；审计日志有记录且不含密码', async () => {
  await call('POST', '/api/auth/register', {agree:true, username: 'carol_9', email: 'c@x.com', password: 'Passw0rd123'});
  srv.db.prepare("UPDATE users SET status='banned' WHERE username='carol_9'").run();
  const r = await call('POST', '/api/auth/login', {account: 'carol_9', password: 'Passw0rd123'}); assert.equal(r.s, 403);
  const log = JSON.stringify(srv.db.prepare('SELECT * FROM audit_log').all());
  assert.ok(log.includes('user.register') && log.includes('auth.login_fail') && !log.includes('Passw0rd123'));
});
test('坏JSON、未知接口、健康检查', async () => {
  const r = await fetch(base + '/api/auth/login', {method: 'POST', body: '{oops'}); assert.equal(r.status, 400);
  assert.equal((await call('GET', '/api/nope')).s, 404); assert.equal((await call('GET', '/api/health')).j.status, 'ok');
});
