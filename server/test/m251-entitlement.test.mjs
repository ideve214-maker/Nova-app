// M2.5.1 统一权益检查器 requireEntitlement：服务端鉴权，到期自动失效，不能靠隐藏前端按钮绕过。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';
import {VipError} from '../vip.mjs';
import {VIP_CONFIG as C} from '../vip-config.mjs';

const DAY = 864e5, T0 = Date.UTC(2026, 10, 12, 8, 0, 0);
let T = T0, srv, base;
test.before(async () => { srv = createApp({clock: () => T}); await new Promise(r => srv.listen(0, r)); base = 'http://127.0.0.1:' + srv.address().port; });
test.after(() => srv.close());
const call = async (m, p, body, tok) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  return {s: r.status, j: await r.json()};
};
let n = 0;
const mk = async () => { const u = 'ent_' + (++n); const r = await call('POST', '/api/auth/register', {agree:true, username: u, email: u + '@x.com', password: 'Passw0rd123'}); return {id: r.j.user.id, tok: r.j.token, u}; };
const setVip = (id, until, since = T0 - DAY, source = 'admin') => srv.db.prepare('UPDATE users SET vip_until=?, vip_since=?, vip_source=? WHERE id=?').run(until, since, source, id);
const user = id => srv.db.prepare('SELECT * FROM users WHERE id=?').get(id);
const catchVip = fn => { try { fn(); return null; } catch (e) { assert.ok(e instanceof VipError, '必须抛 VipError，不能静默放行'); return e; } };

test('服务层：Basic 调用 flag 权益被拒，错误码 403 ENTITLEMENT_REQUIRED，并提示升级', () => {
  // 直接用一个尚未写入 vip_until 的用户对象（与库结构一致）
  const u = {id: 0, vip_until: null, vip_since: null, vip_source: null};
  for (const key of ['vip_badge', 'profile_theme_gold', 'profile_decoration', 'premium_emoji_pack']) {
    const e = catchVip(() => srv.vip.requireEntitlement(u, key));
    assert.equal(e.s, 403); assert.equal(e.code, 'ENTITLEMENT_REQUIRED');
    assert.match(e.message, /NOVA VIP/); assert.match(e.message, new RegExp(C.entitlements[key].title));
    assert.equal(e.extra.entitlement, key); assert.equal(e.extra.plan, 'basic'); assert.equal(e.extra.upgrade, true);
  }
});

test('服务层：有效 VIP 通过全部已配置的 flag 权益；quota 返回对应额度', () => {
  const u = {id: 0, vip_until: T0 + 10 * DAY, vip_since: T0, vip_source: 'admin'};
  for (const key of ['vip_badge', 'profile_theme_gold', 'profile_decoration', 'premium_emoji_pack']) {
    const r = srv.vip.requireEntitlement(u, key);
    assert.equal(r.plan, 'vip'); assert.equal(r.enabled, true); assert.equal(r.value, true); assert.equal(r.key, key);
  }
  const q = srv.vip.requireEntitlement(u, 'personal_saved_items_plus');
  assert.equal(q.value, 100); assert.equal(q.plan, 'vip');
  const t = srv.vip.requireTextLength(u, 'post', 'x'.repeat(1000));
  assert.equal(t.limit, 1000); assert.equal(t.length, 1000);
});

test('服务层：到期当刻立即失效（差 1ms 仍有效）；撤销同样失效；客户端字段不影响判断', () => {
  const until = T0 + DAY;
  const live = {id: 1, vip_until: until, vip_since: T0, vip_source: 'admin'};
  assert.equal(srv.vip.requireEntitlement(live, 'premium_emoji_pack', until - 1).enabled, true);
  const dead = catchVip(() => srv.vip.requireEntitlement(live, 'premium_emoji_pack', until));
  assert.equal(dead.code, 'ENTITLEMENT_REQUIRED'); assert.equal(dead.extra.state, 'expired');
  const revoked = {id: 1, vip_until: null, vip_since: null, vip_source: null};
  const r = catchVip(() => srv.vip.requireEntitlement(revoked, 'vip_badge', T0));
  assert.equal(r.code, 'ENTITLEMENT_REQUIRED');
  // 对象上夹带 vip:true 不能骗过检查器（检查器根本不读这些字段）
  const fake = {id: 0, vip_until: null, vip: true, vipUntil: T0 + 99 * DAY, entitlements: {premium_emoji_pack: {enabled: true}}};
  assert.equal(catchVip(() => srv.vip.requireEntitlement(fake, 'premium_emoji_pack')).code, 'ENTITLEMENT_REQUIRED');
});

