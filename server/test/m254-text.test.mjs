// M2.5.4 发帖/发言长度：前端额度与服务端一致；超长被拒；到期回落 Basic。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';

const DAY = 864e5, T0 = Date.UTC(2026, 10, 12, 12, 0, 0);
let T = T0, srv, base;
test.before(async () => { srv = createApp({clock: () => T}); await new Promise(r => srv.listen(0, r)); base = 'http://127.0.0.1:' + srv.address().port; });
test.after(() => srv.close());
const call = async (m, p, body, tok) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  return {s: r.status, j: await r.json()};
};
let n = 0;
const mk = async () => { const u = 'tx_' + (++n); const r = await call('POST', '/api/auth/register', {username: u, email: u + '@x.com', password: 'Passw0rd123'}); return {id: r.j.user.id, tok: r.j.token}; };
const setVip = (id, until) => srv.db.prepare('UPDATE users SET vip_until=?, vip_since=?, vip_source=? WHERE id=?').run(until, T0, 'admin', id);

test('需要登录；空内容和未知 scope 被拒', async () => {
  assert.equal((await call('POST', '/api/content/check', {scope: 'post', text: 'hi'})).s, 401);
  const {tok} = await mk();
  assert.equal((await call('POST', '/api/content/check', {scope: 'post', text: ''}, tok)).j.error.code, 'EMPTY_TEXT');
  assert.equal((await call('POST', '/api/content/check', {scope: 'nope', text: 'hi'}, tok)).j.error.code, 'BAD_SCOPE');
});

test('Basic：动态 280、聊天 500、频道 280；刚好通过，多 1 字 403 TEXT_TOO_LONG，并提示 VIP 上限；按码点计', async () => {
  const {tok} = await mk();
  const ok = await call('POST', '/api/content/check', {scope: 'post', text: '啊'.repeat(280)}, tok);
  assert.equal(ok.s, 200); assert.equal(ok.j.ok, true); assert.equal(ok.j.length, 280); assert.equal(ok.j.limit, 280); assert.equal(ok.j.plan, 'basic');
  const over = await call('POST', '/api/content/check', {scope: 'post', text: '啊'.repeat(281)}, tok);
  assert.equal(over.s, 403); assert.equal(over.j.error.code, 'TEXT_TOO_LONG');
  assert.equal(over.j.error.limit, 280); assert.equal(over.j.error.length, 281); assert.equal(over.j.error.upgrade, true);
  assert.match(over.j.error.message, /1000/);
  // emoji 按码点：280 个 😀 通过（UTF-16 长度是 560）
  const smile = '😀'.repeat(280);
  assert.equal(smile.length, 560);
  assert.equal((await call('POST', '/api/content/check', {scope: 'post', text: smile}, tok)).s, 200);
  assert.equal((await call('POST', '/api/content/check', {scope: 'chat', text: 'x'.repeat(500)}, tok)).j.limit, 500);
  assert.equal((await call('POST', '/api/content/check', {scope: 'chat', text: 'x'.repeat(501)}, tok)).j.error.limit, 500);
  assert.equal((await call('POST', '/api/content/check', {scope: 'channel', text: 'x'.repeat(280)}, tok)).s, 200);
  assert.equal((await call('POST', '/api/content/check', {scope: 'channel', text: 'x'.repeat(281)}, tok)).s, 403);
});

test('VIP：动态 1000、聊天 1500、频道 800；到期后同一令牌立刻回落 Basic，已发长文不受接口删除（本接口只检查新内容）', async () => {
  T = T0;
  const {id, tok} = await mk();
  setVip(id, T0 + 2 * DAY);
  const long = '字'.repeat(1000);
  const ok = await call('POST', '/api/content/check', {scope: 'post', text: long}, tok);
  assert.equal(ok.s, 200); assert.equal(ok.j.limit, 1000); assert.equal(ok.j.plan, 'vip');
  assert.equal((await call('POST', '/api/content/check', {scope: 'post', text: '字'.repeat(1001)}, tok)).j.error.limit, 1000);
  assert.equal((await call('POST', '/api/content/check', {scope: 'chat', text: 'x'.repeat(1500)}, tok)).s, 200);
  assert.equal((await call('POST', '/api/content/check', {scope: 'channel', text: 'x'.repeat(800)}, tok)).s, 200);
  T = T0 + 2 * DAY;
  const exp = await call('POST', '/api/content/check', {scope: 'post', text: '字'.repeat(281)}, tok);
  assert.equal(exp.s, 403); assert.equal(exp.j.error.limit, 280); assert.equal(exp.j.error.plan, 'basic');
  // 夹带别人身份无效
  const {tok: b} = await mk();
  const sneak = await call('POST', '/api/content/check', {scope: 'post', text: '字'.repeat(281), userId: id}, b);
  assert.equal(sneak.s, 403);
  T = T0;
});
