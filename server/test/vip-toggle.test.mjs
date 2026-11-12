// M2.4.4 测试模式切换：仅开发环境；生产/拼写变体/显式关闭一律拒绝；不改动正式 VIP；只影响调用者自己。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';

const DAY = 864e5, T0 = Date.UTC(2026, 10, 12, 4, 0, 0);
async function boot(opts) {
  let T = T0;
  const srv = createApp({clock: () => T, ...opts});
  await new Promise(r => srv.listen(0, r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const call = async (m, p, body, tok) => { const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined}); return {s: r.status, j: await r.json()}; };
  let n = 0;
  let last = '';
  const mk = async () => { const u = last = 'tg_' + (++n); const r = await call('POST', '/api/auth/register', {username: u, email: u + '@x.com', password: 'Passw0rd123'}); return {id: r.j.user.id, tok: r.j.token}; };
  const relogin = async () => ({tok: (await call('POST', '/api/auth/login', {account: last, password: 'Passw0rd123'})).j.token});
  return {srv, call, mk, relogin, tick: ms => { T += ms; }, close: () => srv.close(), row: id => srv.db.prepare('SELECT vip_until,vip_since,vip_source FROM users WHERE id=?').get(id)};
}
const toggle = (h, tok, on) => h.call('POST', '/api/vip/test-toggle', {on}, tok);

test('默认（生产）：目录显示未开启，切换被 403 拒绝，库里没有任何变化，并留审计', async () => {
  const h = await boot({});                                   // 不传 env → production
  try {
    assert.equal((await h.call('GET', '/api/vip/catalog')).j.testToggle.enabled, false);
    const {id, tok} = await h.mk();
    const r = await toggle(h, tok, true);
    assert.equal(r.s, 403); assert.equal(r.j.error.code, 'TEST_MODE_DISABLED');
    assert.deepEqual({...h.row(id)}, {vip_until: null, vip_since: null, vip_source: null});
    assert.equal(h.srv.db.prepare('SELECT COUNT(*) c FROM vip_events').get().c, 0);
    assert.ok(h.srv.db.prepare("SELECT 1 FROM audit_log WHERE action='vip.test_denied' AND actor_id=?").get(id), '被拒绝的尝试应写审计');
    assert.equal((await h.call('GET', '/api/vip/me', null, tok)).j.vip.plan, 'basic');
  } finally { h.close(); }
});

test('只有严格等于 development 才开启；dev/Development/test/prod/空串/显式关闭都按生产处理', async () => {
  for (const env of ['dev', 'Development', 'DEVELOPMENT', 'test', 'prod', 'production', '', ' development']) {
    const h = await boot({env});
    try {
      const {tok} = await h.mk();
      assert.equal((await h.call('GET', '/api/vip/catalog')).j.testToggle.enabled, false, JSON.stringify(env));
      assert.equal((await toggle(h, tok, true)).s, 403, JSON.stringify(env));
    } finally { h.close(); }
  }
  const off = await boot({env: 'development', vipTestToggle: false});
  try { const {tok} = await off.mk(); assert.equal((await toggle(off, tok, true)).s, 403, 'NOVA_VIP_TEST_TOGGLE=0 可在开发环境里再关掉'); } finally { off.close(); }
});

test('开发环境：目录显示开启；开 → 有效 VIP(来源 test, 30 天)；再开幂等；关 → 回到未开通', async () => {
  const h = await boot({env: 'development'});
  try {
    assert.equal((await h.call('GET', '/api/vip/catalog')).j.testToggle.enabled, true);
    const {id, tok} = await h.mk();
    const on = await toggle(h, tok, true);
    assert.equal(on.s, 200);
    assert.equal(on.j.vip.plan, 'vip'); assert.equal(on.j.vip.state, 'active'); assert.equal(on.j.vip.source, 'test');
    assert.equal(on.j.vip.until, T0 + 30 * DAY); assert.equal(on.j.vip.since, T0); assert.equal(on.j.vip.daysLeft, 30);
    assert.equal(on.j.entitlements.vip_badge.enabled, true);
    assert.equal((await h.call('GET', '/api/me', null, tok)).j.user.vip, true);
    // 幂等：再开一次不会延长
    h.tick(DAY);
    const again = await toggle(h, tok, true);
    assert.equal(again.j.vip.until, T0 + 30 * DAY); assert.equal(h.srv.db.prepare('SELECT COUNT(*) c FROM vip_events WHERE user_id=?').get(id).c, 1);
    const off = await toggle(h, tok, false);
    assert.equal(off.s, 200); assert.equal(off.j.vip.plan, 'basic'); assert.equal(off.j.vip.state, 'none', '测试关闭不是「被撤销」');
    assert.deepEqual({...h.row(id)}, {vip_until: null, vip_since: null, vip_source: null});
    assert.equal((await toggle(h, tok, false)).s, 200, '关两次也是幂等');
    const ev = h.srv.db.prepare('SELECT action,source,actor_id FROM vip_events WHERE user_id=? ORDER BY id').all(id).map(e => ({...e}));
    assert.deepEqual(ev, [{action: 'grant', source: 'test', actor_id: id}, {action: 'revoke', source: 'test', actor_id: id}]);
    const log = JSON.stringify(h.srv.db.prepare('SELECT action FROM audit_log').all());
    assert.ok(log.includes('vip.test_on') && log.includes('vip.test_off'));
  } finally { h.close(); }
});

