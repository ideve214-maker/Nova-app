// 2.0.7 AI 额度用完自动切换（failover）：防止一直用一家把余额用成负数。
//
// 规则（全部在服务端）：
// 1. 服务商有先后顺序（管理端可上下调整；排第一的就是“当前使用”）。
// 2. 每次 AI 调用前先看这一家的额度：实时余额 ≤ 停用线（stop_balance，默认 0），或按资源包估算的剩余 token ≤ stop_tokens，
//    或之前调用时被服务商拒绝为“余额不足 / 欠费”（还在冷却中），就跳过它，用下一家。余额只用 60 秒缓存，不会每次都去查。
// 3. 调用时服务商返回“余额不足”类错误（智谱 1113 / 1112、Kimi exceeded_current_quota_error、OpenAI insufficient_quota、
//    通义 Arrearage、硅基流动 30001、任何 HTTP 402），就把这一家标记为用完，同一个请求换下一家重试一次（只重试一次）。
// 4. 联网搜索只有智谱支持：智谱用完时联网搜索明确报“不可用”，不会改用别家。
// 5. 所有服务商都用完时停下来，返回中文错误；AI 自动发帖这一轮直接停止、不发帖。
// 6. 自动切换写 audit_log：ai.provider.failover（from / to / reason），全部用完写 ai.provider.all_exhausted。
// 7. “额度用完自动切换”开关（ai.autoFailover，默认开）关掉时：只用排第一的那家，它用完就直接报错，也不会继续花钱。
import {ApiError} from './errors.mjs';
import {ENV_ID} from './ai-providers.mjs';

/** 调用失败时，按 HTTP 状态和响应体判断是不是“余额不足 / 欠费 / 额度用完”。返回原因代码或 null。 */
export function billingReason(status, body) {
  const e = (body && typeof body === 'object' && (body.error && typeof body.error === 'object' ? body.error : body)) || {};
  const code = String(e.code != null ? e.code : (body && body.code != null ? body.code : ''));
  const type = String(e.type || '');
  const msg = String(e.message || (body && (body.msg || body.message)) || '');
  if (status === 402) return 'http_402';
  if (code === '1113' || code === '1112') return 'zhipu_' + code;
  if (type === 'exceeded_current_quota_error' || code === 'exceeded_current_quota_error') return 'exceeded_current_quota';
  if (code === 'insufficient_quota' || type === 'insufficient_quota') return 'insufficient_quota';
  if (code === 'Arrearage' || type === 'Arrearage' || code === 'isv.OUT_OF_SERVICE') return 'arrearage';
  if (code === '30001') return 'siliconflow_30001';
  if (/余额不足|已欠费|欠费|无可用资源包|insufficient[ _](balance|quota|credits?)|credit balance is too low|out of credits/i.test(msg)) return 'message';
  return null;
}

/** 调用时发现余额不足：由路由器捕获并切换。 */
export class BillingError extends Error {
  constructor(reason, status) { super('billing:' + reason); this.reason = reason; this.status = status; }
}

export const REASON_TEXT = {
  balance: '余额低于停用线', packages_and_cash: '资源包用完且现金低于停用线', estimated: '估算剩余 token 用完', http_402: '服务商返回 402（余额不足）', zhipu_1113: '智谱 1113：欠费或没有可用资源包',
  zhipu_1112: '智谱 1112：余额不足', exceeded_current_quota: 'Kimi：余额不足', insufficient_quota: '额度不足（insufficient_quota）',
  arrearage: '通义：账号欠费', siliconflow_30001: '硅基流动：余额不足', message: '服务商提示余额不足', manual: '管理员恢复', all_exhausted: '所有接口额度都用完了',
};

