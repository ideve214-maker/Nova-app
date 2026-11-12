// M4.2.2 成员列表与成员角色：所有者/管理员/版主/成员权限服务端校验。
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
  const r = await call('POST', '/api/auth/register', {agree:true, username: u, email: u + '@x.test', password: 'Passw0rd123'});
  return {tok: r.j.token, id: r.j.user.id};
}
async function cm(tok, name = '角色社区') {
  return (await call('POST', '/api/communities', {name}, tok)).j.community;
}

test('成员列表含角色；所有者可把成员设为管理员或版主，结果入库', async () => {
  const o = await acc('ro'), a = await acc('ra'), m = await acc('rm');
  const c = await cm(o.tok);
  await call('POST', '/api/communities/' + c.id + '/join', {}, a.tok);
  await call('POST', '/api/communities/' + c.id + '/join', {}, m.tok);
  const list = await call('GET', '/api/communities/' + c.id + '/members', null, o.tok);
  assert.equal(list.s, 200);
  assert.equal(list.j.members.length, 3);
  assert.ok(list.j.members.some(x => x.id === o.id && x.role === '所有者'));
  const setA = await call('POST', '/api/communities/' + c.id + '/role', {userId: a.id, role: 'admin'}, o.tok);
  assert.equal(setA.s, 200, JSON.stringify(setA.j));
  assert.equal(setA.j.member.role, '管理员');
  const setM = await call('POST', '/api/communities/' + c.id + '/role', {userId: m.id, role: '版主'}, a.tok);
  assert.equal(setM.s, 200); assert.equal(setM.j.member.role, '版主');
  const row = srv.db.prepare('SELECT role FROM community_members WHERE community_id=? AND user_id=?').get(c.id, a.id);
  assert.equal(row.role, 'admin');
});

test('权限边界：成员不能改角色；管理员不能设管理员或改所有者；不能管理同级或更高级', async () => {
  const o = await acc('ow'), ad = await acc('ad'), mem = await acc('mm'), other = await acc('ot');
  const c = await cm(o.tok);
  await call('POST', '/api/communities/' + c.id + '/join', {}, ad.tok);
  await call('POST', '/api/communities/' + c.id + '/join', {}, mem.tok);
  await call('POST', '/api/communities/' + c.id + '/role', {userId: ad.id, role: 'admin'}, o.tok);
  assert.equal((await call('POST', '/api/communities/' + c.id + '/role', {userId: mem.id, role: 'mod'}, mem.tok)).s, 403);
  assert.equal((await call('POST', '/api/communities/' + c.id + '/role', {userId: mem.id, role: 'admin'}, ad.tok)).s, 403);
  assert.equal((await call('POST', '/api/communities/' + c.id + '/role', {userId: o.id, role: 'member'}, ad.tok)).s, 403);
  assert.equal((await call('POST', '/api/communities/' + c.id + '/role', {userId: ad.id, role: 'member'}, ad.tok)).s, 403);
  assert.equal((await call('GET', '/api/communities/' + c.id + '/members', null, other.tok)).s, 403);
  const still = srv.db.prepare('SELECT role FROM community_members WHERE community_id=? AND user_id=?').get(c.id, o.id);
  assert.equal(still.role, 'owner');
});
