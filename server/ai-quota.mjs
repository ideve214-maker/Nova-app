// 2.0.7 管理端「AI 额度」：每家 AI 服务商还剩多少额度 + 本地用量统计；以及 AI 服务商管理接口。
//
// 余额从哪里来（source）：
// - provider（实时）：服务商有余额接口时直接查（智谱控制台接口、Kimi、硅基流动、OpenRouter、DeepSeek）。
//   智谱的 https://www.bigmodel.cn/api/biz/account/query-customer-account-report 是控制台在用的接口，官方文档没有写，
//   用普通 API Key（Bearer）就能查现金余额；资源包（token 包）的余量智谱没有开放接口。可用 ZHIPU_BALANCE_URL 覆盖地址。
// - estimated（估算）：服务商没有余额接口（OpenAI、通义百炼、其他兼容接口）或查询失败时，
//   用“管理员填的资源包 / 预算 token 总数 − 从填写时起本地记录的已用 token”估算。
// 用量：每一次发出去的对话 / 联网搜索都记一行 ai_usage（服务商、模型、token 数），见 meterFetch。
// 缓存：每家 60 秒（ADMIN_AI_QUOTA_TTL_MS）；?refresh=1 强制刷新，但同一家 10 秒内最多查一次。
// 安全：接口只返回打码后的密钥；这些接口不允许 AI 助手代调；这里没有充值、付款能力。
import {ApiError} from './errors.mjs';
import {ENV_ID, maskKey, typeInfo} from './ai-providers.mjs';

export const ZHIPU_BALANCE_URL = 'https://www.bigmodel.cn/api/biz/account/query-customer-account-report';
const DAY = 86400e3;
const num = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100) / 100);
const dayStart = t => Date.parse(new Date(t + 8 * 3600e3).toISOString().slice(0, 10) + 'T00:00:00+08:00');

async function getJson(doFetch, url, key, timeoutMs = 10000) {
  let res;
  try { res = await doFetch(url, {method: 'GET', headers: {Authorization: 'Bearer ' + key, Accept: 'application/json'}, signal: AbortSignal.timeout(timeoutMs)}); }
  catch { return {status: 0, ok: false, j: null}; }
  let j = null;
  try { j = await res.json(); } catch {}
  return {status: res.status, ok: res.ok, j};
}
function httpError(status) {
  if (status === 0) return '余额接口连不上';
  if (status === 401 || status === 403) return '密钥无效或没有权限查余额';
  if (status === 404 || status === 410) return '服务商已停用余额接口';
  if (status === 429) return '查询太频繁，稍后再试';
  return '余额查询失败（' + status + '）';
}
const originOf = b => { try { return new URL(b).origin; } catch { return ''; } };

/**
 * 各家余额接口适配器：fetchBalance({base, key, fetch, env}) → {balance, currency, unit, totalGranted?, used?, resourcePackages?, detail?}
 * 出错时抛 Error(中文原因)，原因里绝不带密钥。
 */
