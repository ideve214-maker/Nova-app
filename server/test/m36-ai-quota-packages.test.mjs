// 2.0.8 线上问题：智谱账户从没充过现金（¥0.00），靠资源包 / 免费模型 glm-4-flash 运行；停用线 ¥1 时被误判“已用完·跳过”。
// 规则：先扣资源包 / 免费额度，用完才扣现金。用完 = 资源包用完 且 现金 ≤ 停用线（或服务商报错）。全部本地假接口。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createApp} from '../index.mjs';
import {ZHIPU_BALANCE_URL, ZHIPU_PACKAGES_URL, zhipuPackages, isZhipuFreeModel} from '../ai-quota.mjs';

const ENV_KEY = 'zhipu-env-key-NOT-REAL-0001';
const PAID_KEY = 'zhipu-paid-key-NOT-REAL-0002';
const OAI_KEY = 'sk-compat-NOT-REAL-0003';
let T = Date.parse('2026-11-19T16:20:00+08:00');
const adv = () => { T += 61e3; };
const json = (o, status = 200) => new Response(JSON.stringify(o), {status, headers: {'content-type': 'application/json'}});
// 每把密钥一个账户：现金（控制台余额接口）+ 资源包（tokenAccounts 接口）
const acct = {
  [ENV_KEY]: {cash: {availableBalance: 0, balance: 0, rechargeAmount: 0, giveAmount: 0, totalSpendAmount: 0, frozenBalance: 0}, packages: null},
  [PAID_KEY]: {cash: {availableBalance: 0, balance: 0, rechargeAmount: 0, giveAmount: 0, totalSpendAmount: 0, frozenBalance: 0}, packages: null},
};
const pkgRow = (tokenBalance, extra = {}) => ({id: 1, resourcePackageName: '新用户赠送 GLM 通用资源包', tokenBalance, status: 'EFFECTIVE', expirationTime: '2027-05-19 23:59:59', purchaseTime: '2026-05-19 10:00:00', suitableModel: 'GLM-4-Plus,GLM-4-Air', ...extra});
const hits = [];
async function fakeNet(url, init = {}) {
  const u = String(url), auth = (init.headers || {}).Authorization || '', key = auth.replace(/^Bearer /, '');
  if (u === ZHIPU_BALANCE_URL) { const a = acct[key]; return a ? json({code: 200, msg: '操作成功', success: true, data: a.cash}) : json({code: 1001, msg: '身份验证失败', success: false}); }
  if (u === ZHIPU_PACKAGES_URL) { const a = acct[key]; if (!a || a.packages === null) return json({error: 'not found'}, 404); return json({code: 200, msg: '操作成功', success: true, rows: a.packages, total: a.packages.length}); }
  if (u.endsWith('/chat/completions')) {
    const body = JSON.parse(init.body);
    hits.push(key);
    if (acct[key] && acct[key].fail) return json({error: {code: '1113', message: '您的账户已欠费，请充值后重试。'}}, 429);
    return json({choices: [{message: {role: 'assistant', content: '你好（' + body.model + '）'}}], usage: {prompt_tokens: 5, completion_tokens: 2, total_tokens: 7}});
  }
  return json({error: 'not found'}, 404);
}
const env = {AI_API_KEY: ENV_KEY, AI_API_BASE: 'https://open.bigmodel.cn/api/paas/v4', ADMIN_AI_KEY_SECRET: 'unit-test-secret'};
let srv, base, tok, paidId, compatId;
const texts = [];
async function call(m, p, body) {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  const text = await r.text(); texts.push(text); let j = null; try { j = JSON.parse(text); } catch {}
  return {s: r.status, j, text};
}
const chat = async () => { hits.length = 0; const r = await call('POST', '/api/admin/ai/chat', {text: '你好'}); return r; };
const item = async id => (await call('GET', '/api/admin/ai/quota')).j.providers.find(x => x.id === id);

