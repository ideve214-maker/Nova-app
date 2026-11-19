// 2.0.7 AI 额度用完自动切换：按余额跳过、按服务商报错切换、只重试一次、全部用完停止、开关、联网搜索只用智谱、
// AI 自动发帖遇到额度用完直接停（不发帖）、审计记录、调顺序、任何响应和日志都不出现完整密钥。全部是本地假接口。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';
import {ZHIPU_BALANCE_URL} from '../ai-quota.mjs';
import {billingReason} from '../ai-failover.mjs';

const ENV_KEY = 'zhipu-env-key-NOT-REAL-5678';
const MOON_KEY = 'sk-moonshot-NOT-REAL-efgh';
const OAI_KEY = 'sk-compat-NOT-REAL-ijkl';
let T = Date.parse('2026-11-19T16:00:00+08:00');
const adv = (ms = 61e3) => { T += ms; };
const env = {AI_API_KEY: ENV_KEY, AI_API_BASE: 'https://open.bigmodel.cn/api/paas/v4', ADMIN_AI_KEY_SECRET: 'unit-test-secret', ADMIN_AI_MODEL: 'glm-4-plus'}; // 付费模型（glm-4-flash 是免费模型，不按现金判断）
const json = (o, status = 200) => new Response(JSON.stringify(o), {status, headers: {'content-type': 'application/json'}});
const net = {zhipuBalance: 30, kimiBalance: 8, mode: {zhipu: 'ok', kimi: 'ok', compat: 'ok'}, hits: [], search: []};
const who = auth => auth === 'Bearer ' + ENV_KEY ? 'zhipu' : auth === 'Bearer ' + MOON_KEY ? 'kimi' : auth === 'Bearer ' + OAI_KEY ? 'compat' : '?';
const FAIL = {
  zhipu1113: () => json({error: {code: '1113', message: '您的账户已欠费，请充值后重试。'}}, 429),
  kimiQuota: () => json({error: {type: 'exceeded_current_quota_error', message: 'Your account is suspended, please check your plan and billing details'}}, 429),
  http402: () => json({error: {message: 'Insufficient credits'}}, 402),
  busy: () => json({error: {code: '1302', message: '并发数过高'}}, 429),
};
async function fakeNet(url, init = {}) {
  const u = String(url), auth = (init.headers || {}).Authorization || '';
  if (u === ZHIPU_BALANCE_URL) return json({code: 200, success: true, data: {availableBalance: net.zhipuBalance, balance: net.zhipuBalance, rechargeAmount: 100, giveAmount: 0, totalSpendAmount: 100 - net.zhipuBalance}});
  if (u === 'https://api.moonshot.cn/v1/users/me/balance') return json({code: 0, data: {available_balance: net.kimiBalance, voucher_balance: 0, cash_balance: net.kimiBalance}});
  if (u.endsWith('/chat/completions')) {
    const body = JSON.parse(init.body), w = who(auth);
    if (body.tools && body.tools[0] && body.tools[0].type === 'web_search') {
      net.search.push(w);
      if (net.mode.zhipu !== 'ok') return FAIL[net.mode.zhipu]();
      return json({choices: [{message: {role: 'assistant', content: ''}}], web_search: net.searchResults || [{title: '济南小吃店', link: 'https://shop1.example.com/', content: '老字号', media: 'm'}]});
    }
    net.hits.push(w);
    const m = (net.chatOverride || net.mode)[w];
    if (m && m !== 'ok') return FAIL[m]();
    if (body.response_format) return json({choices: [{message: {role: 'assistant', content: JSON.stringify({suitable: true, reason: 'ok', advertiser: '小吃店', title: '开业啦', text: '欢迎到店', cta: '去看看'})}}]});
    return json({choices: [{message: {role: 'assistant', content: '你好（' + body.model + '）'}}], usage: {prompt_tokens: 10, completion_tokens: 5, total_tokens: 15}});
  }
  return json({error: 'not found'}, 404);
}

let srv, base, tok, kimiId, compatId;
const texts = [];
async function call(m, p, body, t = tok) {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(t ? {Authorization: 'Bearer ' + t} : {})}, body: body ? JSON.stringify(body) : undefined});
  const text = await r.text(); texts.push(text);
  let j = null; try { j = JSON.parse(text); } catch {}
  return {s: r.status, j, text};
}
const chat = () => call('POST', '/api/admin/ai/chat', {text: '你好'});
const audits = a => srv.db.prepare('SELECT * FROM audit_log WHERE action=? ORDER BY id').all(a);
const detail = r => JSON.parse(r.detail || '{}');
const quota = async () => (await call('GET', '/api/admin/ai/quota')).j;
const item = (ov, id) => ov.providers.find(x => x.id === id);
const healthy = async () => {
  net.mode = {zhipu: 'ok', kimi: 'ok', compat: 'ok'}; net.zhipuBalance = 30; net.kimiBalance = 8;
  for (const id of ['env', kimiId, compatId]) await call('POST', `/api/admin/ai/providers/${id}/recheck`);
  await call('POST', '/api/admin/ai/providers/order', {ids: ['env', kimiId, compatId]});
  adv(); net.hits.length = 0; net.search.length = 0;
};