export const BALANCE_ADAPTERS = {
  async zhipu({base, key, fetch: f, env = {}}) {
    const url = String(env.ZHIPU_BALANCE_URL || '').trim() || ZHIPU_BALANCE_URL;
    if (!env.ZHIPU_BALANCE_URL && !/(^|\.)bigmodel\.cn$/.test((() => { try { return new URL(base).hostname; } catch { return ''; } })())) throw new Error('接口地址不是智谱官方，查不到余额');
    const r = await getJson(f, url, key);
    if (!r.ok) throw new Error(httpError(r.status));
    const j = r.j || {};
    if (j.success === false || (j.code != null && Number(j.code) !== 200)) throw new Error(Number(j.code) === 1001 || Number(j.code) === 1002 || /身份验证|Authorization|令牌|token/i.test(String(j.msg || '')) ? '密钥无效或没有权限查余额' : '智谱返回：' + String(j.msg || '查询失败').slice(0, 40));
    const d = j.data || {};
    const balance = num(d.availableBalance != null ? d.availableBalance : d.balance);
    if (balance == null) throw new Error('智谱返回的数据里没有余额');
    const recharge = num(d.rechargeAmount), give = num(d.giveAmount);
    return {balance, currency: 'CNY', unit: '元', totalGranted: recharge != null || give != null ? num((recharge || 0) + (give || 0)) : null, used: num(d.totalSpendAmount),
      detail: {totalBalance: num(d.balance), frozen: num(d.frozenBalance), recharged: recharge, granted: give}};
  },
  async deepseek({base, key, fetch: f}) {
    const r = await getJson(f, originOf(base) + '/user/balance', key);
    if (!r.ok) throw new Error(httpError(r.status));
    const infos = (r.j && Array.isArray(r.j.balance_infos)) ? r.j.balance_infos : [];
    const b = infos.find(x => x && x.currency === 'CNY') || infos[0];
    if (!b) throw new Error('返回的数据里没有余额');
    return {balance: num(b.total_balance), currency: b.currency || 'CNY', unit: b.currency === 'USD' ? '美元' : '元',
      detail: {granted: num(b.granted_balance), toppedUp: num(b.topped_up_balance), available: r.j.is_available !== false}};
  },
  async moonshot({base, key, fetch: f}) {
    const r = await getJson(f, base + '/users/me/balance', key);
    if (!r.ok) throw new Error(httpError(r.status));
    const d = (r.j && r.j.data) || {};
    const usd = /moonshot\.ai|kimi\.ai/.test(base);
    if (num(d.available_balance) == null) throw new Error('返回的数据里没有余额');
    return {balance: num(d.available_balance), currency: usd ? 'USD' : 'CNY', unit: usd ? '美元' : '元', detail: {cash: num(d.cash_balance), voucher: num(d.voucher_balance)}};
  },
  async siliconflow({base, key, fetch: f}) {
    const r = await getJson(f, base + '/user/info', key);
    if (!r.ok) throw new Error(httpError(r.status));
    const d = (r.j && r.j.data) || {};
    const total = num(d.totalBalance != null ? d.totalBalance : d.balance);
    if (total == null) throw new Error('返回的数据里没有余额');
    return {balance: total, currency: 'CNY', unit: '元', detail: {granted: num(d.balance), charged: num(d.chargeBalance)}};
  },
  async openrouter({base, key, fetch: f}) {
    const [k, c] = await Promise.all([getJson(f, base + '/key', key), getJson(f, base + '/credits', key)]);
    const kd = (k.ok && k.j && k.j.data) || null, cd = (c.ok && c.j && c.j.data) || null;
    if (cd && num(cd.total_credits) != null) {
      return {balance: num(Number(cd.total_credits) - Number(cd.total_usage || 0)), currency: 'USD', unit: '美元', totalGranted: num(cd.total_credits), used: num(cd.total_usage),
        detail: kd ? {keyLimit: num(kd.limit), keyRemaining: num(kd.limit_remaining), keyUsage: num(kd.usage)} : null};
    }
    if (kd && num(kd.limit_remaining) != null) return {balance: num(kd.limit_remaining), currency: 'USD', unit: '美元', totalGranted: num(kd.limit), used: num(kd.usage), detail: {scope: 'key'}};
    if (kd) throw new Error('这把密钥没有额度上限，账户余额需要管理密钥才能查');
    throw new Error(httpError(k.status || c.status));
  },
};

/** 包一层 fetch：每次对话 / 联网搜索请求都记一行用量（不读也不存提示词内容）。 */
export function meterFetch(baseFetch, {record, attribute}) {
  const f = baseFetch || ((...a) => fetch(...a));
  return async (url, init = {}) => {
    const u = String((url && url.url) || url);
    if (!/\/chat\/completions(\?|$)/.test(u)) return f(url, init);
    let body = {};
    try { body = JSON.parse(typeof init.body === 'string' ? init.body : '{}') || {}; } catch {}
    const kind = Array.isArray(body.tools) && body.tools.some(t => t && t.type === 'web_search') ? 'web_search' : 'chat';
    const row = {provider: attribute(u), model: String(body.model || '').slice(0, 80), kind};
    const safeRecord = r => { try { record(r); } catch {} };
    let res;
    try { res = await f(url, init); } catch (e) { safeRecord({...row, ok: 0, status: 0}); throw e; }
    if (!res || !res.ok) { safeRecord({...row, ok: 0, status: res ? res.status : 0}); return res; }
    const done = j => {
      const us = (j && j.usage) || {};
      const p = Number(us.prompt_tokens) || 0, c = Number(us.completion_tokens) || 0;
      safeRecord({...row, ok: 1, status: res.status, prompt: p, completion: c, total: Number(us.total_tokens) || p + c});
    };
    if (typeof res.clone === 'function') { res.clone().json().then(done, () => done(null)); }
    else if (typeof res.json === 'function') {
      const orig = res.json.bind(res);
      let seen = false;
      res.json = async () => { const j = await orig(); if (!seen) { seen = true; done(j); } return j; };
    } else done(null);
    return res;
  };
}

