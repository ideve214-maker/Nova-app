// M2.6.4 登录设备/会话列表：只返回自己的会话；敏感字段脱敏。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';
import {maskIp, deviceOf} from '../profile.mjs';

let srv, base;
test.before(async () => { srv = createApp(); await new Promise(r => srv.listen(0, r)); base = 'http://127.0.0.1:' + srv.address().port; });
test.after(() => srv.close());
const call = async (m, p, body, tok, headers = {}) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...headers, ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  return {s: r.status, j: await r.json()};
};
let n = 0;
const mk = async () => { const u = 'ss_' + (++n); const r = await call('POST', '/api/auth/register', {username: u, email: u + '@x.com', password: 'Passw0rd123'}); return {id: r.j.user.id, tok: r.j.token, u}; };

test('脱敏辅助：IPv4 末段打码，IPv6 截断；UA 归类为设备名', () => {
  assert.equal(maskIp('192.168.1.105'), '192.168.1.*');
  assert.equal(maskIp('::ffff:10.0.0.8'), '::ffff:10.0.0.*');
  assert.ok(maskIp('2001:db8:85a3::8a2e:370:7334').endsWith(':*'));
  assert.ok(!maskIp('2001:db8:85a3::8a2e:370:7334').includes('7334'));
  assert.equal(maskIp(''), '');
  assert.equal(deviceOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), 'iPhone');
  assert.equal(deviceOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'Windows');
  assert.equal(deviceOf('Mozilla/5.0 (X11; Linux x86_64)'), 'Linux');
});

test('只返回当前账号自己的会话；id 不是令牌或哈希前缀；不含原始 IP 和 UA；标记当前设备', async () => {
  const a = await mk(), b = await mk();
  const t2 = (await call('POST', '/api/auth/login', {account: a.u, password: 'Passw0rd123'}, null, {'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)'})).j.token;
  const list = await call('GET', '/api/me/sessions', null, a.tok);
  assert.equal(list.s, 200);
  assert.ok(list.j.sessions.length >= 2);
  const cur = list.j.sessions.find(s => s.current);
  const other = list.j.sessions.find(s => !s.current);
  assert.ok(cur && other);
  assert.ok(cur.id.startsWith('ss_'));
  const raw = JSON.stringify(list.j);
  assert.ok(!raw.includes(a.tok), '响应不得含原始令牌');
  assert.ok(!raw.includes(t2), '响应不得含其他设备令牌');
  // 令牌哈希也不应出现
  const hashes = srv.db.prepare('SELECT token_hash, ip, ua FROM sessions WHERE user_id=?').all(a.id);
  for (const h of hashes) {
    assert.ok(!raw.includes(h.token_hash), '不得返回令牌哈希');
    assert.ok(!raw.includes(h.token_hash.slice(0, 12)), '不得返回哈希前缀');
    if (h.ip && /^\d+\.\d+\.\d+\.\d+$/.test(h.ip)) assert.ok(!raw.includes(h.ip), '原始 IP 必须打码');
  }
  assert.ok(!('ua' in cur) && !('token' in cur) && !('token_hash' in cur));
  assert.ok(['ip', 'device', 'id', 'current', 'createdAt'].every(k => k in cur));
  // B 看不到 A
  const listB = await call('GET', '/api/me/sessions', null, b.tok);
  assert.ok(listB.j.sessions.every(s => s.id !== cur.id && s.id !== other.id));
  assert.equal((await call('GET', '/api/me/sessions')).s, 401);
});
