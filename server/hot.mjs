// V2EX / Hacker News 热榜：服务器定时拉取官方接口，按 source+id 去重，不存正文。
// 列表结构参考 MIT 项目 https://github.com/jiacai2050/mofish
export const V2EX_HOME = 'https://www.v2ex.com';
export const V2EX_HOT_URL = 'https://www.v2ex.com/api/topics/hot.json';
export const HN_HOME = 'https://news.ycombinator.com';
export const HN_TOP_URL = 'https://hacker-news.firebaseio.com/v0/topstories.json';
export const HN_ITEM_URL = id => 'https://hacker-news.firebaseio.com/v0/item/' + id + '.json';
export const MOFISH_REPO = 'https://github.com/jiacai2050/mofish';
const UA = 'VEXO-hot (+https://github.com/ideve214-maker/VEXOold)';
const DEFAULT_INTERVAL = 15 * 60 * 1000;
const DEFAULT_LIMIT = 20;

export class HotError extends Error {
  constructor(s, code, message) { super(message); this.s = s; this.code = code; }
}

export function attribution() {
  return {
    text: '热榜来自 V2EX 和 Hacker News 官方接口，列表结构参考开源项目 mofish。',
    v2ex: V2EX_HOME,
    hn: HN_HOME,
    mofish: MOFISH_REPO,
  };
}

export function sourceMeta(source) {
  if (source === 'v2ex') return {source: 'v2ex', label: 'V2EX', home: V2EX_HOME};
  if (source === 'hn') return {source: 'hn', label: 'Hacker News', home: HN_HOME};
  return null;
}

export function cleanTitle(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 300);
}

export function parseV2ex(raw) {
  if (!raw || raw.id == null) return null;
  const title = cleanTitle(raw.title);
  const url = String(raw.url || (V2EX_HOME + '/t/' + raw.id)).trim();
  if (!title || !url) return null;
  const author = raw.member && (raw.member.username || raw.member.name) || raw.author || '';
  const created = raw.created != null ? Number(raw.created) : (raw.created_at ? Date.parse(raw.created_at) / 1000 : null);
  return {
    source: 'v2ex',
    source_id: String(raw.id),
    title,
    url,
    author: String(author || '').slice(0, 80),
    heat: Number.isFinite(Number(raw.replies)) ? Number(raw.replies) : 0,
    published_at: Number.isFinite(created) ? Math.round(created * (created > 1e12 ? 1 : 1000)) : null,
  };
}

export function parseHn(raw) {
  if (!raw || raw.id == null || raw.dead || raw.deleted) return null;
  const title = cleanTitle(raw.title);
  if (!title) return null;
  const discuss = HN_HOME + '/item?id=' + raw.id;
  const url = String(raw.url || discuss).trim();
  return {
    source: 'hn',
    source_id: String(raw.id),
    title,
    url,
    author: String(raw.by || '').slice(0, 80),
    heat: Number.isFinite(Number(raw.score)) ? Number(raw.score) : 0,
    published_at: raw.time != null && Number.isFinite(Number(raw.time)) ? Number(raw.time) * 1000 : null,
  };
}

function pub(row) {
  const meta = sourceMeta(row.source) || {source: row.source, label: row.source, home: ''};
  return {
    source: row.source,
    sourceId: row.source_id,
    title: row.title,
    url: row.url,
    author: row.author || '',
    heat: row.heat == null ? 0 : row.heat,
    publishedAt: row.published_at || null,
    fetchedAt: row.fetched_at,
    sourceLabel: meta.label,
    sourceHome: meta.home,
  };
}

