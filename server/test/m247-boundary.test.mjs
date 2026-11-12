// M2.4.7 VIP 状态边界测试：未开通 / 有效 / 即将到期 / 已过期 / 管理员撤销。
// 全部用可注入时钟，精确到毫秒；同时核对 /api/me、/api/vip/me、权益取值三处一致。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';
import {VIP_CONFIG as C} from '../vip-config.mjs';

const DAY = 864e5, T0 = Date.UTC(2026, 10, 12, 4, 0, 0);
let T = T0, srv, base;
test.before(async () => { srv = createApp({clock: () => T}); await new Promise(r => srv.listen(0, r)); base = 'http://127.0.0.1:' + srv.address().port; });
test.after(() => srv.close());
const call = async (m, p, body, tok) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  return {s: r.status, j: await r.json()};
};
let n = 0;
const mk = async () => { const u = 'bnd_' + (++n); const r = await call('POST', '/api/auth/register', {username: u, email: u + '@x.com', password: 'Passw0rd123'}); return {id: r.j.user.id, tok: r.j.token}; };
const setVip = (id, until, source = 'admin') => srv.db.prepare('UPDATE users SET vip_until=?, vip_since=?, vip_source=? WHERE id=?').run(until, until === null ? null : T0 - DAY, source, id);

// 一次读出三处：/api/me、/api/vip/me、权益；并断言它们互相一致。
const snap = async u => {
  const me = await call('GET', '/api/me', null, u.tok), v = await call('GET', '/api/vip/me', null, u.tok);
  assert.equal(me.s, 200); assert.equal(v.s, 200);
  const a = v.j.vip;
  assert.equal(me.j.user.vip, a.active, '/api/me.vip 与 /api/vip/me 一致');
  assert.equal(me.j.user.vipUntil, a.active ? a.until : null, '无效时 vipUntil 必须为空');
  assert.equal(v.j.entitlements.profile_theme_gold.enabled, a.active, '主题权益与有效状态一致');
  assert.equal(v.j.entitlements.personal_saved_items_plus.value, a.active ? C.entitlements.personal_saved_items_plus.vip : C.entitlements.personal_saved_items_plus.basic);
  assert.equal(a.plan, a.active ? 'vip' : 'basic');
  return a;
};

test('五种状态各一个用户，三处读数一致', async () => {
  const none = await mk(), act = await mk(), soon = await mk(), exp = await mk(), rev = await mk();
  setVip(act.id, T + 40 * DAY); setVip(soon.id, T + 2 * DAY); setVip(exp.id, T - DAY);
  srv.vip.revoke(rev.id, {source: 'admin', actorId: null, note: '边界测试'});
  const r = {none: await snap(none), active: await snap(act), expiring: await snap(soon), expired: await snap(exp), revoked: await snap(rev)};
  for (const [k, a] of Object.entries(r)) assert.equal(a.state, k, k);
  assert.deepEqual([r.none.active, r.active.active, r.expiring.active, r.expired.active, r.revoked.active], [false, true, true, false, false]);
  assert.equal(r.expiring.daysLeft, 2); assert.equal(r.expiring.expiringSoon, true); assert.equal(r.active.expiringSoon, false);
  assert.equal(r.expired.expiredAt, T - DAY); assert.equal(r.revoked.until, null);
});

test('到期边界精确到毫秒：差 1ms 仍有效，恰好到期即失效', async () => {
  const u = await mk();
  setVip(u.id, T + 1); let a = await snap(u);
  assert.equal(a.active, true); assert.equal(a.daysLeft, 1, '不足一天按 1 天算');
  setVip(u.id, T); a = await snap(u);
  assert.equal(a.active, false, '到期时刻当下就失效，没有宽限'); assert.equal(a.state, 'expired');
  setVip(u.id, T - 1); assert.equal((await snap(u)).state, 'expired');
});

test('「即将到期」阈值边界：恰好 3 天算即将到期，多 1ms 不算', async () => {
  const u = await mk();
  setVip(u.id, T + 3 * DAY); let a = await snap(u);
  assert.equal(a.state, 'expiring'); assert.equal(a.daysLeft, 3); assert.equal(a.active, true, '即将到期权益仍然有效');
  setVip(u.id, T + 3 * DAY + 1); a = await snap(u);
  assert.equal(a.state, 'active'); assert.equal(a.daysLeft, 4);
});

