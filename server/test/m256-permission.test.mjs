// M2.5.6 VIP 接口权限与过期：Basic 调 VIP 接口一律 403 并给出升级错误；到期后同一令牌立刻失去权限。
// 覆盖本阶段全部 VIP 相关写接口。只加测试，不改产品代码。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';

const DAY = 864e5, T0 = Date.UTC(2026, 10, 12, 16, 0, 0);
let T = T0, srv, base;
test.before(async () => { T = T0; srv = createApp({clock: () => T}); await new Promise(r => srv.listen(0, r)); base = 'http://127.0.0.1:' + srv.address().port; });
test.after(() => srv.close());
const call = async (m, p, body, tok) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  return {s: r.status, j: await r.json()};
};
let n = 0;
const mk = async () => { const u = 'p6_' + (++n); const r = await call('POST', '/api/auth/register', {agree:true, username: u, email: u + '@x.com', password: 'Passw0rd123'}); return {id: r.j.user.id, tok: r.j.token, u}; };
const setVip = (id, until) => srv.db.prepare('UPDATE users SET vip_until=?, vip_since=?, vip_source=? WHERE id=?').run(until, T0, 'admin', id);

const VIP_ONLY = [
  ['POST', '/api/vip/gate', {key: 'premium_emoji_pack'}, 'ENTITLEMENT_REQUIRED'],
  ['POST', '/api/vip/gate', {key: 'profile_decoration'}, 'ENTITLEMENT_REQUIRED'],
  ['POST', '/api/vip/gate', {key: 'vip_badge'}, 'ENTITLEMENT_REQUIRED'],
  ['POST', '/api/stickers/use', {pack: 'nova_gold', id: 'gold_star'}, 'ENTITLEMENT_REQUIRED'],
];

test('Basic 调用所有 VIP 专属接口均 403，错误码明确并提示升级；未登录 401', async () => {
  for (const [m, p, b] of VIP_ONLY) assert.equal((await call(m, p, b)).s, 401, p + ' 未登录');
  const {tok} = await mk();
  for (const [m, p, b, code] of VIP_ONLY) {
    const r = await call(m, p, b, tok);
    assert.equal(r.s, 403, p); assert.equal(r.j.error.code, code, p);
    assert.ok(r.j.error.message, '要有说明'); assert.match(r.j.error.message, /VIP/, p);
    assert.equal(r.j.error.upgrade, true, p); assert.equal(r.j.error.plan, 'basic', p);
  }
});

test('有效 VIP 通过全部专属接口；超额和超长仍按 VIP 额度限制', async () => {
  const {id, tok} = await mk();
  setVip(id, T0 + 10 * DAY);
  for (const [m, p, b] of VIP_ONLY) {
    const r = await call(m, p, b, tok);
    assert.equal(r.s, 200, p + ' VIP 应通过：' + JSON.stringify(r.j));
  }
  // 额度类：VIP 可以到 100 / 1000，再超额仍 403，但是按 VIP 上限、不叫「请升级」
  for (let i = 0; i < 100; i++) assert.equal((await call('POST', '/api/me/saved', {kind: 'post', target: 'z' + i}, tok)).s, 200);
  const over = await call('POST', '/api/me/saved', {kind: 'post', target: 'z100'}, tok);
  assert.equal(over.s, 403); assert.equal(over.j.error.code, 'QUOTA_EXCEEDED'); assert.equal(over.j.error.limit, 100); assert.equal(over.j.error.upgrade, false);
  const long = await call('POST', '/api/content/check', {scope: 'post', text: '字'.repeat(1001)}, tok);
  assert.equal(long.s, 403); assert.equal(long.j.error.code, 'TEXT_TOO_LONG'); assert.equal(long.j.error.limit, 1000); assert.equal(long.j.error.upgrade, false);
  assert.equal((await call('POST', '/api/content/check', {scope: 'post', text: '字'.repeat(1000)}, tok)).s, 200);
});

test('到期后同一令牌立刻失去全部 VIP 权限；基础能力仍在；会话仍然有效', async () => {
  T = T0;
  const {id, tok} = await mk();
  setVip(id, T0 + 3 * DAY);
  assert.equal((await call('POST', '/api/stickers/use', {pack: 'nova_gold', id: 'gold_book'}, tok)).s, 200);
  assert.equal((await call('POST', '/api/content/check', {scope: 'post', text: '字'.repeat(500)}, tok)).s, 200);
  T = T0 + 3 * DAY; // 恰好到期
  assert.equal((await call('GET', '/api/me', null, tok)).s, 200, '到期不应让用户下线');
  assert.equal((await call('GET', '/api/me', null, tok)).j.user.vip, false);
  for (const [m, p, b, code] of VIP_ONLY) {
    const r = await call(m, p, b, tok);
    assert.equal(r.s, 403, '到期后 ' + p); assert.equal(r.j.error.code, code);
    assert.equal(r.j.error.plan, 'basic'); assert.equal(r.j.error.state, 'expired');
  }
  const long = await call('POST', '/api/content/check', {scope: 'post', text: '字'.repeat(281)}, tok);
  assert.equal(long.s, 403); assert.equal(long.j.error.limit, 280);
  assert.equal((await call('POST', '/api/stickers/use', {pack: 'basic', id: 'smile'}, tok)).s, 200, '基础表情仍可用');
  assert.equal((await call('POST', '/api/content/check', {scope: 'post', text: '短'}, tok)).s, 200);
  T = T0;
});

test('撤销与即将到期：撤销立即 403；即将到期（不足 3 天）权益仍有效', async () => {
  T = T0;
  const {id, tok} = await mk();
  setVip(id, T0 + 2 * DAY); // expiring
  const me = (await call('GET', '/api/vip/me', null, tok)).j;
  assert.equal(me.vip.state, 'expiring'); assert.equal(me.vip.active, true);
  assert.equal((await call('POST', '/api/stickers/use', {pack: 'nova_gold', id: 'gold_rose'}, tok)).s, 200);
  srv.vip.revoke(id, {source: 'admin', note: 'M2.5.6'});
  const r = await call('POST', '/api/stickers/use', {pack: 'nova_gold', id: 'gold_rose'}, tok);
  assert.equal(r.s, 403); assert.equal(r.j.error.state, 'revoked');
  assert.equal((await call('GET', '/api/me', null, tok)).s, 200, '撤销不下线');
});

test('权限不能跨账号：A 的 VIP 不能让 B 的请求通过；body 里带 A 的 userId 无效', async () => {
  const a = await mk(), b = await mk();
  setVip(a.id, T0 + 10 * DAY);
  const r = await call('POST', '/api/stickers/use', {pack: 'nova_gold', id: 'gold_star', userId: a.id, vip: true}, b.tok);
  assert.equal(r.s, 403); assert.equal(r.j.error.plan, 'basic');
  const g = await call('POST', '/api/vip/gate', {key: 'premium_emoji_pack', userId: a.id}, b.tok);
  assert.equal(g.s, 403);
  await call('POST', '/api/me/saved', {kind: 'post', target: 'onlyA'}, a.tok);
  assert.equal((await call('GET', '/api/me/saved', null, b.tok)).j.count, 0);
});
