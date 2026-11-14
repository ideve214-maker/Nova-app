// M5.3.1 投票：权限、截止时间、防重复投票。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';

let srv, base, seq = 0, t0;
test.before(async () => {
  t0 = Date.now();
  srv = createApp({clock: () => t0});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
});
test.after(() => srv.close());
const call = async (m, p, body, tok) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  return {s: r.status, j: await r.json()};
};
async function acc(n) {
  const u = n + (++seq);
  const r = await call('POST', '/api/auth/register', {agree:true, username: u, email: u + '@x.test', password: 'Passw0rd123'});
  // 2.0：发起投票需要官方/官方授权标识；这里的老用例只测投票规则，统一给标识
  srv.db.prepare("UPDATE users SET badge='authorized' WHERE id=?").run(r.j.user.id);
  return {tok: r.j.token, id: r.j.user.id};
}

test('动态投票：截止后不能投；同一人不能重复投；相同选项幂等', async () => {
  const a = await acc('pla'), b = await acc('plb');
  const closes = t0 + 60_000;
  const cr = await call('POST', '/api/posts', {
    text: '今晚吃什么？',
    poll: {question: '晚饭', options: ['面', '饭'], closesAt: closes},
  }, a.tok);
  assert.equal(cr.s, 200, JSON.stringify(cr.j));
  const poll = cr.j.post.poll;
  assert.ok(poll && poll.id);
  assert.equal(poll.options.length, 2);
  assert.equal(poll.closed, false);
  const oid = poll.options[0].id;
  const v1 = await call('POST', '/api/polls/' + poll.id + '/vote', {optionId: oid}, b.tok);
  assert.equal(v1.s, 200, JSON.stringify(v1.j));
  assert.equal(v1.j.already, false);
  assert.equal(v1.j.poll.options[0].votes, 1);
  const v2 = await call('POST', '/api/polls/' + poll.id + '/vote', {optionId: oid}, b.tok);
  assert.equal(v2.s, 200);
  assert.equal(v2.j.already, true);
  assert.equal(v2.j.poll.options[0].votes, 1);
  const other = poll.options[1].id;
  const v3 = await call('POST', '/api/polls/' + poll.id + '/vote', {optionId: other}, b.tok);
  assert.equal(v3.s, 409);
  assert.equal(v3.j.error.code, 'ALREADY_VOTED');
  t0 = closes + 1;
  const v4 = await call('POST', '/api/polls/' + poll.id + '/vote', {optionId: oid}, a.tok);
  assert.equal(v4.s, 403);
  assert.equal(v4.j.error.code, 'POLL_CLOSED');
  const got = await call('GET', '/api/posts/' + cr.j.post.id, null, a.tok);
  assert.equal(got.j.post.poll.closed, true);
  assert.equal(got.j.post.poll.options[0].votes, 1);
});

test('关注者权限与社区成员权限分别生效', async () => {
  const a = await acc('plc'), b = await acc('pld'), c = await acc('ple');
  const post = (await call('POST', '/api/posts', {
    text: '只给关注者投',
    poll: {question: '颜色', options: ['红', '蓝'], votePerm: 'followers'},
  }, a.tok)).j.post;
  const deny = await call('POST', '/api/polls/' + post.poll.id + '/vote', {optionId: post.poll.options[0].id}, b.tok);
  assert.equal(deny.s, 403, JSON.stringify(deny.j));
  await call('POST', '/api/follows', {userId: a.id}, b.tok);
  const ok = await call('POST', '/api/polls/' + post.poll.id + '/vote', {optionId: post.poll.options[0].id}, b.tok);
  assert.equal(ok.s, 200, JSON.stringify(ok.j));
  const cm = (await call('POST', '/api/communities', {name: '投票社', description: '测权限'}, a.tok)).j.community;
  await call('POST', '/api/communities/' + cm.id + '/join', {}, b.tok);
  const cp = await call('POST', '/api/communities/' + cm.id + '/polls', {question: '社规', options: ['同意', '再议']}, a.tok);
  assert.equal(cp.s, 200, JSON.stringify(cp.j));
  assert.equal(cp.j.poll.votePerm, 'community');
  const out = await call('POST', '/api/polls/' + cp.j.poll.id + '/vote', {optionId: cp.j.poll.options[0].id}, c.tok);
  assert.equal(out.s, 403);
  const inB = await call('POST', '/api/polls/' + cp.j.poll.id + '/vote', {optionId: cp.j.poll.options[0].id}, b.tok);
  assert.equal(inB.s, 200, JSON.stringify(inB.j));
  const non = await call('GET', '/api/communities/' + cm.id + '/polls', null, c.tok);
  assert.equal(non.s, 403);
});
