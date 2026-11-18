// VEXO 2.0.3：共创项目取消后项目群聊自动解散、发起人可手动解散项目群聊；私聊「删除会话」只影响自己一侧。
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
async function project(o, members) {
  const made = await call('POST', '/api/projects', {title: '共创测试项目' + seq, goal: '做一个能用的小工具', skills: ['前端'], capacity: 5}, o.tok);
  assert.equal(made.s, 200, JSON.stringify(made.j));
  const id = made.j.project.id;
  for (const m of members) {
    assert.equal((await call('POST', '/api/projects/' + id + '/apply', {message: '想参与'}, m.tok)).s, 200);
    assert.equal((await call('POST', '/api/projects/' + id + '/requests/' + m.id + '/approve', null, o.tok)).s, 200);
  }
  const full = await call('GET', '/api/projects/' + id, null, o.tok);
  assert.ok(full.j.project.conversationId, '项目应有群聊');
  return {id, cid: full.j.project.conversationId};
}
const listIds = async tok => ((await call('GET', '/api/conversations', null, tok)).j.conversations || []).map(c => c.id);

test('取消共创项目：项目群聊自动解散，所有成员列表里都没有了，也不能再发言', async () => {
  const o = await acc('pco'), m = await acc('pcm');
  const {id, cid} = await project(o, [m]);
  assert.ok((await listIds(m.tok)).includes(cid));
  const c = await call('POST', '/api/projects/' + id + '/cancel', null, o.tok);
  assert.equal(c.s, 200, JSON.stringify(c.j));
  assert.equal(c.j.project.status, 'cancelled');
  assert.ok(!(await listIds(o.tok)).includes(cid), '发起人列表里不应再有项目群聊');
  assert.ok(!(await listIds(m.tok)).includes(cid), '成员列表里不应再有项目群聊');
  const send = await call('POST', '/api/conversations/' + cid + '/messages', {text: '还在吗'}, m.tok);
  assert.ok(send.s === 404 || send.s === 403, '解散后不能发言：' + send.s);
});

test('发起人可以在项目群聊里解散群聊；普通成员不行；解散后项目不再指向这个群', async () => {
  const o = await acc('pdo'), m = await acc('pdm');
  const {id, cid} = await project(o, [m]);
  const no = await call('POST', '/api/conversations/' + cid + '/dissolve', {}, m.tok);
  assert.equal(no.s, 403);
  const ok = await call('POST', '/api/conversations/' + cid + '/dissolve', {}, o.tok);
  assert.equal(ok.s, 200, JSON.stringify(ok.j));
  assert.ok(!(await listIds(m.tok)).includes(cid));
  const p = await call('GET', '/api/projects/' + id, null, o.tok);
  assert.equal(p.s, 200);
  assert.ok(!p.j.project.conversationId, '项目不应再指向已解散的群聊');
  assert.equal(p.j.project.status === 'cancelled', false, '手动解散群聊不会取消项目');
});

test('私聊「删除会话」：只从自己列表移除并清空自己看到的历史；对方不受影响；对方再发消息时只显示新消息', async () => {
  const a = await acc('dda'), b = await acc('ddb');
  srv.friends.setAccepted(a.id, b.id);
  const cv = (await call('POST', '/api/conversations', {kind: 'dm', userId: b.id}, a.tok)).j.conversation;
  await call('POST', '/api/conversations/' + cv.id + '/messages', {text: '旧消息一'}, a.tok);
  await call('POST', '/api/conversations/' + cv.id + '/messages', {text: '旧消息二'}, b.tok);

  const del = await call('POST', '/api/conversations/' + cv.id + '/delete', null, a.tok);
  assert.equal(del.s, 200, JSON.stringify(del.j));
  assert.ok(!(await listIds(a.tok)).includes(cv.id), '删除后自己列表里不应再有');
  assert.ok((await listIds(b.tok)).includes(cv.id), '对方不受影响');
  const hb = await call('GET', '/api/conversations/' + cv.id + '/messages', null, b.tok);
  assert.equal(hb.j.messages.length, 2, '对方历史不变');
  const ha = await call('GET', '/api/conversations/' + cv.id + '/messages', null, a.tok);
  assert.equal(ha.s, 200);
  assert.equal(ha.j.messages.length, 0, '自己看到的历史应清空');

  // 重新打开（例如从资料页点私信）也看不到旧消息
  const re = await call('POST', '/api/conversations', {kind: 'dm', userId: b.id}, a.tok);
  assert.equal(re.j.conversation.id, cv.id);
  assert.equal((await call('GET', '/api/conversations/' + cv.id + '/messages', null, a.tok)).j.messages.length, 0);

  await new Promise(r => setTimeout(r, 5));
  await call('POST', '/api/conversations/' + cv.id + '/messages', {text: '新消息'}, b.tok);
  const list = (await call('GET', '/api/conversations', null, a.tok)).j.conversations;
  const back = list.find(c => c.id === cv.id);
  assert.ok(back, '对方发来新消息后会话重新出现');
  assert.equal(back.unread, 1);
  const ha2 = (await call('GET', '/api/conversations/' + cv.id + '/messages', null, a.tok)).j.messages.map(m => m.text);
  assert.deepEqual(ha2, ['新消息']);
});

test('删除会话：未登录 401，非成员 403/404，群聊不能用这个接口', async () => {
  const a = await acc('dea'), b = await acc('deb'), x = await acc('dex');
  srv.friends.setAccepted(a.id, b.id);
  const cv = (await call('POST', '/api/conversations', {kind: 'dm', userId: b.id}, a.tok)).j.conversation;
  assert.equal((await call('POST', '/api/conversations/' + cv.id + '/delete')).s, 401);
  const nx = await call('POST', '/api/conversations/' + cv.id + '/delete', null, x.tok);
  assert.ok(nx.s === 403 || nx.s === 404);
  const g = (await call('POST', '/api/conversations', {kind: 'group', name: '群', userIds: [b.id]}, a.tok)).j.conversation;
  assert.equal((await call('POST', '/api/conversations/' + g.id + '/delete', null, a.tok)).s, 400);
});
