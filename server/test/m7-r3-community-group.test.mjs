// M7.r3：社区资料编辑、会话/社区举报、群昵称与解散。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';

let srv, base, seq = 0;
test.before(async () => {
  srv = createApp();
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
});
test.after(() => srv.close());
const call = async (m, p, body, tok) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  return {s: r.status, j: await r.json()};
};
async function acc(n) {
  const u = n + (++seq);
  const r = await call('POST', '/api/auth/register', {agree:true, username: u, email: u + '@x.test', password: 'Passw0rd123'});
  return {tok: r.j.token, id: r.j.user.id, username: r.j.user.username};
}

test('所有者与管理员可改小组名称和简介，成员不能改，校验字数', async () => {
  const o = await acc('ow'), ad = await acc('ad'), m = await acc('mb');
  const cm = await call('POST', '/api/communities', {name: '原来的名字', description: '旧简介'}, o.tok);
  assert.equal(cm.s, 200, JSON.stringify(cm.j));
  const id = cm.j.community.id;
  await call('POST', '/api/communities/' + id + '/join', {}, ad.tok);
  await call('POST', '/api/communities/' + id + '/join', {}, m.tok);
  const role = await call('POST', '/api/communities/' + id + '/role', {userId: ad.id, role: 'admin'}, o.tok);
  assert.equal(role.s, 200, JSON.stringify(role.j));

  const bad = await call('POST', '/api/communities/' + id + '/edit', {name: 'x', description: 'd'}, o.tok);
  assert.equal(bad.s, 400);
  const long = await call('POST', '/api/communities/' + id + '/edit', {name: '合法名称', description: '字'.repeat(81)}, o.tok);
  assert.equal(long.s, 400);

  const mem = await call('POST', '/api/communities/' + id + '/edit', {name: '成员乱改', description: '不行'}, m.tok);
  assert.equal(mem.s, 403);

  const okAd = await call('POST', '/api/communities/' + id + '/edit', {name: '管理员改名', description: '新简介'}, ad.tok);
  assert.equal(okAd.s, 200, JSON.stringify(okAd.j));
  assert.equal(okAd.j.community.name, '管理员改名');
  assert.equal(okAd.j.community.description, '新简介');

  const okOw = await call('POST', '/api/communities/' + id + '/edit', {name: '所有者改名', description: '再改简介'}, o.tok);
  assert.equal(okOw.s, 200);
  assert.equal(okOw.j.community.name, '所有者改名');
});

test('可以举报社区，也可以在不勾选消息的情况下举报群聊', async () => {
  const a = await acc('ra'), b = await acc('rb');
  const cm = await call('POST', '/api/communities', {name: '被举报小组', description: 'desc'}, a.tok);
  assert.equal(cm.s, 200);
  const rp = await call('POST', '/api/reports', {targetType: 'community', targetId: cm.j.community.id, reason: '垃圾信息', detail: '广告'}, b.tok);
  assert.equal(rp.s, 200, JSON.stringify(rp.j));
  assert.equal(rp.j.report.targetType, 'community');
  assert.equal(rp.j.report.targetId, cm.j.community.id);

  const g = await call('POST', '/api/conversations', {kind: 'group', name: '被举报群', userIds: [b.id]}, a.tok);
  assert.equal(g.s, 200, JSON.stringify(g.j));
  const gid = g.j.conversation.id;
  const rpcv = await call('POST', '/api/reports', {targetType: 'conversation', targetId: gid, context: {conversationId: gid}, reason: '骚扰'}, b.tok);
  assert.equal(rpcv.s, 200, JSON.stringify(rpcv.j));
  assert.equal(rpcv.j.report.targetType, 'conversation');
  assert.equal(rpcv.j.report.targetId, gid);

  const outsider = await acc('out');
  const denied = await call('POST', '/api/reports', {targetType: 'conversation', targetId: gid, context: {conversationId: gid}, reason: '骚扰'}, outsider.tok);
  assert.equal(denied.s, 403);
});

test('群成员可设置和清除本群昵称；群主可解散，成员不能解散', async () => {
  const o = await acc('go'), m = await acc('gm'), x = await acc('gx');
  const g = await call('POST', '/api/conversations', {kind: 'group', name: '昵称群', userIds: [m.id, x.id]}, o.tok);
  assert.equal(g.s, 200, JSON.stringify(g.j));
  const id = g.j.conversation.id;
  assert.equal(g.j.conversation.myNickname, null);

  const set = await call('POST', '/api/conversations/' + id + '/nickname', {nickname: '小明在这'}, m.tok);
  assert.equal(set.s, 200, JSON.stringify(set.j));
  assert.equal(set.j.nickname, '小明在这');
  assert.equal(set.j.conversation.myNickname, '小明在这');
  const asO = await call('GET', '/api/conversations/' + id, null, o.tok);
  const mem = (asO.j.conversation.members || []).find(u => Number(u.id) === Number(m.id));
  assert.ok(mem);
  assert.equal(mem.nickname, '小明在这');

  const too = await call('POST', '/api/conversations/' + id + '/nickname', {nickname: '字'.repeat(21)}, m.tok);
  assert.equal(too.s, 400);
  const clr = await call('POST', '/api/conversations/' + id + '/nickname', {nickname: ''}, m.tok);
  assert.equal(clr.s, 200);
  assert.equal(clr.j.nickname, null);

  const forbid = await call('POST', '/api/conversations/' + id + '/dissolve', {}, m.tok);
  assert.equal(forbid.s, 403);
  const dis = await call('POST', '/api/conversations/' + id + '/dissolve', {}, o.tok);
  assert.equal(dis.s, 200, JSON.stringify(dis.j));
  assert.equal(dis.j.dissolved, id);
  const gone = await call('GET', '/api/conversations/' + id, null, o.tok);
  assert.ok(gone.s === 404 || gone.s === 403);
});
