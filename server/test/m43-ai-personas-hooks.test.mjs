// 2.1.3：AI 内部账号的服务端挂钩（公共函数、登录/私信拒绝、数据调整、额度、用户数）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';
import {isInternalAccount} from '../internal-account.mjs';

let srv, base, adm, seq = 0;
test.before(async () => {
  srv = createApp({adminUsername: 'ops_aih', adminPassword: 'OpsAiHook1!'});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  adm = (await call('POST', '/api/admin/auth/login', {username: 'ops_aih', password: 'OpsAiHook1!'})).j.token;
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
  return {tok: r.j.token, id: r.j.user.id, u, pw: 'Passw0rd123'};
}
function markInternal(id) {
  srv.db.prepare("UPDATE users SET badge='internal' WHERE id=?").run(id);
  srv.db.prepare("INSERT INTO ai_personas(user_id,status,persona,next_at,next_post_at,created_at) VALUES(?,'active','{}',0,0,?)").run(id, Date.now());
}

test('isInternalAccount 认 badge 和 ai_personas 表', () => {
  const a = srv.db.prepare("SELECT * FROM users LIMIT 1").get();
  assert.equal(isInternalAccount({badge: 'internal'}, srv.db), true);
  assert.equal(isInternalAccount({badge: 'official'}, srv.db), false);
  if (a) {
    markInternal(a.id);
    const row = srv.db.prepare('SELECT * FROM users WHERE id=?').get(a.id);
    assert.equal(isInternalAccount(row, srv.db), true);
    assert.equal(isInternalAccount({id: a.id, badge: null}, srv.db), true);
  }
});

test('内部账号不能登录；资料和帖子作者带 ai:true', async () => {
  const ai = await acc('aiu');
  const real = await acc('realu');
  const post = (await call('POST', '/api/posts', {text: '内部账号帖 ' + ai.u}, ai.tok)).j.post;
  markInternal(ai.id);
  const login = await call('POST', '/api/auth/login', {account: ai.u, password: ai.pw});
  assert.equal(login.s, 403);
  assert.equal(login.j.error.code, 'INTERNAL_ACCOUNT');
  const card = await call('GET', '/api/users/' + ai.id, null, real.tok);
  assert.equal(card.s, 200);
  assert.equal(card.j.user.ai, true);
  assert.equal(card.j.user.badge, 'internal');
  const got = (await call('GET', '/api/posts/' + post.id, null, real.tok)).j.post;
  assert.equal(got.author.ai, true);
  assert.equal(got.author.badge, 'internal');
});

test('真人给内部账号发私信或加好友返回 403 INTERNAL_ACCOUNT', async () => {
  const ai = await acc('aidm');
  const real = await acc('realdm');
  markInternal(ai.id);
  const fr = await call('POST', '/api/friends/request', {userId: ai.id}, real.tok);
  assert.equal(fr.s, 403);
  assert.equal(fr.j.error.code, 'INTERNAL_ACCOUNT');
  const mr = await call('POST', '/api/message-requests', {userId: ai.id, text: '你好'}, real.tok);
  assert.equal(mr.s, 403);
  assert.equal(mr.j.error.code, 'INTERNAL_ACCOUNT');
});

test('内部账号收藏不受额度限制', async () => {
  const ai = await acc('aisv');
  const real = await acc('realsv');
  const p = (await call('POST', '/api/posts', {text: '额度帖'}, real.tok)).j.post;
  markInternal(ai.id);
  for (let i = 0; i < 20; i++) {
    srv.db.prepare("INSERT INTO saved_items(user_id,kind,target,title,excerpt,created_at) VALUES(?,'post',?,?,?,?)").run(ai.id, 'po_pad_' + i, 't', '', Date.now());
  }
  const r = await call('POST', '/api/me/saved', {kind: 'post', target: p.id, title: '额度帖'}, ai.tok);
  assert.equal(r.s, 200, JSON.stringify(r.j));
  assert.equal(r.j.saved, true);
});

test('首页总用户数排除内部账号', async () => {
  const before = (await call('GET', '/api/admin/stats', null, adm)).j.users.total;
  const ai = await acc('aicnt');
  const mid = (await call('GET', '/api/admin/stats', null, adm)).j.users.total;
  assert.equal(mid, before + 1);
  markInternal(ai.id);
  const after = (await call('GET', '/api/admin/stats', null, adm)).j.users.total;
  assert.equal(after, before);
});

test('数据调整返回 real/ai/adj/shown，保存支持 {adj:{…}} 和旧格式', async () => {
  const real = await acc('adjr');
  const ai = await acc('adja');
  const p = (await call('POST', '/api/posts', {text: '调整帖 ' + real.u}, real.tok)).j.post;
  await call('POST', `/api/posts/${p.id}/view`, {}, real.tok);
  await call('POST', `/api/posts/${p.id}/react`, {index: 0}, real.tok);
  markInternal(ai.id);
  const rAi = await srv.userActions.viewPost({id: ai.id, badge: 'internal'}, p.id);
  assert.equal(rAi.counted, true);
  srv.userActions.react({id: ai.id, badge: 'internal'}, p.id, {index: 0}, {via: 'ai-persona'});
  const list = await call('GET', '/api/admin/marketing/posts?q=' + encodeURIComponent('调整帖'), null, adm);
  const row = list.j.posts.find(x => x.id === p.id);
  assert.ok(row);
  assert.equal(row.real.views, 1);
  assert.equal(row.ai.views, 1);
  assert.equal(row.real.likes, 1);
  assert.equal(row.ai.likes, 1);
  assert.equal(row.shown.views, 2);
  const up = await call('POST', `/api/admin/marketing/posts/${p.id}/stats`, {adj: {views: 100, likes: 0, saves: 0, reposts: 5}}, adm);
  assert.equal(up.s, 200, JSON.stringify(up.j));
  assert.deepEqual(up.j.post.adj, {views: 100, likes: 0, saves: 0, reposts: 5});
  assert.equal(up.j.post.shown.views, 102);
  assert.equal(up.j.post.shown.reposts, 5);
  const old = await call('POST', `/api/admin/marketing/posts/${p.id}/stats`, {views: 50}, adm);
  assert.equal(old.s, 200);
  assert.equal(old.j.post.shown.views, 50);
  assert.equal(old.j.post.adj.views, 48);
});

test('管理端 AI 内部账号接口已挂载；公共函数名与 DIFT 表一致', async () => {
  const r = await call('GET', '/api/admin/ai/personas', null, adm);
  assert.equal(r.s, 200, JSON.stringify(r.j));
  assert.ok(r.j.settings);
  const ua = srv.userActions;
  for (const k of ['createPost', 'repost', 'addComment', 'react', 'savePost', 'viewPost', 'joinCommunity', 'postChannelMessage']) {
    assert.equal(typeof ua[k], 'function', k);
  }
});
