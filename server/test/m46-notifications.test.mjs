// M4.6 站内通知：系统通知、互动提醒、已读；重复事件不重复推送。
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

test('评论、关注、@所有人会通知对方；自己的操作不通知自己；重复关注不重复通知', async () => {
  const a = await acc('na'), b = await acc('nb'), c = await acc('nc');
  const post = (await call('POST', '/api/posts', {text: '来评论我', clientId: 'np1'}, a.tok)).j.post;
  await call('POST', '/api/posts/' + post.id + '/comments', {text: '不错'}, b.tok);
  await call('POST', '/api/posts/' + post.id + '/comments', {text: '我也说一句'}, b.tok); // 两条评论两条通知
  const list = await call('GET', '/api/notifications', null, a.tok);
  assert.equal(list.s, 200, JSON.stringify(list.j));
  const comments = list.j.notifications.filter(n => n.kind === 'comment');
  assert.equal(comments.length, 2);
  assert.ok(comments.every(n => n.actor && n.actor.id === b.id));
  assert.ok(comments.every(n => !n.read));
  // 自己评论自己不通知
  const before = list.j.unread;
  await call('POST', '/api/posts/' + post.id + '/comments', {text: '我自己回'}, a.tok);
  const afterSelf = await call('GET', '/api/notifications/unread', null, a.tok);
  assert.equal(afterSelf.j.unread, before);
  // 关注
  await call('POST', '/api/follows', {userId: a.id}, c.tok);
  await call('POST', '/api/follows', {userId: a.id}, c.tok); // 幂等，不重复通知
  const fol = (await call('GET', '/api/notifications', null, a.tok)).j.notifications.filter(n => n.kind === 'follow');
  assert.equal(fol.length, 1);
  // @所有人
  const g = (await call('POST', '/api/conversations', {kind: 'group', name: '通知', userIds: [a.id, b.id]}, c.tok)).j.conversation;
  await call('POST', '/api/conversations/' + g.id + '/role', {userId: c.id, role: '群主'}, c.tok); // already owner
  const at = await call('POST', '/api/conversations/' + g.id + '/messages', {text: '@所有人 集合', clientId: 'nat'}, c.tok);
  assert.equal(at.s, 200, JSON.stringify(at.j));
  const atA = (await call('GET', '/api/notifications', null, a.tok)).j.notifications.filter(n => n.kind === 'at_all');
  const atC = (await call('GET', '/api/notifications', null, c.tok)).j.notifications.filter(n => n.kind === 'at_all');
  assert.equal(atA.length, 1);
  assert.equal(atC.length, 0, '不通知自己');
  // 系统通知（供管理端 M3.6 写入同一收件箱）
  srv.notifications.push(a.id, {kind: 'system', title: '系统维护', body: '今晚 2 点', dedupeKey: 'sys:maint1'});
  srv.notifications.push(a.id, {kind: 'system', title: '系统维护', body: '今晚 2 点', dedupeKey: 'sys:maint1'});
  const sys = (await call('GET', '/api/notifications', null, a.tok)).j.notifications.filter(n => n.kind === 'system');
  assert.equal(sys.length, 1);
});

test('单条已读和全部已读；他人不能改我的通知', async () => {
  const a = await acc('nr'), b = await acc('ns');
  srv.notifications.push(a.id, {kind: 'system', title: '一', body: '', dedupeKey: 't1'});
  srv.notifications.push(a.id, {kind: 'system', title: '二', body: '', dedupeKey: 't2'});
  const list = await call('GET', '/api/notifications', null, a.tok);
  assert.equal(list.j.unread, 2);
  const id = list.j.notifications[0].id;
  assert.equal((await call('POST', '/api/notifications/' + id + '/read', {}, b.tok)).s, 404);
  const one = await call('POST', '/api/notifications/' + id + '/read', {}, a.tok);
  assert.equal(one.s, 200); assert.equal(one.j.notification.read, true);
  assert.equal((await call('GET', '/api/notifications/unread', null, a.tok)).j.unread, 1);
  const all = await call('POST', '/api/notifications/read-all', {}, a.tok);
  assert.equal(all.s, 200); assert.equal(all.j.unread, 0);
  assert.equal((await call('GET', '/api/notifications?unread=1', null, a.tok)).j.notifications.length, 0);
});
