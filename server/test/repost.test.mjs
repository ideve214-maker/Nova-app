// 转帖（迁移 056）：直接转帖 / 引用转帖嵌入原帖，原帖删除后显示已删除；同一原帖直接转帖不重复；撤销后可以再转；旧版文字转帖读出时还原。
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

test('直接转帖：嵌入原帖作者、正文、图片；计数和 myRepost；重复转帖返回同一条', async () => {
  const a = await acc('rpa'), b = await acc('rpb');
  const o = await post(b, {text: '原帖正文', media: [{id: 'm1', url: 'assets/x.jpg', kind: 'image'}]});
  const r = await post(a, {text: '', repostOf: o.id});
  assert.equal(r.text, '');
  assert.equal(r.repostOf.id, o.id);
  assert.equal(r.repostOf.deleted, false);
  assert.equal(r.repostOf.text, '原帖正文');
  assert.equal(r.repostOf.author.id, b.id);
  assert.equal(r.repostOf.media[0].url, 'assets/x.jpg');
  assert.equal(r.repostOf.repostOf, undefined, '嵌入的原帖不再套一层');
  const again = await call('POST', '/api/posts', {text: '', repostOf: o.id}, a.tok);
  assert.equal(again.s, 200); assert.equal(again.j.idempotent, true); assert.equal(again.j.post.id, r.id);
  const og = await call('GET', '/api/posts/' + o.id, null, a.tok);
  assert.equal(og.j.post.repostCount, 1);
  assert.equal(og.j.post.myRepost, r.id);
  const ob = await call('GET', '/api/posts/' + o.id, null, b.tok);
  assert.equal(ob.j.post.myRepost, null);
});

test('撤销转帖后可以再转；连续转不同的帖子互不影响', async () => {
  const a = await acc('rpc'), b = await acc('rpd');
  const o1 = await post(b, {text: '第一条'}), o2 = await post(b, {text: '第二条'});
  const r1 = await post(a, {text: '', repostOf: o1.id});
  const r2 = await post(a, {text: '', repostOf: o2.id});
  assert.notEqual(r1.id, r2.id);
  assert.equal(r2.repostOf.id, o2.id);
  assert.equal((await call('POST', '/api/posts/' + r1.id + '/delete', {}, a.tok)).s, 200);
  const g = await call('GET', '/api/posts/' + o1.id, null, a.tok);
  assert.equal(g.j.post.repostCount, 0); assert.equal(g.j.post.myRepost, null);
  const r3 = await post(a, {text: '', repostOf: o1.id});
  assert.notEqual(r3.id, r1.id);
  assert.equal((await call('GET', '/api/posts/' + o1.id, null, a.tok)).j.post.myRepost, r3.id);
});

test('引用转帖：评论在上、原帖嵌入；转的是转帖时指向原帖；原帖删除后显示已删除', async () => {
  const a = await acc('rpe'), b = await acc('rpf'), c = await acc('rpg');
  const o = await post(b, {text: '会被删掉的原帖'});
  const plain = await post(c, {text: '', repostOf: o.id});
  const q = await post(a, {text: '说得好', repostOf: plain.id});
  assert.equal(q.text, '说得好');
  assert.equal(q.repostOf.id, o.id, '转帖的转帖指向原帖');
  assert.equal((await call('GET', '/api/posts/' + o.id, null, b.tok)).j.post.repostCount, 2);
  assert.equal((await call('POST', '/api/posts/' + o.id + '/delete', {}, b.tok)).s, 200);
  const g = await call('GET', '/api/posts/' + q.id, null, a.tok);
  assert.deepEqual(g.j.post.repostOf, {id: o.id, deleted: true});
  const feed = await call('GET', '/api/posts?limit=20', null, a.tok);
  const mine = feed.j.posts.find(p => p.id === q.id);
  assert.equal(mine.repostOf.deleted, true);
  const bad = await call('POST', '/api/posts', {text: '', repostOf: o.id}, a.tok);
  assert.equal(bad.s, 404);
  const none = await call('POST', '/api/posts', {text: '', repostOf: 'po_nope'}, a.tok);
  assert.equal(none.s, 404);
});

test('看不见的原帖（仅自己）不能转，嵌入时也按已删除处理', async () => {
  const a = await acc('rph'), b = await acc('rpi');
  const o = await post(b, {text: '只给自己看', audience: 'self'});
  assert.equal((await call('POST', '/api/posts', {text: '', repostOf: o.id}, a.tok)).s, 404);
});

test('旧版文字转帖（「🔁 转帖 @某人：…\\n链接」）读出时还原成转帖', async () => {
  const a = await acc('rpj'), b = await acc('rpk');
  const o = await post(b, {text: '老原帖'});
  const old = await post(a, {text: '我的看法\n\n🔁 转帖 @rpk：老原帖\nhttps://47.239.0.90/#/post/' + o.id});
  assert.equal(old.text, '我的看法');
  assert.equal(old.repostOf.id, o.id);
  const oldPlain = await post(a, {text: '🔁 转帖 @rpk：老原帖\nvexo://post/' + o.id});
  assert.equal(oldPlain.text, '');
  assert.equal(oldPlain.repostOf.text, '老原帖');
});
