// r7：热门话题（管理员挑选 + 排序）与公告弹窗（每人每条只弹一次）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';

let srv, base, seq = 0, adminTok;
test.before(async () => {
  srv = createApp({adminUsername: 'r7_ops', adminPassword: 'R7OpsPass1'});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  adminTok = (await call('POST', '/api/admin/auth/login', {username: 'r7_ops', password: 'R7OpsPass1'})).j.token;
});
test.after(() => srv.close());
const call = async (m, p, body, tok) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  return {s: r.status, j: await r.json()};
};
async function acc(n) {
  const u = n + (++seq);
  const r = await call('POST', '/api/auth/register', {agree: true, username: u, email: u + '@x.test', password: 'Passw0rd123'});
  return {tok: r.j.token, id: r.j.user.id, u};
}
async function post(a, text, audience) {
  const r = await call('POST', '/api/posts', {text, ...(audience ? {audience} : {})}, a.tok);
  assert.equal(r.s, 200, JSON.stringify(r.j));
  return r.j.post.id;
}

test('热门话题：管理员加入、排序、移出；用户端按顺序看到，删除/非公开的不出现', async () => {
  const a = await acc('hota'), b = await acc('hotb');
  const p1 = await post(a, '热门一'), p2 = await post(a, '热门二'), p3 = await post(b, '热门三');
  const priv = await post(a, '只给自己', 'self');

  let u = await call('GET', '/api/hot-posts', null, b.tok);
  assert.equal(u.s, 200);
  assert.deepEqual(u.j.posts, []);
  assert.equal(u.j.nextCursor, null);
  assert.equal((await call('GET', '/api/hot-posts')).s, 401);
  assert.equal((await call('GET', '/api/admin/hot-posts', null, a.tok)).s, 403, '普通用户令牌不能用管理端接口');
  assert.equal((await call('POST', '/api/admin/hot-posts', {postId: p1}, a.tok)).s, 403);

  for (const id of [p1, p2]) assert.equal((await call('POST', '/api/admin/hot-posts', {postId: id}, adminTok)).s, 200);
  const ins = await call('POST', '/api/admin/hot-posts', {postId: p3, position: 1}, adminTok);
  assert.equal(ins.s, 200, JSON.stringify(ins.j));
  assert.equal(ins.j.already, false);
  assert.equal(ins.j.max, 20);
  assert.deepEqual(ins.j.items.map(x => [x.postId, x.position]), [[p3, 1], [p1, 2], [p2, 3]]);
  assert.equal(ins.j.items[0].available, true);
  assert.equal(ins.j.items[0].post.text, '热门三');
  assert.ok(ins.j.items[0].addedAtUtc);

  assert.equal((await call('POST', '/api/admin/hot-posts', {postId: p1}, adminTok)).j.already, true);
  assert.equal((await call('POST', '/api/admin/hot-posts', {}, adminTok)).j.error.code, 'BAD_POST_ID');
  assert.equal((await call('POST', '/api/admin/hot-posts', {postId: priv}, adminTok)).j.error.code, 'POST_NOT_PUBLIC');
  assert.equal((await call('POST', '/api/admin/hot-posts', {postId: 'nope'}, adminTok)).s, 404);

  u = await call('GET', '/api/hot-posts', null, b.tok);
  assert.deepEqual(u.j.posts.map(p => p.id), [p3, p1, p2]);
  assert.deepEqual(u.j.posts.map(p => p.hotPosition), [1, 2, 3]);

  assert.equal((await call('POST', '/api/admin/hot-posts/order', {postIds: 'x'}, adminTok)).j.error.code, 'BAD_ORDER');
  const conflict = await call('POST', '/api/admin/hot-posts/order', {postIds: [p1, p2]}, adminTok);
  assert.equal(conflict.s, 409);
  assert.equal(conflict.j.error.code, 'ORDER_CONFLICT');
  assert.equal(conflict.j.error.items.length, 3);
  assert.equal((await call('POST', '/api/admin/hot-posts/order', {postIds: [p2, p3, p1]}, adminTok)).s, 200);
  assert.deepEqual((await call('GET', '/api/hot-posts', null, b.tok)).j.posts.map(p => p.id), [p2, p3, p1]);

  assert.equal((await call('POST', '/api/posts/' + p2 + '/delete', {}, a.tok)).s, 200);
  assert.deepEqual((await call('GET', '/api/hot-posts', null, b.tok)).j.posts.map(p => p.id), [p3, p1]);
  assert.equal((await call('GET', '/api/admin/hot-posts', null, adminTok)).j.items.find(x => x.postId === p2).available, false);

  const rm = await call('POST', '/api/admin/hot-posts/' + p2 + '/delete', {}, adminTok);
  assert.equal(rm.j.already, false);
  assert.deepEqual(rm.j.items.map(x => [x.postId, x.position]), [[p3, 1], [p1, 2]]);
  assert.equal((await call('POST', '/api/admin/hot-posts/' + p2 + '/delete', {}, adminTok)).j.already, true);
});