export function createAiRouter(db, {providers, quota, audit, now = Date.now} = {}) {
  const q = {
    getSet: db.prepare('SELECT value FROM admin_ai_settings WHERE key=?'),
    setSet: db.prepare('INSERT INTO admin_ai_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at'),
  };
  const setting = k => { const r = q.getSet.get(k); return r ? r.value : null; };
  const enabled = () => setting('ai.autoFailover') !== '0';
  const log = (action, target, detail) => { try { audit(null, action, target, null, detail); } catch {} };
  let lastAllExhausted = 0;

  /** 按顺序列出可用（有密钥、已启用、没被禁用）的服务商，并标上是否用完。 */
  async function chain() {
    const out = [];
    for (const p of providers.ordered()) {
      if (!p.usable) continue;
      out.push({p, ex: await quota.exhaustion(p)});
    }
    return out;
  }
  function noteSwitch(from, to, reason, kind) {
    const ev = {at: now(), from: from ? from.id : null, fromName: from ? from.name : null, to: to ? to.id : null, toName: to ? to.name : null, reason, kind};
    q.setSet.run('ai.lastFailover', JSON.stringify(ev), now());
    log('ai.provider.failover', 'ai_provider:' + (to ? to.id : 'none'), {from: ev.from, to: ev.to, reason, kind});
  }
  function allExhausted(kind, list) {
    if (now() - lastAllExhausted > 10 * 60e3) {
      lastAllExhausted = now();
      log('ai.provider.all_exhausted', 'ai_provider:none', {kind, providers: list.map(x => ({id: x.p.id, reason: x.ex.reason}))});
    }
    q.setSet.run('ai.lastFailover', JSON.stringify({at: now(), from: list[0] ? list[0].p.id : null, fromName: list[0] ? list[0].p.name : null, to: null, toName: null, reason: 'all_exhausted', kind}), now());
    return new ApiError(503, 'AI_ALL_EXHAUSTED', list.length > 1 || enabled()
      ? '所有 AI 接口的额度都用完了，已停止调用（防止欠费）。请充值或在「AI 接口与额度」里添加新的接口'
      : '当前 AI 接口的额度已用完，已停止调用（防止欠费）。可以打开「额度用完自动切换」或换一个接口');
  }
  function remember(p) {
    const prev = setting('ai.lastEffective');
    if (prev !== p.id) q.setSet.run('ai.lastEffective', p.id, now());
    return prev;
  }

  /** 对话类调用：fn(provider) 发请求；余额不足时抛 BillingError。 */
  async function call(kind, fn) {
    const list = await chain();
    if (!list.length) throw new ApiError(503, 'AI_NOT_CONFIGURED', 'AI 助手还没有配置智谱密钥（或管理端选定的 AI 服务商不可用）');
    const pool = enabled() ? list : list.slice(0, 1);
    const live = pool.filter(x => !x.ex.exhausted);
    if (!live.length) throw allExhausted(kind, pool);
    let cur = live[0];
    // 排在前面的因为额度被跳过：记一次切换（同一个目标只记一次）
    const prev = remember(cur.p);
    if (cur !== pool[0] && prev !== cur.p.id) noteSwitch(pool[0].p, cur.p, pool[0].ex.reason || 'balance', kind);
    try { return await fn(cur.p); }
    catch (e) {
      if (!(e instanceof BillingError)) throw e;
      quota.markExhausted(cur.p, e.reason);
      const next = enabled() ? live.find(x => x !== cur) : null;
      if (!next) throw allExhausted(kind, pool);
      noteSwitch(cur.p, next.p, e.reason, kind);
      remember(next.p);
      try { return await fn(next.p); }
      catch (e2) {
        if (!(e2 instanceof BillingError)) throw e2;
        quota.markExhausted(next.p, e2.reason);
        // 只重试一次：还有别家没用完时，这次先报错，下一次请求会直接用下一家
        const rest = (await chain()).filter(x => !x.ex.exhausted);
        if (rest.length) { throw new ApiError(503, 'AI_UNAVAILABLE', '这次调用的两个 AI 接口额度都不够，已自动切换到「' + rest[0].p.name + '」，请再试一次'); }
        throw allExhausted(kind, pool);
      }
    }
  }

  /** 联网搜索：只用智谱（当前这家是智谱就用它，否则服务器默认智谱，再否则第一家智谱）；智谱用完就明确报不可用。 */
  async function search(fn) {
    const zs = providers.ordered().filter(p => p.usable && p.search);
    const env = zs.find(p => p.id === ENV_ID);
    const first = providers.ordered().find(p => p.usable);
    const order = [...new Set([first && first.search ? first : null, env, ...zs].filter(Boolean))];
    if (!order.length) return null;
    for (const p of order) {
      const ex = await quota.exhaustion(p);
      if (ex.exhausted) continue;
      try { return {value: await fn(p)}; }
      catch (e) {
        if (!(e instanceof BillingError)) throw e;
        quota.markExhausted(p, e.reason);
        log('ai.provider.failover', 'ai_provider:none', {from: p.id, to: null, reason: e.reason, kind: 'web_search'});
        break; // 搜索不重试别家（只有智谱支持）
      }
    }
    throw new ApiError(503, 'AI_SEARCH_EXHAUSTED', '智谱的额度用完了，联网搜索暂时不可用（只有智谱支持联网搜索）。请给智谱充值后再试');
  }

  function status() {
    let last = null;
    try { last = JSON.parse(setting('ai.lastFailover') || 'null'); } catch {}
    return {enabled: enabled(), lastEvent: last, effectiveId: setting('ai.lastEffective')};
  }
  function setEnabled(on) { q.setSet.run('ai.autoFailover', on ? '1' : '0', now()); return status(); }

  return {call, search, status, setEnabled, enabled, chain};
}
