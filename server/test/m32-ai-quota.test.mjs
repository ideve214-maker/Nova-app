// 2.0.7 AI 额度面板 + AI 服务商切换：各家余额接口适配器（全部是本地假接口，不访问外网、不需要真实密钥）、
// 缓存、用量统计、估算剩余、密钥加密与打码（任何接口都不返回完整密钥）、切换当前服务商、联网搜索退回智谱、审计、AI 助手不能代调。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';
import {BALANCE_ADAPTERS, meterFetch, testProvider, ZHIPU_BALANCE_URL} from '../ai-quota.mjs';
import {createKeyBox, maskKey, PROVIDER_TYPES} from '../ai-providers.mjs';

const ENV_KEY = 'zhipu-env-key-NOT-REAL-1234';
const MOON_KEY = 'sk-moonshot-NOT-REAL-abcd';
const OAI_KEY = 'sk-openai-compat-NOT-REAL-wxyz';
let T = Date.parse('2026-11-19T15:00:00+08:00');
const hits = [];
let zhipuBalance = 42.5;
const json = (o, status = 200) => new Response(JSON.stringify(o), {status, headers: {'content-type': 'application/json'}});

// 假的“外网”：按网址返回各家接口的样子
async function fakeNet(url, init = {}) {
  const u = String(url), auth = (init.headers || {}).Authorization || '';
  hits.push({url: u, auth});
  if (u === ZHIPU_BALANCE_URL) {
    if (auth !== 'Bearer ' + ENV_KEY) return json({code: 1001, msg: 'Header中未收到Authorization参数，无法进行身份验证。', success: false});
    return json({code: 200, msg: '操作成功', success: true, data: {balance: zhipuBalance + 2.5, availableBalance: zhipuBalance, rechargeAmount: 100, giveAmount: 20, totalSpendAmount: 77.5, frozenBalance: 2.5}});
  }
  if (u === 'https://api.moonshot.cn/v1/users/me/balance') {
    if (auth !== 'Bearer ' + MOON_KEY) return json({error: {message: 'Incorrect API key provided'}}, 401);
    return json({code: 0, data: {available_balance: 3.21, voucher_balance: 1, cash_balance: 2.21}, status: true});
  }
  if (u.endsWith('/chat/completions')) {
    const body = JSON.parse(init.body);
    if (body.tools && body.tools[0] && body.tools[0].type === 'web_search') {
      return json({choices: [{message: {role: 'assistant', content: ''}}], web_search: [{title: '测试店', link: 'https://shop.example.com/', content: 'x', media: 'm'}], usage: {prompt_tokens: 20, completion_tokens: 5, total_tokens: 25}});
    }
    if (body.max_tokens === 1) return auth.includes('bad') ? json({error: {message: 'invalid key ' + auth.slice(7)}}, 401) : json({choices: [{message: {role: 'assistant', content: 'p'}}], usage: {prompt_tokens: 3, completion_tokens: 1, total_tokens: 4}});
    return json({choices: [{message: {role: 'assistant', content: '你好（' + body.model + '）'}}], usage: {prompt_tokens: 100, completion_tokens: 50, total_tokens: 150}});
  }
  return json({error: 'not found'}, 404);
}

let srv, base, tok;
async function call(m, p, body, t = tok) {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(t ? {Authorization: 'Bearer ' + t} : {})}, body: body ? JSON.stringify(body) : undefined});
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch {}
  return {s: r.status, j, text};
}
const tick = () => new Promise(r => setTimeout(r, 20));
const audits = a => srv.db.prepare('SELECT * FROM audit_log WHERE action=? ORDER BY id').all(a);
const noKeys = text => { for (const k of [ENV_KEY, MOON_KEY, OAI_KEY]) assert.ok(!text.includes(k), '响应里出现了完整密钥'); };

test.before(async () => {
  srv = createApp({adminUsername: 'ops_quota', adminPassword: 'OpsUsrPass1', clock: () => T,
    aiEnv: {AI_API_KEY: ENV_KEY, AI_API_BASE: 'https://open.bigmodel.cn/api/paas/v4', ADMIN_AI_KEY_SECRET: 'unit-test-secret'},
    aiFetch: fakeNet, adminAiOpts: {fetchImpl: fakeNet}});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  tok = (await call('POST', '/api/admin/auth/login', {username: 'ops_quota', password: 'OpsUsrPass1'}, null)).j.token;
});
test.after(() => srv.close());