test('测试 VIP 同样按时间到期；需要登录；参数必须是布尔值', async () => {
  const h = await boot({env: 'development'});
  try {
    const {tok} = await h.mk();
    assert.equal((await h.call('POST', '/api/vip/test-toggle', {on: true})).s, 401);
    for (const bad of [undefined, 'true', 1, null, {}]) assert.equal((await h.call('POST', '/api/vip/test-toggle', {on: bad}, tok)).s, 400);
    await toggle(h, tok, true);
    h.tick(31 * DAY);                                    // 会话本身也是 30 天，重新登录后再查
    const me = (await h.call('GET', '/api/vip/me', null, (await h.relogin()).tok)).j;
    assert.equal(me.vip.state, 'expired'); assert.equal(me.vip.plan, 'basic');
  } finally { h.close(); }
});

test('不改动正式开通的 VIP（管理员/支付/历史数据），开关与关闭都返回 409 且数据不变', async () => {
  const h = await boot({env: 'development'});
  try {
    for (const source of ['admin', 'payment', null]) {
      const {id, tok} = await h.mk();
      h.srv.db.prepare('UPDATE users SET vip_until=?, vip_since=?, vip_source=? WHERE id=?').run(T0 + 90 * DAY, T0 - DAY, source, id);
      const before = {...h.row(id)};
      for (const on of [true, false]) { const r = await toggle(h, tok, on); assert.equal(r.s, 409, `${source} on=${on}`); assert.equal(r.j.error.code, 'REAL_VIP_ACTIVE'); }
      assert.deepEqual({...h.row(id)}, before);
      assert.equal((await h.call('GET', '/api/vip/me', null, tok)).j.vip.state, 'active');
    }
  } finally { h.close(); }
});

test('只能给自己开：body 里带别人的 userId 无效', async () => {
  const h = await boot({env: 'development'});
  try {
    const a = await h.mk(), b = await h.mk();
    const r = await h.call('POST', '/api/vip/test-toggle', {on: true, userId: b.id, user_id: b.id, id: b.id}, a.tok);
    assert.equal(r.s, 200);
    assert.equal(h.row(a.id).vip_source, 'test'); assert.equal(h.row(b.id).vip_until, null);
  } finally { h.close(); }
});

test('服务层：grant 顺延规则与 revoke（管理员接口之后复用）', async () => {
  const h = await boot({env: 'development'});
  try {
    const {id} = await h.mk(), v = h.srv.vip;
    assert.throws(() => v.grant(id, {days: 0, source: 'admin'}), /days/);
    assert.throws(() => v.grant(id, {days: 5, source: 'hacker'}), /来源/);
    const u1 = v.grant(id, {days: 10, source: 'admin', actorId: 99});
    assert.equal(u1.vip_until, T0 + 10 * DAY);
    h.tick(4 * DAY);
    const u2 = v.grant(id, {days: 10, source: 'admin', actorId: 99});            // 未过期：从原到期日顺延
    assert.equal(u2.vip_until, T0 + 20 * DAY); assert.equal(u2.vip_since, T0);
    h.tick(30 * DAY);                                                            // 已过期
    const u3 = v.grant(id, {days: 5, source: 'admin'});                          // 已过期：从现在起算
    assert.equal(u3.vip_until, T0 + 34 * DAY + 5 * DAY); assert.equal(u3.vip_since, T0 + 34 * DAY);
    v.revoke(id, {source: 'admin', actorId: 99});
    assert.equal(v.status(h.srv.db.prepare('SELECT * FROM users WHERE id=?').get(id)).state, 'revoked');
  } finally { h.close(); }
});