test.before(async () => {
  srv = createApp({adminUsername: 'ops_pkg', adminPassword: 'OpsUsrPass1', clock: () => T, aiEnv: env, aiFetch: fakeNet, adminAiOpts: {fetchImpl: fakeNet}});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  tok = (await call('POST', '/api/admin/auth/login', {username: 'ops_pkg', password: 'OpsUsrPass1'})).j.token;
});
test.after(() => srv.close());

test('免费模型列表；资源包接口解析（只算有效的）', async () => {
  assert.ok(isZhipuFreeModel('glm-4-flash') && isZhipuFreeModel('GLM-4-Flash-250414') && isZhipuFreeModel('glm-z1-flash'));
  assert.ok(!isZhipuFreeModel('glm-4-plus') && !isZhipuFreeModel('glm-4-air'));
  const rows = await zhipuPackages({key: 'k', fetch: async () => json({code: 200, success: true, rows: [pkgRow(4_000_000), pkgRow(999, {status: 'EXPIRED'}), pkgRow(1_000_000, {resourcePackageName: '购买的资源包'})]})});
  assert.deepEqual(rows.map(r => r.remaining), [4_000_000, 1_000_000]);
  assert.equal(rows[0].unit, 'token');
  assert.ok(rows[0].expiresAt > Date.parse('2027-05-19T00:00:00+08:00'));
});