export function createAiUsage(db, {now = Date.now, keepDays = 90} = {}) {
  const ins = db.prepare('INSERT INTO ai_usage(at,provider,model,kind,ok,status,prompt_tokens,completion_tokens,total_tokens) VALUES(?,?,?,?,?,?,?,?,?)');
  const prune = db.prepare('DELETE FROM ai_usage WHERE at<?');
  const sum = db.prepare(`SELECT COUNT(*) AS calls, COALESCE(SUM(CASE WHEN kind='web_search' THEN 1 ELSE 0 END),0) AS searches,
    COALESCE(SUM(CASE WHEN ok=0 THEN 1 ELSE 0 END),0) AS errors, COALESCE(SUM(prompt_tokens),0) AS prompt, COALESCE(SUM(completion_tokens),0) AS completion,
    COALESCE(SUM(total_tokens),0) AS tokens FROM ai_usage WHERE provider=? AND at>=?`);
  let lastPrune = 0;
  function record({provider, model, kind, ok = 1, status = null, prompt = 0, completion = 0, total = 0}) {
    const t = now();
    ins.run(t, String(provider || 'unknown').slice(0, 80), model || null, kind === 'web_search' ? 'web_search' : 'chat', ok ? 1 : 0, status, prompt | 0, completion | 0, total | 0);
    if (t - lastPrune > 3600e3) { lastPrune = t; prune.run(t - keepDays * DAY); }
  }
  const stats = (provider, since) => { const r = sum.get(String(provider), since); return {calls: Number(r.calls), searches: Number(r.searches), errors: Number(r.errors), promptTokens: Number(r.prompt), completionTokens: Number(r.completion), tokens: Number(r.tokens)}; };
  return {record, stats};
}

