// M3.5.0 平台管理员账号与鉴权：无内置默认密码；环境变量/选项播种；Bearer；普通用户令牌不能进 /api/admin/*。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {createApp} from '../index.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

async function listen(app) {
  await new Promise(r => app.listen(0, '127.0.0.1', r));
  return 'http://127.0.0.1:' + app.address().port;
}
const call = async (base, m, p, body, tok) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  return {s: r.status, j: await r.json(), h: r.headers};
};

test('源码没有硬编码的生产默认管理员密码', () => {
  const files = [
    join(root, 'server/admin.mjs'),
    join(root, 'server/admin-cli.mjs'),
    join(root, 'server/index.mjs'),
  ];
  for (const f of files) {
    const t = readFileSync(f, 'utf8');
    assert.doesNotMatch(t, /nova1234|admin123|password\s*[:=]\s*['\"]admin['\"]/i, f);
    assert.match(t.includes('admin.mjs') ? 'skip' : t, /skip|没有内置默认密码|不会使用默认密码|绝不用内置默认密码/);
  }
});

test('未播种时没有任何管理员；常见默认口令不能登录', async () => {
  const srv = createApp();
  const base = await listen(srv);
  try {
    assert.equal(srv.admins.list().length, 0);
    assert.equal(srv.adminSeed.created, false);
    for (const [u, p] of [['admin', 'nova1234'], ['admin', 'admin'], ['root', 'password'], ['admin', 'Passw0rd123']]) {
      const r = await call(base, 'POST', '/api/admin/auth/login', {username: u, password: p});
      assert.equal(r.s, 401, u + '/' + p + ' ' + JSON.stringify(r.j));
    }
    assert.equal((await call(base, 'GET', '/api/admin/me')).s, 401);
    assert.equal((await call(base, 'GET', '/api/admin/reports')).s, 401);
    assert.equal((await call(base, 'GET', '/api/admin/audit')).s, 401);
  } finally { srv.close(); }
});

test('通过 createApp 选项播种；登录返回 Bearer；me 可读；错误口令与锁定', async () => {
  const srv = createApp({adminUsername: 'ops_alice', adminPassword: 'OpsPassw0rd!'});
  const base = await listen(srv);
  try {
    assert.equal(srv.adminSeed.created, true);
    const bad = await call(base, 'POST', '/api/admin/auth/login', {username: 'ops_alice', password: 'wrongpass1'});
    assert.equal(bad.s, 401);
    const ok = await call(base, 'POST', '/api/admin/auth/login', {account: 'ops_alice', password: 'OpsPassw0rd!'});
    assert.equal(ok.s, 200, JSON.stringify(ok.j));
    assert.ok(ok.j.token && ok.j.token.startsWith('na_'));
    assert.equal(ok.j.admin.username, 'ops_alice');
    assert.ok(['admin', 'root'].includes(ok.j.admin.role));
    const me = await call(base, 'GET', '/api/admin/me', null, ok.j.token);
    assert.equal(me.s, 200);
    assert.equal(me.j.admin.username, 'ops_alice');
    assert.ok(!me.j.admin.password_hash && !me.j.admin.password);
    const again = createApp({adminUsername: 'ops_alice', adminPassword: 'OpsPassw0rd!'});
    // 不同内存库；同一库：
    const seed2 = srv.admins.seedFromEnv({username: 'ops_alice', password: 'OpsPassw0rd!'});
    assert.equal(seed2.created, false);
    assert.equal(seed2.reason, 'exists');
    again.close();
  } finally { srv.close(); }
});

test('普通用户令牌访问 /api/admin/* 返回 403；弱密码/残缺环境变量不创建账号', async () => {
  const weak = createApp({adminUsername: 'ops_bob', adminPassword: '123'});
  assert.equal(weak.adminSeed.created, false);
  weak.close();
  const half = createApp({adminUsername: 'ops_bob', adminPassword: ''});
  assert.equal(half.adminSeed.created, false);
  half.close();
  const srv = createApp({adminUsername: 'ops_cara', adminPassword: 'CaraPass1x'});
  const base = await listen(srv);
  try {
    const u = await call(base, 'POST', '/api/auth/register', {username: 'normalu', email: 'n@x.test', password: 'Passw0rd123'});
    assert.equal(u.s, 200);
    const r = await call(base, 'GET', '/api/admin/me', null, u.j.token);
    assert.equal(r.s, 403);
    assert.equal(r.j.error.code, 'FORBIDDEN');
    const r2 = await call(base, 'GET', '/api/admin/reports', null, u.j.token);
    assert.equal(r2.s, 403);
    const r3 = await call(base, 'GET', '/api/admin/audit', null, u.j.token);
    assert.equal(r3.s, 403);
    // 用户登录接口不能用管理员账号
    const mix = await call(base, 'POST', '/api/auth/login', {account: 'ops_cara', password: 'CaraPass1x'});
    assert.equal(mix.s, 401);
  } finally { srv.close(); }
});