test.before(async () => {
  srv = createApp({adminUsername: 'ops_fo', adminPassword: 'OpsUsrPass1', clock: () => T, aiEnv: env,
    aiFetch: fakeNet, adminAiOpts: {fetchImpl: fakeNet}});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  tok = (await call('POST', '/api/admin/auth/login', {username: 'ops_fo', password: 'OpsUsrPass1'}, null)).j.token;
  kimiId = (await call('POST', '/api/admin/ai/providers', {type: 'moonshot', name: 'Kimi 备用', apiKey: MOON_KEY})).j.savedId;
  compatId = (await call('POST', '/api/admin/ai/providers', {type: 'custom', name: '兼容备用', baseUrl: 'https://llm.example.com/v1', model: 'm-x', apiKey: OAI_KEY})).j.savedId;
});
test.after(() => srv.close());

test('余额不足类错误识别：智谱 1113/1112、Kimi、OpenAI、402、通义欠费、硅基流动；普通限流不算', () => {
  assert.equal(billingReason(429, {error: {code: '1113', message: '您的账户已欠费'}}), 'zhipu_1113');
  assert.equal(billingReason(429, {error: {code: 1112}}), 'zhipu_1112');
  assert.equal(billingReason(429, {error: {type: 'exceeded_current_quota_error'}}), 'exceeded_current_quota');
  assert.equal(billingReason(429, {error: {code: 'insufficient_quota', type: 'insufficient_quota'}}), 'insufficient_quota');
  assert.equal(billingReason(402, {error: {message: 'x'}}), 'http_402');
  assert.equal(billingReason(400, {code: 'Arrearage', message: 'Access denied'}), 'arrearage');
  assert.equal(billingReason(403, {code: 30001, message: 'Sorry, your account balance is insufficient'}), 'siliconflow_30001');
  assert.equal(billingReason(429, {error: {code: '1302', message: '并发数过高'}}), null);
  assert.equal(billingReason(500, null), null);
});

test('默认按顺序用第一家（智谱）；顺序里当前使用排第一', async () => {
  const r = await chat();
  assert.equal(r.s, 200, r.text);
  assert.match(r.j.reply, /glm-4-plus/);
  const ov = await quota();
  assert.deepEqual(ov.order.slice(0, 3), ['env', kimiId, compatId]);
  assert.equal(ov.failover.enabled, true, '默认打开自动切换');
  assert.equal(audits('ai.provider.failover').length, 0);
});

test('按余额切换：智谱余额 ≤ 停用线就跳过，用下一家（Kimi），只记一次切换', async () => {
  await healthy();
  net.zhipuBalance = 0; adv();
  const r = await chat();
  assert.match(r.j.reply, /moonshot-v1-8k/);
  assert.deepEqual(net.hits, ['kimi'], '没有再去调用余额为 0 的智谱');
  const fo = audits('ai.provider.failover');
  assert.equal(fo.length, 1);
  assert.deepEqual([detail(fo[0]).from, detail(fo[0]).to, detail(fo[0]).reason], ['env', kimiId, 'balance']);
  assert.equal(fo[0].actor_id, null);
  await chat();
  assert.equal(audits('ai.provider.failover').length, 1, '同一次切换不重复记');
  const ov = await quota();
  assert.equal(item(ov, 'env').exhausted, true);
  assert.equal(ov.failover.lastEvent.to, kimiId);
  assert.equal(ov.failover.lastEvent.from, 'env');
});

test('停用线：设为 ¥1 时余额 0.5 也算用完；改回 0 又用回智谱', async () => {
  await healthy();
  net.zhipuBalance = 0.5; adv();
  const s = await call('POST', '/api/admin/ai/quota/env/settings', {stopBalance: 1});
  assert.equal(s.s, 200, s.text);
  assert.equal(item(s.j, 'env').stopBalance, 1);
  assert.match((await chat()).j.reply, /moonshot/);
  await call('POST', '/api/admin/ai/quota/env/settings', {stopBalance: 0});
  assert.match((await chat()).j.reply, /glm-4-plus/);
  assert.equal((await call('POST', '/api/admin/ai/quota/env/settings', {stopBalance: -1})).s, 400);
});

