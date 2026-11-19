// 2.0.6 首页“平台概览”：总用户要和“用户管理”列表口径一致（不算已注销），活跃用户要是真的活跃（今日 / 7 日），不能等于总用户。
// 复现线上：users 表 7 行，其中 3 个已注销，列表只显示 4 个，且都很久没登录 → 以前首页显示 总用户 7、活跃用户 7。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';

const T = Date.parse('2026-11-19T15:30:00+08:00');
const DAY = 86400e3;
let srv, base, tok;
async function call(m, p, body) {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  return {s: r.status, j: await r.json().catch(() => null)};
}

test.before(async () => {
  srv = createApp({adminUsername: 'ops_stats', adminPassword: 'OpsUsrPass1', clock: () => T});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  tok = (await call('POST', '/api/admin/auth/login', {username: 'ops_stats', password: 'OpsUsrPass1'})).j.token;
  const ins = srv.db.prepare('INSERT INTO users(id,username,email,password_hash,role,status,created_at,last_login_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?)');
  const old = T - 30 * DAY, longAgo = T - 10 * DAY;
  // 1、6、7 已注销（管理员注销后 status='deleted'、deleted_at 有值）；2–5 是列表里的 4 个，都 10 天没登录
  ins.run(1, 'deleted_1', 'd1@x.test', 'x', 'user', 'deleted', old, longAgo, old + DAY);
  ins.run(2, 'vexo_dev', 'u2@x.test', 'x', 'user', 'active', old, longAgo, null);
  ins.run(3, 'test01', 'u3@x.test', 'x', 'user', 'active', old, longAgo, null);
  ins.run(4, 'ops_ideve', 'u4@x.test', 'x', 'user', 'active', old, longAgo, null);
  ins.run(5, 'jonsnow', 'u5@x.test', 'x', 'user', 'active', old, longAgo, null);
  ins.run(6, 'deleted_6', 'd6@x.test', 'x', 'user', 'deleted', old, T - 3600e3, old + DAY);
  ins.run(7, 'deleted_7', 'd7@x.test', 'x', 'user', 'active', old, null, old + DAY); // 只有 deleted_at 的旧数据也算已注销
});
test.after(() => srv.close());

test('7 行 / 列表 4 个、都没活跃：总用户 4，今日活跃 0，7 日活跃 0（以前是 7 / 7）', async () => {
  const list = await call('GET', '/api/admin/users?limit=100');
  const s = await call('GET', '/api/admin/stats');
  assert.equal(s.s, 200);
  assert.equal(list.j.users.length, 4);
  assert.equal(s.j.users.total, list.j.users.length, '总用户要和用户列表一致');
  assert.deepEqual([s.j.users.total, s.j.users.normal, s.j.users.deleted, s.j.users.activeToday, s.j.users.active7d, s.j.users.onlineNow], [4, 4, 3, 0, 0, 0]);
  assert.ok(s.j.field_meanings['users.activeToday'].includes('今天'));
});

test('活跃：今天登录过 / 3 天前打开过 App 才算；封禁的不算活跃但算总用户；已注销的最近登录也不算', async () => {
  srv.db.prepare('UPDATE users SET last_login_at=? WHERE id=3').run(T - 3600e3);                       // 今天登录
  srv.db.prepare("INSERT INTO user_presence(user_id,mode,visibility,last_seen,updated_at) VALUES(4,'online','friends',?,?)").run(T - 3 * DAY, T - 3 * DAY); // 3 天前在线
  srv.db.prepare("UPDATE users SET status='banned', last_login_at=? WHERE id=5").run(T - 60e3);       // 封禁
  srv.db.prepare("INSERT INTO user_presence(user_id,mode,visibility,last_seen,updated_at) VALUES(2,'online','friends',?,?)").run(T - 60e3, T - 60e3); // 刚刚在线
  const s = (await call('GET', '/api/admin/stats')).j.users;
  assert.deepEqual([s.total, s.normal, s.active, s.banned, s.activeToday, s.active7d, s.onlineNow], [4, 3, 3, 1, 2, 3, 1]);
  const list = await call('GET', '/api/admin/users?limit=100');
  assert.equal(list.j.users.length, s.total);
});

test('“今日”按上海时间 0 点切：昨天 23:59 登录的不算今日活跃，但算 7 日活跃', async () => {
  srv.db.prepare('UPDATE users SET last_login_at=? WHERE id=3').run(Date.parse('2026-11-18T23:59:00+08:00'));
  const s = (await call('GET', '/api/admin/stats')).j.users;
  assert.deepEqual([s.activeToday, s.active7d], [1, 3]);
});