test('服务层：quota 在额度内放行，超额 403 QUOTA_EXCEEDED；VIP 额度更大；到期后回落到 Basic', () => {
  const basic = {id: 0, vip_until: null};
  assert.equal(srv.vip.requireQuota(basic, 'personal_saved_items_plus', {used: 19, add: 1}).remaining, 1);
  const over = catchVip(() => srv.vip.requireQuota(basic, 'personal_saved_items_plus', {used: 20, add: 1}));
  assert.equal(over.s, 403); assert.equal(over.code, 'QUOTA_EXCEEDED');
  assert.equal(over.extra.limit, 20); assert.equal(over.extra.used, 20); assert.equal(over.extra.upgrade, true);
  assert.match(over.message, /20/); assert.match(over.message, /100/); assert.match(over.message, /VIP/);
  const vipU = {id: 0, vip_until: T0 + 10 * DAY, vip_since: T0, vip_source: 'admin'};
  assert.equal(srv.vip.requireQuota(vipU, 'personal_saved_items_plus', {used: 20, add: 1, at: T0}).limit, 100);
  assert.equal(srv.vip.requireQuota(vipU, 'personal_saved_items_plus', {used: 99, add: 1}).remaining, 1);
  assert.equal(catchVip(() => srv.vip.requireQuota(vipU, 'personal_saved_items_plus', {used: 100, add: 1})).extra.limit, 100);
  // 到期后即便已有 50 条（保留），也不能再新增
  const after = catchVip(() => srv.vip.requireQuota(vipU, 'personal_saved_items_plus', {used: 50, add: 1, at: T0 + 11 * DAY}));
  // at passed inside opts — wait, I used at in opts. requireQuota takes {used, add, scope, at}. Good.
  assert.equal(after.code, 'QUOTA_EXCEEDED'); assert.equal(after.extra.limit, 20); assert.equal(after.extra.plan, 'basic');
});

test('服务层：文本长度按 Unicode 码点计，与前端 len() 一致；Basic/VIP 上限不同，到期回落', () => {
  const basic = {id: 0, vip_until: null};
  assert.equal(srv.vip.requireTextLength(basic, 'post', '啊'.repeat(280)).length, 280);
  const e = catchVip(() => srv.vip.requireTextLength(basic, 'post', '啊'.repeat(281)));
  assert.equal(e.code, 'TEXT_TOO_LONG'); assert.equal(e.extra.limit, 280); assert.equal(e.extra.length, 281);
  assert.match(e.message, /动态/); assert.match(e.message, /1000/);
  // emoji 代理对按码点算 1 字（与 [...s].length 一致），不是 UTF-16 长度 2
  const smile = '😀'.repeat(280);
  assert.equal(smile.length, 560);
  assert.equal(srv.vip.requireTextLength(basic, 'post', smile).length, 280);
  const vipU = {id: 0, vip_until: T0 + DAY, vip_since: T0, vip_source: 'admin'};
  assert.equal(srv.vip.requireTextLength(vipU, 'chat', 'x'.repeat(1500)).limit, 1500);
  assert.equal(srv.vip.requireTextLength(vipU, 'channel', 'x'.repeat(800)).limit, 800);
  assert.equal(catchVip(() => srv.vip.requireTextLength(vipU, 'chat', 'x'.repeat(1501))).extra.limit, 1500);
  const exp = catchVip(() => srv.vip.requireTextLength(vipU, 'post', 'x'.repeat(281), T0 + DAY));
  assert.equal(exp.extra.limit, 280); assert.equal(exp.extra.plan, 'basic');
  assert.equal(catchVip(() => srv.vip.requireTextLength(basic, 'post', '')).code, 'EMPTY_TEXT');
  assert.equal(catchVip(() => srv.vip.requireTextLength(basic, 'bogus', 'hi')).code, 'BAD_SCOPE');
});