test('公告：同一时间只有一条发布中；current 不需要登录；version 随发布/改内容变化', async () => {
  const none = await call('GET', '/api/announcements/current');
  assert.equal(none.s, 200);
  const c1 = await call('POST', '/api/admin/announcements', {title: '维护通知', body: '今晚 23:00 维护 10 分钟'}, adminTok);
  assert.equal(c1.s, 200, JSON.stringify(c1.j));
  const a1 = c1.j.announcement;
  assert.equal(a1.status, 'published', '不传 published 默认发布');
  assert.ok(a1.publishedAt && a1.version.startsWith(a1.id + '-'));

  let cur = await call('GET', '/api/announcements/current');
  assert.equal(cur.j.announcement.id, a1.id);
  assert.equal(cur.j.announcement.body, '今晚 23:00 维护 10 分钟');
  assert.equal(cur.j.announcement.authorAdminId, undefined, '不带后台字段');

  const d = (await call('POST', '/api/admin/announcements', {title: '草稿', body: '还没发布', published: false}, adminTok)).j.announcement;
  assert.equal(d.status, 'draft');
  assert.equal((await call('GET', '/api/announcements/current')).j.announcement.id, a1.id);

  const pub = await call('POST', '/api/admin/announcements/' + d.id + '/publish', {}, adminTok);
  assert.equal(pub.s, 200, JSON.stringify(pub.j));
  assert.equal(pub.j.already, false);
  assert.deepEqual(pub.j.withdrawnIds, [a1.id]);
  assert.equal((await call('POST', '/api/admin/announcements/' + d.id + '/publish', {}, adminTok)).j.already, true);
  cur = await call('GET', '/api/announcements/current');
  assert.equal(cur.j.announcement.id, d.id);
  const list = (await call('GET', '/api/admin/announcements', null, adminTok)).j.announcements;
  assert.equal(list.filter(x => x.published).length, 1);
  assert.equal(list.find(x => x.id === a1.id).status, 'withdrawn');

  const v0 = cur.j.announcement.version;
  await new Promise(r => setTimeout(r, 5));
  await call('PATCH', '/api/admin/announcements/' + d.id, {title: '草稿'}, adminTok);
  assert.equal((await call('GET', '/api/announcements/current')).j.announcement.version, v0, '内容没变，version 不变');
  await call('PATCH', '/api/admin/announcements/' + d.id, {body: '改过的内容'}, adminTok);
  assert.notEqual((await call('GET', '/api/announcements/current')).j.announcement.version, v0, '内容变了，version 变');

  await call('POST', '/api/admin/announcements/' + d.id + '/withdraw', {}, adminTok);
  assert.equal((await call('GET', '/api/announcements/current')).j.announcement, null);
  assert.equal((await call('POST', '/api/admin/announcements/999999/publish', {}, adminTok)).s, 404);
});
