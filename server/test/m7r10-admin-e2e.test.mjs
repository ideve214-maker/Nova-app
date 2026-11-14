// r10：管理端能管住用户端——每个管理按钮对应的接口在用户侧真的生效。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';

let srv, base, seq = 0, adm;
test.before(async () => {
  srv = createApp({adminUsername: 'ops_r10', adminPassword: 'OpsR10Pass1!'});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  const r = await call('POST', '/api/admin/auth/login', {username: 'ops_r10', password: 'OpsR10Pass1!'});
  assert.equal(r.s, 200, JSON.stringify(r.j));
  adm = r.j.token;
});
test.after(() => srv.close());
const call = async (m, p, body, tok) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  let j = null; try { j = await r.json(); } catch {}
  return {s: r.status, j};
};
async function acc(n) {
  const u = n + (++seq);
  const r = await call('POST', '/api/auth/register', {agree: true, username: u, email: u + '@x.test', password: 'Passw0rd123'});
  assert.equal(r.s, 200, JSON.stringify(r.j));
  return {tok: r.j.token, id: r.j.user.id, u};
}

test('封禁：会话失效、不能登录；解封后可以登录', async () => {
  const a = await acc('ban');
  assert.equal((await call('POST', '/api/admin/users/' + a.id + '/ban', {reason: '刷屏'}, adm)).s, 200);
  assert.equal((await call('GET', '/api/me', null, a.tok)).s, 401);
  assert.notEqual((await call('POST', '/api/auth/login', {account: a.u, password: 'Passw0rd123'})).s, 200);
  assert.equal((await call('POST', '/api/admin/users/' + a.id + '/unban', {}, adm)).s, 200);
  assert.equal((await call('POST', '/api/auth/login', {account: a.u, password: 'Passw0rd123'})).s, 200);
});

test('删除内容：帖子从用户端消失', async () => {
  const a = await acc('del');
  const p = await call('POST', '/api/posts', {text: '要被删的帖子', visibility: 'public'}, a.tok);
  assert.equal(p.s, 200, JSON.stringify(p.j));
  const id = p.j.post.id;
  const d = await call('POST', '/api/admin/content/post/' + id + '/delete', {reason: '违规'}, adm);
  assert.equal(d.s, 200, JSON.stringify(d.j));
  const g = await call('GET', '/api/posts/' + id, null, a.tok);
  assert.ok(g.s === 404 || (g.j && g.j.post && (g.j.post.deleted || g.j.post.hidden)), JSON.stringify(g));
});

test('社区禁言：用户不能发言；解除后恢复', async () => {
  const own = await acc('cmo'), mem = await acc('cmm');
  const cm = (await call('POST', '/api/communities', {name: '禁言社' + seq, description: ''}, own.tok)).j.community;
  const ch = cm.channels.find(c => c.kindKey === 'text');
  await call('POST', '/api/communities/' + cm.id + '/join', {}, mem.tok);
  const m = await call('POST', '/api/admin/communities/' + cm.id + '/members/' + mem.id + '/mute', {reason: '刷屏', hours: 2}, adm);
  assert.equal(m.s, 200, JSON.stringify(m.j));
  assert.equal((await call('POST', '/api/channels/' + ch.id + '/messages', {text: '还能说话吗'}, mem.tok)).s, 403);
  assert.equal((await call('POST', '/api/admin/communities/' + cm.id + '/members/' + mem.id + '/unmute', {}, adm)).s, 200);
  assert.equal((await call('POST', '/api/channels/' + ch.id + '/messages', {text: '恢复了'}, mem.tok)).s, 200);
});

test('屏蔽词：昵称、社区名、频道消息都拦截', async () => {
  const a = await acc('bw');
  assert.equal((await call('POST', '/api/admin/blockwords', {word: '违禁名'}, adm)).s, 200);
  const prof = await call('POST', '/api/me/profile', {displayName: '我是违禁名'}, a.tok);
  assert.ok(prof.s === 400 || prof.s === 422, JSON.stringify(prof));
  const cm = await call('POST', '/api/communities', {name: '违禁名小组', description: ''}, a.tok);
  assert.ok(cm.s === 400 || cm.s === 422, JSON.stringify(cm));
  const ok = (await call('POST', '/api/communities', {name: '正常小组' + seq, description: ''}, a.tok)).j.community;
  const ch = ok.channels.find(c => c.kindKey === 'text');
  const msg = await call('POST', '/api/channels/' + ch.id + '/messages', {text: '含有违禁名的话'}, a.tok);
  assert.ok(msg.s === 400 || msg.s === 422, JSON.stringify(msg));
});

test('维护模式：用户写操作被拒、读取正常；关闭后恢复', async () => {
  const a = await acc('mt');
  assert.equal((await call('POST', '/api/admin/flags', {maintenance: true, maintenanceMessage: '升级中'}, adm)).s, 200);
  const st = await call('GET', '/api/app/status');
  assert.equal(st.j.maintenance, true);
  const w = await call('POST', '/api/posts', {text: '维护时发帖', visibility: 'public'}, a.tok);
  assert.equal(w.s, 503);
  assert.equal((await call('GET', '/api/me', null, a.tok)).s, 200);
  assert.equal((await call('POST', '/api/admin/flags', {maintenance: false}, adm)).s, 200);
  assert.equal((await call('POST', '/api/posts', {text: '维护后发帖', visibility: 'public'}, a.tok)).s, 200);
});

test('会员：管理员开通后用户端显示会员', async () => {
  const a = await acc('vip');
  const g = await call('POST', '/api/admin/vip/grant', {userId: a.id, days: 30, reason: '活动奖励'}, adm);
  assert.equal(g.s, 200, JSON.stringify(g.j));
  const me = await call('GET', '/api/vip/me', null, a.tok);
  assert.equal(me.s, 200, JSON.stringify(me.j));
  assert.ok(JSON.stringify(me.j).includes('true'), JSON.stringify(me.j));
});

test('公告：发布后用户能读到', async () => {
  const a = await acc('ann');
  const r = await call('POST', '/api/admin/announcements', {title: 'r10 公告', body: '今晚更新', published: true}, adm);
  assert.equal(r.s, 200, JSON.stringify(r.j));
  const list = await call('GET', '/api/announcements/current', null, a.tok);
  assert.equal(list.s, 200, JSON.stringify(list.j));
  assert.ok(JSON.stringify(list.j).includes('r10 公告'));
});
