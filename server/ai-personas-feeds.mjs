// AI 官方内部账号的内容来源（Cc）：RSS 抓取、解析、入库，以及「读完新闻写自己的观点」的发帖文案。
// - 只存标题、摘要、原文链接；发出去的是 AI 用自己的话写的看法，最后附「来源：原文链接」。
// - 防照搬：生成的文字和原文标题 + 摘要做 8 字连续重合检查，重合超过 30% 直接丢掉不发。
// - 政治类只允许中新网（chinanews.com.cn）的来源（ideve 决定）。
// - BBC 中文简体地址在服务器上会 301 到繁体，所以按繁体抓，入库时用 opencc-js 转简体（convert='t2s'）。
// - 不加 XML 依赖：自己写的轻量解析，支持 RSS 2.0 / RDF / Atom。
import {createHash} from 'node:crypto';

/** 内部账号的兴趣分类（管理端可选）。 */
export const PERSONA_CATEGORIES = Object.freeze(['news', 'politics', 'sports', 'economy', 'tech', 'game', 'crypto', 'life']);
export const CATEGORY_LABEL = Object.freeze({news: '综合', politics: '时政', sports: '体育', economy: '经济', tech: '科技', game: '游戏', crypto: '币圈', life: '生活'});
/** 帖子分类（Dift 定的 posts.category 取值）：tech / game / crypto / finance / news / life / other。 */
export const POST_CATEGORIES = Object.freeze(['tech', 'game', 'crypto', 'finance', 'news', 'life', 'other']);
/** 内部账号分类 → 帖子分类。改映射只改这里。 */
export const PERSONA_TO_POST_CATEGORY = Object.freeze({news: 'news', politics: 'news', sports: 'news', economy: 'finance', tech: 'tech', game: 'game', crypto: 'crypto', life: 'life'});
export const postCategoryOf = c => PERSONA_TO_POST_CATEGORY[String(c || '')] || 'other';

export const POLITICS_HOSTS = Object.freeze(['chinanews.com.cn', 'www.chinanews.com.cn']);
export function hostOf(u) { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } }
export const politicsAllowed = url => POLITICS_HOSTS.includes(hostOf(url));

/** 内置来源（2026-11-21 在共用电脑和线上服务器实测能用；ESPN 403 已删）。
 *  境外中文综合新闻（BBC 中文 / DW / RFI / 纽约时报中文）默认关闭：按 ideve 的决定，政治内容只用中新网，这几个由管理员自己决定开不开。
 *  英文来源默认关闭（AI 读英文写中文，每条多耗一点 token）。 */
