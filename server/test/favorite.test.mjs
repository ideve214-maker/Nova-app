// 帖子收藏：收藏 / 取消收藏返回帖子最新收藏数；帖子上的 bookmarkCount 与收藏状态在重新读取（相当于重新打开）后保持。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';

let srv, base, seq = 0;
test.before(async () => { srv = createApp(); await new Promise(r => srv.listen(0, '127.0.0.1', r)); base = 'http://127.0.0.1:' + srv.address().port; });
test.after(() => srv.close());
const call = async (m, p, body, tok) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  let j = null; try { j = await r.json(); } catch {}
  return {s: r.status, j};
};
async function acc(n) {
  const u = n + (++seq);
  const r = await call('POST', '/api/auth/register', {agree: true, username: u, email: u + '@qq.com', password: 'Passw0rd123'});
  assert.equal(r.s, 200, JSON.stringify(r.j));
  return {tok: r.j.token, id: r.j.user.id};
}
const post = async (who, body) => { const r = await call('POST', '/api/posts', body, who.tok); assert.equal(r.s, 200, JSON.stringify(r.j)); return r.j.post; };


test('收藏切换：+1 / -1，返回 bookmarkCount，重新读取后状态和数量保持', async () => {
  const a = await acc('fva'), b = await acc('fvb'), c = await acc('fvc');
  const p = await post(b, {text: '要被收藏的帖子'});
  assert.equal(p.bookmarkCount, 0);
  assert.equal((await call('POST', '/api/me/saved', {kind: 'post', target: p.id, title: 'x'}, c.tok)).j.bookmarkCount, 1);
  const s1 = await call('POST', '/api/me/saved', {kind: 'post', target: p.id, title: 'b', excerpt: '要被收藏的帖子'}, a.tok);
  assert.equal(s1.s, 200); assert.equal(s1.j.saved, true); assert.equal(s1.j.existed, false); assert.equal(s1.j.bookmarkCount, 2);
  const again = await call('POST', '/api/me/saved', {kind: 'post', target: p.id}, a.tok);
  assert.equal(again.j.existed, true); assert.equal(again.j.bookmarkCount, 2, '重复收藏不重复计数');
  // 重新打开：帖子详情、首页、我的收藏
  assert.equal((await call('GET', '/api/posts/' + p.id, null, a.tok)).j.post.bookmarkCount, 2);
  assert.equal((await call('GET', '/api/posts?limit=20', null, a.tok)).j.posts.find(x => x.id === p.id).bookmarkCount, 2);
  assert.ok((await call('GET', '/api/me/saved', null, a.tok)).j.items.some(i => i.kind === 'post' && i.target === p.id));
  const r1 = await call('POST', '/api/me/saved/remove', {kind: 'post', target: p.id}, a.tok);
  assert.equal(r1.s, 200); assert.equal(r1.j.saved, false); assert.equal(r1.j.bookmarkCount, 1);
  assert.equal((await call('GET', '/api/posts/' + p.id, null, a.tok)).j.post.bookmarkCount, 1);
  assert.ok(!(await call('GET', '/api/me/saved', null, a.tok)).j.items.some(i => i.target === p.id));
  assert.equal((await call('POST', '/api/me/saved/remove', {kind: 'post', target: p.id}, a.tok)).s, 404);
  const s2 = await call('POST', '/api/me/saved', {kind: 'post', target: p.id}, a.tok);
  assert.equal(s2.j.bookmarkCount, 2);
});
