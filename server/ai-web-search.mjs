// 2.0.6 管理端 AI 联网搜索：用智谱对话接口自带的 web_search 工具（tools: [{type:'web_search'}]），
// 只取响应顶层的 web_search 结果（标题 / 原网址 / 摘要 / 来源站点），每条都保留原网址；没有网址的结果直接丢掉。
// 注意：每次搜索都会调用一次智谱接口（会产生费用），所以有每天的本地上限 ADMIN_AI_SEARCH_RPD（默认 30 次）。
import {ApiError} from './errors.mjs';
import {billingReason, BillingError} from './ai-failover.mjs';

const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
const dayOf = t => new Date(t + 8 * 3600e3).toISOString().slice(0, 10);

/** 只接受 http(s) 原网址，去掉账号密码；不合格返回 null。 */
export function cleanSourceUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (!u.hostname || !u.hostname.includes('.')) return null;
  if (u.href.length > 500) return null;
  return u.href;
}

/** 把智谱返回的 web_search 数组整理成统一格式。 */
export function parseSearchResults(j) {
  const arr = (j && (Array.isArray(j.web_search) ? j.web_search : Array.isArray(j.search_result) ? j.search_result : [])) || [];
  const seen = new Set();
  const out = [];
  for (const r of arr) {
    const url = cleanSourceUrl(r && (r.link || r.url));
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({title: clip(r.title, 120), url, snippet: clip(r.content, 600), site: clip(r.media, 40), publishedAt: clip(r.publish_date, 20) || null});
  }
  return out;
}

// 2.0.7：可以传 provider()（返回 {base,key,model} 或 null，见 ai-providers.mjs 的 searchProvider），优先于 base/apiKey/model/ready。
// withProvider(fn)：有自动切换路由时由它挑智谱（智谱用完会报 AI_SEARCH_EXHAUSTED），返回 {value} 或 null（没有可用的智谱）。
export function createWebSearch({env = process.env, fetchImpl, now = Date.now, base, apiKey, model, ready, provider, unavailable, withProvider} = {}) {
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  const engine = () => String(env.ADMIN_AI_SEARCH_ENGINE || 'search_std').trim();
  const perDay = () => { const n = Number(env.ADMIN_AI_SEARCH_RPD); return Number.isInteger(n) && n >= 0 ? n : 30; };
  let day = '', used = 0;
  function budget() {
    const d = dayOf(now());
    if (d !== day) { day = d; used = 0; }
    if (used >= perDay()) throw new ApiError(429, 'SEARCH_LIMIT', '今天的联网搜索次数已用完');
    used++;
  }
  async function search(query, {count = 8} = {}) {
    const q = clip(query, 120);
    if (!q) throw new ApiError(400, 'BAD_QUERY', '请填写搜索关键词');
    const none = () => new ApiError(503, 'AI_NOT_CONFIGURED', (unavailable && unavailable()) || 'AI 助手还没有配置智谱密钥');
    if (withProvider) {
      if (!(provider ? provider() : true)) throw none();
      budget();
      const r = await withProvider(p => searchOn(p, q, count));
      if (!r) throw none();
      return r.value;
    }
    const p = provider ? provider() : (ready() ? {base: base(), key: apiKey(), model: model()} : null);
    if (!p) throw none();
    budget();
    return searchOn(p, q, count);
  }
  async function searchOn(p, q, count) {
    let res;
    try {
      res = await doFetch(p.base + '/chat/completions', {method: 'POST', signal: AbortSignal.timeout(30000),
        headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + p.key},
        body: JSON.stringify({model: p.model, temperature: 0.1, max_tokens: 300,
          messages: [{role: 'user', content: '联网搜索：' + q}],
          tools: [{type: 'web_search', web_search: {enable: true, search_engine: engine(), search_result: true, search_query: q}}]})});
    } catch { throw new ApiError(503, 'SEARCH_UNAVAILABLE', '联网搜索暂时连不上，请稍后再试'); }
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const why = billingReason(res.status, body);
      if (why) throw new BillingError(why, res.status);
      throw new ApiError(503, 'SEARCH_UNAVAILABLE', '联网搜索暂时不可用（' + res.status + '）');
    }
    const j = await res.json().catch(() => null);
    return {query: q, results: parseSearchResults(j).slice(0, Math.min(Math.max(count, 1), 15))};
  }
  return {search, status: () => ({engine: engine(), perDay: perDay(), usedToday: day === dayOf(now()) ? used : 0})};
}