export function createAiQuota(db, {providers, usage, fetchImpl, env = process.env, now = Date.now} = {}) {
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  const ttl = () => { const n = Number(env.ADMIN_AI_QUOTA_TTL_MS); return Number.isFinite(n) && n >= 10e3 ? n : 60e3; };
  const MIN_FORCE_MS = 10e3;
  const cache = new Map(), inflight = new Map();
  const cooldown = () => { const n = Number(env.ADMIN_AI_EXHAUSTED_COOLDOWN_MS); return Number.isFinite(n) && n >= 60e3 ? n : 30 * 60e3; };
  const q = {
    get: db.prepare('SELECT * FROM ai_quota_settings WHERE provider=?'),
    put: db.prepare(`INSERT INTO ai_quota_settings(provider,budget_tokens,budget_since,low_balance,stop_balance,stop_tokens,updated_at) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(provider) DO UPDATE SET budget_tokens=excluded.budget_tokens, budget_since=excluded.budget_since, low_balance=excluded.low_balance,
      stop_balance=excluded.stop_balance, stop_tokens=excluded.stop_tokens, updated_at=excluded.updated_at`),
    mark: db.prepare(`INSERT INTO ai_quota_settings(provider,exhausted_at,exhausted_reason,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(provider) DO UPDATE SET exhausted_at=excluded.exhausted_at, exhausted_reason=excluded.exhausted_reason, updated_at=excluded.updated_at`),
    clear: db.prepare('UPDATE ai_quota_settings SET exhausted_at=NULL, exhausted_reason=NULL WHERE provider=?'),
  };
  const settingsOf = id => {
    const r = q.get.get(id);
    return {budgetTokens: r && r.budget_tokens != null ? Number(r.budget_tokens) : null, budgetSince: r ? r.budget_since : null, lowBalance: r && r.low_balance != null ? Number(r.low_balance) : null,
      stopBalance: r && r.stop_balance != null ? Number(r.stop_balance) : 0, stopTokens: r && r.stop_tokens != null ? Number(r.stop_tokens) : 0,
      exhaustedAt: r && r.exhausted_at ? Number(r.exhausted_at) : null, exhaustedReason: r ? r.exhausted_reason || null : null};
  };
  const dropCache = id => { for (const k of [...cache.keys()]) if (k.startsWith(id + '|')) cache.delete(k); };

  /** 这家现在算不算“用完”（自动切换用）。只用 60 秒内的余额缓存；被标记用完的会强制重查（10 秒一次）看是否已充值。 */
  async function exhaustion(p) {
    const st = settingsOf(p.id);
    const live = await liveBalance(p, !!st.exhaustedAt);
    const ok = !!live && !live.error && live.balance != null;
    if (st.exhaustedAt) {
      if (ok && live.fetchedAt > st.exhaustedAt && live.balance > st.stopBalance) q.clear.run(p.id);
      else if (!ok && now() - st.exhaustedAt >= cooldown()) q.clear.run(p.id);
      else return {exhausted: true, reason: st.exhaustedReason || 'balance', since: st.exhaustedAt};
    }
    if (ok && live.balance <= st.stopBalance) return {exhausted: true, reason: 'balance', since: null};
    if (st.budgetTokens != null && st.budgetTokens - usage.stats(p.id, st.budgetSince || 0).tokens <= st.stopTokens) return {exhausted: true, reason: 'estimated', since: null};
    return {exhausted: false, reason: null, since: null};
  }
  function markExhausted(p, reason) { q.mark.run(p.id, now(), String(reason || 'balance').slice(0, 40), now()); dropCache(p.id); }
  function clearExhausted(id) { q.clear.run(String(id)); dropCache(String(id)); }

  async function liveBalance(p, force) {
    const adapter = BALANCE_ADAPTERS[p.type];
    if (!adapter || !typeInfo(p.type).balance) return null;
    if (!p.key) return {error: '还没有配置密钥', fetchedAt: null};
    const ck = p.id + '|' + p.base + '|' + maskKey(p.key);
    const hit = cache.get(ck), t = now();
    if (hit && (t - hit.at < (force ? MIN_FORCE_MS : ttl()))) return hit.value;
    if (inflight.has(ck)) return inflight.get(ck);
    const job = (async () => {
      let value;
      try { value = {...(await adapter({base: p.base, key: p.key, fetch: doFetch, env})), fetchedAt: now()}; }
      catch (e) {
        const msg = String((e && e.message) || '查询失败').split(p.key).join('***').slice(0, 80);
        value = {error: msg, fetchedAt: now(), stale: hit && !hit.value.error ? hit.value : null};
      }
      cache.set(ck, {at: now(), value});
      return value;
    })().finally(() => inflight.delete(ck));
    inflight.set(ck, job);
    return job;
  }

  async function item(p, force, activeId, searchId, priority) {
    const t = typeInfo(p.type), t0 = now();
    const today = usage.stats(p.id, dayStart(t0)), week = usage.stats(p.id, t0 - 7 * DAY);
    const live = await liveBalance(p, force);
    const ex = p.usable ? await exhaustion(p) : {exhausted: false, reason: null, since: null};
    const st = settingsOf(p.id);
    const lb = live && !live.error ? live : (live && live.stale) || null;
    let source = 'none', balance = null, currency = t.currency, unit = t.currency === 'USD' ? '美元' : '元';
    if (lb) { source = 'provider'; balance = lb.balance; currency = lb.currency || currency; unit = lb.unit || unit; }
    let estimatedRemainingTokens = null, usedSinceBudget = null;
    if (st.budgetTokens != null) {
      usedSinceBudget = usage.stats(p.id, st.budgetSince || 0).tokens;
      estimatedRemainingTokens = Math.max(0, st.budgetTokens - usedSinceBudget);
      if (source === 'none') source = 'estimated';
    }
    const lowLine = st.lowBalance != null ? st.lowBalance : (currency === 'USD' ? 2 : 10);
    const low = source === 'provider' ? balance != null && balance <= lowLine
      : (estimatedRemainingTokens != null && st.budgetTokens > 0 ? estimatedRemainingTokens <= st.budgetTokens * 0.1 : false);
    return {
      id: p.id, name: p.name, type: p.type, typeName: t.name, model: p.model, builtin: !!p.builtin,
      keyMasked: p.builtin ? maskKey(p.key) : (p.keyHint || maskKey(p.key)), configured: !!p.usable,
      active: p.id === activeId, search: p.id === searchId,
      source, balanceApi: !!t.balance, balance, currency, unit,
      totalGranted: lb ? (lb.totalGranted != null ? lb.totalGranted : null) : null, used: lb ? (lb.used != null ? lb.used : null) : null,
      resourcePackages: lb && Array.isArray(lb.resourcePackages) ? lb.resourcePackages : [], detail: lb ? lb.detail || null : null,
      fetchedAt: live ? live.fetchedAt : null, error: live && live.error ? live.error : null, stale: !!(live && live.error && live.stale),
      budgetTokens: st.budgetTokens, budgetSince: st.budgetSince, usedSinceBudget, estimatedRemainingTokens,
      lowBalance: lowLine, low, empty: source === 'provider' ? balance != null && balance <= 0 : estimatedRemainingTokens === 0,
      usage: {today, week},
      priority, stopBalance: st.stopBalance, stopTokens: st.stopTokens,
      exhausted: ex.exhausted, exhaustedReason: ex.reason, exhaustedAt: ex.since,
    };
  }

  async function overview({refresh = false} = {}) {
    const a = providers.active(), s = providers.searchProvider();
    const list = providers.ordered().filter(p => p.builtin ? true : p.enabled || p.id === providers.activeId());
    const items = [];
    for (const [i, p] of list.entries()) items.push(await item(p, !!refresh, a ? a.id : null, s ? s.id : null, i + 1));
    return {providers: items, activeId: a ? a.id : null, searchProviderId: s ? s.id : null, ttlMs: ttl(), at: now()};
  }

  function saveSettings(id, body = {}) {
    if (!providers.find(id)) throw new ApiError(404, 'NOT_FOUND', '没有找到这个服务商');
    const old = settingsOf(id);
    const toInt = (v, max) => { if (v == null || v === '') return null; const n = Math.round(Number(v)); if (!Number.isFinite(n) || n < 0 || n > max) throw new ApiError(400, 'BAD_NUMBER', '数字不对'); return n; };
    const budget = body.budgetTokens !== undefined ? toInt(body.budgetTokens, 1e12) : old.budgetTokens;
    let low = old.lowBalance;
    if (body.lowBalance !== undefined) { low = body.lowBalance === null || body.lowBalance === '' ? null : Number(body.lowBalance); if (low != null && (!Number.isFinite(low) || low < 0 || low > 1e7)) throw new ApiError(400, 'BAD_NUMBER', '提醒线不对'); }
    let stop = old.stopBalance;
    if (body.stopBalance !== undefined) { stop = body.stopBalance === null || body.stopBalance === '' ? 0 : Number(body.stopBalance); if (!Number.isFinite(stop) || stop < 0 || stop > 1e6) throw new ApiError(400, 'BAD_NUMBER', '停用线不对'); }
    const stopTokens = body.stopTokens !== undefined ? (toInt(body.stopTokens, 1e12) || 0) : old.stopTokens;
    // 改了额度总量（或要求重新开始算）时，从现在起重新累计已用
    const since = budget == null ? null : (budget !== old.budgetTokens || body.resetSince ? now() : (old.budgetSince || now()));
    q.put.run(id, budget, since, low, stop, stopTokens, now());
    return {before: old, after: settingsOf(id)};
  }

  return {overview, saveSettings, liveBalance, exhaustion, markExhausted, clearExhausted, clearCache: () => cache.clear()};
}

