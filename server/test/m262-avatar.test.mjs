// M2.6.2 颜色/文字头像：设置入库；图片头像明确尚未开放。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';
import {AVATAR_COLORS} from '../profile.mjs';

let srv, base;
test.before(async () => { srv = createApp(); await new Promise(r => srv.listen(0, r)); base = 'http://127.0.0.1:' + srv.address().port; });
test.after(() => srv.close());
const call = async (m, p, body, tok) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  return {s: r.status, j: await r.json()};
};
let n = 0;
const mk = async () => { const u = 'av_' + (++n); const r = await call('POST', '/api/auth/register', {agree:true, username: u, email: u + '@x.com', password: 'Passw0rd123'}); return {id: r.j.user.id, tok: r.j.token, u}; };

test('新用户有默认颜色和首字母；设置后入库，重新登录仍在', async () => {
  const {u, tok} = await mk();
  const d = (await call('GET', '/api/me/profile', null, tok)).j.profile.avatar;
  assert.equal(d.kind, 'color');
  assert.ok(AVATAR_COLORS.includes(d.color) || /^#[0-9A-Fa-f]{6}$/.test(d.color));
  assert.equal(d.letter, [...u][0]);
  const r = await call('POST', '/api/me/avatar', {avatar: {kind: 'color', color: '#243044', letter: '夏'}}, tok);
  assert.equal(r.s, 200);
  assert.equal(r.j.profile.avatar.color, '#243044');
  assert.equal(r.j.profile.avatar.letter, '夏');
  const login = await call('POST', '/api/auth/login', {account: u, password: 'Passw0rd123'});
  assert.equal(login.j.user.profile.avatar.letter, '夏');
  assert.equal(login.j.user.profile.avatar.color, '#243044');
});

test('图片头像尚未开放；非法颜色或文字被拒；不能改别人的头像', async () => {
  const a = await mk(), b = await mk();
  const img = await call('POST', '/api/me/avatar', {avatar: {kind: 'image', color: '#243044', letter: 'A'}}, a.tok);
  assert.equal(img.s, 400); assert.equal(img.j.error.code, 'AVATAR_IMAGE_PENDING');
  assert.match(img.j.error.message, /后续/);
  assert.equal((await call('POST', '/api/me/avatar', {avatar: {color: 'red', letter: 'A'}}, a.tok)).j.error.code, 'BAD_AVATAR_COLOR');
  assert.equal((await call('POST', '/api/me/avatar', {avatar: {color: '#243044', letter: '两个'}}, a.tok)).j.error.code, 'BAD_AVATAR_LETTER');
  await call('POST', '/api/me/avatar', {avatar: {color: '#6B3A4A', letter: 'A'}}, a.tok);
  await call('POST', '/api/me/avatar', {avatar: {color: '#3A465C', letter: 'B', userId: a.id}}, b.tok);
  assert.equal((await call('GET', '/api/me/profile', null, a.tok)).j.profile.avatar.letter, 'A');
});
