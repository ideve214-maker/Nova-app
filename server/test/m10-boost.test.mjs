// r10 营销管理（3）：推流 / 加热——下单付款、管理员核对、信息流真实投放、按人计曝光、投满即止。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';

let srv, base, seq = 0, adm;
test.before(async () => {
  srv = createApp({adminUsername: 'ops_bt', adminPassword: 'OpsBtPass1!'});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  adm = (await call('POST', '/api/admin/auth/login', {username: 'ops_bt', password: 'OpsBtPass1!'})).j.token;
});
test.after(() => srv.close());
const call = async (m, p, body, tok) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  let j = null; try { j = await r.json(); } catch {}
  return {s: r.status, j};
};
async function acc(n) {
  const u = n + (++seq);
  const r = await call('POST', '/api/auth/register', {agree: true, username: u, email: u + '@x.test', password: 'Passw0rd123'});
  return {tok: r.j.token, id: r.j.user.id, u};
}

test('推流：套餐、下单、我已付款、管理员开通；信息流给没看过的人投放，按人计数，投满即止', async () => {
  const author = await acc('bta');
  // 管理员把套餐改成 2 次曝光，方便测试投满
  const st = await call('POST', '/api/admin/boost/settings', {perFeed: 2, plans: [{id: 'mini', name: '迷你', priceCents: 100, impressions: 2, days: 1}]}, adm);
  assert.equal(st.s, 200, JSON.stringify(st.j));
  const cat = await call('GET', '/api/boost/catalog', null, author.tok);
  assert.equal(cat.j.plans[0].impressions, 2);
  assert.ok(cat.j.methods.length >= 1);
  const post = (await call('POST', '/api/posts', {text: '我的新作品'}, author.tok)).j.post;
  const other = await acc('bto');
  const otherPost = (await call('POST', '/api/posts', {text: '别人的帖子'}, other.tok)).j.post;
  assert.equal((await call('POST', '/api/boost/orders', {postId: otherPost.id, planId: 'mini', method: cat.j.methods[0].id}, author.tok)).s, 403);
  const o = await call('POST', '/api/boost/orders', {postId: post.id, planId: 'mini', method: cat.j.methods[0].id}, author.tok);
  assert.equal(o.s, 200, JSON.stringify(o.j));
  assert.equal(o.j.order.status, 'pending');
  assert.match(o.j.order.code, /^BT/);
  assert.ok(o.j.order.qrUrl && o.j.order.instructions.includes(o.j.order.code));
  const v1 = await acc('btv');
  assert.equal((await call('GET', '/api/posts?feed=rec', null, v1.tok)).j.boosts.length, 0, '没开通前不投放');
  assert.equal((await call('POST', `/api/boost/orders/${o.j.order.id}/paid`, {}, author.tok)).j.order.status, 'awaiting_review');
  const list = await call('GET', '/api/admin/boost/orders?status=awaiting_review', null, adm);
  assert.equal(list.j.orders[0].id, o.j.order.id);
  assert.equal((await call('POST', `/api/admin/boost/orders/${o.j.order.id}/confirm`, {}, adm)).j.order.status, 'active');
  // 作者自己看到「推流中」
  const mine = (await call('GET', `/api/posts/${post.id}`, null, author.tok)).j.post;
  assert.equal(mine.boost.label, '推流中');
  // 作者自己的信息流不会被投放自己的帖子
  assert.equal((await call('GET', '/api/posts?feed=rec', null, author.tok)).j.boosts.length, 0);
  let f = await call('GET', '/api/posts?feed=rec', null, v1.tok);
  assert.equal(f.j.boosts.length, 1);
  assert.equal(f.j.boosts[0].id, post.id);
  assert.equal(f.j.boosts[0].boost.label, '曝光中');
  await call('POST', `/api/posts/${post.id}/view`, {}, v1.tok);
  await call('POST', `/api/posts/${post.id}/view`, {}, v1.tok);
  assert.equal((await call('GET', '/api/boost/orders', null, author.tok)).j.orders[0].delivered, 1, '同一个人只算一次');
  assert.equal((await call('GET', '/api/posts?feed=rec', null, v1.tok)).j.boosts.length, 0, '看过的人不再投');
  const v2 = await acc('btw');
  assert.equal((await call('GET', '/api/posts?feed=rec', null, v2.tok)).j.boosts.length, 1);
  await call('POST', `/api/posts/${post.id}/view`, {}, v2.tok);
  const done = (await call('GET', '/api/boost/orders', null, author.tok)).j.orders[0];
  assert.equal(done.delivered, 2); assert.equal(done.status, 'done');
  const v3 = await acc('btx');
  assert.equal((await call('GET', '/api/posts?feed=rec', null, v3.tok)).j.boosts.length, 0, '投满即止');
  // 退款
  assert.equal((await call('POST', `/api/admin/boost/orders/${o.j.order.id}/stop`, {refund: true, reason: '测试'}, adm)).j.order.status, 'refunded');
});

test('推流：拒绝需要原因；非公开帖不能推流；普通用户不能调管理接口', async () => {
  const a = await acc('btr');
  const cat = (await call('GET', '/api/boost/catalog', null, a.tok)).j;
  const p = (await call('POST', '/api/posts', {text: '仅好友', audience: 'friends'}, a.tok)).j.post;
  assert.equal((await call('POST', '/api/boost/orders', {postId: p.id, planId: cat.plans[0].id, method: cat.methods[0].id}, a.tok)).s, 400);
  const p2 = (await call('POST', '/api/posts', {text: '公开'}, a.tok)).j.post;
  const o = (await call('POST', '/api/boost/orders', {postId: p2.id, planId: cat.plans[0].id, method: cat.methods[0].id}, a.tok)).j.order;
  assert.equal((await call('POST', `/api/admin/boost/orders/${o.id}/reject`, {}, adm)).s, 400);
  assert.equal((await call('POST', `/api/admin/boost/orders/${o.id}/reject`, {reason: '未收到款'}, adm)).j.order.status, 'rejected');
  assert.equal((await call('GET', '/api/admin/boost/orders', null, a.tok)).s, 403);
});

test('推流套餐价格支持小数（9.9 元 = 990 分），也接受 price 字段', async () => {
  const st = await call('POST', '/api/admin/boost/settings', {plans: [
    {id: 'a', name: '体验', priceCents: 990, impressions: 300, days: 3},
    {id: 'b', name: '小数', price: 9.99, impressions: 300, days: 3},
    {id: 'c', name: '浮点', priceCents: 9.9 * 100, impressions: 300, days: 3},
  ]}, adm);
  assert.equal(st.s, 200, JSON.stringify(st.j));
  const cat = await call('GET', '/api/admin/boost/settings', null, adm);
  const plans = (cat.j && (cat.j.plans || (cat.j.settings && cat.j.settings.plans))) || st.j.plans || (st.j.settings && st.j.settings.plans);
  const by = Object.fromEntries(plans.map(p => [p.id, p.priceCents]));
  assert.deepEqual(by, {a: 990, b: 999, c: 990});
  const bad = await call('POST', '/api/admin/boost/settings', {plans: [{id: 'z', name: '零', price: 0.001, impressions: 1, days: 1}]}, adm);
  assert.equal(bad.s, 400);
});