export const DEFAULT_SOURCES = Object.freeze([
  {name: '中新网 滚动', url: 'https://www.chinanews.com.cn/rss/scroll-news.xml', category: 'news', lang: 'zh', enabled: 1},
  {name: '中新网 国内', url: 'https://www.chinanews.com.cn/rss/china.xml', category: 'politics', lang: 'zh', enabled: 1},
  {name: '中新网 国际', url: 'https://www.chinanews.com.cn/rss/world.xml', category: 'politics', lang: 'zh', enabled: 1},
  {name: '中新网 体育', url: 'https://www.chinanews.com.cn/rss/sports.xml', category: 'sports', lang: 'zh', enabled: 1},
  {name: '中新网 财经', url: 'https://www.chinanews.com.cn/rss/finance.xml', category: 'economy', lang: 'zh', enabled: 1},
  {name: 'FT 中文网', url: 'https://www.ftchinese.com/rss/news', category: 'economy', lang: 'zh', enabled: 1},
  {name: 'BBC 中文', url: 'https://feeds.bbci.co.uk/zhongwen/trad/rss.xml', category: 'news', lang: 'zh', convert: 't2s', enabled: 0},
  {name: '德国之声 中文', url: 'https://rss.dw.com/rdf/rss-chi-all', category: 'news', lang: 'zh', enabled: 0},
  {name: '法广 RFI 中文', url: 'https://www.rfi.fr/cn/rss', category: 'news', lang: 'zh', enabled: 0},
  {name: '纽约时报中文网', url: 'https://cn.nytimes.com/rss/', category: 'news', lang: 'zh', enabled: 0},
  {name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', category: 'news', lang: 'en', enabled: 0},
  {name: 'BBC Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml', category: 'economy', lang: 'en', enabled: 0},
  {name: 'BBC Sport', url: 'https://feeds.bbci.co.uk/sport/rss.xml', category: 'sports', lang: 'en', enabled: 0},
  {name: 'The Guardian World', url: 'https://www.theguardian.com/world/rss', category: 'news', lang: 'en', enabled: 0},
  {name: 'The Guardian Sport', url: 'https://www.theguardian.com/uk/sport/rss', category: 'sports', lang: 'en', enabled: 0},
  {name: 'The Guardian Business', url: 'https://www.theguardian.com/uk/business/rss', category: 'economy', lang: 'en', enabled: 0},
  {name: 'NPR News', url: 'https://feeds.npr.org/1001/rss.xml', category: 'news', lang: 'en', enabled: 0},
  {name: 'NPR Economy', url: 'https://feeds.npr.org/1017/rss.xml', category: 'economy', lang: 'en', enabled: 0},
  {name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', category: 'news', lang: 'en', enabled: 0},
  {name: 'Yahoo Sports', url: 'https://sports.yahoo.com/rss/', category: 'sports', lang: 'en', enabled: 0},
  {name: 'CNBC Top News', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114', category: 'economy', lang: 'en', enabled: 0},
  {name: 'MarketWatch 头条', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories', category: 'economy', lang: 'en', enabled: 0},
]);

export const FEED_UA = 'VEXO/2.1 (ai-personas feed; +https://github.com/ideve214-maker/VEXOold)';
export const FEED_TIMEOUT_MS = 15000;
export const MAX_ITEMS_PER_FETCH = 30;
export const ITEM_KEEP_DAYS = 7;

// ---------- 解析 ----------
const ENT = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', middot: '·'};
export function decodeEntities(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
    return ENT[e.toLowerCase()] != null ? ENT[e.toLowerCase()] : m;
  });
}
export function stripHtml(s) {
  let t = String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  t = decodeEntities(t);   // 有的源把 HTML 转义后放在描述里
  t = t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ');
  return decodeEntities(t).replace(/\s+/g, ' ').trim();
}
function tag(block, names) {
  for (const n of names) {
    const re = new RegExp('<' + n + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + n + '>', 'i');
    const m = re.exec(block);
    if (m) return m[1];
  }
  return '';
}
function atomLink(block) {
  const links = [...block.matchAll(/<link\b([^>]*?)\/?>/gi)].map(m => m[1]);
  let best = null;
  for (const a of links) {
    const href = /href\s*=\s*"([^"]+)"|href\s*=\s*'([^']+)'/i.exec(a);
    if (!href) continue;
    const rel = /rel\s*=\s*"([^"]+)"/i.exec(a);
    if (!rel || rel[1] === 'alternate') return href[1] || href[2];
    if (!best) best = href[1] || href[2];
  }
  return best;
}
export function cleanUrl(raw) {
  const s = stripHtml(raw).trim();
  try { const u = new URL(s); if (u.protocol !== 'http:' && u.protocol !== 'https:') return null; u.username = ''; u.password = ''; return u.toString(); } catch { return null; }
}
function parseDate(s) { const t = Date.parse(stripHtml(s)); return Number.isFinite(t) ? t : null; }

