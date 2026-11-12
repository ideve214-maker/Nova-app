// M2.6.1 个人资料读取与编辑：服务端持久化，重新登录仍在。
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
const mk = async (name) => { const u = name || ('pf_' + (++n)); const r = await call('POST', '/api/auth/register', {username: u, email: u + '@x.com', password: 'Passw0rd123'}); return {id: r.j.user.id, tok: r.j.token, u, user: r.j.user}; };

test('未登录 401；新用户返回默认资料（昵称=用户名，简介为空），并出现在 /api/me', async () => {
  assert.equal((await call('GET', '/api/me/profile')).s, 401);
  const {u, tok, user} = await mk();
  const r = await call('GET', '/api/me/profile', null, tok);
  assert.equal(r.s, 200);
  assert.equal(r.j.profile.displayName, u);
  assert.equal(r.j.profile.bio, '');
  assert.equal(r.j.profile.gender, '');
  assert.equal(r.j.profile.birthday, '');
  assert.equal(user.profile.displayName, u);
  const me = await call('GET', '/api/me', null, tok);
  assert.equal(me.j.user.profile.displayName, u);
});

test('修改昵称、简介、性别、生日后入库；退出再登录仍然存在', async () => {
  const {u, tok} = await mk();
  const p = await call('POST', '/api/me/profile', {displayName: '夏日知音', bio: '把句子写下来。', gender: '女', birthday: '1998-05-20'}, tok);
  assert.equal(p.s, 200);
  assert.equal(p.j.profile.displayName, '夏日知音');
  assert.equal(p.j.profile.bio, '把句子写下来。');
  assert.equal(p.j.profile.gender, '女');
  assert.equal(p.j.profile.birthday, '1998-05-20');
  assert.equal(p.j.user.profile.displayName, '夏日知音');
  await call('POST', '/api/auth/logout', {}, tok);
  const again = await call('POST', '/api/auth/login', {account: u, password: 'Passw0rd123'});
  assert.equal(again.s, 200);
  assert.equal(again.j.user.profile.displayName, '夏日知音');
  assert.equal(again.j.user.profile.bio, '把句子写下来。');
  const got = await call('GET', '/api/me/profile', null, again.j.token);
  assert.equal(got.j.profile.birthday, '1998-05-20');
  assert.equal(got.j.profile.gender, '女');
});

test('校验：显示名 1–20 字、简介最多 80、非法生日/性别被拒；不能改别人的资料', async () => {
  const a = await mk(), b = await mk();
  assert.equal((await call('POST', '/api/me/profile', {displayName: ''}, a.tok)).j.error.code, 'BAD_DISPLAY_NAME');
  assert.equal((await call('POST', '/api/me/profile', {displayName: '字'.repeat(21)}, a.tok)).j.error.code, 'BAD_DISPLAY_NAME');
  assert.equal((await call('POST', '/api/me/profile', {bio: '啊'.repeat(81)}, a.tok)).j.error.code, 'BAD_BIO');
  assert.equal((await call('POST', '/api/me/profile', {gender: '未知'}, a.tok)).j.error.code, 'BAD_GENDER');
  assert.equal((await call('POST', '/api/me/profile', {birthday: '2999-01-01'}, a.tok)).j.error.code, 'BAD_BIRTHDAY');
  assert.equal((await call('POST', '/api/me/profile', {birthday: 'not-a-date'}, a.tok)).j.error.code, 'BAD_BIRTHDAY');
  await call('POST', '/api/me/profile', {displayName: '只属于A', bio: 'A 的简介'}, a.tok);
  const sneak = await call('POST', '/api/me/profile', {displayName: '被B改了', userId: a.id}, b.tok);
  assert.equal(sneak.s, 200); assert.equal(sneak.j.profile.displayName, '被B改了'); // B 改的是自己
  assert.equal((await call('GET', '/api/me/profile', null, a.tok)).j.profile.displayName, '只属于A');
  assert.equal((await call('GET', '/api/me/profile', null, b.tok)).j.profile.bio, '');
});