test('服务层：未知权益 400；媒体额度已开放，Basic 200MB、VIP 2GB', () => {
  const u = {id: 0, vip_until: T0 + DAY, vip_since: T0, vip_source: 'admin'};
  assert.equal(catchVip(() => srv.vip.requireEntitlement(u, 'not_a_real_key')).code, 'UNKNOWN_ENTITLEMENT');
  const basic = srv.vip.requireEntitlement({id: 0, vip_until: null}, 'media_quota_plus');
  assert.equal(basic.value, 200); assert.equal(basic.plan, 'basic');
  const vipE = srv.vip.requireEntitlement(u, 'media_quota_plus');
  assert.equal(vipE.value, 2048); assert.equal(vipE.plan, 'vip');
});

test('HTTP：/api/vip/gate 需要登录；Basic 调 VIP 专属权益 403；VIP 通过；到期后同一令牌立刻 403', async () => {
  T = T0;
  const {id, tok} = await mk();
  assert.equal((await call('POST', '/api/vip/gate', {key: 'premium_emoji_pack'})).s, 401);
  const basic = await call('POST', '/api/vip/gate', {key: 'premium_emoji_pack'}, tok);
  assert.equal(basic.s, 403); assert.equal(basic.j.error.code, 'ENTITLEMENT_REQUIRED');
  assert.equal(basic.j.error.entitlement, 'premium_emoji_pack'); assert.equal(basic.j.error.plan, 'basic');
  assert.match(basic.j.error.message, /NOVA VIP/);
  // 隐藏按钮无效：只要有令牌就能打到接口，服务端仍然拒绝
  setVip(id, T0 + 5 * DAY);
  const ok = await call('POST', '/api/vip/gate', {key: 'premium_emoji_pack'}, tok);
  assert.equal(ok.s, 200); assert.equal(ok.j.ok, true); assert.equal(ok.j.plan, 'vip'); assert.equal(ok.j.enabled, true);
  // 夹带别人的身份或 vip 字段无效
  const sneak = await call('POST', '/api/vip/gate', {key: 'premium_emoji_pack', vip: true, userId: id + 99}, tok);
  assert.equal(sneak.s, 200); // 自己本来就是 VIP
  const {tok: tokB} = await mk();
  const other = await call('POST', '/api/vip/gate', {key: 'premium_emoji_pack', userId: id}, tokB);
  assert.equal(other.s, 403); assert.equal(other.j.error.plan, 'basic');
  // 到期
  T = T0 + 5 * DAY;
  const expired = await call('POST', '/api/vip/gate', {key: 'premium_emoji_pack'}, tok);
  assert.equal(expired.s, 403); assert.equal(expired.j.error.code, 'ENTITLEMENT_REQUIRED');
  assert.equal(expired.j.error.plan, 'basic'); assert.equal(expired.j.error.state, 'expired');
  T = T0;
});

test('HTTP：未知权益 400；quota 权益 Basic 也可以查询（免费额度）；未登录 401', async () => {
  const {tok} = await mk();
  assert.equal((await call('POST', '/api/vip/gate', {key: 'nope'}, tok)).j.error.code, 'UNKNOWN_ENTITLEMENT');
  const q = await call('POST', '/api/vip/gate', {key: 'personal_saved_items_plus'}, tok);
  assert.equal(q.s, 200); assert.equal(q.j.value, 20); assert.equal(q.j.plan, 'basic');
  assert.equal((await call('POST', '/api/vip/gate', {key: 'vip_badge'})).s, 401);
});
