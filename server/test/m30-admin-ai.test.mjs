// 管理端 AI 助手：服务端强制确认、只读免确认、钱相关拦截、过期 / 单次 / 本人确认、审计。
// 智谱接口全部用本地假实现（fetchImpl），不会访问外网，也不需要真实密钥。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';
import {TOOLS, MONEY_PATH, SYSTEM, isConfirmText, isCancelText, redactForLlm, PENDING_TTL_MS} from '../admin-ai.mjs';

let T = Date.now();
const script = [];            // 每次调用 /chat/completions 依次取一个函数 (body) => message
const seen = [];              // 记录发给模型的请求体
const llm = async (url, init) => {
  const u = String(url);
  if (!u.endsWith('/chat/completions')) return new Response('{}', {status: 404});
  const body = JSON.parse(init.body); seen.push(body);
  const f = script.shift();
  const message = f ? f(body) : {role: 'assistant', content: '好的'};
  return new Response(JSON.stringify({choices: [{message}]}), {status: 200, headers: {'content-type': 'application/json'}});
};
const tc = (name, args) => () => ({role: 'assistant', content: '', tool_calls: [{id: 'c' + Math.random(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]});
const say = (text) => () => ({role: 'assistant', content: text});

let srv, base, tokA, tokA2, tokB;
test.before(async () => {
  srv = createApp({
    adminUsername: 'ops_ai', adminPassword: 'OpsUsrPass1', clock: () => T,
    aiEnv: {AI_API_KEY: 'test-key-not-real', AI_API_BASE: 'http://zhipu.mock/api/paas/v4'},
    aiFetch: async () => { throw new Error('offline'); },
    adminAiOpts: {
      fetchImpl: llm,
    },
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  srv.admins.create({username: 'ops_b', password: 'OpsUsrPass2'});
  tokA = (await call('POST', '/api/admin/auth/login', {username: 'ops_ai', password: 'OpsUsrPass1'})).j.token;
  tokA2 = (await call('POST', '/api/admin/auth/login', {username: 'ops_ai', password: 'OpsUsrPass1'})).j.token;
  tokB = (await call('POST', '/api/admin/auth/login', {username: 'ops_b', password: 'OpsUsrPass2'})).j.token;
});
test.after(() => srv.close());

async function call(m, p, body, tok) {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  let j = null; try { j = await r.json(); } catch {}
  return {s: r.status, j};
}
let seq = 0;
async function user() {
  const u = 'aiu' + (++seq);
  const r = await call('POST', '/api/auth/register', {agree: true, username: u, email: u + '@x.test', password: 'Passw0rd123'});
  assert.equal(r.s, 200, JSON.stringify(r.j));
  return {id: r.j.user.id, u};
}
const audits = (action) => srv.db.prepare('SELECT * FROM audit_log WHERE action=? ORDER BY id').all(action);
const status = (id) => srv.db.prepare('SELECT status FROM users WHERE id=?').get(id).status;

test('工具登记里没有任何付款 / 退款 / 推流订单工具，执行路径也会再拦一次', () => {
  for (const [name, t] of TOOLS) {
    assert.doesNotMatch(name, /pay|refund|boost|order/i);
    if (t.kind === 'write') {
      const sample = {userId: 1, id: 1, postId: 1, days: 1, bonus: 0, badge: 'none', tag: 'x', body: 'hello', title: 't', word: 'w', action: 'reject', type: 'post'};
      try { const b = t.build(sample); assert.doesNotMatch(b.path, MONEY_PATH, name); } catch (e) { assert.ok(e.code, name); }
    }
  }
  assert.match('/api/admin/payments/abc/refund', MONEY_PATH);
  assert.match('/api/admin/boost/orders/1/confirm', MONEY_PATH);
  assert.doesNotMatch('/api/admin/users/1/ban', MONEY_PATH);
  assert.ok(isConfirmText('确认') && isConfirmText('中！') && !isConfirmText('确认封禁 18'));
  assert.ok(isCancelText('算了') && !isCancelText('确认'));
  assert.deepEqual(redactForLlm({user: {id: 1, email: 'a@b', ip: '1.2.3.4', username: 'x'}}), {user: {id: 1, username: 'x'}});
});

test('未登录不能用；状态接口说明已配置', async () => {
  assert.equal((await call('GET', '/api/admin/ai/status')).s, 401);
  const st = await call('GET', '/api/admin/ai/status', null, tokA);
  assert.equal(st.s, 200);
  assert.equal(st.j.configured, true);
  assert.equal(st.j.moneyBlocked, true);
});

test('只读查询直接执行、不需要确认，且发给模型的数据去掉了邮箱', async () => {
  const u = await user();
  script.push(tc('get_user', {userId: u.id}), say('查到了'));
  const n = seen.length;
  const r = await call('POST', '/api/admin/ai/chat', {text: '看看 ' + u.id + ' 号用户'}, tokA);
  assert.equal(r.s, 200, JSON.stringify(r.j));
  assert.equal(r.j.pending, null);
  assert.equal(r.j.reply, '查到了');
  const toolMsg = seen[n + 1].messages.find((m) => m.role === 'tool');
  assert.ok(toolMsg && toolMsg.content.includes(u.u));
  assert.ok(!toolMsg.content.includes('@x.test'), '邮箱不应发给模型');
});

test('写操作：模型只能提出，服务端核对目标并生成确认话术；不确认就不会执行', async () => {
  const u = await user();
  script.push(tc('ban_user', {userId: u.id, reason: '发广告'}));
  const r = await call('POST', '/api/admin/ai/chat', {text: '把 ID ' + u.id + ' 的账号封了'}, tokA);
  assert.equal(r.s, 200, JSON.stringify(r.j));
  assert.ok(r.j.pending && r.j.pending.id.startsWith('aip_'));
  assert.match(r.j.reply, new RegExp('确认把 ID ' + u.id + ' 的账号封了吗？'));
  assert.match(r.j.reply, new RegExp(u.u));
  assert.equal(status(u.id), 'active', '提出后不能直接执行');
  assert.ok(audits('admin.ai.proposed').some((a) => a.target === 'ai_pending:' + r.j.pending.id));
  const row = srv.db.prepare('SELECT * FROM admin_ai_pending WHERE id=?').get(r.j.pending.id);
  assert.equal(row.expires_at - row.created_at, PENDING_TTL_MS);
  assert.equal(row.path, '/api/admin/users/' + u.id + '/ban');

  // 别的管理员、同一管理员的另一个登录令牌，都不能确认
  const other = await call('POST', '/api/admin/ai/confirm', {id: r.j.pending.id}, tokB);
  assert.equal(other.s, 403);
  const otherTok = await call('POST', '/api/admin/ai/confirm', {id: r.j.pending.id}, tokA2);
  assert.equal(otherTok.s, 403);
  assert.equal((await call('POST', '/api/admin/ai/confirm', {id: r.j.pending.id})).s, 401);
  assert.equal(status(u.id), 'active');
  assert.ok(audits('admin.ai.denied').length >= 2);

  // 本人确认后执行；同一条不能再确认（一次性）
  const ok = await call('POST', '/api/admin/ai/confirm', {id: r.j.pending.id}, tokA);
  assert.equal(ok.s, 200, JSON.stringify(ok.j));
  assert.equal(ok.j.executed, true);
  assert.equal(status(u.id), 'banned');
  const again = await call('POST', '/api/admin/ai/confirm', {id: r.j.pending.id}, tokA);
  assert.equal(again.s, 409);
  for (const a of ['admin.ai.confirmed', 'admin.ai.executed']) assert.ok(audits(a).some((x) => x.target === 'ai_pending:' + r.j.pending.id), a);
  // 底层接口自己的审计也照常写入（与手动操作一致）
  assert.ok(audits('admin.user.ban').some((x) => x.target === 'user:' + u.id));
});

test('确认时按提出时存下的请求原样执行，确认请求里夹带的参数无效', async () => {
  const u = await user();
  script.push(tc('grant_vip', {userId: u.id, days: 30, reason: '活动奖励'}));
  const r = await call('POST', '/api/admin/ai/chat', {text: '给 ' + u.id + ' 开 30 天会员'}, tokA);
  assert.ok(r.j.pending, JSON.stringify(r.j));
  const ok = await call('POST', '/api/admin/ai/confirm', {id: r.j.pending.id, days: 3650, userId: 1, path: '/api/admin/payments/x/refund'}, tokA);
  assert.equal(ok.s, 200, JSON.stringify(ok.j));
  const until = srv.db.prepare('SELECT vip_until FROM users WHERE id=?').get(u.id).vip_until;
  const days = Math.round((until - T) / 86400e3);
  assert.ok(days >= 29 && days <= 31, 'vip 天数应为 30，实际 ' + days);
});

test('语音说“确认”（带上待确认 id）同样走服务端确认；“算了”会取消', async () => {
  const u = await user();
  script.push(tc('ban_user', {userId: u.id}));
  const r = await call('POST', '/api/admin/ai/chat', {text: '封了 ' + u.id}, tokA);
  const v = await call('POST', '/api/admin/ai/chat', {text: '确认', pendingId: r.j.pending.id}, tokA);
  assert.equal(v.s, 200, JSON.stringify(v.j));
  assert.equal(v.j.executed, true);
  assert.equal(status(u.id), 'banned');

  script.push(tc('unban_user', {userId: u.id}));
  const r2 = await call('POST', '/api/admin/ai/chat', {text: '解封 ' + u.id}, tokA);
  const c = await call('POST', '/api/admin/ai/chat', {text: '算了', pendingId: r2.j.pending.id}, tokA);
  assert.equal(c.j.cancelled, true);
  assert.equal((await call('POST', '/api/admin/ai/confirm', {id: r2.j.pending.id}, tokA)).s, 409);
  assert.equal(status(u.id), 'banned');
  assert.ok(audits('admin.ai.cancelled').some((x) => x.target === 'ai_pending:' + r2.j.pending.id));
  // 别人的令牌拿着 id 说“确认”也不行
  script.push(tc('unban_user', {userId: u.id}));
  const r3 = await call('POST', '/api/admin/ai/chat', {text: '解封 ' + u.id}, tokA);
  assert.equal((await call('POST', '/api/admin/ai/chat', {text: '确认', pendingId: r3.j.pending.id}, tokB)).s, 403);
  assert.equal(status(u.id), 'banned');
});

test('超过 5 分钟未确认就过期，不能再执行，并记录过期', async () => {
  const u = await user();
  script.push(tc('ban_user', {userId: u.id}));
  const r = await call('POST', '/api/admin/ai/chat', {text: '封 ' + u.id}, tokA);
  T += PENDING_TTL_MS + 1000;
  const late = await call('POST', '/api/admin/ai/confirm', {id: r.j.pending.id}, tokA);
  assert.ok([409, 410].includes(late.s), String(late.s));
  assert.match(late.j.error.message, /过期/);
  assert.equal(status(u.id), 'active');
  assert.ok(audits('admin.ai.expired').some((x) => x.target === 'ai_pending:' + r.j.pending.id));
});

test('目标不存在时不生成待确认操作；涉及钱的工具名直接拦截', async () => {
  script.push(tc('ban_user', {userId: 987654}));
  const r = await call('POST', '/api/admin/ai/chat', {text: '封 987654'}, tokA);
  assert.equal(r.j.pending, null);
  assert.match(r.j.reply, /用户不存在/);

  script.push(tc('refund_payment', {id: 'p1'}));
  const m = await call('POST', '/api/admin/ai/chat', {text: '给订单 p1 退款'}, tokA);
  assert.equal(m.j.pending, null);
  assert.match(m.j.reply, /不能由 AI 代办/);
  assert.ok(audits('admin.ai.blocked').length >= 1);
  assert.equal(srv.db.prepare("SELECT COUNT(*) n FROM admin_ai_pending WHERE path LIKE '%pay%'").get().n, 0);
});

test('get_stats 区分累计总数与今日/24小时/7日新增；提示词禁止把总数当成今日数据或猜测', async () => {
  const before = await call('GET', '/api/admin/stats', null, tokA);
  assert.equal(before.s, 200, JSON.stringify(before.j));
  assert.ok(typeof before.j.users.total === 'number');
  assert.equal(before.j.users_total, before.j.users.total);
  assert.equal(before.j.timezone, 'Asia/Shanghai');
  assert.ok(before.j.windows && before.j.windows.today && before.j.windows.last_24h && before.j.windows.last_7d);
  assert.match(before.j.field_meanings.users_total, /不是今日新增/);

  const t = T;
  const sh = new Date(t + 8 * 3600e3);
  const todayStart = Date.UTC(sh.getUTCFullYear(), sh.getUTCMonth(), sh.getUTCDate()) - 8 * 3600e3;
  assert.ok(t >= todayStart + 2000, '测试时钟应落在当天开始之后');
  const todayA = t - 2000, todayB = t - 1000;
  const yesterday = todayStart - 3600e3;
  const tenDays = todayStart - 10 * 86400e3;

  const insUser = (name, at) => srv.db.prepare('INSERT INTO users(username,email,password_hash,created_at) VALUES(?,?,?,?)').run(name, name + '@stats.test', 'x', at);
  insUser('stat_today_a', todayA);
  insUser('stat_today_b', todayB);
  insUser('stat_yday', yesterday);
  insUser('stat_old', tenDays);
  const author = srv.db.prepare("SELECT id FROM users WHERE username='stat_today_a'").get().id;
  const insPost = (id, at) => srv.db.prepare('INSERT INTO posts(id,author_id,text,created_at,updated_at) VALUES(?,?,?,?,?)').run(id, author, 'stats', at, at);
  insPost('p_stat_today_a', todayA);
  insPost('p_stat_today_b', todayB);
  insPost('p_stat_yday', yesterday);
  insPost('p_stat_old', tenDays);
  const insRep = (id, at) => srv.db.prepare("INSERT INTO reports(id,reporter_id,target_type,target_id,reason,status,created_at) VALUES(?,?,?,?,?,'pending',?)").run(id, author, 'user', String(author), 'spam', at);
  insRep('r_stat_today', todayA);
  insRep('r_stat_yday', yesterday);

  const after = await call('GET', '/api/admin/stats', null, tokA);
  assert.equal(after.s, 200, JSON.stringify(after.j));
  assert.equal(after.j.users_total, before.j.users.total + 4);
  assert.equal(after.j.users_total, after.j.users.total);
  assert.equal(after.j.new_users_today, before.j.new_users_today + 2);
  assert.equal(after.j.new_users_24h, before.j.new_users_24h + 3);
  assert.equal(after.j.new_users_7d, before.j.new_users_7d + 3);
  assert.equal(after.j.new_posts_today, before.j.new_posts_today + 2);
  assert.equal(after.j.new_posts_24h, before.j.new_posts_24h + 3);
  assert.equal(after.j.new_posts_7d, before.j.new_posts_7d + 3);
  assert.equal(after.j.new_reports_today, before.j.new_reports_today + 1);
  assert.equal(after.j.new_reports_24h, before.j.new_reports_24h + 2);
  assert.notEqual(after.j.new_users_today, after.j.users_total, '今日新增不得等于累计总数');
  assert.ok(after.j.new_users_today < after.j.users_total);
  assert.equal(after.j.timezone, 'Asia/Shanghai');
  assert.equal(after.j.windows.today.start, todayStart);
  assert.ok('payments' in after.j && 'comments' in after.j && 'reports' in after.j);

  assert.match(SYSTEM, /不要猜测/);
  assert.match(SYSTEM, /不是每日新增/);
  assert.match(TOOLS.get('get_stats').desc, /不是今日新增|绝不是今日新增/);

  script.push(tc('get_stats', {}), say('今天（上海时间 00:00 起）新增用户以 new_users_today 为准，不是累计总数。'));
  const n = seen.length;
  const r = await call('POST', '/api/admin/ai/chat', {text: '今天有多少新用户'}, tokA);
  assert.equal(r.s, 200, JSON.stringify(r.j));
  const sysMsg = seen[n].messages.find((m) => m.role === 'system');
  assert.ok(sysMsg, '应把系统提示词发给模型');
  assert.match(sysMsg.content, /不要猜测/);
  assert.match(sysMsg.content, /不是每日新增|累计总数/);
  const toolMsg = seen[n + 1].messages.find((m) => m.role === 'tool');
  assert.ok(toolMsg && toolMsg.content.includes('new_users_today'), toolMsg && toolMsg.content.slice(0, 200));
  const payload = JSON.parse(toolMsg.content);
  assert.equal(payload.new_users_today, after.j.new_users_today);
  assert.equal(payload.users_total, after.j.users_total);
  assert.notEqual(payload.new_users_today, payload.users_total);
  assert.equal(payload.timezone, 'Asia/Shanghai');
});
