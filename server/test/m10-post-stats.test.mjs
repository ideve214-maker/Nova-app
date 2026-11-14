// r10 营销管理（2）：数据调整——真实阅读计数、管理端搜帖并修改显示的阅读 / 点赞 / 收藏。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';

let srv, base, seq = 0, adm;
test.before(async () => {
  srv = createApp({adminUsername: 'ops_ps', adminPassword: 'OpsPsPass1!'});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  adm = (await call('POST', '/api/admin/auth/login', {username: 'ops_ps', password: 'OpsPsPass1!'})).j.token;
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

test('阅读每人只算一次；管理端按关键词/用户名搜索并修改显示数据，用户端立即看到；可恢复真实数据', async () => {
  const a = await acc('psa'), b = await acc('psb');
  const p = (await call('POST', '/api/posts', {text: '春天的第一场雨'}, a.tok)).j.post;
  assert.equal(p.viewCount, 0);
  assert.equal((await call('POST', `/api/posts/${p.id}/view`, {}, b.tok)).j.viewCount, 1);
  assert.equal((await call('POST', `/api/posts/${p.id}/view`, {}, b.tok)).j.counted, false);
  await call('POST', `/api/posts/${p.id}/react`, {index: 0}, b.tok);
  let s = await call('GET', '/api/admin/marketing/posts?q=' + encodeURIComponent('第一场雨'), null, adm);
  assert.equal(s.j.posts.length, 1);
  assert.equal(s.j.posts[0].real.views, 1);
  s = await call('GET', '/api/admin/marketing/posts?q=' + a.u, null, adm);
  assert.equal(s.j.posts[0].id, p.id);
  const up = await call('POST', `/api/admin/marketing/posts/${p.id}/stats`, {views: 1200, likes: 88, saves: 30}, adm);
  assert.equal(up.s, 200, JSON.stringify(up.j));
  assert.deepEqual(up.j.post.shown, {views: 1200, likes: 88, saves: 30});
  const g = (await call('GET', `/api/posts/${p.id}`, null, b.tok)).j.post;
  assert.equal(g.viewCount, 1200);
  assert.equal(g.bookmarkCount, 30);
  assert.equal(g.reactions.reduce((x, y) => x + y, 0), 88);
  // 再有真实阅读，显示数在调整后的基础上继续增长
  const c = await acc('psc');
  assert.equal((await call('POST', `/api/posts/${p.id}/view`, {}, c.tok)).j.viewCount, 1201);
  assert.equal((await call('POST', `/api/admin/marketing/posts/${p.id}/stats`, {views: -5}, adm)).s, 400);
  const rs = await call('POST', `/api/admin/marketing/posts/${p.id}/stats`, {reset: true}, adm);
  assert.deepEqual(rs.j.post.shown, {views: 2, likes: 1, saves: 0});
  assert.equal((await call('GET', '/api/admin/marketing/posts', null, a.tok)).s, 403);
});