test('同一用户随时间推进：有效 → 即将到期 → 已过期，权益随之回落，内容与登录不受影响', async () => {
  const u = await mk(); const t0 = T;
  try {
    setVip(u.id, T + 10 * DAY);
    assert.equal((await snap(u)).state, 'active');
    T = t0 + 7 * DAY; let a = await snap(u);
    assert.equal(a.state, 'expiring'); assert.equal(a.daysLeft, 3);
    T = t0 + 10 * DAY - 1; a = await snap(u); assert.equal(a.state, 'expiring'); assert.equal(a.active, true);
    T = t0 + 10 * DAY; a = await snap(u);
    assert.equal(a.state, 'expired'); assert.equal(a.expiredAt, t0 + 10 * DAY);
    const v = await call('GET', '/api/vip/me', null, u.tok);
    assert.equal(v.j.entitlements.personal_saved_items_plus.value, 20, '额度回到 Basic');
    assert.equal(v.j.entitlements.longer_post_text.value.post, 280);
    assert.equal((await call('GET', '/api/me', null, u.tok)).s, 200, '到期不影响登录');
    const row = srv.db.prepare('SELECT * FROM users WHERE id=?').get(u.id);   // 登录令牌本身会过期，远期直接读服务层
    assert.equal(srv.vip.status(row, t0 + 400 * DAY).state, 'expired', '过很久仍是已过期');
  } finally { T = t0; }
});

test('管理员手动撤销：立即失效、状态为 revoked、不受时间影响、可重新开通', async () => {
  const u = await mk(); setVip(u.id, T + 30 * DAY);
  assert.equal((await snap(u)).active, true);
  srv.vip.revoke(u.id, {source: 'admin', actorId: null, note: '违规撤销'});
  let a = await snap(u);
  assert.equal(a.state, 'revoked'); assert.equal(a.active, false); assert.equal(a.until, null);
  assert.equal(srv.db.prepare('SELECT vip_until u FROM users WHERE id=?').get(u.id).u, null);
  assert.equal((await call('GET', '/api/me', null, u.tok)).s, 200, '撤销 VIP 不会让用户下线');
  const t0 = T, row = srv.db.prepare('SELECT * FROM users WHERE id=?').get(u.id);
  assert.equal(srv.vip.status(row, t0 + 100 * DAY).state, 'revoked', '撤销状态不会随时间自己变回去');
  srv.vip.grant(u.id, {days: 30, source: 'admin', actorId: null, note: '申诉通过'});
  a = await snap(u); assert.equal(a.state, 'active'); assert.equal(a.daysLeft, 30);
  const ev = srv.db.prepare('SELECT action,source FROM vip_events WHERE user_id=? ORDER BY id').all(u.id);
  assert.deepEqual(ev.map(e => e.action + ':' + e.source), ['revoke:admin', 'grant:admin']);
});

test('撤销的其他情形：已过期的用户被撤销、从未开通的用户被撤销、测试来源撤销不算 revoked', async () => {
  const exp = await mk(); setVip(exp.id, T - 5 * DAY);
  srv.vip.revoke(exp.id, {source: 'admin'}); assert.equal((await snap(exp)).state, 'revoked');
  const none = await mk(); srv.vip.revoke(none.id, {source: 'admin'}); assert.equal((await snap(none)).state, 'revoked');
  const tst = await mk(); srv.vip.grant(tst.id, {days: 30, source: 'test'}); srv.vip.revoke(tst.id, {source: 'test'});
  assert.equal((await snap(tst)).state, 'none', '测试开关关闭回到未开通，不是被撤销');
});

test('撤销只影响本人；异常的库内数值不会让人意外变成 VIP', async () => {
  const a = await mk(), b = await mk(); setVip(a.id, T + 30 * DAY); setVip(b.id, T + 30 * DAY);
  srv.vip.revoke(a.id, {source: 'admin'});
  assert.equal((await snap(a)).active, false); assert.equal((await snap(b)).active, true);
  for (const bad of [0, -5]) {
    const u = await mk(); srv.db.prepare('UPDATE users SET vip_until=? WHERE id=?').run(bad, u.id);
    assert.equal((await snap(u)).active, false, 'vip_until=' + bad + ' 不是 VIP');
  }
});

test('续期规则边界：有效期内从原到期日顺延；到期后从当前时间重新起算', async () => {
  const u = await mk(); srv.vip.grant(u.id, {days: 10, source: 'admin'});
  const first = srv.db.prepare('SELECT vip_until u FROM users WHERE id=?').get(u.id).u;
  srv.vip.grant(u.id, {days: 5, source: 'admin'});
  assert.equal(srv.db.prepare('SELECT vip_until u FROM users WHERE id=?').get(u.id).u, first + 5 * DAY);
  const t0 = T;
  try {
    T = t0 + 20 * DAY;                                     // 已过期
    srv.vip.grant(u.id, {days: 5, source: 'admin'});
    assert.equal(srv.db.prepare('SELECT vip_until u FROM users WHERE id=?').get(u.id).u, T + 5 * DAY, '过期后从现在起算，不补欠的天数');
    assert.equal((await snap(u)).state, 'active');
  } finally { T = t0; }
});
