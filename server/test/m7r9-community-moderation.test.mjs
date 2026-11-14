// 管理端社区管理：下架/恢复/警告/删除、成员移除/禁言；下架后用户端各接口都拒绝；下架通知可申诉，申诉端到端（提交→管理端队列→通过恢复/驳回通知）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';

let srv, base, seq = 0, adminTok;
test.before(async () => {
  srv = createApp({adminUsername: 'ops_cmod', adminPassword: 'OpsCmodPass1'});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  adminTok = (await call('POST', '/api/admin/auth/login', {username: 'ops_cmod', password: 'OpsCmodPass1'})).j.token;
});
test.after(() => srv.close());
const call = async (m, p, body, tok) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  return {s: r.status, j: await r.json()};
};
const A = (m, p, b) => call(m, p, b, adminTok);
async function acc(n) {
  const u = n + (++seq);
  const r = await call('POST', '/api/auth/register', {agree: true, username: u, email: u + '@x.test', password: 'Passw0rd123'});
  return {tok: r.j.token, id: r.j.user.id, u};
}
async function world() {
  const owner = await acc('co'), member = await acc('cm'), outsider = await acc('cx');
  const cm = (await call('POST', '/api/communities', {name: '测试社区' + seq, description: '用于下架测试'}, owner.tok)).j.community;
  assert.ok(cm && cm.id);
  assert.equal((await call('POST', '/api/communities/' + cm.id + '/join', {}, member.tok)).s, 200);
  return {owner, member, outsider, cm, ch: cm.channels[0]};
}
const notes = async tok => (await call('GET', '/api/notifications', null, tok)).j.notifications;

test('下架：需要原因；用户端列表/搜索/详情/加入/频道/发言都拒绝；所有者收到可申诉通知；管理端仍可见；恢复后一切正常', async () => {
  const {owner, member, outsider, cm, ch} = await world();
  assert.equal((await A('POST', `/api/admin/communities/${cm.id}/takedown`, {})).s, 400);
  const t = await A('POST', `/api/admin/communities/${cm.id}/takedown`, {reason: '违规引流'});
  assert.equal(t.s, 200, JSON.stringify(t.j));
  assert.equal(t.j.community.status, 'taken_down');
  assert.equal(t.j.notified, true);

  const list = (await call('GET', '/api/communities', null, outsider.tok)).j.communities;
  assert.equal(list.some(c => c && c.id === cm.id), false);
  const mine = (await call('GET', '/api/communities?mine=1', null, member.tok)).j.communities;
  assert.equal(mine.some(c => c && c.id === cm.id), false);
  const s = (await call('GET', '/api/search?q=' + encodeURIComponent('测试社区') + '&type=community', null, outsider.tok)).j;
  assert.equal((s.communities || []).some(c => c.id === cm.id), false);
  const d = await call('GET', '/api/communities/' + cm.id, null, member.tok);
  assert.equal(d.s, 404); assert.equal(d.j.error.code, 'COMMUNITY_TAKEN_DOWN'); assert.equal(d.j.error.reason, undefined);
  const dOwner = await call('GET', '/api/communities/' + cm.id, null, owner.tok);
  assert.equal(dOwner.s, 404); assert.equal(dOwner.j.error.reason, '违规引流'); assert.equal(dOwner.j.error.appealable, true);
  assert.equal((await call('POST', '/api/communities/' + cm.id + '/join', {}, outsider.tok)).s, 404);
  assert.equal((await call('GET', '/api/channels/' + ch.id + '/messages', null, member.tok)).s, 404);
  assert.equal((await call('POST', '/api/channels/' + ch.id + '/messages', {text: 'hi'}, member.tok)).s, 404);

  const n = (await notes(owner.tok)).find(x => x.kind === 'community_takedown');
  assert.ok(n, 'owner got takedown notification');
  assert.match(n.body, /因存在问题已被下架（原因：违规引流），如有疑问请联系管理员或提交申诉/);
  assert.equal(n.appealable, true);
  assert.equal(n.data.type, 'community_takedown'); assert.equal(n.data.communityId, cm.id); assert.equal(n.data.reason, '违规引流');
  assert.equal(n.refType, 'community'); assert.equal(n.refId, cm.id);

  const al = (await A('GET', '/api/admin/communities')).j.communities.find(c => c.id === cm.id);
  assert.equal(al.status, 'taken_down'); assert.equal(al.takedownReason, '违规引流');
  const audit = (await A('GET', '/api/admin/audit?limit=50')).j;
  assert.ok(JSON.stringify(audit).includes('admin.community.takedown'));

  const r = await A('POST', `/api/admin/communities/${cm.id}/restore`, {reason: '已整改'});
  assert.equal(r.s, 200); assert.equal(r.j.community.status, 'active');
  assert.equal((await call('GET', '/api/communities/' + cm.id, null, member.tok)).s, 200);
  assert.equal((await call('POST', '/api/channels/' + ch.id + '/messages', {text: 'back'}, member.tok)).s, 200);
});

