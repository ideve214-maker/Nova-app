// M4.2.5 社区联网回归：双账号角色、退出、封禁、删除等用例。
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
  return {tok: r.j.token, id: r.j.user.id};
}

test('一条链路：设角色、退出、封禁后再加入被拒、解散后读取 404', async () => {
  const o = await acc('xo'), ad = await acc('xad'), mem = await acc('xm'), ban = await acc('xb');
  const c = (await call('POST', '/api/communities', {name: '回归社区'}, o.tok)).j.community;
  await call('POST', '/api/communities/' + c.id + '/join', {}, ad.tok);
  await call('POST', '/api/communities/' + c.id + '/join', {}, mem.tok);
  await call('POST', '/api/communities/' + c.id + '/join', {}, ban.tok);
  await call('POST', '/api/communities/' + c.id + '/role', {userId: ad.id, role: 'admin'}, o.tok);
  // 管理员可踢普通成员并封禁
  const k = await call('POST', '/api/communities/' + c.id + '/kick', {userId: ban.id, ban: true}, ad.tok);
  assert.equal(k.s, 200); assert.equal(k.j.banned, true);
  const re = await call('POST', '/api/communities/' + c.id + '/join', {}, ban.tok);
  assert.equal(re.s, 403); assert.equal(re.j.error.code, 'BANNED');
  // 管理员不能踢所有者
  assert.equal((await call('POST', '/api/communities/' + c.id + '/kick', {userId: o.id}, ad.tok)).s, 403);
  // 成员自己退出
  assert.equal((await call('POST', '/api/communities/' + c.id + '/leave', {}, mem.tok)).s, 200);
  assert.equal((await call('GET', '/api/communities/' + c.id, null, o.tok)).j.community.memberCount, 2); // owner+admin
  // 成员不能解散；所有者可以
  assert.equal((await call('POST', '/api/communities/' + c.id + '/dissolve', {}, ad.tok)).s, 403);
  const dis = await call('POST', '/api/communities/' + c.id + '/dissolve', {}, o.tok);
  assert.equal(dis.s, 200);
  assert.equal((await call('GET', '/api/communities/' + c.id, null, o.tok)).s, 404);
  assert.ok(!(await call('GET', '/api/communities', null, o.tok)).j.communities.some(x => x.id === c.id));
  const row = srv.db.prepare('SELECT * FROM communities WHERE id=?').get(c.id);
  assert.ok(row.deleted_at);
});

test('A 的社区权限不影响 B 的社区；夹带 communityId 不能越权', async () => {
  const a = await acc('aa'), b = await acc('bb'), m = await acc('mm');
  const ca = (await call('POST', '/api/communities', {name: 'A 的社区'}, a.tok)).j.community;
  const cb = (await call('POST', '/api/communities', {name: 'B 的社区'}, b.tok)).j.community;
  await call('POST', '/api/communities/' + cb.id + '/join', {}, m.tok);
  const r = await call('POST', '/api/communities/' + cb.id + '/role', {userId: m.id, role: 'admin'}, a.tok);
  assert.equal(r.s, 403);
  const still = srv.db.prepare('SELECT role FROM community_members WHERE community_id=? AND user_id=?').get(cb.id, m.id);
  assert.equal(still.role, 'member');
  assert.equal((await call('POST', '/api/communities/' + cb.id + '/dissolve', {}, a.tok)).s, 403);
  assert.equal((await call('GET', '/api/communities/' + cb.id, null, b.tok)).s, 200);
});
