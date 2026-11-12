// M2.4.2 VIP 状态 API：目录公开、状态由服务端按时间计算、客户端无法自行设置 VIP、到期自动回落。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createApp} from '../index.mjs';
import {hashPassword} from '../auth.mjs';
import {VIP_CONFIG as C} from '../vip-config.mjs';

const DAY = 864e5, T0 = Date.UTC(2026, 10, 12, 4, 0, 0);
let T = T0, srv, base;
test.before(async () => { srv = createApp({clock: () => T}); await new Promise(r => srv.listen(0, r)); base = 'http://127.0.0.1:' + srv.address().port; });
test.after(() => srv.close());
const call = async (m, p, body, tok, headers = {}) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...headers, ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  return {s: r.status, j: await r.json()};
};
let n = 0;
const mk = async () => { const u = 'vipuser_' + (++n); const r = await call('POST', '/api/auth/register', {username: u, email: u + '@x.com', password: 'Passw0rd123'}); return {id: r.j.user.id, tok: r.j.token, u}; };
const setVip = (id, until, since = null, source = 'admin') => srv.db.prepare('UPDATE users SET vip_until=?, vip_since=?, vip_source=? WHERE id=?').run(until, since, source, id);

test('目录公开可读：套餐、价格占位、权益表、到期规则，且不含用户信息', async () => {
  const r = await call('GET', '/api/vip/catalog');
  assert.equal(r.s, 200);
  const c = r.j;
  assert.equal(c.plans.basic.id, 'basic'); assert.equal(c.plans.vip.id, 'vip');
  assert.deepEqual(c.plans.vip.prices.map(p => p.label), ['¥9.9/月', '¥99/年']);
  assert.equal(c.plans.vip.purchase.enabled, true);
  assert.equal(c.plans.vip.purchase.provider, 'manual_qr');
  assert.ok(c.pay && c.pay.methods.some(m => m.enabled), '至少一种收款码可用');
  assert.match(c.plans.vip.purchase.reason, /管理员核对/);
  assert.doesNotMatch(c.plans.vip.priceNote, /暂定/);
  assert.match(c.plans.vip.priceNote, /¥9\.9/);
  assert.deepEqual(c.entitlements.map(e => e.key), Object.keys(C.entitlements));
  const saved = c.entitlements.find(e => e.key === 'personal_saved_items_plus');
  assert.equal(saved.basic, 20); assert.equal(saved.vip, 100); assert.equal(saved.status, 'live');
  assert.equal(c.expiry.soonDays, 3);
  assert.ok(c.alwaysFree.length >= 4);
  assert.ok(!JSON.stringify(c).includes('testGrantDays'), '不暴露内部测试授予天数');
});

test('/api/vip/me 需要登录', async () => {
  assert.equal((await call('GET', '/api/vip/me')).s, 401);
  assert.equal((await call('GET', '/api/vip/me', null, 'nv_bogus')).s, 401);
});

test('新用户：Basic / none，权益为免费额度，带服务器时间', async () => {
  const {tok} = await mk();
  const r = await call('GET', '/api/vip/me', null, tok);
  assert.equal(r.s, 200);
  assert.equal(r.j.now, T0);
  assert.deepEqual(r.j.vip, {plan: 'basic', state: 'none', active: false, since: null, until: null, daysLeft: null, expiringSoon: false, expiredAt: null, source: null});
  const e = r.j.entitlements;
  assert.deepEqual(e.vip_badge, {value: false, enabled: false});
  assert.deepEqual(e.personal_saved_items_plus, {value: 20, enabled: true});
  assert.deepEqual(e.longer_post_text.value, {post: 280, chat: 500, channel: 280});
  assert.deepEqual(e.media_quota_plus, {value: 200, enabled: true});
});

test('有效 VIP：返回套餐、开始/到期时间、剩余天数与 VIP 额度', async () => {
  const {id, tok} = await mk();
  setVip(id, T0 + 20 * DAY, T0 - 5 * DAY);
  const r = (await call('GET', '/api/vip/me', null, tok)).j;
  assert.equal(r.vip.plan, 'vip'); assert.equal(r.vip.state, 'active'); assert.equal(r.vip.active, true);
  assert.equal(r.vip.since, T0 - 5 * DAY); assert.equal(r.vip.until, T0 + 20 * DAY);
  assert.equal(r.vip.daysLeft, 20); assert.equal(r.vip.expiringSoon, false); assert.equal(r.vip.source, 'admin');
  assert.deepEqual(r.entitlements.vip_badge, {value: true, enabled: true});
  assert.deepEqual(r.entitlements.personal_saved_items_plus, {value: 100, enabled: true});
  assert.deepEqual(r.entitlements.longer_post_text.value, {post: 1000, chat: 1500, channel: 800});
  assert.deepEqual(r.entitlements.media_quota_plus, {value: 2048, enabled: true});
  const me = (await call('GET', '/api/me', null, tok)).j.user;
  assert.equal(me.vip, true); assert.equal(me.vipUntil, T0 + 20 * DAY);
});

