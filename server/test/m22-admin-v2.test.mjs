// 管理端 2.0：编辑资料、粉丝加成、标签、站内通知、注销、AI 助理日报。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';
import {shanghaiDayRange, localReport, DELETE_CONFIRM} from '../admin-v2.mjs';

let srv, base, seq = 0, adminTok;
test.before(async () => {
  srv = createApp({adminUsername: 'ops_v2', adminPassword: 'OpsUsrPass1'});
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  const login = await call('POST', '/api/admin/auth/login', {username: 'ops_v2', password: 'OpsUsrPass1'});
  adminTok = login.j.token;
});
test.after(() => srv.close());

const call = async (m, p, body, tok) => {
  const r = await fetch(base + p, {
    method: m,
    headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})},
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null;
  try { j = await r.json(); } catch { j = null; }
  return {s: r.status, j};
};
const AH = () => adminTok;
async function acc(n) {
  const u = n + (++seq);
  const r = await call('POST', '/api/auth/register', {agree: true, username: u, email: u + '@x.test', password: 'Passw0rd123'});
  assert.equal(r.s, 200, JSON.stringify(r.j));
  return {tok: r.j.token, id: r.j.user.id, u};
}

test('shanghaiDayRange 按上海时区切天', () => {
  const r = shanghaiDayRange('2026-11-15');
  assert.equal(r.date, '2026-11-15');
  assert.equal(r.end - r.start, 86400e3);
  // 上海 11-15 00:00 = UTC 11-14 16:00
  assert.equal(r.start, Date.UTC(2026, 10, 14, 16, 0, 0));
  const loc = localReport({date: '2026-11-15', newUsers: 2, newPosts: 3});
  assert.match(loc, /2026-11-15/);
  assert.match(loc, /新注册 2/);
});

test('管理员可以编辑资料，并设置增加粉丝数（展示 = 真实 + 加成）', async () => {
  const a = await acc('pf');
  const b = await acc('flw');
  await call('POST', '/api/follows', {userId: a.id}, b.tok);
  const edit = await call('POST', '/api/admin/users/' + a.id + '/profile', {displayName: '小测试', bio: '你好 VEXO'}, AH());
  assert.equal(edit.s, 200, JSON.stringify(edit.j));
  assert.equal(edit.j.user.displayName, '小测试');
  assert.equal(edit.j.user.bio, '你好 VEXO');
  const bonus = await call('POST', '/api/admin/users/' + a.id + '/follower-bonus', {bonus: 100}, AH());
  assert.equal(bonus.s, 200, JSON.stringify(bonus.j));
  assert.equal(bonus.j.user.followerBonus, 100);
  assert.equal(bonus.j.user.followerCountReal, 1);
  assert.equal(bonus.j.user.followerCount, 101);
  const counts = await call('GET', '/api/follows?kind=followers&user=' + a.id, null, b.tok);
  assert.equal(counts.s, 200, JSON.stringify(counts.j));
  assert.equal(counts.j.followerCount, 101);
  const bad = await call('POST', '/api/admin/users/' + a.id + '/follower-bonus', {bonus: -1}, AH());
  assert.equal(bad.s, 400);
});

test('用户标签：添加、按标签筛选、批量删除', async () => {
  const a = await acc('tagA');
  const b = await acc('tagB');
  const add = await call('POST', '/api/admin/users/' + a.id + '/tags', {tag: '测试账号'}, AH());
  assert.equal(add.s, 200, JSON.stringify(add.j));
  assert.ok(add.j.user.tags.includes('测试账号'));
  await call('POST', '/api/admin/users/' + b.id + '/tags', {tag: '测试账号'}, AH());
  await call('POST', '/api/admin/users/' + b.id + '/tags', {tag: '内部'}, AH());
  const list = await call('GET', '/api/admin/users?tag=' + encodeURIComponent('测试账号'), null, AH());
  assert.equal(list.s, 200);
  const ids = (list.j.users || []).map((u) => u.id);
  assert.ok(ids.includes(a.id) && ids.includes(b.id));
  const tags = await call('GET', '/api/admin/tags', null, AH());
  assert.equal(tags.s, 200);
  assert.ok(tags.j.presets.includes('测试账号'));
  const row = tags.j.tags.find((t) => t.tag === '测试账号');
  assert.ok(row && row.count >= 2);
  const bulk = await call('POST', '/api/admin/tags/bulk-delete', {tag: '测试账号'}, AH());
  assert.equal(bulk.s, 200, JSON.stringify(bulk.j));
  assert.ok(bulk.j.removed >= 2);
  const after = await call('GET', '/api/admin/users/' + a.id, null, AH());
  assert.deepEqual(after.j.user.tags || [], []);
  const still = await call('GET', '/api/admin/users/' + b.id, null, AH());
  assert.deepEqual(still.j.user.tags, ['内部']);
});

