// M3.5.3 管理端内容软删除与恢复；用户端看不到已删除内容。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';

let srv, base, seq = 0, adminTok;
test.before(async () => {
  srv = createApp({adminUsername: 'ops_cnt', adminPassword: 'OpsCntPass1'});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  const login = await call('POST', '/api/admin/auth/login', {username: 'ops_cnt', password: 'OpsCntPass1'});
  adminTok = login.j.token;
});
test.after(() => srv.close());
const call = async (m, p, body, tok) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  return {s: r.status, j: await r.json()};
};
const AH = () => adminTok;
async function acc(n) {
  const u = n + (++seq);
  const r = await call('POST', '/api/auth/register', {agree:true, username: u, email: u + '@x.test', password: 'Passw0rd123'});
  return {tok: r.j.token, id: r.j.user.id, u};
}

test('未登录 / 普通用户不能访问管理端内容接口', async () => {
  const a = await acc('cuser');
  const no = await call('GET', '/api/admin/content');
  assert.ok(no.s === 401 || no.s === 403, '未登录应被拒 ' + no.s);
  const user = await call('GET', '/api/admin/content', null, a.tok);
  assert.ok(user.s === 401 || user.s === 403, '普通用户应被拒 ' + user.s);
});

test('管理员软删除动态后用户端 404，恢复后重新可见；重复删除幂等；写入审计', async () => {
  const a = await acc('author'), b = await acc('reader');
  const post = await call('POST', '/api/posts', {text: '这条会被管理端删除'}, a.tok);
  assert.equal(post.s, 200);
  const id = post.j.post.id;
  assert.equal((await call('GET', '/api/posts/' + id, null, b.tok)).s, 200);

  const del = await call('POST', '/api/admin/content/post/' + id + '/delete', {reason: '违规广告'}, AH());
  assert.equal(del.s, 200, JSON.stringify(del.j));
  assert.equal(del.j.item.deleted, true);
  assert.equal(del.j.item.adminHidden, true);
  assert.equal(del.j.item.adminReason, '违规广告');
  assert.equal(del.j.already, false);

  const again = await call('POST', '/api/admin/content/post/' + id + '/delete', {reason: '再删一次'}, AH());
  assert.equal(again.s, 200);
  assert.equal(again.j.already, true);

  assert.equal((await call('GET', '/api/posts/' + id, null, b.tok)).s, 404);
  assert.equal((await call('GET', '/api/posts/' + id, null, a.tok)).s, 404);
  const feed = await call('GET', '/api/posts', null, b.tok);
  assert.equal(feed.s, 200);
  assert.ok(!(feed.j.posts || []).some(p => p.id === id), '信息流不得出现已删除动态');

  const list = await call('GET', '/api/admin/content?type=post&status=removed', null, AH());
  assert.equal(list.s, 200);
  assert.ok(list.j.items.some(i => i.id === id && i.deleted));

  const rst = await call('POST', '/api/admin/content/post/' + id + '/restore', {}, AH());
  assert.equal(rst.s, 200, JSON.stringify(rst.j));
  assert.equal(rst.j.item.deleted, false);
  assert.equal((await call('GET', '/api/posts/' + id, null, b.tok)).s, 200);

  const audit = await call('GET', '/api/admin/audit?action=admin.content', null, AH());
  assert.equal(audit.s, 200);
  const acts = audit.j.audits.map(x => x.action);
  assert.ok(acts.includes('admin.content.delete'));
  assert.ok(acts.includes('admin.content.restore'));
});

test('管理员软删除评论后用户列表不再出现正文，恢复后可见', async () => {
  const a = await acc('cauthor');
  const post = await call('POST', '/api/posts', {text: '有评论的帖'}, a.tok);
  const cmt = await call('POST', '/api/posts/' + post.j.post.id + '/comments', {text: '不当评论内容'}, a.tok);
  assert.equal(cmt.s, 200, JSON.stringify(cmt.j));
  const cid = cmt.j.comment.id;
  const before = await call('GET', '/api/posts/' + post.j.post.id + '/comments', null, a.tok);
  assert.ok(before.j.comments.some(c => c.id === cid && (c.text || '').includes('不当')));

  const del = await call('POST', '/api/admin/content/comment/' + cid + '/delete', {reason: '辱骂'}, AH());
  assert.equal(del.s, 200, JSON.stringify(del.j));
  assert.equal(del.j.item.deleted, true);

  const after = await call('GET', '/api/posts/' + post.j.post.id + '/comments', null, a.tok);
  const row = (after.j.comments || []).find(c => c.id === cid);
  assert.ok(!row || row.deleted || !row.text, '用户端不得再看到已删除评论正文');

  const rst = await call('POST', '/api/admin/content/comment/' + cid + '/restore', {}, AH());
  assert.equal(rst.s, 200);
  const again = await call('GET', '/api/posts/' + post.j.post.id + '/comments', null, a.tok);
  assert.ok(again.j.comments.some(c => c.id === cid && !c.deleted));
});
