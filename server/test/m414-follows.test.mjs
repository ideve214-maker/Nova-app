// M4.1.4 关注/取消关注：单向关注；与双向好友分开建模。
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
  return {tok: r.j.token, id: r.j.user.id, username: r.j.user.username};
}

test('关注是单向的：A 关注 B 不等于 B 关注 A；重复关注幂等；不能关注自己', async () => {
  const a = await acc('fa'), b = await acc('fb');
  const r = await call('POST', '/api/follows', {userId: b.id}, a.tok);
  assert.equal(r.s, 200, JSON.stringify(r.j));
  assert.equal(r.j.following, true); assert.equal(r.j.already, false);
  const again = await call('POST', '/api/follows', {userId: b.id}, a.tok);
  assert.equal(again.s, 200); assert.equal(again.j.already, true);
  const listA = await call('GET', '/api/follows?kind=following', null, a.tok);
  assert.equal(listA.j.followingCount, 1); assert.equal(listA.j.followerCount, 0);
  assert.equal(listA.j.users[0].id, b.id);
  const folB = await call('GET', '/api/follows?kind=followers&user=' + b.id, null, a.tok);
  assert.equal(folB.j.followerCount, 1);
  const listB = await call('GET', '/api/follows?kind=following', null, b.tok);
  assert.equal(listB.j.followingCount, 0, '关注不是双向的');
  const self = await call('POST', '/api/follows', {userId: a.id}, a.tok);
  assert.equal(self.s, 400);
  const rm = await call('POST', '/api/follows/remove', {userId: b.id}, a.tok);
  assert.equal(rm.s, 200); assert.equal(rm.j.following, false);
  assert.equal((await call('GET', '/api/follows?kind=following', null, a.tok)).j.followingCount, 0);
  assert.equal((await call('POST', '/api/follows', {userId: 999999}, a.tok)).s, 404);
  assert.equal((await call('GET', '/api/follows')).s, 401);
});

test('关注动态流只含自己和已关注的人；与好友表无关（没有好友记录也能关注）', async () => {
  const a = await acc('ga'), b = await acc('gb'), c = await acc('gc');
  await call('POST', '/api/posts', {text: 'A 的动态'}, a.tok);
  await call('POST', '/api/posts', {text: 'B 的动态'}, b.tok);
  await call('POST', '/api/posts', {text: 'C 的动态'}, c.tok);
  await call('POST', '/api/follows', {userId: b.id}, a.tok);
  const rec = await call('GET', '/api/posts?feed=rec', null, a.tok);
  const recTexts = rec.j.posts.map(p => p.text);
  assert.ok(recTexts.includes('B 的动态') && recTexts.includes('C 的动态'));
  const fol = await call('GET', '/api/posts?feed=follow', null, a.tok);
  const texts = fol.j.posts.map(p => p.text);
  assert.ok(texts.includes('A 的动态') && texts.includes('B 的动态'));
  assert.ok(!texts.includes('C 的动态'));
  const tables = srv.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  assert.ok(tables.includes('follows'));
  assert.ok(!tables.includes('friends'), '好友表尚未建立，关注不依赖好友');
});
