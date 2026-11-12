// M4.2.1 社区创建、发现、加入、退出：真实入库；成员状态变更正确。
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

test('创建社区入库：创建者是所有者，自带大厅和公告；发现列表能看到公开社区', async () => {
  const a = await acc('ca'), b = await acc('cb');
  assert.equal((await call('POST', '/api/communities', {name: '夜读角', description: '只讨论句子。'})).s, 401);
  const r = await call('POST', '/api/communities', {name: '夜读角', description: '只讨论句子。'}, a.tok);
  assert.equal(r.s, 200, JSON.stringify(r.j));
  assert.ok(r.j.community.id.startsWith('cm_'));
  assert.equal(r.j.community.role, '所有者');
  assert.equal(r.j.community.joined, true);
  assert.equal(r.j.community.memberCount, 1);
  assert.equal(r.j.community.visibility, 'public');
  const kinds = r.j.community.channels.map(c => c.name + c.kind).sort();
  assert.deepEqual(kinds, ['公告公告', '大厅文字']);
  const row = srv.db.prepare('SELECT * FROM communities WHERE id=?').get(r.j.community.id);
  assert.equal(row.name, '夜读角'); assert.equal(row.owner_id, a.id);
  const disc = await call('GET', '/api/communities', null, b.tok);
  assert.ok(disc.j.communities.some(c => c.id === r.j.community.id && c.joined === false));
  const mine = await call('GET', '/api/communities?mine=1', null, a.tok);
  assert.ok(mine.j.communities.some(c => c.id === r.j.community.id));
  const mineB = await call('GET', '/api/communities?mine=1', null, b.tok);
  assert.ok(!mineB.j.communities.some(c => c.id === r.j.community.id));
  assert.equal((await call('POST', '/api/communities', {name: '啊'}, a.tok)).s, 400);
});

test('加入和退出：成员数正确变化；重复加入幂等；所有者不能直接退出', async () => {
  const a = await acc('ja'), b = await acc('jb');
  const cm = (await call('POST', '/api/communities', {name: '城市步行', description: '交换路线'}, a.tok)).j.community;
  const j = await call('POST', '/api/communities/' + cm.id + '/join', {}, b.tok);
  assert.equal(j.s, 200); assert.equal(j.j.community.joined, true); assert.equal(j.j.community.role, '成员');
  assert.equal(j.j.community.memberCount, 2); assert.equal(j.j.already, false);
  const j2 = await call('POST', '/api/communities/' + cm.id + '/join', {}, b.tok);
  assert.equal(j2.j.already, true); assert.equal(j2.j.community.memberCount, 2);
  const got = await call('GET', '/api/communities/' + cm.id, null, a.tok);
  assert.equal(got.j.community.memberCount, 2);
  const lv = await call('POST', '/api/communities/' + cm.id + '/leave', {}, b.tok);
  assert.equal(lv.s, 200);
  assert.equal((await call('GET', '/api/communities/' + cm.id, null, a.tok)).j.community.memberCount, 1);
  const own = await call('POST', '/api/communities/' + cm.id + '/leave', {}, a.tok);
  assert.equal(own.s, 400); assert.equal(own.j.error.code, 'OWNER_LEAVE');
  // 退出后再加入，仍是成员
  const j3 = await call('POST', '/api/communities/' + cm.id + '/join', {}, b.tok);
  assert.equal(j3.s, 200); assert.equal(j3.j.community.role, '成员'); assert.equal(j3.j.community.memberCount, 2);
});