test('发送通知：单人与全体，用户能在通知列表里看到', async () => {
  const a = await acc('ntfA');
  const b = await acc('ntfB');
  const one = await call('POST', '/api/admin/users/' + a.id + '/notify', {title: '系统', body: '请更新资料'}, AH());
  assert.equal(one.s, 200, JSON.stringify(one.j));
  assert.equal(one.j.sent, 1);
  const mine = await call('GET', '/api/notifications', null, a.tok);
  assert.equal(mine.s, 200, JSON.stringify(mine.j));
  const items = mine.j.notifications || mine.j.items || mine.j.list || [];
  assert.ok(items.some((n) => String(n.body || n.text || '').includes('请更新资料')), JSON.stringify(mine.j));
  const all = await call('POST', '/api/admin/notifications', {title: '全体', body: '今晚维护，请互相转告'}, AH());
  assert.equal(all.s, 200, JSON.stringify(all.j));
  assert.ok(all.j.sent >= 2);
  const bList = await call('GET', '/api/notifications', null, b.tok);
  const bItems = bList.j.notifications || bList.j.items || bList.j.list || [];
  assert.ok(bItems.some((n) => String(n.body || n.text || '').includes('今晚维护')), JSON.stringify(bList.j));
  const empty = await call('POST', '/api/admin/users/' + a.id + '/notify', {body: 'x'}, AH());
  assert.equal(empty.s, 400);
});

test('注销账号需要两次确认（确认删除 + 用户名），之后无法登录', async () => {
  const a = await acc('delu');
  const miss = await call('POST', '/api/admin/users/' + a.id + '/delete', {}, AH());
  assert.equal(miss.s, 400);
  const half = await call('POST', '/api/admin/users/' + a.id + '/delete', {confirm: DELETE_CONFIRM}, AH());
  assert.equal(half.s, 400);
  const wrong = await call('POST', '/api/admin/users/' + a.id + '/delete', {confirm: DELETE_CONFIRM, confirmUsername: 'not-this'}, AH());
  assert.equal(wrong.s, 400);
  const ok = await call('POST', '/api/admin/users/' + a.id + '/delete', {confirm: DELETE_CONFIRM, confirmUsername: a.u}, AH());
  assert.equal(ok.s, 200, JSON.stringify(ok.j));
  assert.equal(ok.j.deleted, true);
  const login = await call('POST', '/api/auth/login', {account: a.u, password: 'Passw0rd123'});
  assert.ok(login.s === 401 || login.s === 404, '注销后不能登录 ' + login.s + JSON.stringify(login.j));
  const listed = await call('GET', '/api/admin/users', null, AH());
  assert.ok(!(listed.j.users || []).some((u) => u.id === a.id));
  const gone = await call('GET', '/api/admin/users?status=deleted', null, AH());
  assert.ok((gone.j.users || []).some((u) => u.id === a.id));
});

test('AI 助理日报：无密钥时返回本地汇总，服务商标识为智谱；拒绝 DeepSeek', async () => {
  const r = await call('POST', '/api/admin/ai-assistant/report', {date: '2026-11-15'}, AH());
  assert.equal(r.s, 200, JSON.stringify(r.j));
  assert.equal(r.j.providerLabel, '智谱');
  assert.equal(r.j.model, 'glm-4-flash');
  assert.equal(r.j.source, 'local');
  assert.ok(r.j.report && r.j.report.includes('2026-11-15'));
  assert.ok(r.j.stats && r.j.stats.timezone === 'Asia/Shanghai');
  const peek = await call('GET', '/api/admin/ai-assistant/report?date=2026-11-15', null, AH());
  assert.equal(peek.s, 200);
  assert.equal(peek.j.providerLabel, '智谱');

  // 用带 DeepSeek 的环境单独起一个服务，生成日报应退回本地并标记不允许
  const blocked = createApp({
    adminUsername: 'ops_ds', adminPassword: 'OpsUsrPass1',
    aiEnv: {AI_API_BASE: 'https://api.deepseek.com/v1', AI_MODEL: 'deepseek-chat', AI_API_KEY: 'sk-test'},
  });
  await new Promise((cb) => blocked.listen(0, '127.0.0.1', cb));
  const bbase = 'http://127.0.0.1:' + blocked.address().port;
  const login = await fetch(bbase + '/api/admin/auth/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({username: 'ops_ds', password: 'OpsUsrPass1'})});
  const tok = (await login.json()).token;
  const g = await fetch(bbase + '/api/admin/ai-assistant/report', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + tok}, body: JSON.stringify({date: '2026-11-15'})});
  const gj = await g.json();
  assert.equal(g.status, 200, JSON.stringify(gj));
  assert.equal(gj.source, 'local');
  assert.equal(gj.error, 'provider_not_allowed');
  blocked.close();
});
