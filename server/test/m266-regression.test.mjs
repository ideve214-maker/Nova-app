// M2.6.6 资料、隐私、设备与改密回归：修改后刷新/重登仍有效；权限不能跨账号。
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
const mk = async () => { const u = 'rg_' + (++n); const r = await call('POST', '/api/auth/register', {agree:true, username: u, email: u + '@x.test', password: 'Passw0rd123'}); return {id: r.j.user.id, tok: r.j.token, u}; };

test('一条链路：改资料+头像+隐私后重登全部还在；改密后其他设备下线、本设备仍在；A 读不到 B', async () => {
  const a = await mk(), b = await mk();
  const tA2 = (await call('POST', '/api/auth/login', {account: a.u, password: 'Passw0rd123'})).j.token;
  assert.equal((await call('POST', '/api/me/profile', {displayName: '回归昵称', bio: '回归简介', gender: '其他', birthday: '2000-01-02'}, a.tok)).s, 200);
  assert.equal((await call('POST', '/api/me/avatar', {avatar: {color: '#5C4A3A', letter: '回'}}, a.tok)).s, 200);
  assert.equal((await call('POST', '/api/me/privacy', {profileVisibility: 'private', friendRequests: 'nobody', showBirthday: false, searchable: false}, a.tok)).s, 200);

  const relogin = await call('POST', '/api/auth/login', {account: a.u, password: 'Passw0rd123'});
  const u = relogin.j.user;
  assert.equal(u.profile.displayName, '回归昵称');
  assert.equal(u.profile.bio, '回归简介');
  assert.equal(u.profile.avatar.letter, '回');
  assert.equal(u.profile.avatar.color, '#5C4A3A');
  const prv = (await call('GET', '/api/me/privacy', null, relogin.j.token)).j.privacy;
  assert.equal(prv.profileVisibility, 'private');
  assert.equal(prv.friendRequests, 'nobody');
  assert.equal(prv.showBirthday, false);

  // 改密：其他设备下线，当前（a.tok）仍在
  assert.equal((await call('POST', '/api/me/password', {oldPassword: 'Passw0rd123', newPassword: 'NewPass456'}, a.tok)).s, 200);
  assert.equal((await call('GET', '/api/me', null, a.tok)).s, 200);
  assert.equal((await call('GET', '/api/me', null, tA2)).s, 401);
  assert.equal((await call('GET', '/api/me', null, relogin.j.token)).s, 401);
  assert.equal((await call('POST', '/api/auth/login', {account: a.u, password: 'Passw0rd123'})).s, 401);
  const fresh = await call('POST', '/api/auth/login', {account: a.u, password: 'NewPass456'});
  assert.equal(fresh.s, 200);
  assert.equal(fresh.j.user.profile.displayName, '回归昵称');

  // 跨账号：B 用自己的令牌看不到 A 的资料/隐私/设备
  assert.notEqual((await call('GET', '/api/me/profile', null, b.tok)).j.profile.displayName, '回归昵称');
  assert.notEqual((await call('GET', '/api/me/privacy', null, b.tok)).j.privacy.profileVisibility, 'private');
  const sessB = (await call('GET', '/api/me/sessions', null, b.tok)).j.sessions;
  const sessA = (await call('GET', '/api/me/sessions', null, fresh.j.token)).j.sessions;
  assert.ok(sessA.every(s => !sessB.some(x => x.id === s.id)));
  // B 无法用 A 的资料 id 之类做任何事（接口没有按 id 读他人资料）
  const all = ['/api/me/profile', '/api/me/privacy', '/api/me/sessions', '/api/me'];
  for (const path of all) assert.equal((await call('GET', path, null, b.tok)).s, 200);
});

test('库中仍无明文密码和原始令牌；资料表没有可还原密钥', async () => {
  const {tok, u} = await mk();
  await call('POST', '/api/me/profile', {displayName: '安全检查', bio: 'ok'}, tok);
  const users = JSON.stringify(srv.db.prepare('SELECT * FROM users').all());
  const sess = JSON.stringify(srv.db.prepare('SELECT * FROM sessions').all());
  const prof = JSON.stringify(srv.db.prepare('SELECT * FROM profiles').all());
  assert.ok(!users.includes('Passw0rd123') && !sess.includes(tok) && !prof.includes(tok));
  const row = srv.db.prepare('SELECT password_hash FROM users WHERE username=?').get(u);
  assert.ok(row.password_hash.startsWith('scrypt$'));
});