test('按报错切换：智谱返回 1113（HTTP 429 欠费）→ 标记用完，同一个请求换 Kimi 重试一次', async () => {
  await healthy();
  net.mode.zhipu = 'zhipu1113';
  const r = await chat();
  assert.equal(r.s, 200, r.text);
  assert.match(r.j.reply, /moonshot/);
  assert.deepEqual(net.hits, ['zhipu', 'kimi']);
  const last = audits('ai.provider.failover').at(-1);
  assert.deepEqual([detail(last).from, detail(last).to, detail(last).reason], ['env', kimiId, 'zhipu_1113']);
  // 已标记：下一次直接用 Kimi，不再去碰智谱
  net.hits.length = 0;
  await chat();
  assert.deepEqual(net.hits, ['kimi']);
  const ov = await quota();
  assert.equal(item(ov, 'env').exhausted, true);
  assert.equal(item(ov, 'env').exhaustedReason, 'zhipu_1113');
  // 充值后（余额接口显示有钱、且是标记之后查到的）自动恢复
  net.mode.zhipu = 'ok'; adv();
  net.hits.length = 0;
  assert.match((await chat()).j.reply, /glm-4-plus/);
  assert.deepEqual(net.hits, ['zhipu']);
});

test('普通限流（1302）不算额度用完：不切换', async () => {
  await healthy();
  net.mode.zhipu = 'busy';
  const before = audits('ai.provider.failover').length;
  const r = await chat();
  assert.equal(r.s, 503);
  assert.equal(r.j.error.code, 'AI_UNAVAILABLE');
  assert.deepEqual(net.hits, ['zhipu']);
  assert.equal(audits('ai.provider.failover').length, before);
});

test('只重试一次：智谱 1113、Kimi exceeded_current_quota_error → 这次报错，下次直接用第三家', async () => {
  await healthy();
  net.mode.zhipu = 'zhipu1113'; net.mode.kimi = 'kimiQuota';
  const r = await chat();
  assert.equal(r.s, 503);
  assert.match(r.j.error.message, /兼容备用/);
  assert.deepEqual(net.hits, ['zhipu', 'kimi'], '同一个请求最多两家');
  net.hits.length = 0;
  assert.match((await chat()).j.reply, /m-x/);
  assert.deepEqual(net.hits, ['compat']);
});

test('全部用完：停止调用并返回中文错误；不再花钱；记 all_exhausted；Kimi 余额为负也算用完', async () => {
  await healthy();
  net.mode = {zhipu: 'zhipu1113', kimi: 'ok', compat: 'http402'}; net.kimiBalance = -0.3; adv();
  const r1 = await chat();
  assert.equal(r1.s, 503);
  assert.equal(r1.j.error.code, 'AI_ALL_EXHAUSTED', r1.text);
  assert.match(r1.j.error.message, /所有 AI 接口的额度都用完了/);
  assert.deepEqual(net.hits, ['zhipu', 'compat']);
  net.hits.length = 0;
  const r2 = await chat();
  assert.equal(r2.j.error.code, 'AI_ALL_EXHAUSTED');
  assert.deepEqual(net.hits, [], '全部用完后不再调用任何服务商');
  assert.ok(audits('ai.provider.all_exhausted').length >= 1);
  const ov = await quota();
  assert.equal(ov.failover.lastEvent.reason, 'all_exhausted');
  assert.ok(ov.providers.filter(x => x.usable !== false).every(x => x.exhausted), JSON.stringify(ov.providers.map(x => [x.id, x.exhausted])));
});

test('关掉“额度用完自动切换”：只用排第一的，用完直接报错，不会切到别家', async () => {
  await healthy();
  const off = await call('POST', '/api/admin/ai/failover', {enabled: false});
  assert.equal(off.j.failover.enabled, false);
  assert.equal(audits('admin.ai.failover.off').length, 1);
  net.zhipuBalance = 0; adv();
  const r = await chat();
  assert.equal(r.j.error.code, 'AI_ALL_EXHAUSTED');
  assert.match(r.j.error.message, /当前 AI 接口的额度已用完/);
  assert.deepEqual(net.hits, []);
  // 报错后也不切换
  net.zhipuBalance = 30; adv(); net.mode.zhipu = 'zhipu1113';
  const r2 = await chat();
  assert.equal(r2.j.error.code, 'AI_ALL_EXHAUSTED');
  assert.deepEqual(net.hits, ['zhipu']);
  await call('POST', '/api/admin/ai/failover', {enabled: true});
  assert.equal(audits('admin.ai.failover.on').length, 1);
});

