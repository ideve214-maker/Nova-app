// M5.3.4 屏蔽词：个人过滤与平台治理规则分开。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';

let srv, base, seq = 0, adminTok;
test.before(async () => {
  srv = createApp({adminUsername: 'ops_bw', adminPassword: 'OpsBwPass1!'});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  const login = await call('POST', '/api/admin/auth/login', {username: 'ops_bw', password: 'OpsBwPass1!'});
  adminTok = login.j.token;
});
test.after(() => srv.close());
const call = async (m, p, body, tok) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  return {s: r.status, j: await r.json()};
};
async function acc(n) {
  const u = n + (++seq);
  const r = await call('POST', '/api/auth/register', {username: u, email: u + '@x.test', password: 'Passw0rd123'});
  return {tok: r.j.token, id: r.j.user.id};
}

test('平台屏蔽词拦截发布；个人屏蔽只对自己隐藏，不阻止别人发布', async () => {
  const a = await acc('bwa'), b = await acc('bwb');
  const add = await call('POST', '/api/admin/blockwords', {word: '违禁词甲', note: '测试平台规则'}, adminTok);
  assert.equal(add.s, 200, JSON.stringify(add.j));
  assert.equal(add.j.blockword.scope, 'platform');
  const listA = await call('GET', '/api/admin/blockwords', null, adminTok);
  assert.ok(listA.j.blockwords.some(w => w.word === '违禁词甲'));
  // 用户不能走管理员接口
  assert.ok([401, 403].includes((await call('GET', '/api/admin/blockwords', null, a.tok)).s));
  const denied = await call('POST', '/api/posts', {text: '这有违禁词甲，不能发'}, a.tok);
  assert.equal(denied.s, 400);
  assert.equal(denied.j.error.code, 'BLOCKED_WORD');
  assert.equal(denied.j.error.scope, 'platform');

  // 个人屏蔽：B 把「广告」加入个人词，A 仍可发布；B 看到隐藏文案，A 看自己原文
  const per = await call('POST', '/api/me/blockwords', {word: '广告'}, b.tok);
  assert.equal(per.s, 200, JSON.stringify(per.j));
  assert.equal(per.j.blockword.scope, 'personal');
  const post = await call('POST', '/api/posts', {text: '这不是广告，是分享'}, a.tok);
  assert.equal(post.s, 200, JSON.stringify(post.j));
  const asB = await call('GET', '/api/posts/' + post.j.post.id, null, b.tok);
  assert.equal(asB.j.post.filtered, true);
  assert.equal(asB.j.post.filteredBy, 'personal');
  assert.equal(asB.j.post.text, '【已按你的屏蔽词隐藏】');
  const asA = await call('GET', '/api/posts/' + post.j.post.id, null, a.tok);
  assert.ok(!asA.j.post.filtered);
  assert.equal(asA.j.post.text, '这不是广告，是分享');
  const mine = await call('GET', '/api/me/blockwords', null, b.tok);
  assert.ok(mine.j.blockwords.some(w => w.word === '广告' && w.scope === 'personal'));
  assert.ok(!(await call('GET', '/api/me/blockwords', null, a.tok)).j.blockwords.some(w => w.word === '广告'));
  // 平台列表不含个人词
  const plat = await call('GET', '/api/admin/blockwords', null, adminTok);
  assert.ok(!plat.j.blockwords.some(w => w.word === '广告'));
  const del = await call('POST', '/api/admin/blockwords/' + add.j.blockword.id + '/delete', {}, adminTok);
  assert.equal(del.s, 200);
  const after = await call('POST', '/api/posts', {text: '现在可以写违禁词甲了'}, a.tok);
  assert.equal(after.s, 200, JSON.stringify(after.j));
});