/** 测试连接：发一个最小的对话请求（max_tokens=1），只回结果，不回密钥。 */
export async function testProvider(p, {fetchImpl, now = Date.now} = {}) {
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  if (!p.key) return {ok: false, error: p.keyBroken ? '密钥无法解密，请重新填写' : '还没有配置密钥'};
  const t0 = now();
  let res;
  try {
    res = await doFetch(p.base + '/chat/completions', {method: 'POST', signal: AbortSignal.timeout(15000),
      headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + p.key},
      body: JSON.stringify({model: p.model, messages: [{role: 'user', content: 'ping'}], max_tokens: 1, temperature: 0})});
  } catch { return {ok: false, error: '连不上接口地址', latencyMs: now() - t0}; }
  const latencyMs = now() - t0;
  if (res.ok) return {ok: true, status: res.status, latencyMs, model: p.model};
  let msg = '';
  try { const j = await res.json(); msg = String((j && j.error && (j.error.message || j.error.code)) || (j && j.msg) || ''); } catch {}
  msg = msg.split(p.key).join('***').slice(0, 80);
  const why = res.status === 401 || res.status === 403 ? '密钥无效' : res.status === 404 ? '接口地址或模型名不对' : res.status === 429 ? '额度不足或调用太频繁' : '接口返回错误';
  return {ok: false, status: res.status, latencyMs, error: why + '（' + res.status + '）' + (msg ? '：' + msg : '')};
}