test('联网搜索只用智谱：智谱用完就明确报“不可用”，不会改用 Kimi', async () => {
  await healthy();
  net.zhipuBalance = 0; adv();
  const r = await call('GET', '/api/admin/ai/web-search?q=' + encodeURIComponent('济南 小吃'));
  assert.equal(r.s, 503);
  assert.equal(r.j.error.code, 'AI_SEARCH_EXHAUSTED');
  assert.match(r.j.error.message, /联网搜索暂时不可用/);
  assert.deepEqual(net.search, []);
  // 余额有但搜索时报 1113：标记用完，不改用别家
  await healthy();
  net.mode.zhipu = 'zhipu1113';
  const r2 = await call('GET', '/api/admin/ai/web-search?q=x');
  assert.equal(r2.j.error.code, 'AI_SEARCH_EXHAUSTED');
  assert.deepEqual(net.search, ['zhipu']);
  assert.equal(item(await quota(), 'env').exhausted, true);
});

test('AI 自动发帖：智谱用完 → 这一轮跳过；搜索成功但所有接口用完 → 停止，不发帖', async () => {
  const aiAds = () => srv.db.prepare("SELECT * FROM marketing_ads WHERE source='ai'").all();
  env.ADMIN_AI_AUTO_ADS = '1';
  await call('POST', '/api/admin/ai/auto-ads/settings', {enabled: true, dailyCap: 2});
  await healthy();
  net.zhipuBalance = 0; adv();
  const r = await call('POST', '/api/admin/ai/auto-ads/run');
  assert.equal(r.s, 200, r.text);
  assert.equal(r.j.result.skipped, 'quota_exhausted');
  assert.equal(aiAds().length, 0);
  assert.ok(audits('ai.autoads.skipped').some(a => detail(a).reason === 'quota_exhausted'));
  // 搜索成功（智谱搜索正常），但文案生成时三家都报余额不足
  await healthy();
  net.searchResults = [{title: '济南小吃店1', link: 'https://shop1.example.com/', content: '老字号', media: 'm'}, {title: '济南小吃店2', link: 'https://shop2.example.com/', content: '老字号', media: 'm'}];
  net.chatOverride = {zhipu: 'zhipu1113', kimi: 'http402', compat: 'http402'};
  const r2 = await call('POST', '/api/admin/ai/auto-ads/run');
  delete net.chatOverride;
  assert.equal(r2.s, 200, r2.text);
  assert.equal(r2.j.result.stopped, 'quota_exhausted', r2.text);
  assert.equal((r2.j.result.published || []).length, 0);
  assert.equal(aiAds().length, 0, '额度用完时不发帖');
  assert.ok(audits('ai.autoads.stopped').length >= 1);
  assert.ok(net.hits.length <= 3, '每家最多调用一次：' + net.hits.join());
  assert.equal(net.search.length, 1);
  delete env.ADMIN_AI_AUTO_ADS;
});

test('调整顺序：第一个就是当前使用；排第一的必须可用；设为当前会移到最前；审计', async () => {
  await healthy();
  const r = await call('POST', '/api/admin/ai/providers/order', {ids: [kimiId, 'env', compatId]});
  assert.equal(r.s, 200, r.text);
  assert.equal(r.j.activeId, kimiId);
  assert.deepEqual(r.j.order.slice(0, 3), [kimiId, 'env', compatId]);
  assert.match((await chat()).j.reply, /moonshot/);
  assert.ok(audits('admin.ai.provider.reordered').length >= 1);
  await call('POST', `/api/admin/ai/providers/${compatId}`, {enabled: false});
  assert.equal((await call('POST', '/api/admin/ai/providers/order', {ids: [compatId, 'env']})).j.error.code, 'NOT_READY');
  await call('POST', `/api/admin/ai/providers/${compatId}`, {enabled: true});
  const a = await call('POST', '/api/admin/ai/providers/active', {id: compatId});
  assert.deepEqual(a.j.order.slice(0, 3), [compatId, kimiId, 'env']);
  assert.ok(audits('admin.ai.provider.rechecked').length >= 1);
});

test('不泄露密钥：所有响应和审计记录里都没有完整密钥', () => {
  const all = texts.join('\n') + JSON.stringify(srv.db.prepare('SELECT * FROM audit_log').all()) + JSON.stringify(srv.db.prepare('SELECT * FROM admin_ai_settings').all());
  for (const k of [ENV_KEY, MOON_KEY, OAI_KEY]) assert.ok(!all.includes(k), '出现了完整密钥');
});
