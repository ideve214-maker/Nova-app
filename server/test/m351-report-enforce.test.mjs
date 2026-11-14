// 举报处置真正生效：admin 1.1.0 只发 action=resolve + note=处理方式文案。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';

let srv, base, seq = 0, adminTok;
test.before(async () => {
  srv = createApp({adminUsername: 'ops_enf', adminPassword: 'OpsEnfPass1'});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  adminTok = (await call('POST', '/api/admin/auth/login', {username: 'ops_enf', password: 'OpsEnfPass1'})).j.token;
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
async function setup(text) {
  const reporter = await acc('er'), author = await acc('ea'), viewer = await acc('ev');
  const post = (await call('POST', '/api/posts', {text}, author.tok)).j.post;
  const rep = (await call('POST', '/api/reports', {targetType: 'post', targetId: post.id, reason: '垃圾广告'}, reporter.tok)).j.report;
  return {reporter, author, viewer, post, rep};
}
const decide = (id, action, note) => call('POST', '/api/admin/reports/' + id + '/decision', {action, note, notify: true}, adminTok);
const inFeed = async (tok, id) => ((await call('GET', '/api/posts', null, tok)).j.posts || []).some(p => p.id === id);

test('删除内容并警告：帖子从信息流和详情消失，作者收到警告，账号不封', async () => {
  const {author, viewer, post, rep} = await setup('#引流 加我领福利 ' + Date.now());
  assert.equal(await inFeed(viewer.tok, post.id), true);
  const d = await decide(rep.id, 'resolve', '删除内容并警告');
  assert.equal(d.s, 200, JSON.stringify(d.j));
  assert.equal(d.j.enforced.penalty, 'delete');
  assert.equal(d.j.enforced.contentHidden, true);
  assert.equal(d.j.enforced.userBanned, false);
  assert.equal(await inFeed(viewer.tok, post.id), false);
  assert.equal((await call('GET', '/api/posts/' + post.id, null, viewer.tok)).s, 404);
  const row = srv.db.prepare('SELECT deleted_at, admin_hidden FROM posts WHERE id=?').get(post.id);
  assert.ok(row.deleted_at); assert.equal(row.admin_hidden, 1);
  const n = (await call('GET', '/api/notifications', null, author.tok)).j;
  const items = n.notifications || n.items || [];
  assert.ok(items.some(x => /警告/.test(x.body || '') && /删除/.test(x.body || '')), JSON.stringify(items));
  assert.equal((await call('GET', '/api/me', null, author.tok)).s, 200);
});

test('封禁作者：作者被封、会话失效', async () => {
  const {author, rep} = await setup('ban me ' + Date.now());
  const d = await decide(rep.id, 'resolve', '封禁作者');
  assert.equal(d.j.enforced.userBanned, true);
  assert.equal(srv.db.prepare('SELECT status FROM users WHERE id=?').get(author.id).status, 'banned');
  assert.equal((await call('GET', '/api/me', null, author.tok)).s, 401);
});

test('仅警告用户 / 驳回举报：帖子保持可见，账号不变', async () => {
  for (const [action, note] of [['resolve', '仅警告用户'], ['reject', '驳回举报']]) {
    const {author, viewer, post, rep} = await setup('keep ' + note + Date.now());
    const d = await decide(rep.id, action, note);
    assert.equal(d.s, 200);
    assert.equal(d.j.enforced.contentHidden, false);
    assert.equal(d.j.enforced.userBanned, false);
    assert.equal(await inFeed(viewer.tok, post.id), true);
    assert.equal(srv.db.prepare('SELECT status FROM users WHERE id=?').get(author.id).status, 'active');
  }
});

test('评论举报删除内容：评论不再出现在列表；显式 penalty 字段也生效', async () => {
  const reporter = await acc('cr'), author = await acc('ca'), viewer = await acc('cv');
  const post = (await call('POST', '/api/posts', {text: 'host ' + Date.now()}, viewer.tok)).j.post;
  const c = await call('POST', '/api/posts/' + post.id + '/comments', {text: '垃圾评论'}, author.tok);
  assert.equal(c.s, 200, JSON.stringify(c.j));
  const cid = c.j.comment.id;
  const rep = (await call('POST', '/api/reports', {targetType: 'comment', targetId: cid, reason: '垃圾'}, reporter.tok)).j.report;
  const d = await call('POST', '/api/admin/reports/' + rep.id + '/decision', {action: 'resolve', penalty: 'delete'}, adminTok);
  assert.equal(d.j.enforced.contentHidden, true);
  const list = (await call('GET', '/api/posts/' + post.id + '/comments', null, viewer.tok)).j;
  assert.ok(!JSON.stringify(list).includes('垃圾评论'));
});