test('到期由服务端按时间自动回落 Basic（不需要任何人操作）', async () => {
  const {id, tok} = await mk();
  setVip(id, T + 2 * 3600e3, T - DAY);                       // 2 小时后到期
  assert.equal((await call('GET', '/api/vip/me', null, tok)).j.vip.state, 'expiring');
  T += 3 * 3600e3;                                           // 时间走到到期之后
  try {
    const r = (await call('GET', '/api/vip/me', null, tok)).j;
    assert.equal(r.vip.plan, 'basic'); assert.equal(r.vip.state, 'expired'); assert.equal(r.vip.active, false);
    assert.equal(r.vip.until, null); assert.ok(r.vip.expiredAt < T);
    assert.deepEqual(r.entitlements.vip_badge, {value: false, enabled: false});
    assert.equal(r.entitlements.personal_saved_items_plus.value, 20);
    const me = (await call('GET', '/api/me', null, tok)).j.user;
    assert.equal(me.vip, false); assert.equal(me.vipUntil, null);
  } finally { T = T0; }
});

test('客户端无法自行设置 VIP：多余字段、伪造头部、写接口一律无效', async () => {
  const r = await call('POST', '/api/auth/register', {username: 'sneaky_1', email: 's1@x.com', password: 'Passw0rd123', vip: true, vip_until: T0 + 999 * DAY, vipUntil: T0 + 999 * DAY, role: 'admin'},
    null, {'X-Nova-Vip': '1', 'X-Vip': 'true'});
  assert.equal(r.s, 200); assert.equal(r.j.user.vip, false); assert.equal(r.j.user.role, 'user');
  const tok = r.j.token;
  const row = srv.db.prepare('SELECT vip_until, vip_since, vip_source, role FROM users WHERE username=?').get('sneaky_1');
  assert.deepEqual({...row}, {vip_until: null, vip_since: null, vip_source: null, role: 'user'});
  for (const [m, p] of [['POST', '/api/vip/me'], ['PUT', '/api/vip/me'], ['PATCH', '/api/me'], ['POST', '/api/me'], ['POST', '/api/vip/grant'], ['POST', '/api/vip/set']]) {
    const x = await call(m, p, {vip: true, vipUntil: T0 + 999 * DAY, vip_until: T0 + 999 * DAY, plan: 'vip'}, tok, {'X-Vip': '1'});
    assert.ok([404, 405].includes(x.s), `${m} ${p} 应被拒绝，实际 ${x.s}`);
  }
  assert.equal((await call('GET', '/api/vip/me?plan=vip&vip=1', null, tok, {'X-Vip': '1'})).j.vip.plan, 'basic');
  // 改密码接口带上 VIP 字段也不会生效
  await call('POST', '/api/me/password', {oldPassword: 'Passw0rd123', newPassword: 'Passw0rd456', vip_until: T0 + 999 * DAY}, tok);
  assert.equal(srv.db.prepare('SELECT vip_until FROM users WHERE username=?').get('sneaky_1').vip_until, null);
});

test('迁移 002：历史用户（只有 vip_until）升级后仍按到期时间正确判断', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nova-m24-')), path = join(dir, 'legacy.db');
  const old = new DatabaseSync(path);
  old.exec(readFileSync(new URL('../migrations/001_users.sql', import.meta.url), 'utf8'));
  old.exec('CREATE TABLE schema_migrations(name TEXT PRIMARY KEY, at INTEGER)');
  old.prepare('INSERT INTO schema_migrations VALUES(?,?)').run('001_users.sql', 1);
  const ins = old.prepare('INSERT INTO users(username,email,password_hash,vip_until,created_at) VALUES(?,?,?,?,?)');
  ins.run('old_vip', 'ov@x.com', hashPassword('Passw0rd123'), T0 + 10 * DAY, 1);
  ins.run('old_exp', 'oe@x.com', hashPassword('Passw0rd123'), T0 - DAY, 1);
  old.close();
  const s2 = createApp({dbPath: path, clock: () => T0});
  try {
    const cols = s2.db.prepare("SELECT name FROM pragma_table_info('users')").all().map(c => c.name);
    assert.ok(cols.includes('vip_since') && cols.includes('vip_source'));
    assert.ok(s2.db.prepare("SELECT name FROM sqlite_master WHERE name='vip_events'").get());
    const a = s2.vip.status(s2.db.prepare('SELECT * FROM users WHERE username=?').get('old_vip'));
    assert.equal(a.state, 'active'); assert.equal(a.since, null); assert.equal(a.source, null);
    assert.equal(s2.vip.status(s2.db.prepare('SELECT * FROM users WHERE username=?').get('old_exp')).state, 'expired');
  } finally { s2.db.close(); }
});
