// M2.6.2 头像。r10 起新版客户端只用官方默认头像或图片头像；颜色/文字字段只为兼容旧版保留。
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
const mk = async () => { const u = 'av_' + (++n); const r = await call('POST', '/api/auth/register', {agree:true, username: u, email: u + '@x.test', password: 'Passw0rd123'}); return {id: r.j.user.id, tok: r.j.token, u}; };

test('新用户是官方默认头像（兼容字段仍有颜色和首字母）；设置后入库，重新登录仍在', async () => {
  const {u, tok} = await mk();
  const d = (await call('GET', '/api/me/profile', null, tok)).j.profile.avatar;
  assert.equal(d.kind, 'default');
  assert.equal(d.image, null);
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

test('图片头像只接受内置样板或自己的图片；非法颜色或文字被拒；不能改别人的头像', async () => {
  const a = await mk(), b = await mk();
  const img = await call('POST', '/api/me/avatar', {avatar: {kind: 'image', image: 'https://evil.example/a.jpg'}}, a.tok);
  assert.equal(img.s, 400); assert.equal(img.j.error.code, 'BAD_AVATAR');
  const okImg = await call('POST', '/api/me/avatar', {avatar: {kind: 'image', image: 'assets/av-me.jpg'}}, a.tok);
  assert.equal(okImg.s, 200); assert.equal(okImg.j.profile.avatar.image, 'assets/av-me.jpg');
  assert.equal((await call('POST', '/api/me/avatar', {avatar: {color: 'red', letter: 'A'}}, a.tok)).j.error.code, 'BAD_AVATAR_COLOR');
  assert.equal((await call('POST', '/api/me/avatar', {avatar: {color: '#243044', letter: '两个'}}, a.tok)).j.error.code, 'BAD_AVATAR_LETTER');
  await call('POST', '/api/me/avatar', {avatar: {color: '#6B3A4A', letter: 'A'}}, a.tok);
  await call('POST', '/api/me/avatar', {avatar: {color: '#3A465C', letter: 'B', userId: a.id}}, b.tok);
  assert.equal((await call('GET', '/api/me/profile', null, a.tok)).j.profile.avatar.letter, 'A');
});
