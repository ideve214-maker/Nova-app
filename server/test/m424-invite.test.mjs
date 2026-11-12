// M4.2.4 社区邀请/加入边界：私密社区不可被未授权用户读取；邀请可撤销。
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

test('私密社区不出现在发现列表，未加入者读取 404，不能直接加入', async () => {
  const o = await acc('po'), s = await acc('ps');
  const c = (await call('POST', '/api/communities', {name: '秘密角', visibility: 'private'}, o.tok)).j.community;
  assert.equal(c.visibility, 'private');
  const disc = await call('GET', '/api/communities', null, s.tok);
  assert.ok(!disc.j.communities.some(x => x.id === c.id));
  const get = await call('GET', '/api/communities/' + c.id, null, s.tok);
  assert.equal(get.s, 404);
  const j = await call('POST', '/api/communities/' + c.id + '/join', {}, s.tok);
  assert.equal(j.s, 403); assert.equal(j.j.error.code, 'INVITE_REQUIRED');
  // 猜邀请也没用
  assert.equal((await call('POST', '/api/communities/' + c.id + '/join', {code: 'nope'}, s.tok)).s, 403);
});

test('有效邀请可加入；撤销后立刻失效；过期和用尽同样失效', async () => {
  let t = Date.now();
  srv.close();
  srv = createApp({clock: () => t});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  const o = await acc('io'), a = await acc('ia'), b = await acc('ib'), c = await acc('ic');
  const cm = (await call('POST', '/api/communities', {name: '邀请社区', visibility: 'private'}, o.tok)).j.community;
  const inv = await call('POST', '/api/communities/' + cm.id + '/invites', {maxUses: 2}, o.tok);
  assert.equal(inv.s, 200, JSON.stringify(inv.j));
  const code = inv.j.invite.code;
  const j1 = await call('POST', '/api/communities/join-code', {code}, a.tok);
  assert.equal(j1.s, 200); assert.equal(j1.j.community.joined, true);
  const j2 = await call('POST', '/api/communities/' + cm.id + '/join', {code}, b.tok);
  assert.equal(j2.s, 200);
  const j3 = await call('POST', '/api/communities/join-code', {code}, c.tok);
  assert.equal(j3.s, 400, '用尽');
  const inv2 = (await call('POST', '/api/communities/' + cm.id + '/invites', {}, o.tok)).j.invite;
  const rv = await call('POST', '/api/communities/' + cm.id + '/invites/revoke', {id: inv2.id}, o.tok);
  assert.equal(rv.s, 200);
  const d = await acc('id');
  assert.equal((await call('POST', '/api/communities/join-code', {code: inv2.code}, d.tok)).s, 400);
  // 过期
  const inv3 = (await call('POST', '/api/communities/' + cm.id + '/invites', {days: 1}, o.tok)).j.invite;
  t += 2 * 864e5;
  const e = await acc('ie');
  assert.equal((await call('POST', '/api/communities/join-code', {code: inv3.code}, e.tok)).s, 400);
});