// ---------- 适配器（单元）
const f1 = (status, body) => async () => json(body, status);
test('智谱适配器：控制台余额接口 → 可用余额 / 已用 / 充值+赠送；code 1001 视为密钥无效；非官方地址不查', async () => {
  const r = await BALANCE_ADAPTERS.zhipu({base: 'https://open.bigmodel.cn/api/paas/v4', key: 'k-123456789', fetch: f1(200, {code: 200, success: true, data: {balance: 45, availableBalance: 40, rechargeAmount: 100, giveAmount: 20, totalSpendAmount: 77.5, frozenBalance: 5}})});
  assert.deepEqual([r.balance, r.currency, r.totalGranted, r.used, r.detail.frozen], [40, 'CNY', 120, 77.5, 5]);
  await assert.rejects(BALANCE_ADAPTERS.zhipu({base: 'https://open.bigmodel.cn/api/paas/v4', key: 'k', fetch: f1(200, {code: 1001, msg: '身份验证失败', success: false})}), /密钥无效/);
  await assert.rejects(BALANCE_ADAPTERS.zhipu({base: 'http://zhipu.mock/api', key: 'k', fetch: f1(200, {})}), /不是智谱官方/);
  const seen = [];
  await BALANCE_ADAPTERS.zhipu({base: 'http://zhipu.mock/api', key: 'k', env: {ZHIPU_BALANCE_URL: 'https://bal.example/x'}, fetch: async u => { seen.push(u); return json({code: 200, data: {availableBalance: 1}}); }});
  assert.deepEqual(seen, ['https://bal.example/x', 'https://bigmodel.cn/api/biz/tokenAccounts/list?filterEnabled=true&pageNum=1&pageSize=50']);
});
test('DeepSeek / Kimi / 硅基流动 / OpenRouter 适配器', async () => {
  const urls = [];
  const rec = body => async (u) => { urls.push(String(u)); return json(body); };
  const d = await BALANCE_ADAPTERS.deepseek({base: 'https://api.deepseek.com/v1', key: 'k', fetch: rec({is_available: true, balance_infos: [{currency: 'USD', total_balance: '1.00'}, {currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00'}]})});
  assert.deepEqual([d.balance, d.currency, d.detail.granted], [110, 'CNY', 10]);
  const m = await BALANCE_ADAPTERS.moonshot({base: 'https://api.moonshot.cn/v1', key: 'k', fetch: rec({data: {available_balance: 49.58894, voucher_balance: 46.58893, cash_balance: 3.00001}})});
  assert.deepEqual([m.balance, m.currency, m.detail.voucher], [49.59, 'CNY', 46.59]);
  const s = await BALANCE_ADAPTERS.siliconflow({base: 'https://api.siliconflow.cn/v1', key: 'k', fetch: rec({code: 20000, data: {balance: '0.88', chargeBalance: '88.00', totalBalance: '88.88'}})});
  assert.deepEqual([s.balance, s.detail.charged], [88.88, 88]);
  const o = await BALANCE_ADAPTERS.openrouter({base: 'https://openrouter.ai/api/v1', key: 'k', fetch: async u => json(String(u).endsWith('/credits') ? {data: {total_credits: 10, total_usage: 2.5}} : {data: {limit: null, usage: 2.5, limit_remaining: null}})});
  assert.deepEqual([o.balance, o.currency, o.totalGranted, o.used], [7.5, 'USD', 10, 2.5]);
  const o2 = await BALANCE_ADAPTERS.openrouter({base: 'https://openrouter.ai/api/v1', key: 'k', fetch: async u => (String(u).endsWith('/credits') ? json({error: 'forbidden'}, 403) : json({data: {limit: 5, usage: 1, limit_remaining: 4}}))});
  assert.deepEqual([o2.balance, o2.detail.scope], [4, 'key']);
  assert.deepEqual(urls, ['https://api.deepseek.com/user/balance', 'https://api.moonshot.cn/v1/users/me/balance', 'https://api.siliconflow.cn/v1/user/info']);
  await assert.rejects(BALANCE_ADAPTERS.siliconflow({base: 'https://api.siliconflow.cn/v1', key: 'k', fetch: f1(410, {})}), /停用余额接口/);
  await assert.rejects(BALANCE_ADAPTERS.moonshot({base: 'https://api.moonshot.cn/v1', key: 'k', fetch: f1(401, {})}), /密钥无效/);
});
test('密钥加密与打码：密文里看不到原文，换了加密密钥就解不开', () => {
  const a = createKeyBox({secret: 's1'}), b = createKeyBox({secret: 's2'});
  const sealed = a.seal(MOON_KEY);
  assert.ok(!sealed.includes(MOON_KEY) && sealed.startsWith('v1:'));
  assert.equal(a.open(sealed), MOON_KEY);
  assert.equal(b.open(sealed), null);
  assert.equal(maskKey(MOON_KEY), 'sk-…abcd');
  assert.equal(maskKey('short'), '****');
  assert.ok(PROVIDER_TYPES.find(t => t.type === 'deepseek').blocked);
});
test('meterFetch：只记对话 / 联网搜索，记 token 数；失败也记一行', async () => {
  const rows = [];
  const mf = meterFetch(async (u) => (String(u).includes('fail') ? json({}, 500) : json({usage: {prompt_tokens: 7, completion_tokens: 3, total_tokens: 10}})), {record: r => rows.push(r), attribute: () => 'p1'});
  await (await mf('https://x.example/v1/chat/completions', {method: 'POST', body: JSON.stringify({model: 'm1'})})).json();
  await mf('https://x.example/v1/models');
  await mf('https://x.example/fail/chat/completions', {method: 'POST', body: JSON.stringify({model: 'm1', tools: [{type: 'web_search'}]})});
  await tick();
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => [r.kind, r.ok, r.total]), [['web_search', 0, undefined], ['chat', 1, 10]].sort((x, y) => (x[0] < y[0] ? -1 : 1)));
});
test('testProvider：错误信息里不带密钥', async () => {
  const r = await testProvider({base: 'https://x.example/v1', key: 'sk-bad-NOT-REAL-9999', model: 'm'}, {fetchImpl: fakeNet});
  assert.equal(r.ok, false);
  assert.match(r.error, /密钥无效/);
  assert.ok(!r.error.includes('sk-bad-NOT-REAL-9999'));
});

// ---------- 接口（集成）
test('额度接口：要管理员登录；服务器默认智谱显示实时余额（打码密钥），60 秒缓存，?refresh=1 10 秒内不重复查', async () => {
  assert.equal((await call('GET', '/api/admin/ai/quota', null, null)).s, 401);
  hits.length = 0;
  const r = await call('GET', '/api/admin/ai/quota');
  assert.equal(r.s, 200); noKeys(r.text);
  const env = r.j.providers.find(p => p.id === 'env');
  assert.deepEqual([env.source, env.balance, env.currency, env.used, env.totalGranted, env.active, env.search, env.keyMasked], ['provider', 42.5, 'CNY', 77.5, 120, true, true, 'zhi…1234']);
  assert.equal(hits.filter(h => h.url === ZHIPU_BALANCE_URL).length, 1);
  zhipuBalance = 8;
  await call('GET', '/api/admin/ai/quota');
  T += 5e3; await call('GET', '/api/admin/ai/quota?refresh=1');
  assert.equal(hits.filter(h => h.url === ZHIPU_BALANCE_URL).length, 1, '缓存期内不应重复查');
  T += 6e3;
  const r2 = await call('GET', '/api/admin/ai/quota?refresh=1');
  assert.equal(hits.filter(h => h.url === ZHIPU_BALANCE_URL).length, 2);
  const e2 = r2.j.providers.find(p => p.id === 'env');
  assert.equal(e2.balance, 8); assert.equal(e2.low, false, 'glm-4-flash 是免费模型，现金低于提醒线也不标黄'); assert.equal(e2.cashNote, 'free_model');
  T += 61e3;
  await call('GET', '/api/admin/ai/quota');
  assert.equal(hits.filter(h => h.url === ZHIPU_BALANCE_URL).length, 3, '60 秒后自动重新查');
});

test('用量统计：AI 助手对话按服务商记 token；设了资源包总量后显示估算剩余；提醒线可改；写审计', async () => {
  srv.db.exec('DELETE FROM ai_usage');
  const c = await call('POST', '/api/admin/ai/chat', {text: '你好'});
  assert.equal(c.s, 200);
  await tick();
  let q = (await call('GET', '/api/admin/ai/quota')).j.providers.find(p => p.id === 'env');
  assert.deepEqual([q.usage.today.calls, q.usage.today.tokens, q.usage.week.tokens], [1, 150, 150]);
  T += 1000;
  const s = await call('POST', '/api/admin/ai/quota/env/settings', {budgetTokens: 1000, lowBalance: 5});
  T += 1000;
  assert.equal(s.s, 200);
  await call('POST', '/api/admin/ai/chat', {text: '再来'}); await tick();
  q = (await call('GET', '/api/admin/ai/quota')).j.providers.find(p => p.id === 'env');
  assert.deepEqual([q.budgetTokens, q.usedSinceBudget, q.estimatedRemainingTokens, q.lowBalance], [1000, 150, 850, 5]);
  assert.equal(audits('admin.ai.quota.settings').length, 1);
  assert.equal((await call('POST', '/api/admin/ai/quota/env/settings', {budgetTokens: -1})).s, 400);
});

test('服务商管理：添加（密钥加密存储、只回打码）→ 测试连接 → 切换为当前 → AI 助手改走新服务商；联网搜索退回智谱；审计齐全', async () => {
  // 不能添加 DeepSeek，不能用 http
  assert.equal((await call('POST', '/api/admin/ai/providers', {type: 'deepseek', apiKey: 'sk-deepseek-NOT-REAL'})).j.error.code, 'BLOCKED_PROVIDER');
  assert.equal((await call('POST', '/api/admin/ai/providers', {type: 'custom', baseUrl: 'http://x.example/v1', model: 'm', apiKey: OAI_KEY})).j.error.code, 'BAD_BASE_URL');
  assert.equal((await call('POST', '/api/admin/ai/providers', {type: 'moonshot'})).j.error.code, 'BAD_KEY');
  const add = await call('POST', '/api/admin/ai/providers', {type: 'moonshot', name: 'Kimi 备用', apiKey: MOON_KEY});
  assert.equal(add.s, 200); noKeys(add.text);
  const id = add.j.savedId;
  const row = srv.db.prepare('SELECT * FROM ai_providers WHERE id=?').get(id);
  assert.ok(row.key_enc.startsWith('v1:') && !row.key_enc.includes(MOON_KEY));
  assert.equal(row.key_hint, 'sk-…abcd');
  const p = add.j.providers.find(x => x.id === id);
  assert.deepEqual([p.keyMasked, p.baseUrl, p.model, p.searchCapable, p.active], ['sk-…abcd', 'https://api.moonshot.cn/v1', 'moonshot-v1-8k', false, false]);
  const ad = audits('admin.ai.provider.created').at(-1);
  assert.ok(!ad.detail.includes(MOON_KEY));

  const t = await call('POST', `/api/admin/ai/providers/${id}/test`);
  assert.equal(t.j.test.ok, true); noKeys(t.text);
  assert.equal(audits('admin.ai.provider.tested').length, 1);

  // 余额：Kimi 实时
  let q = (await call('GET', '/api/admin/ai/quota?refresh=1')).j;
  const k = q.providers.find(x => x.id === id);
  assert.deepEqual([k.source, k.balance, k.active], ['provider', 3.21, false]);

  // 切换
  const act = await call('POST', '/api/admin/ai/providers/active', {id});
  assert.equal(act.s, 200); assert.equal(act.j.activeId, id);
  assert.equal(audits('admin.ai.provider.activated').length, 1);
  hits.length = 0;
  const c = await call('POST', '/api/admin/ai/chat', {text: '你好'});
  assert.match(c.j.reply, /moonshot-v1-8k/);
  assert.equal(hits.find(h => h.url.endsWith('/chat/completions')).url, 'https://api.moonshot.cn/v1/chat/completions');
  assert.equal(hits.find(h => h.url.endsWith('/chat/completions')).auth, 'Bearer ' + MOON_KEY);
  const st = (await call('GET', '/api/admin/ai/status')).j;
  assert.deepEqual([st.providerId, st.search.providerId], [id, 'env']);
  // 联网搜索：Kimi 不支持 → 用服务器默认智谱
  hits.length = 0;
  const w = await call('GET', '/api/admin/ai/web-search?q=' + encodeURIComponent('新店开业'));
  assert.equal(w.s, 200);
  assert.ok(hits[0].url.startsWith('https://open.bigmodel.cn/'));
  await tick();
  q = (await call('GET', '/api/admin/ai/quota')).j;
  assert.equal(q.activeId, id);
  assert.ok(q.providers.find(x => x.id === id).usage.today.calls >= 1);
  assert.ok(q.providers.find(x => x.id === 'env').usage.today.searches >= 1);

  // 修改：不填密钥 = 保留原密钥；改模型写审计（不含密钥）
  const up = await call('POST', `/api/admin/ai/providers/${id}`, {model: 'moonshot-v1-32k'});
  assert.equal(up.s, 200);
  assert.equal(srv.db.prepare('SELECT key_enc FROM ai_providers WHERE id=?').get(id).key_enc, row.key_enc);
  assert.match(audits('admin.ai.provider.updated').at(-1).detail, /model/);
  // 服务器默认不能改、不能删
  assert.equal((await call('POST', '/api/admin/ai/providers/env', {model: 'x'})).j.error.code, 'BUILTIN');
  assert.equal((await call('POST', '/api/admin/ai/providers/env/delete')).j.error.code, 'BUILTIN');
  // 删除当前服务商 → 自动退回服务器默认智谱
  const del = await call('POST', `/api/admin/ai/providers/${id}/delete`);
  assert.equal(del.j.activeId, 'env');
  assert.equal(audits('admin.ai.provider.deleted').length, 1);
  const g = await call('GET', '/api/admin/ai/providers'); noKeys(g.text);
});

test('当前服务商不支持联网搜索、也没有智谱密钥时，联网搜索明确报不可用', async () => {
  const s2 = createApp({adminUsername: 'ops_q2', adminPassword: 'OpsUsrPass1', clock: () => T, aiEnv: {ADMIN_AI_KEY_SECRET: 'x'}, aiFetch: fakeNet, adminAiOpts: {fetchImpl: fakeNet}});
  await new Promise(r => s2.listen(0, '127.0.0.1', r));
  const b2 = 'http://127.0.0.1:' + s2.address().port;
  const c2 = async (m, p, body, t) => { const r = await fetch(b2 + p, {method: m, headers: {'Content-Type': 'application/json', ...(t ? {Authorization: 'Bearer ' + t} : {})}, body: body ? JSON.stringify(body) : undefined}); return {s: r.status, j: await r.json().catch(() => null)}; };
  try {
    const t2 = (await c2('POST', '/api/admin/auth/login', {username: 'ops_q2', password: 'OpsUsrPass1'})).j.token;
    assert.equal((await c2('POST', '/api/admin/ai/providers/active', {id: 'env'}, t2)).j.error.code, 'NOT_READY');
    const add = await c2('POST', '/api/admin/ai/providers', {type: 'custom', name: '兼容接口', baseUrl: 'https://llm.example.com/v1', model: 'm-x', apiKey: OAI_KEY}, t2);
    await c2('POST', '/api/admin/ai/providers/active', {id: add.j.savedId}, t2);
    const w = await c2('GET', '/api/admin/ai/web-search?q=abc', null, t2);
    assert.equal(w.s, 503);
    assert.match(w.j.error.message, /不支持联网搜索/);
    const q = await c2('GET', '/api/admin/ai/quota', null, t2);
    const it = q.j.providers.find(p => p.id === add.j.savedId);
    assert.deepEqual([it.source, it.balanceApi, it.active], ['none', false, true]);
    const ov = await c2('GET', '/api/admin/ai/auto-ads', null, t2);
    assert.equal(ov.j.status.configured, false, '没有联网搜索时自动发帖视为未配置');
  } finally { s2.close(); }
});

test('AI 助手不能代调服务商 / 额度接口', async () => {
  const {aiQuotaRoutes} = await import('../ai-quota.mjs');
  const r = aiQuotaRoutes({adminAuth: () => ({admin: {id: 1}}), ip: () => null, audit: () => {}, providers: {}, quota: {}, meteredFetch: null});
  for (const k of Object.keys(r)) await assert.rejects(async () => r[k]({_aiInternal: true, query: {}, params: {id: 'env'}}, {}), e => e.code === 'AI_FORBIDDEN', k);
});