/** 解析 RSS 2.0 / RDF（<item>）和 Atom（<entry>）。返回 [{guid, url, title, summary, publishedAt}]。 */
export function parseFeed(xml) {
  const s = String(xml || '');
  if (!/<(rss|rdf:RDF|feed)\b/i.test(s)) throw new Error('不是 RSS / Atom');
  const isAtom = /<feed\b/i.test(s) && !/<item\b/i.test(s);
  const blocks = isAtom ? [...s.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)] : [...s.matchAll(/<item\b[\s\S]*?<\/item>/gi)];
  const out = [];
  for (const m of blocks) {
    const b = m[0];
    const title = stripHtml(tag(b, ['title']));
    let url = isAtom ? atomLink(b) : stripHtml(tag(b, ['link']));
    if (!url && !isAtom) { const g = stripHtml(tag(b, ['guid'])); if (/^https?:\/\//.test(g)) url = g; }
    url = url ? cleanUrl(url) : null;
    if (!title || !url) continue;
    const summary = stripHtml(tag(b, isAtom ? ['summary', 'content'] : ['description', 'content:encoded', 'summary'])).slice(0, 600);
    const guid = stripHtml(tag(b, ['guid', 'id'])) || url;
    const publishedAt = parseDate(tag(b, ['pubDate', 'dc:date', 'published', 'updated']));
    out.push({guid: guid.slice(0, 300), url, title: title.slice(0, 200), summary, publishedAt});
  }
  return out;
}

// ---------- 繁转简 ----------
let t2s = null;
export async function toSimplified(text) {
  if (!text) return text;
  if (!t2s) {
    try { const m = await import('opencc-js'); const C = m.Converter || (m.default && m.default.Converter); t2s = C({from: 'tw', to: 'cn'}); }
    catch { t2s = s => s; }   // 没装 opencc-js 时原样返回，不影响其他功能
  }
  return t2s(text);
}

// ---------- 防照搬 ----------
const norm = s => [...String(s || '').toLowerCase().replace(/https?:\/\/\S+/g, '').replace(/[\s\p{P}\p{S}]/gu, '')];
/** 生成文字里有多少比例的 8 字片段在原文（标题 + 摘要）里原样出现过。英文按 8 个字母算，宽松一些。 */
export function overlapRatio(generated, source, n = 8) {
  const g = norm(generated), src = norm(source).join('');
  if (g.length < n) return 0;
  let hit = 0, total = 0;
  for (let i = 0; i + n <= g.length; i++) { total++; if (src.includes(g.slice(i, i + n).join(''))) hit++; }
  return total ? hit / total : 0;
}
export const MAX_OVERLAP = 0.3;

/** 去掉模型自己写的网址、电话、微信号、话题外广告痕迹。 */
export function scrubAiText(s) {
  return String(s || '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/www\.\S+/gi, '')
    .replace(/(?:\+?86[-\s]?)?1[3-9]\d{9}/g, '')
    .replace(/(微信|vx|v信|wx|qq)[:：]?\s*[A-Za-z0-9_-]{5,}/gi, '')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

export const POST_MAX = 280;      // 普通账号发帖上限（vip-config basic.post）
export const COMMENT_MAX = 280;
/** 拼成最终帖子：观点 + 空行 + 「来源：链接」。超长时截观点，不截链接。 */
export function composePost(take, url, max = POST_MAX) {
  const tail = '\n\n来源：' + url;
  const room = max - [...tail].length;
  let body = [...String(take || '').trim()];
  if (room < 20) return null;
  if (body.length > room) body = body.slice(0, room - 1).concat('…');
  return body.join('') + tail;
}

export function guidHash(s) { return createHash('sha256').update(String(s)).digest('base64url').slice(0, 32); }

// ---------- 提示词 ----------
export function postMessages({persona, item}) {
  const sys = `你是社区用户「${persona.displayName}」，平时关注${persona.interestLabels}，说话风格：${persona.tone}。` +
    '下面是一条新闻的标题和摘要。请用你自己的话写一段 60–160 字的中文看法，口语化，可以提一个问题引发讨论。' +
    '不要复述或翻译原文句子，不要编造新闻里没有的事实，不要带链接、联系方式和广告。只输出 JSON：{"text":"..."}';
  return [{role: 'system', content: sys}, {role: 'user', content: JSON.stringify({title: item.title, summary: String(item.summary || '').slice(0, 400)})}];
}
export function commentMessages({persona, post, comments = [], replyTo = null}) {
  const sys = `你是社区用户「${persona.displayName}」，说话风格：${persona.tone}。` +
    (replyTo ? '请针对下面这条评论回复一句' : '请针对下面这条帖子写一句评论') +
    '，15–60 个字，自然、友好、有内容，不要复述原文，不要带链接和联系方式，不要自称 AI。只输出 JSON：{"text":"..."}';
  const user = {post: String(post.text || '').slice(0, 500), recentComments: comments.slice(0, 5).map(c => String(c.text || '').slice(0, 100))};
  if (replyTo) user.replyTo = String(replyTo.text || '').slice(0, 200);
  return [{role: 'system', content: sys}, {role: 'user', content: JSON.stringify(user)}];
}
export function groupMessages({persona, communityName, recent = []}) {
  const sys = `你是社区用户「${persona.displayName}」，在小组「${communityName}」里聊天，说话风格：${persona.tone}。` +
    '根据最近的聊天接一句话（或者开一个和小组主题相关的轻松话题），10–60 个字，自然友好，不要带链接和联系方式，不要自称 AI。只输出 JSON：{"text":"..."}';
  return [{role: 'system', content: sys}, {role: 'user', content: JSON.stringify({recent: recent.slice(-10).map(m => String(m.text || '').slice(0, 100))})}];
}
/** 解析模型的 JSON 输出（容忍 ```json 包裹）。 */
export function parseAiText(content) {
  let s = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  try { const j = JSON.parse(s); return String((j && j.text) || '').trim(); } catch { return s.startsWith('{') ? '' : s; }
}

// ---------- 来源管理 + 抓取 ----------
export function createPersonaFeeds(db, {now = Date.now, fetchImpl = globalThis.fetch, timeoutMs = FEED_TIMEOUT_MS} = {}) {
  const q = {
    all: db.prepare('SELECT * FROM ai_feed_sources ORDER BY id'),
    byId: db.prepare('SELECT * FROM ai_feed_sources WHERE id=?'),
    byUrl: db.prepare('SELECT * FROM ai_feed_sources WHERE url=?'),
    ins: db.prepare('INSERT INTO ai_feed_sources(name,url,category,lang,convert,enabled,builtin,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)'),
    upd: db.prepare('UPDATE ai_feed_sources SET name=?, category=?, lang=?, enabled=?, updated_at=? WHERE id=?'),
    del: db.prepare('DELETE FROM ai_feed_sources WHERE id=?'),
    delItems: db.prepare('DELETE FROM ai_feed_items WHERE source_id=? AND used_at IS NULL'),
    okRun: db.prepare('UPDATE ai_feed_sources SET last_fetched_at=?, last_ok_at=?, last_error=NULL, etag=?, last_modified=?, item_count=?, updated_at=? WHERE id=?'),
    errRun: db.prepare('UPDATE ai_feed_sources SET last_fetched_at=?, last_error=?, updated_at=? WHERE id=?'),
    insItem: db.prepare('INSERT OR IGNORE INTO ai_feed_items(source_id,guid,url,title,summary,category,published_at,fetched_at) VALUES(?,?,?,?,?,?,?,?)'),
    prune: db.prepare('DELETE FROM ai_feed_items WHERE fetched_at < ? AND used_at IS NULL'),
    unused: db.prepare('SELECT COUNT(*) n FROM ai_feed_items WHERE used_at IS NULL AND fetched_at >= ?'),
    pick: db.prepare(`SELECT i.* FROM ai_feed_items i JOIN ai_feed_sources s ON s.id=i.source_id
      WHERE i.used_at IS NULL AND s.enabled=1 AND i.category IN (SELECT value FROM json_each(?)) AND i.fetched_at >= ?
        AND NOT EXISTS (SELECT 1 FROM ai_feed_items j WHERE j.url=i.url AND j.used_at IS NOT NULL)
      ORDER BY COALESCE(i.published_at, i.fetched_at) DESC LIMIT 20`),
    use: db.prepare('UPDATE ai_feed_items SET used_post_id=?, used_by=?, used_at=? WHERE id=? AND used_at IS NULL'),
    burn: db.prepare("UPDATE ai_feed_items SET used_post_id='skipped', used_at=? WHERE id=? AND used_at IS NULL"),
  };

  function seed() {
    const t = now();
    for (const s of DEFAULT_SOURCES) if (!q.byUrl.get(s.url)) q.ins.run(s.name, s.url, s.category, s.lang || 'zh', s.convert || null, s.enabled ? 1 : 0, 1, t, t);
  }
  const pub = r => r && ({id: r.id, name: r.name, url: r.url, category: r.category, categoryLabel: CATEGORY_LABEL[r.category] || r.category,
    lang: r.lang, convert: r.convert || null, enabled: !!r.enabled, builtin: !!r.builtin, lastFetchedAt: r.last_fetched_at, lastOkAt: r.last_ok_at,
    lastError: r.last_error, itemCount: r.item_count});
  function list() { return q.all.all().map(pub); }

  function checkCategory(category, url) {
    if (!PERSONA_CATEGORIES.includes(category)) { const e = new Error('分类不正确'); e.code = 'BAD_CATEGORY'; throw e; }
    if (category === 'politics' && !politicsAllowed(url)) { const e = new Error('时政分类只允许中新网的来源'); e.code = 'POLITICS_SOURCE'; throw e; }
  }

  async function download(url, {etag, lastModified} = {}) {
    const headers = {'User-Agent': FEED_UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5'};
    if (etag) headers['If-None-Match'] = etag;
    if (lastModified) headers['If-Modified-Since'] = lastModified;
    const t0 = now();
    const res = await fetchImpl(url, {headers, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs)});
    if (res.status === 304) return {notModified: true, ms: now() - t0};
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    return {text, etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified'), ms: now() - t0};
  }

  async function itemsFrom(src, text) {
    let items = parseFeed(text).slice(0, MAX_ITEMS_PER_FETCH);
    if (src.convert === 't2s') {
      items = await Promise.all(items.map(async it => ({...it, title: await toSimplified(it.title), summary: await toSimplified(it.summary)})));
    }
    return items;
  }

  /** 抓一个来源并入库。返回 {ok, added, total, error}。 */
  async function fetchSource(src) {
    const t = now();
    try {
      const r = await download(src.url, {etag: src.etag, lastModified: src.last_modified});
      if (r.notModified) { q.okRun.run(t, t, src.etag, src.last_modified, src.item_count, t, src.id); return {ok: true, added: 0, total: src.item_count, notModified: true}; }
      const items = await itemsFrom(src, r.text);
      let added = 0;
      for (const it of items) added += Number(q.insItem.run(src.id, guidHash(it.guid), it.url, it.title, it.summary || '', src.category, it.publishedAt, t).changes || 0);
      q.okRun.run(t, t, r.etag || null, r.lastModified || null, items.length, t, src.id);
      return {ok: true, added, total: items.length};
    } catch (e) {
      const msg = String((e && e.name === 'TimeoutError') ? '超时' : (e && e.message) || e).slice(0, 200);
      q.errRun.run(t, msg, t, src.id);
      return {ok: false, added: 0, total: 0, error: msg};
    }
  }

  async function refreshAll() {
    const res = [];
    for (const s of q.all.all()) if (s.enabled) res.push({id: s.id, ...(await fetchSource(s))});
    q.prune.run(now() - ITEM_KEEP_DAYS * 86400e3);
    return res;
  }

  /** 管理端「测试来源」：只抓不入库。 */
  async function test(url, {convert} = {}) {
    const t0 = now();
    const r = await download(url);
    const items = await itemsFrom({convert}, r.text || '');
    return {ok: true, items: items.slice(0, 10).map(i => ({title: i.title, url: i.url, publishedAt: i.publishedAt})), count: items.length, ms: now() - t0};
  }

  async function add({name, url, category, lang = 'zh', convert = null}) {
    const u = cleanUrl(url);
    if (!u) { const e = new Error('地址不正确，只支持 http / https'); e.code = 'BAD_URL'; throw e; }
    const nm = String(name || '').trim().slice(0, 40);
    if (!nm) { const e = new Error('请填写来源名称'); e.code = 'BAD_NAME'; throw e; }
    checkCategory(category, u);
    if (q.byUrl.get(u)) { const e = new Error('这个来源已经添加过了'); e.code = 'EXISTS'; throw e; }
    let probe;
    try { probe = await test(u, {convert}); }
    catch (e) { const er = new Error('抓不到这个来源：' + String((e && e.message) || e).slice(0, 120)); er.code = 'BAD_FEED'; throw er; }
    if (!probe.count) { const er = new Error('这个地址里没有读到新闻条目'); er.code = 'BAD_FEED'; throw er; }
    const t = now();
    const r = q.ins.run(nm, u, category, lang === 'en' ? 'en' : 'zh', convert === 't2s' ? 't2s' : null, 1, 0, t, t);
    return pub(q.byId.get(Number(r.lastInsertRowid)));
  }
  function update(id, body = {}) {
    const r = q.byId.get(Number(id));
    if (!r) { const e = new Error('来源不存在'); e.code = 'NOT_FOUND'; throw e; }
    const category = body.category != null ? String(body.category) : r.category;
    checkCategory(category, r.url);
    const name = body.name != null ? String(body.name).trim().slice(0, 40) || r.name : r.name;
    const lang = body.lang != null ? (body.lang === 'en' ? 'en' : 'zh') : r.lang;
    const enabled = body.enabled != null ? (body.enabled ? 1 : 0) : r.enabled;
    q.upd.run(name, category, lang, enabled, now(), r.id);
    return pub(q.byId.get(r.id));
  }
  function remove(id) {
    const r = q.byId.get(Number(id));
    if (!r) { const e = new Error('来源不存在'); e.code = 'NOT_FOUND'; throw e; }
    q.delItems.run(r.id); q.del.run(r.id);
    return {deleted: r.id};
  }

  /** 给某个账号挑一条没用过的新闻（同一原文链接全站只用一次）。 */
  function pickItem(categories) {
    const rows = q.pick.all(JSON.stringify(categories && categories.length ? categories : PERSONA_CATEGORIES), now() - 2 * 86400e3);
    return rows.length ? rows[Math.floor(Math.random() * Math.min(rows.length, 5))] : null;
  }
  function markUsed(itemId, postId, userId) { return Number(q.use.run(postId, userId, now(), itemId).changes || 0) > 0; }
  function burn(itemId) { q.burn.run(now(), itemId); }
  function stats() {
    const all = q.all.all();
    return {enabled: all.filter(s => s.enabled).length, failing: all.filter(s => s.enabled && s.last_error).length, unusedItems: q.unused.get(now() - 2 * 86400e3).n};
  }
  return {seed, list, add, update, remove, test, fetchSource, refreshAll, pickItem, markUsed, burn, stats, byId: id => q.byId.get(Number(id))};
}