/** 路由：都要求管理员登录；AI 助手不能代调（req._aiInternal）。 */
export function aiQuotaRoutes({adminAuth, ip, audit, providers, quota, router, meteredFetch, now = Date.now}) {
  const A = req => {
    if (req._aiInternal) throw new ApiError(403, 'AI_FORBIDDEN', 'AI 服务商和额度设置不允许 AI 代办');
    return adminAuth(req).admin;
  };
  const view = () => ({...providers.overview(), failover: router ? router.status() : null});
  const qview = async (o = {}) => ({...(await quota.overview(o)), failover: router ? router.status() : null, order: providers.order()});
  return {
    async 'GET /api/admin/ai/quota'(req) { A(req); const qq = req.query || {}; return qview({refresh: qq.refresh === '1' || qq.refresh === 'true'}); },
    async 'POST /api/admin/ai/failover'(req, b) {
      const admin = A(req); const on = !!(b || {}).enabled;
      if (router) router.setEnabled(on);
      audit(admin.id, on ? 'admin.ai.failover.on' : 'admin.ai.failover.off', 'ai_failover', ip(req), {enabled: on});
      return qview();
    },
    'POST /api/admin/ai/providers/order'(req, b) {
      const admin = A(req); const r = providers.setOrder((b || {}).ids);
      audit(admin.id, 'admin.ai.provider.reordered', 'ai_provider:' + r.after[0], ip(req), {before: r.before, after: r.after});
      return view();
    },
    async 'POST /api/admin/ai/providers/:id/recheck'(req) {
      const admin = A(req); const p = providers.find(req.params.id);
      if (!p) throw new ApiError(404, 'NOT_FOUND', '没有找到这个服务商');
      quota.clearExhausted(p.id);
      audit(admin.id, 'admin.ai.provider.rechecked', 'ai_provider:' + p.id, ip(req), {name: p.name});
      return qview({refresh: true});
    },
    async 'POST /api/admin/ai/quota/:id/settings'(req, b) {
      const admin = A(req); const r = quota.saveSettings(req.params.id, b || {});
      audit(admin.id, 'admin.ai.quota.settings', 'ai_provider:' + req.params.id, ip(req), {before: r.before, after: r.after});
      return qview();
    },
    'GET /api/admin/ai/providers'(req) { A(req); return view(); },
    'POST /api/admin/ai/providers'(req, b) {
      const admin = A(req); const r = providers.save(admin, b || {});
      audit(admin.id, 'admin.ai.provider.created', 'ai_provider:' + r.id, ip(req), r.detail);
      return {...view(), savedId: r.id};
    },
    'POST /api/admin/ai/providers/active'(req, b) {
      const admin = A(req); const r = providers.setActive(String((b || {}).id || ''));
      audit(admin.id, 'admin.ai.provider.activated', 'ai_provider:' + r.to, ip(req), {from: r.from, to: r.to, name: r.name});
      quota.clearCache();
      return view();
    },
    'POST /api/admin/ai/providers/:id'(req, b) {
      const admin = A(req); const r = providers.save(admin, b || {}, req.params.id);
      audit(admin.id, 'admin.ai.provider.updated', 'ai_provider:' + r.id, ip(req), {...r.detail, changed: r.changed});
      quota.clearCache();
      return {...view(), savedId: r.id};
    },
    'POST /api/admin/ai/providers/:id/delete'(req) {
      const admin = A(req); const r = providers.remove(req.params.id);
      audit(admin.id, 'admin.ai.provider.deleted', 'ai_provider:' + r.id, ip(req), {name: r.name, type: r.type, wasActive: r.wasSelected});
      return view();
    },
    async 'POST /api/admin/ai/providers/:id/test'(req) {
      const admin = A(req); const p = providers.find(req.params.id);
      if (!p) throw new ApiError(404, 'NOT_FOUND', '没有找到这个服务商');
      if (typeInfo(p.type).blocked) throw new ApiError(400, 'BLOCKED_PROVIDER', '按之前的决定暂不使用 DeepSeek');
      const r = await testProvider(p, {fetchImpl: meteredFetch, now});
      audit(admin.id, 'admin.ai.provider.tested', 'ai_provider:' + p.id, ip(req), {ok: r.ok, status: r.status || null, latencyMs: r.latencyMs || null});
      return {test: r};
    },
  };
}
