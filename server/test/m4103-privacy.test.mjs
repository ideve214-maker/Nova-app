// M4.10.3 资料可见范围与字段开关对他人生效。自己始终能看完整资料。
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
  const r = await call('POST', '/api/auth/register', {username: u, email: u + '@x.test', password: 'Passw0rd123'});
  return {tok: r.j.token, id: r.j.user.id, u};
}

test('everyone 任何人可见；friends 仅好友与自己；private 对他人是 404', async () => {
  const a = await acc('pa'), b = await acc('pb'), c = await acc('pc');
  await call('POST', '/api/me/profile', {displayName: 'AliceVis', bio: '你好世界'}, a.tok);
  // 默认 everyone
  const ev = await call('GET', '/api/users/' + a.id, null, b.tok);
  assert.equal(ev.s, 200, JSON.stringify(ev.j));
  assert.equal(ev.j.user.displayName, 'AliceVis');
  assert.equal(ev.j.user.bio, '你好世界');
  assert.equal(ev.j.user.username, a.u);
  assert.ok(!('email' in ev.j.user), '他人资料不得含邮箱');
  // 仅好友
  await call('POST', '/api/me/privacy', {profileVisibility: 'friends'}, a.tok);
  const hid = await call('GET', '/api/users/' + a.id, null, b.tok);
  assert.equal(hid.s, 403);
  assert.equal(hid.j.error.code, 'PROFILE_PRIVATE');
  const self = await call('GET', '/api/users/' + a.id, null, a.tok);
  assert.equal(self.s, 200);
  assert.equal(self.j.user.isSelf, true);
  // 加为好友后可见
  await call('POST', '/api/friends/request', {userId: b.id}, a.tok);
  await call('POST', '/api/friends/accept', {userId: a.id}, b.tok);
  const fr = await call('GET', '/api/users/' + a.id, null, b.tok);
  assert.equal(fr.s, 200);
  assert.equal(fr.j.user.isFriend, true);
  assert.equal(fr.j.user.bio, '你好世界');
  const still = await call('GET', '/api/users/' + a.id, null, c.tok);
  assert.equal(still.s, 403);
  // 仅自己：好友也 404
  await call('POST', '/api/me/privacy', {profileVisibility: 'private'}, a.tok);
  assert.equal((await call('GET', '/api/users/' + a.id, null, b.tok)).s, 404);
  assert.equal((await call('GET', '/api/users/' + a.id, null, c.tok)).s, 404);
  assert.equal((await call('GET', '/api/users/' + a.id, null, a.tok)).s, 200);
  assert.equal((await call('GET', '/api/users/' + a.id, null, null)).s, 401);
  assert.equal((await call('GET', '/api/users/not-a-number', null, a.tok)).s, 400);
  assert.equal((await call('GET', '/api/users/9999999', null, a.tok)).s, 404);
});

test('生日/年龄/性别开关对他人生效，对自己始终可见', async () => {
  const a = await acc('pd'), b = await acc('pe');
  await call('POST', '/api/me/profile', {displayName: 'Pat', gender: '女', birthday: '2000-01-15'}, a.tok);
  await call('POST', '/api/me/privacy', {showBirthday: false, showAge: true, showGender: false, profileVisibility: 'everyone'}, a.tok);
  const o = (await call('GET', '/api/users/' + a.id, null, b.tok)).j.user;
  assert.equal(o.gender, '');
  assert.equal(o.birthday, '');
  assert.equal(typeof o.age, 'number');
  assert.ok(o.age >= 25 && o.age <= 27, 'age=' + o.age);
  const me = (await call('GET', '/api/users/' + a.id, null, a.tok)).j.user;
  assert.equal(me.gender, '女');
  assert.equal(me.birthday, '2000-01-15');
  await call('POST', '/api/me/privacy', {showAge: false, showBirthday: true, showGender: true}, a.tok);
  const o2 = (await call('GET', '/api/users/' + a.id, null, b.tok)).j.user;
  assert.equal(o2.birthday, '2000-01-15');
  assert.equal(o2.age, null);
  assert.equal(o2.gender, '女');
});
