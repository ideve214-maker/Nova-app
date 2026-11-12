// M4.3.1 单聊/群聊会话与成员：会话唯一性、成员关系和权限正确。
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
  return {tok: r.j.token, id: r.j.user.id, name: u};
}
function befriend(a, b) { srv.friends.setAccepted(a.id, b.id); }

test('单聊会话一对用户唯一；不能和自己聊；未加入者 404；退出后再开是同一会话', async () => {
  const a = await acc('da'), b = await acc('db'), c = await acc('dc');
  befriend(a, b);
  const d1 = await call('POST', '/api/conversations', {kind: 'dm', userId: b.id}, a.tok);
  assert.equal(d1.s, 200, JSON.stringify(d1.j));
  assert.equal(d1.j.conversation.kind, 'dm');
  assert.equal(d1.j.conversation.memberCount, 2);
  assert.ok(d1.j.conversation.members.some(m => m.id === a.id));
  assert.ok(d1.j.conversation.members.some(m => m.id === b.id));
  const d2 = await call('POST', '/api/conversations', {kind: 'dm', userId: a.id}, b.tok);
  assert.equal(d2.s, 200);
  assert.equal(d2.j.conversation.id, d1.j.conversation.id, '同一对用户必须是同一会话');
  const self = await call('POST', '/api/conversations', {kind: 'dm', userId: a.id}, a.tok);
  assert.equal(self.s, 400); assert.equal(self.j.error.code, 'SELF_DM');
  const ghost = await call('GET', '/api/conversations/' + d1.j.conversation.id, null, c.tok);
  assert.equal(ghost.s, 404);
  const listC = await call('GET', '/api/conversations', null, c.tok);
  assert.ok(!listC.j.conversations.some(x => x.id === d1.j.conversation.id));
  const lv = await call('POST', '/api/conversations/' + d1.j.conversation.id + '/leave', {}, a.tok);
  assert.equal(lv.s, 200);
  assert.equal((await call('GET', '/api/conversations/' + d1.j.conversation.id, null, a.tok)).s, 404);
  assert.equal((await call('GET', '/api/conversations/' + d1.j.conversation.id, null, b.tok)).s, 200);
  const d3 = await call('POST', '/api/conversations', {kind: 'dm', userId: b.id}, a.tok);
  assert.equal(d3.j.conversation.id, d1.j.conversation.id);
  assert.equal((await call('GET', '/api/conversations/' + d1.j.conversation.id, null, a.tok)).s, 200);
});

test('群聊：创建者是群主；管理员可加成员；只能移出更低等级；转让群主后原群主可退出', async () => {
  const o = await acc('go'), ad = await acc('ga'), m = await acc('gm'), x = await acc('gx'), y = await acc('gy');
  const bad = await call('POST', '/api/conversations', {kind: 'group', name: '空群', userIds: []}, o.tok);
  assert.equal(bad.s, 400);
  const g = await call('POST', '/api/conversations', {kind: 'group', name: '测试群', userIds: [ad.id, m.id]}, o.tok);
  assert.equal(g.s, 200, JSON.stringify(g.j));
  const id = g.j.conversation.id;
  assert.equal(g.j.conversation.kind, 'group');
  assert.equal(g.j.conversation.myRole, '群主');
  assert.equal(g.j.conversation.owner.id, o.id);
  assert.equal(g.j.conversation.memberCount, 3);
  const asAd = await call('GET', '/api/conversations/' + id, null, ad.tok);
  assert.equal(asAd.j.conversation.myRole, '成员');
  // 成员不能设管理员、不能加人
  assert.equal((await call('POST', '/api/conversations/' + id + '/role', {userId: m.id, role: '管理员'}, ad.tok)).s, 403);
  assert.equal((await call('POST', '/api/conversations/' + id + '/members', {userId: x.id}, m.tok)).s, 403);
  // 群主设管理员，管理员可加人
  const sr = await call('POST', '/api/conversations/' + id + '/role', {userId: ad.id, role: '管理员'}, o.tok);
  assert.equal(sr.s, 200); assert.equal(sr.j.member.role, '管理员');
  assert.equal((await call('POST', '/api/conversations/' + id + '/members', {userId: x.id}, ad.tok)).s, 200);
  // 管理员不能踢群主，也不能改群主角色
  assert.equal((await call('POST', '/api/conversations/' + id + '/kick', {userId: o.id}, ad.tok)).s, 403);
  assert.equal((await call('POST', '/api/conversations/' + id + '/role', {userId: o.id, role: '成员'}, ad.tok)).s, 403);
  // 管理员可踢普通成员
  assert.equal((await call('POST', '/api/conversations/' + id + '/kick', {userId: x.id}, ad.tok)).s, 200);
  assert.equal((await call('GET', '/api/conversations/' + id, null, x.tok)).s, 404);
  // 群主不转让不能退出
  const lv = await call('POST', '/api/conversations/' + id + '/leave', {}, o.tok);
  assert.equal(lv.s, 400); assert.equal(lv.j.error.code, 'OWNER_LEAVE');
  const tr = await call('POST', '/api/conversations/' + id + '/leave', {transferTo: ad.id}, o.tok);
  assert.equal(tr.s, 200, JSON.stringify(tr.j));
  const nowAd = await call('GET', '/api/conversations/' + id, null, ad.tok);
  assert.equal(nowAd.j.conversation.myRole, '群主');
  assert.equal(nowAd.j.conversation.owner.id, ad.id);
  assert.equal((await call('GET', '/api/conversations/' + id, null, o.tok)).s, 404);
  // 改名权限
  assert.equal((await call('POST', '/api/conversations/' + id + '/rename', {name: '新名字'}, m.tok)).s, 403);
  assert.equal((await call('POST', '/api/conversations/' + id + '/rename', {name: '新名字'}, ad.tok)).s, 200);
  // 外人不能用夹带的 conversationId 操作
  assert.equal((await call('POST', '/api/conversations/' + id + '/members', {userId: y.id}, y.tok)).s, 404);
});