test('截图原样：智谱默认 glm-4-flash、现金 ¥0.00、充值+赠送 ¥0、停用线 ¥1、资源包估算 500 万 → 不跳过，照常调用', async () => {
  await call('POST', '/api/admin/ai/quota/env/settings', {stopBalance: 1, budgetTokens: 5_000_000, lowBalance: 10});
  adv();
  const r = await chat();
  assert.equal(r.s, 200, r.text);
  assert.match(r.j.reply, /glm-4-flash/);
  assert.deepEqual(hits, [ENV_KEY]);
  const q = await item('env');
  assert.equal(q.exhausted, false);
  assert.equal(q.cashApplies, false);
  assert.equal(q.balance, 0);
  assert.equal(q.low, false); assert.equal(q.empty, false);
  assert.equal(q.packageSource, 'estimated');
  assert.ok(q.packageTokens > 4_999_000);
  assert.equal(srv.db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='ai.provider.failover'").get().n, 0);
});

test('付费模型：资源包（实时）还有 → 现金 0 也不跳过；资源包用完 + 现金 0 → 跳过；有过现金但花完 → 跳过', async () => {
  paidId = (await call('POST', '/api/admin/ai/providers', {type: 'zhipu', name: '智谱 Plus', apiKey: PAID_KEY, model: 'glm-4-plus'})).j.savedId;
  compatId = (await call('POST', '/api/admin/ai/providers', {type: 'custom', name: '兼容备用', baseUrl: 'https://llm.example.com/v1', model: 'm-x', apiKey: OAI_KEY})).j.savedId;
  await call('POST', '/api/admin/ai/providers/order', {ids: [paidId, compatId, 'env']});
  await call('POST', `/api/admin/ai/quota/${paidId}/settings`, {stopBalance: 1});
  acct[PAID_KEY].packages = [pkgRow(2_000_000)];
  adv();
  let r = await chat();
  assert.match(r.j.reply, /glm-4-plus/, r.text);
  let q = await item(paidId);
  assert.deepEqual([q.exhausted, q.cashApplies, q.packageSource, q.packageTokens], [false, false, 'provider', 2_000_000]);
  assert.equal(q.resourcePackages[0].name, '新用户赠送 GLM 通用资源包');
  // 资源包用完，现金也是 0（以前充过 50 元，已花完）→ 用完，跳到下一家
  acct[PAID_KEY].packages = [pkgRow(0)];
  acct[PAID_KEY].cash = {availableBalance: 0, balance: 0, rechargeAmount: 50, giveAmount: 0, totalSpendAmount: 50};
  adv();
  r = await chat();
  assert.match(r.j.reply, /m-x/);
  q = await item(paidId);
  assert.deepEqual([q.exhausted, q.exhaustedReason, q.cashApplies], [true, 'packages_and_cash', true]);
  // 充了现金（高于停用线）→ 恢复
  acct[PAID_KEY].cash = {availableBalance: 20, balance: 20, rechargeAmount: 70, giveAmount: 0, totalSpendAmount: 50};
  adv();
  assert.match((await chat()).j.reply, /glm-4-plus/);
});

test('只靠现金计费：没有资源包、现金 0 → 跳过；资源包查不到 + 从没充过钱 → 判断不了，不提前跳过', async () => {
  acct[PAID_KEY].packages = [];
  acct[PAID_KEY].cash = {availableBalance: 0, balance: 0, rechargeAmount: 100, giveAmount: 0, totalSpendAmount: 100};
  adv();
  assert.match((await chat()).j.reply, /m-x/);
  acct[PAID_KEY].packages = null; // 资源包接口 404
  acct[PAID_KEY].cash = {availableBalance: 0, balance: 0, rechargeAmount: 0, giveAmount: 0, totalSpendAmount: 0};
  adv();
  assert.match((await chat()).j.reply, /glm-4-plus/);
  assert.equal((await item(paidId)).cashNote, 'no_cash_history');
});

test('“不按现金余额判断”开关：打开后只认服务商报错；报错 1113 仍然切换', async () => {
  acct[PAID_KEY].packages = [];
  acct[PAID_KEY].cash = {availableBalance: 0, balance: 0, rechargeAmount: 100, giveAmount: 0, totalSpendAmount: 100};
  adv();
  assert.match((await chat()).j.reply, /m-x/);
  const s = await call('POST', `/api/admin/ai/quota/${paidId}/settings`, {cashExempt: true});
  assert.equal(s.j.providers.find(x => x.id === paidId).cashExempt, true);
  assert.match((await chat()).j.reply, /glm-4-plus/);
  acct[PAID_KEY].fail = true;
  const r = await chat();
  assert.match(r.j.reply, /m-x/);
  assert.deepEqual(hits, [PAID_KEY, OAI_KEY]);
  acct[PAID_KEY].fail = false;
  await call('POST', `/api/admin/ai/quota/${paidId}/settings`, {cashExempt: false});
});

test('启动时清掉以前因“余额低于停用线”留下的已用完标记；报错留下的标记保留', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vexo-pkg-'));
  const dbPath = join(dir, 'x.db');
  const a = createApp({adminUsername: 'ops_pkg2', adminPassword: 'OpsUsrPass1', clock: () => T, aiEnv: env, aiFetch: fakeNet, adminAiOpts: {fetchImpl: fakeNet}, dbPath});
  a.db.prepare("INSERT INTO ai_quota_settings(provider,exhausted_at,exhausted_reason,updated_at) VALUES('env',?, 'balance', ?)").run(T, T);
  a.db.prepare("INSERT INTO ai_quota_settings(provider,exhausted_at,exhausted_reason,updated_at) VALUES('aiprov_x',?, 'zhipu_1113', ?)").run(T, T);
  a.close?.(); try { a.db.close(); } catch {}
  const b = createApp({adminUsername: 'ops_pkg2', adminPassword: 'OpsUsrPass1', clock: () => T, aiEnv: env, aiFetch: fakeNet, adminAiOpts: {fetchImpl: fakeNet}, dbPath});
  const rows = Object.fromEntries(b.db.prepare('SELECT provider, exhausted_reason FROM ai_quota_settings').all().map(r => [r.provider, r.exhausted_reason]));
  assert.equal(rows.env, null);
  assert.equal(rows.aiprov_x, 'zhipu_1113');
  try { b.db.close(); } catch {}
  void DatabaseSync;
});

test('不泄露密钥', () => {
  const all = texts.join('\n') + JSON.stringify(srv.db.prepare('SELECT * FROM audit_log').all());
  for (const k of [ENV_KEY, PAID_KEY, OAI_KEY]) assert.ok(!all.includes(k));
});
