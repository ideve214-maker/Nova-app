// 管理员自己改密码：核对旧密码、校验强度、踢掉其他会话、写审计。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';

async function listen(app) {
  await new Promise(r => app.listen(0, '127.0.0.1', r));
  return 'http://127.0.0.1:' + app.address().port;
}
const call = async (base, m, p, body, tok) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  return {s: r.status, j: await r.json()};
};

const USER = 'ops_pwself';
const OLD = 'OpsOldPass1';
const NEW = 'OpsNewPass2';

test('未登录改密码返回 401', async () => {
  const srv = createApp({adminUsername: USER, adminPassword: OLD});
  const base = await listen(srv);
  try {
    const r = await call(base, 'POST', '/api/admin/me/password', {currentPassword: OLD, newPassword: NEW});
    assert.equal(r.s, 401);
    assert.equal(r.j.error.code, 'UNAUTHORIZED');
  } finally { srv.close(); }
});

test('原密码错误、新密码过弱会被拒绝；改密成功后旧会话失效、当前会话仍可用、新密码可登录、写入审计', async () => {
  const srv = createApp({adminUsername: USER, adminPassword: OLD});
  const base = await listen(srv);
  try {
    const a = await call(base, 'POST', '/api/admin/auth/login', {username: USER, password: OLD});
    const b = await call(base, 'POST', '/api/admin/auth/login', {username: USER, password: OLD});
    assert.equal(a.s, 200, JSON.stringify(a.j));
    assert.equal(b.s, 200, JSON.stringify(b.j));
    const t1 = a.j.token;
    const t2 = b.j.token;
    assert.ok(t1 && t2 && t1 !== t2);

    const wrong = await call(base, 'POST', '/api/admin/me/password', {currentPassword: 'WrongPass1', newPassword: NEW}, t1);
    assert.equal(wrong.s, 400, JSON.stringify(wrong.j));
    assert.equal(wrong.j.error.code, 'WRONG_PASSWORD');

    const weak = await call(base, 'POST', '/api/admin/me/password', {currentPassword: OLD, newPassword: 'abcdefgh'}, t1);
    assert.equal(weak.s, 400, JSON.stringify(weak.j));
    assert.equal(weak.j.error.code, 'WEAK_PASSWORD');

    const same = await call(base, 'POST', '/api/admin/me/password', {currentPassword: OLD, newPassword: OLD}, t1);
    assert.equal(same.s, 400, JSON.stringify(same.j));
    assert.equal(same.j.error.code, 'SAME_PASSWORD');

    const ok = await call(base, 'POST', '/api/admin/me/password', {currentPassword: OLD, newPassword: NEW}, t1);
    assert.equal(ok.s, 200, JSON.stringify(ok.j));
    assert.equal(ok.j.ok, true);
    const dumped = JSON.stringify(ok.j);
    assert.ok(!dumped.includes(OLD) && !dumped.includes(NEW));

    const other = await call(base, 'GET', '/api/admin/me', null, t2);
    assert.equal(other.s, 401, JSON.stringify(other.j));

    const me = await call(base, 'GET', '/api/admin/me', null, t1);
    assert.equal(me.s, 200, JSON.stringify(me.j));
    assert.equal(me.j.admin.username, USER);

    const oldLogin = await call(base, 'POST', '/api/admin/auth/login', {username: USER, password: OLD});
    assert.equal(oldLogin.s, 401);
    assert.equal(oldLogin.j.error.code, 'BAD_CREDENTIALS');

    const neu = await call(base, 'POST', '/api/admin/auth/login', {username: USER, password: NEW});
    assert.equal(neu.s, 200, JSON.stringify(neu.j));
    assert.equal(neu.j.admin.username, USER);

    const rows = srv.db.prepare("SELECT action,target,detail,actor_id FROM audit_log WHERE action='admin.self.change_password'").all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].target, 'admin:' + me.j.admin.id);
    assert.equal(rows[0].actor_id, me.j.admin.id);
    const detail = String(rows[0].detail || '');
    assert.ok(!detail.includes(OLD) && !detail.includes(NEW) && !/password/i.test(detail));
  } finally { srv.close(); }
});