test('警告通知所有者；删除需二次确认；移除成员和禁言生效并通知；不能移除所有者', async () => {
  const {owner, member, cm, ch} = await world();
  const w = await A('POST', `/api/admin/communities/${cm.id}/warn`, {reason: '公告频道广告过多'});
  assert.equal(w.s, 200); assert.equal(w.j.notified, true);
  assert.ok((await notes(owner.tok)).some(x => x.kind === 'community_warning' && x.body.includes('公告频道广告过多')));

  const mu = await A('POST', `/api/admin/communities/${cm.id}/members/${member.id}/mute`, {reason: '刷屏', hours: 2});
  assert.equal(mu.s, 200);
  assert.equal(mu.j.community.members.find(m => m.userId === member.id).muted, true);
  const p = await call('POST', '/api/channels/' + ch.id + '/messages', {text: 'x'}, member.tok);
  assert.equal(p.s, 403); assert.equal(p.j.error.code, 'MUTED');
  assert.equal((await A('POST', `/api/admin/communities/${cm.id}/members/${member.id}/unmute`, {})).s, 200);
  assert.equal((await call('POST', '/api/channels/' + ch.id + '/messages', {text: 'ok'}, member.tok)).s, 200);

  assert.equal((await A('POST', `/api/admin/communities/${cm.id}/members/${owner.id}/remove`, {reason: 'x'})).s, 400);
  const rm = await A('POST', `/api/admin/communities/${cm.id}/members/${member.id}/remove`, {reason: '多次违规', ban: true});
  assert.equal(rm.s, 200); assert.equal(rm.j.banned, true);
  assert.equal((await call('POST', '/api/communities/' + cm.id + '/join', {}, member.tok)).s, 403);
  assert.ok((await notes(member.tok)).some(x => x.title === '你已被移出社区'));

  assert.equal((await A('POST', `/api/admin/communities/${cm.id}/delete`, {reason: '严重违规'})).j.error.code, 'CONFIRM_REQUIRED');
  const del = await A('POST', `/api/admin/communities/${cm.id}/delete`, {reason: '严重违规', confirm: cm.id});
  assert.equal(del.s, 200);
  assert.equal((await A('GET', '/api/admin/communities')).j.communities.some(c => c.id === cm.id), false);
  assert.equal((await call('GET', '/api/communities/' + cm.id, null, owner.tok)).s, 404);
});

