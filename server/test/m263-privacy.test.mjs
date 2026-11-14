// M2.6.3 隐私设置：每项都有服务端读写和默认值。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';
import {PRIVACY_DEFAULTS} from '../profile.mjs';

let srv, base;
test.before(async () => { srv = createApp(); await new Promise(r => srv.listen(0, r)); base = 'http://127.0.0.1:' + srv.address().port; });
test.after(() => srv.close());
const call = async (m, p, body, tok) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  return {s: r.status, j: await r.json()};
};
let n = 0;
const mk = async () => { const u = 'pr_' + (++n); const r = await call('POST', '/api/auth/register', {agree:true, username: u, email: u + '@x.test', password: 'Passw0rd123'}); return {id: r.j.user.id, tok: r.j.token, u}; };

test('未写过库的用户返回全部默认值；默认值在响应里公开', async () => {
  assert.equal((await call('GET', '/api/me/privacy')).s, 401);
  const {tok} = await mk();
  const r = await call('GET', '/api/me/privacy', null, tok);
  assert.equal(r.s, 200);
  assert.deepEqual(r.j.privacy, PRIVACY_DEFAULTS);
  assert.deepEqual(r.j.defaults, PRIVACY_DEFAULTS);
  assert.equal(r.j.privacy.profileVisibility, 'everyone');
  assert.equal(r.j.privacy.friendRequests, 'everyone');
  assert.equal(r.j.privacy.showBirthday, true);
  assert.equal(r.j.privacy.showAge, true);
  assert.equal(r.j.privacy.showGender, true);
  assert.equal(r.j.privacy.searchable, true);
});

test('每项都可以读写并持久化；非法值被拒；不能改别人的设置', async () => {
  const a = await mk(), b = await mk();
  const p = await call('POST', '/api/me/privacy', {
    profileVisibility: 'friends', friendRequests: 'nobody',
    showBirthday: false, showAge: false, showGender: true, searchable: false,
  }, a.tok);
  assert.equal(p.s, 200);
  assert.equal(p.j.privacy.profileVisibility, 'friends');
  assert.equal(p.j.privacy.friendRequests, 'nobody');
  assert.equal(p.j.privacy.showBirthday, false);
  assert.equal(p.j.privacy.searchable, false);
  const again = await call('POST', '/api/auth/login', {account: a.u, password: 'Passw0rd123'});
  const got = await call('GET', '/api/me/privacy', null, again.j.token);
  assert.deepEqual(got.j.privacy, p.j.privacy);
  assert.equal((await call('POST', '/api/me/privacy', {profileVisibility: 'world'}, a.tok)).j.error.code, 'BAD_PRIVACY');
  assert.equal((await call('POST', '/api/me/privacy', {friendRequests: 'maybe'}, a.tok)).j.error.code, 'BAD_PRIVACY');
  const sneak = await call('POST', '/api/me/privacy', {profileVisibility: 'private', userId: a.id}, b.tok);
  assert.equal(sneak.j.privacy.profileVisibility, 'private');
  assert.equal((await call('GET', '/api/me/privacy', null, a.tok)).j.privacy.profileVisibility, 'friends');
  assert.equal((await call('GET', '/api/me/privacy', null, b.tok)).j.privacy.profileVisibility, 'private');
});