export function createHot({
  db,
  now = Date.now,
  fetchFn = globalThis.fetch,
  intervalMs = DEFAULT_INTERVAL,
  limit = DEFAULT_LIMIT,
  itemDelayMs = 80,
  concurrency = 4,
} = {}) {
  const upsert = db.prepare(`INSERT INTO hot_items(source,source_id,title,url,author,heat,published_at,fetched_at)
    VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(source,source_id) DO UPDATE SET
      title=excluded.title, url=excluded.url, author=excluded.author, heat=excluded.heat,
      published_at=excluded.published_at, fetched_at=excluded.fetched_at`);
  const delMissing = db.prepare(`DELETE FROM hot_items WHERE source=? AND source_id NOT IN (SELECT value FROM json_each(?))`);
  const listQ = db.prepare(`SELECT * FROM hot_items WHERE source=? ORDER BY heat DESC, fetched_at DESC, id DESC LIMIT ?`);
  const lastQ = db.prepare(`SELECT MAX(fetched_at) AS t FROM hot_items WHERE source=?`);
  function saveMany(source, items, at) {
    db.exec('BEGIN');
    try {
      for (const it of items) {
        upsert.run(it.source, it.source_id, it.title, it.url, it.author, it.heat, it.published_at, at);
      }
      const ids = items.map(it => it.source_id);
      if (ids.length) delMissing.run(source, JSON.stringify(ids));
      else db.prepare('DELETE FROM hot_items WHERE source=?').run(source);
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch {}
      throw e;
    }
  }

  const lastAttempt = {v2ex: 0, hn: 0};
  let timer = null;

  async function httpGet(url) {
    const ctrl = (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(10000) : undefined;
    const r = await fetchFn(url, {headers: {'User-Agent': UA, Accept: 'application/json'}, signal: ctrl, redirect: 'follow'});
    if (!r || !r.ok) {
      const err = new Error('http ' + (r && r.status));
      err.status = r && r.status;
      throw err;
    }
    return r.json();
  }

  async function fetchV2ex() {
    const raw = await httpGet(V2EX_HOT_URL);
    const list = Array.isArray(raw) ? raw : [];
    return list.map(parseV2ex).filter(Boolean).slice(0, limit);
  }

  async function fetchHn() {
    const ids = await httpGet(HN_TOP_URL);
    const top = (Array.isArray(ids) ? ids : []).slice(0, limit);
    const out = [];
    for (let i = 0; i < top.length; i += concurrency) {
      const chunk = top.slice(i, i + concurrency);
      const rows = await Promise.all(chunk.map(async id => {
        try { return parseHn(await httpGet(HN_ITEM_URL(id))); }
        catch { return null; }
      }));
      for (const it of rows) if (it) out.push(it);
      if (itemDelayMs && i + concurrency < top.length) {
        await new Promise(r => setTimeout(r, itemDelayMs));
      }
    }
    return out;
  }

  function list(source, n = limit) {
    const src = source === 'hn' ? 'hn' : (source === 'v2ex' ? 'v2ex' : '');
    if (!src) throw new HotError(400, 'BAD_REQUEST', '请指定热榜来源。');
    const items = listQ.all(src, Math.min(50, Math.max(1, n || limit))).map(pub);
    const fetchedAt = (lastQ.get(src) || {}).t || null;
    const meta = sourceMeta(src);
    return {source: src, items, fetchedAt, attribution: attribution(), sourceLabel: meta.label, sourceHome: meta.home};
  }

  async function refresh(source, {force = false} = {}) {
    const srcs = source ? [source] : ['v2ex', 'hn'];
    for (const s of srcs) {
      if (s !== 'v2ex' && s !== 'hn') throw new HotError(400, 'BAD_REQUEST', '请指定热榜来源。');
      const t = now();
      if (!force && lastAttempt[s] && t - lastAttempt[s] < intervalMs) continue;
      try {
        const items = s === 'v2ex' ? await fetchV2ex() : await fetchHn();
        lastAttempt[s] = now();
        saveMany(s, items, lastAttempt[s]);
      } catch (e) {
        lastAttempt[s] = now();
        if (listQ.all(s, 1).length) continue; // keep last snapshot
        throw new HotError(503, 'HOT_UNAVAILABLE', '暂时无法获取热榜，请稍后再试。');
      }
    }
    return source ? list(source) : {v2ex: list('v2ex'), hn: list('hn'), attribution: attribution()};
  }

  async function handle(query = {}) {
    const src = String(query.source || query.src || '').trim();
    if (src && src !== 'v2ex' && src !== 'hn') throw new HotError(400, 'BAD_REQUEST', '请指定热榜来源。');
    const have = src ? listQ.all(src, 1).length : (listQ.all('v2ex', 1).length + listQ.all('hn', 1).length);
    if (!have) await refresh(src || undefined, {force: true});
    if (src) return list(src);
    return {v2ex: list('v2ex'), hn: list('hn'), attribution: attribution()};
  }

  function start() {
    if (timer) return;
    const ms = Math.max(30 * 1000, Number(intervalMs) || DEFAULT_INTERVAL);
    const kick = () => { refresh(undefined, {force: false}).catch(() => {}); };
    timer = setInterval(kick, ms);
    if (timer.unref) timer.unref();
    const kickSoon = setTimeout(kick, 800);
    if (kickSoon.unref) kickSoon.unref();
  }
  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  return {handle, list, refresh, start, stop, attribution, _lastAttempt: lastAttempt};
}
