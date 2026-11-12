// M4.1.3 评论、回复、反应：关系与数量真实更新；删除和权限边界正确。
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

test('评论和回复入库，数量随发表和删除更新', async () => {
  const a = await acc('ca'), b = await acc('cb');
  const p = (await call('POST', '/api/posts', {text: '原文'}, a.tok)).j.post;
  assert.equal(p.commentCount, 0);
  const c1 = await call('POST', '/api/posts/' + p.id + '/comments', {text: '这句可以留下来。'}, b.tok);
  assert.equal(c1.s, 200, JSON.stringify(c1.j));
  assert.ok(c1.j.comment.id.startsWith('co_'));
  assert.equal(c1.j.commentCount, 1);
  const c2 = await call('POST', '/api/posts/' + p.id + '/comments', {text: '那就先折在这里。', parentId: c1.j.comment.id}, a.tok);
  assert.equal(c2.s, 200); assert.equal(c2.j.comment.parentId, c1.j.comment.id); assert.equal(c2.j.commentCount, 2);
  const got = await call('GET', '/api/posts/' + p.id, null, a.tok);
  assert.equal(got.j.post.commentCount, 2);
  const list = await call('GET', '/api/posts/' + p.id + '/comments', null, a.tok);
  assert.equal(list.j.comments.length, 2);
  const rm = await call('POST', '/api/comments/' + c2.j.comment.id + '/delete', {}, a.tok);
  assert.equal(rm.s, 200); assert.equal(rm.j.commentCount, 1);
  const after = await call('GET', '/api/posts/' + p.id + '/comments', null, a.tok);
  assert.equal(after.j.commentCount, 1);
  assert.ok(!after.j.comments.some(c => c.id === c2.j.comment.id && !c.deleted));
});

test('楼中楼：可回复回复；删除中间层保留结构；管理端能看到父评与层级', async () => {
  const a = await acc('na'), b = await acc('nb');
  const p = (await call('POST', '/api/posts', {text: '楼中楼'}, a.tok)).j.post;
  const c1 = (await call('POST', '/api/posts/' + p.id + '/comments', {text: '一层'}, a.tok)).j.comment;
  const c2 = (await call('POST', '/api/posts/' + p.id + '/comments', {text: '二层', parentId: c1.id}, b.tok)).j.comment;
  assert.equal(c2.depth, 1);
  assert.equal(c2.replyTo.id, c1.id);
  assert.equal(c2.replyTo.author.id, a.id);
  const c3 = await call('POST', '/api/posts/' + p.id + '/comments', {text: '三层', parentId: c2.id}, a.tok);
  assert.equal(c3.s, 200, JSON.stringify(c3.j));
  assert.equal(c3.j.comment.depth, 2);
  assert.equal(c3.j.comment.parentId, c2.id);
  assert.equal(c3.j.comment.rootId, c1.id);
  assert.equal(c3.j.comment.replyTo.author.id, b.id);
  assert.equal(c3.j.commentCount, 3);
  // 删中间层：占位保留，子评仍在
  const rm = await call('POST', '/api/comments/' + c2.id + '/delete', {}, b.tok);
  assert.equal(rm.s, 200);
  const list = await call('GET', '/api/posts/' + p.id + '/comments', null, a.tok);
  assert.equal(list.j.commentCount, 2);
  const mid = list.j.comments.find(x => x.id === c2.id);
  assert.ok(mid.deleted);
  assert.equal(mid.text, '');
  const leaf = list.j.comments.find(x => x.id === c3.j.comment.id);
  assert.ok(leaf && !leaf.deleted);
  assert.equal(leaf.parentId, c2.id);
  assert.equal(leaf.replyTo.deleted, true);
  // 仍可回复已删除的中间层，线程不断
  const c4 = await call('POST', '/api/posts/' + p.id + '/comments', {text: '接上', parentId: c2.id}, a.tok);
  assert.equal(c4.s, 200, JSON.stringify(c4.j));
  assert.equal(c4.j.comment.parentId, c2.id);
});

