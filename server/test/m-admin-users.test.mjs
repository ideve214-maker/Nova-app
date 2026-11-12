// 管理端用户封禁 / 解禁 / 重置密码与 VIP 授予撤销。路径对齐 Agen。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';

let srv, base, seq = 0, adminTok;
test.before(async () => {
  srv = createApp({adminUsername: 'ops_usr', adminPassword: 'OpsUsrPass1'});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  const login = await call('POST', '/api/admin/auth/login', {username: 'ops_usr', password: 'OpsUsrPass1'});
  adminTok = login.j.token;
});
test.after(() => srv.close());
const call = async (m, p, body, tok) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  return {s: r.status, j: await r.json()};
};
const AH = () => adminTok;
async function acc(n) {
  const u = n + (++seq);
  const r = await call('POST', '/api/auth/register', {agree:true, username: u, email: u + '@x.test', password: 'Passw0rd123'});
  return {tok: r.j.token, id: r.j.user.id, u};
}

test('GET /api/admin/users 列出用户，字段可被 Agen mapRemoteUser 识别', async () => {
  const a = await acc('listed');
  const r = await call('GET', '/api/admin/users', null, AH());
  assert.equal(r.s, 200, JSON.stringify(r.j));
  const u = r.j.users.find(x => x.id === a.id);
  assert.ok(u);
  assert.equal(u.username, a.u);
  assert.ok(u.displayName || u.name);
  assert.equal(u.status, 'active');
  assert.equal(u.banned, false);
  assert.ok('vipUntil' in u || 'vip_until' in u);
  const one = await call('GET', '/api/admin/users/' + a.id, null, AH());
  assert.equal(one.s, 200);
  assert.equal(one.j.user.id, a.id);
});

test('封禁后登录、令牌、发帖均被拒绝；解禁后恢复', async () => {
  const a = await acc('toban');
  const ban = await call('POST', '/api/admin/users/' + a.id + '/ban', {reason: '刷广告'}, AH());
  assert.equal(ban.s, 200, JSON.stringify(ban.j));
  assert.equal(ban.j.user.status, 'banned');
  assert.equal(ban.j.user.banned, true);

  const login = await call('POST', '/api/auth/login', {account: a.u, password: 'Passw0rd123'});
  assert.equal(login.s, 403);
  assert.equal(login.j.error.code, 'BANNED');

  const me = await call('GET', '/api/me', null, a.tok);
  assert.ok(me.s === 401 || me.s === 403, '封禁后旧令牌不可用 ' + me.s);
  const post = await call('POST', '/api/posts', {text: '封禁后不该发出'}, a.tok);
  assert.ok(post.s === 401 || post.s === 403);

  const un = await call('POST', '/api/admin/users/' + a.id + '/unban', {reason: '已申诉'}, AH());
  assert.equal(un.s, 200);
  assert.equal(un.j.user.status, 'active');
  const login2 = await call('POST', '/api/auth/login', {account: a.u, password: 'Passw0rd123'});
  assert.equal(login2.s, 200, JSON.stringify(login2.j));
  const post2 = await call('POST', '/api/posts', {text: '解禁后可以发'}, login2.j.token);
  assert.equal(post2.s, 200, JSON.stringify(post2.j));
});

test('重置密码返回临时密码并要求修改，旧密码失效', async () => {
  const a = await acc('rpw');
  const r = await call('POST', '/api/admin/users/' + a.id + '/reset-password', {}, AH());
  assert.equal(r.s, 200, JSON.stringify(r.j));
  assert.ok(r.j.temporaryPassword);
  assert.equal(r.j.mustChangePw, true);
  const old = await call('POST', '/api/auth/login', {account: a.u, password: 'Passw0rd123'});
  assert.equal(old.s, 401);
  const neu = await call('POST', '/api/auth/login', {account: a.u, password: r.j.temporaryPassword});
  assert.equal(neu.s, 200, JSON.stringify(neu.j));
  assert.equal(neu.j.user.mustChangePw, true);
});

test('VIP 授予与撤销：需要原因；封禁账号不能开通；写入审计', async () => {
  const a = await acc('vipu');
  const noReason = await call('POST', '/api/admin/vip/grant', {userId: a.id, days: 30}, AH());
  assert.equal(noReason.s, 400);
  const g = await call('POST', '/api/admin/vip/grant', {userId: a.id, days: 30, reason: '活动赠送'}, AH());
  assert.equal(g.s, 200, JSON.stringify(g.j));
  assert.equal(g.j.user.vip, true);
  assert.ok(g.j.user.vipUntil > Date.now());
  const me = await call('GET', '/api/vip/me', null, a.tok);
  assert.equal(me.j.vip.active, true);

  const rv = await call('POST', '/api/admin/vip/revoke', {userId: a.id, reason: '违规'}, AH());
  assert.equal(rv.s, 200);
  assert.equal(rv.j.user.vip, false);
  const me2 = await call('GET', '/api/vip/me', null, a.tok);
  assert.equal(me2.j.vip.active, false);

  const b = await acc('vipban');
  await call('POST', '/api/admin/users/' + b.id + '/ban', {reason: '封'}, AH());
  const bad = await call('POST', '/api/admin/vip/grant', {userId: b.id, days: 7, reason: '不行'}, AH());
  assert.equal(bad.s, 409);

  const audit = await call('GET', '/api/admin/audit?action=admin.', null, AH());
  const acts = audit.j.audits.map(x => x.action);
  assert.ok(acts.includes('admin.vip.grant'));
  assert.ok(acts.includes('admin.vip.revoke'));
  assert.ok(acts.includes('admin.user.ban'));
});

test('GET /api/admin/stats 与 announcements 可用', async () => {
  const s = await call('GET', '/api/admin/stats', null, AH());
  assert.equal(s.s, 200, JSON.stringify(s.j));
  assert.ok(s.j.users.total >= 0);
  assert.ok('payments' in s.j);
  const a = await call('GET', '/api/admin/announcements', null, AH());
  assert.equal(a.s, 200);
  assert.ok(Array.isArray(a.j.announcements));
  const add = await call('POST', '/api/admin/announcements', {title: '维护', body: '今晚维护'}, AH());
  assert.equal(add.s, 200);
  assert.ok(add.j.announcements.some(x => x.title === '维护'));
});