test('申诉端到端：非所有者/未下架拒绝；所有者提交→管理端队列带社区信息→通过即恢复并通知；再次下架→驳回通知', async () => {
  const {owner, member, cm} = await world();
  assert.equal((await call('POST', '/api/appeals', {kind: 'community', related: cm.id, body: '我们已经整改完毕'}, owner.tok)).j.error.code, 'NOT_TAKEN_DOWN');
  await A('POST', `/api/admin/communities/${cm.id}/takedown`, {reason: '违规内容'});
  assert.equal((await call('POST', '/api/appeals', {kind: 'community', related: cm.id, body: '不是我的社区'}, member.tok)).s, 403);
  const ap = await call('POST', '/api/appeals', {kind: 'community', communityId: cm.id, body: '我们已经整改完毕，请恢复'}, owner.tok);
  assert.equal(ap.s, 200, JSON.stringify(ap.j));
  assert.equal(ap.j.appeal.kind, 'community'); assert.equal(ap.j.appeal.targetType, 'community');
  const dup = await call('POST', '/api/appeals', {kind: 'community', related: cm.id, body: '再提交一次看看'}, owner.tok);
  assert.equal(dup.j.already, true); assert.equal(dup.j.appeal.id, ap.j.appeal.id);
  const ownerView = await call('GET', '/api/communities/' + cm.id, null, owner.tok);
  assert.equal(ownerView.j.error.appealStatus, 'pending'); assert.equal(ownerView.j.error.appealable, false);
  assert.ok((await call('GET', '/api/appeals', null, owner.tok)).j.appeals.some(a => a.id === ap.j.appeal.id));

  const q = (await A('GET', '/api/admin/appeals?status=pending')).j.appeals.find(a => a.id === ap.j.appeal.id);
  assert.ok(q, 'in admin queue');
  assert.equal(q.community.id, cm.id); assert.equal(q.community.status, 'taken_down'); assert.equal(q.community.takedownReason, '违规内容');
  assert.equal(q.user.id, owner.id);
  const one = (await A('GET', '/api/admin/appeals/' + ap.j.appeal.id)).j.appeal;
  assert.equal(one.community.name, cm.name);

  const ok = await A('POST', `/api/admin/appeals/${ap.j.appeal.id}/decision`, {action: 'accept', note: '已核实整改'});
  assert.equal(ok.s, 200); assert.equal(ok.j.restored, true); assert.equal(ok.j.appeal.status, 'accepted');
  assert.equal((await call('GET', '/api/communities/' + cm.id, null, member.tok)).s, 200);
  const res = (await notes(owner.tok)).find(x => x.kind === 'appeal_result');
  assert.ok(res); assert.match(res.body, /已通过，社区已恢复上架/); assert.equal(res.data.restored, true);
  assert.equal((await A('POST', `/api/admin/appeals/${ap.j.appeal.id}/decision`, {action: 'reject'})).j.already, true);

  await A('POST', `/api/admin/communities/${cm.id}/takedown`, {reason: '再次违规'});
  const ap2 = await call('POST', '/api/appeals', {kind: 'community', related: cm.id, body: '请再看一下'}, owner.tok);
  const no = await A('POST', `/api/admin/appeals/${ap2.j.appeal.id}/decision`, {action: 'reject', note: '证据充分'});
  assert.equal(no.s, 200); assert.equal(no.j.restored, false);
  assert.equal((await call('GET', '/api/communities/' + cm.id, null, member.tok)).s, 404);
  assert.ok((await notes(owner.tok)).some(x => x.kind === 'appeal_result' && /未通过。说明：证据充分/.test(x.body)));
});

test('举报社区：删除内容→下架（所有者收到可申诉通知，不重复收举报结果），警告→通知所有者', async () => {
  const {owner, member, cm} = await world();
  const rep = (await call('POST', '/api/reports', {targetType: 'community', targetId: cm.id, reason: '色情低俗'}, member.tok)).j.report;
  const d = await A('POST', `/api/admin/reports/${rep.id}/decision`, {action: 'resolve', note: '删除内容并警告', notify: true});
  assert.equal(d.s, 200, JSON.stringify(d.j));
  assert.equal(d.j.enforced.communityTakenDown, true);
  assert.equal((await call('GET', '/api/communities/' + cm.id, null, member.tok)).j.error.code, 'COMMUNITY_TAKEN_DOWN');
  const ns = await notes(owner.tok);
  assert.ok(ns.some(x => x.kind === 'community_takedown' && x.appealable));
  assert.equal(ns.some(x => x.kind === 'report_result'), false);
  assert.ok((await notes(member.tok)).some(x => x.kind === 'report_result'));

  const c2 = await world();
  const rep2 = (await call('POST', '/api/reports', {targetType: 'community', targetId: c2.cm.id, reason: '广告'}, c2.member.tok)).j.report;
  const w = await A('POST', `/api/admin/reports/${rep2.id}/decision`, {action: 'resolve', note: '警告', notify: true});
  assert.equal(w.j.enforced.penalty, 'warn');
  assert.ok((await notes(c2.owner.tok)).some(x => x.kind === 'report_result' && /警告/.test(x.body)));
  assert.equal((await call('GET', '/api/communities/' + c2.cm.id, null, c2.member.tok)).s, 200);
});

test('通知分页：limit + before 游标，hasMore/nextBefore', async () => {
  const {owner, cm} = await world();
  for (let i = 0; i < 7; i++) { await A('POST', `/api/admin/communities/${cm.id}/warn`, {reason: '第' + i + '次'}); await new Promise(r => setTimeout(r, 3)); }
  const p1 = (await call('GET', '/api/notifications?limit=5', null, owner.tok)).j;
  assert.equal(p1.notifications.length, 5); assert.equal(p1.hasMore, true);
  const p2 = (await call('GET', '/api/notifications?limit=5&before=' + p1.nextBefore, null, owner.tok)).j;
  assert.ok(p2.notifications.length >= 2);
  assert.equal(p2.notifications.some(n => p1.notifications.some(m => m.id === n.id)), false);
});