test('删除评论：只能删自己的；有回复时保留占位，计数不含已删', async () => {
  const a = await acc('da'), b = await acc('db');
  const p = (await call('POST', '/api/posts', {text: '讨论'}, a.tok)).j.post;
  const c = (await call('POST', '/api/posts/' + p.id + '/comments', {text: '顶层'}, a.tok)).j.comment;
  const r = (await call('POST', '/api/posts/' + p.id + '/comments', {text: '回复', parentId: c.id}, b.tok)).j.comment;
  assert.equal((await call('POST', '/api/comments/' + c.id + '/delete', {}, b.tok)).s, 403);
  const rm = await call('POST', '/api/comments/' + c.id + '/delete', {}, a.tok);
  assert.equal(rm.s, 200);
  const list = await call('GET', '/api/posts/' + p.id + '/comments', null, a.tok);
  const top = list.j.comments.find(x => x.id === c.id);
  assert.ok(top.deleted); assert.equal(top.text, '');
  assert.ok(list.j.comments.some(x => x.id === r.id && !x.deleted));
  assert.equal(list.j.commentCount, 1);
  const row = srv.db.prepare('SELECT * FROM post_comments WHERE id=?').get(c.id);
  assert.ok(row.deleted_at);
});

test('表态：同一用户同一表情可取消，换表情不重复计数；评论点赞可切换', async () => {
  const a = await acc('ra'), b = await acc('rb');
  const p = (await call('POST', '/api/posts', {text: '表态'}, a.tok)).j.post;
  const r1 = await call('POST', '/api/posts/' + p.id + '/react', {index: 2}, a.tok);
  assert.equal(r1.s, 200); assert.equal(r1.j.myReaction, 2); assert.equal(r1.j.reactions[2], 1);
  await call('POST', '/api/posts/' + p.id + '/react', {index: 2}, b.tok);
  const r2 = await call('POST', '/api/posts/' + p.id + '/react', {index: 0}, a.tok); // 换表情
  assert.equal(r2.j.myReaction, 0);
  assert.equal(r2.j.reactions[2], 1); assert.equal(r2.j.reactions[0], 1);
  const r3 = await call('POST', '/api/posts/' + p.id + '/react', {index: 0}, a.tok); // 取消
  assert.equal(r3.j.myReaction, -1); assert.equal(r3.j.reactions[0], 0); assert.equal(r3.j.reactions[2], 1);
  const got = await call('GET', '/api/posts/' + p.id, null, b.tok);
  assert.equal(got.j.post.myReaction, 2);
  assert.deepEqual(got.j.post.reactions, [0, 0, 1, 0, 0, 0]);
  const c = (await call('POST', '/api/posts/' + p.id + '/comments', {text: '赞一下'}, b.tok)).j.comment;
  const l1 = await call('POST', '/api/comments/' + c.id + '/like', {}, a.tok);
  assert.equal(l1.j.comment.liked, true); assert.equal(l1.j.comment.likeCount, 1);
  const l2 = await call('POST', '/api/comments/' + c.id + '/like', {}, a.tok);
  assert.equal(l2.j.comment.liked, false); assert.equal(l2.j.comment.likeCount, 0);
  assert.equal((await call('POST', '/api/posts/' + p.id + '/react', {index: 9}, a.tok)).s, 400);
  assert.equal((await call('POST', '/api/posts/' + p.id + '/comments', {text: '  '}, a.tok)).s, 400);
  assert.equal((await call('POST', '/api/posts/' + p.id + '/comments', {text: '哈'.repeat(281)}, a.tok)).j.error.code, 'TEXT_TOO_LONG');
});

test('不能评论已删除的帖；不能改别人的评论；未登录 401', async () => {
  const a = await acc('xa'), b = await acc('xb');
  const p = (await call('POST', '/api/posts', {text: '将删除'}, a.tok)).j.post;
  const c = (await call('POST', '/api/posts/' + p.id + '/comments', {text: '先评'}, a.tok)).j.comment;
  assert.equal((await call('POST', '/api/comments/' + c.id + '/delete', {}, b.tok)).s, 403);
  await call('POST', '/api/posts/' + p.id + '/delete', {}, a.tok);
  assert.equal((await call('POST', '/api/posts/' + p.id + '/comments', {text: '还评'}, b.tok)).s, 404);
  assert.equal((await call('POST', '/api/posts/' + p.id + '/react', {index: 1}, a.tok)).s, 404);
  assert.equal((await call('GET', '/api/posts/' + p.id + '/comments')).s, 401);
});
