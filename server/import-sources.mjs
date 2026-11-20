// 外部帖来源目录与解析。能访问的源 enabled=true；测不通的保留在目录里并写明原因，默认不拉。
// 新条目一律交给 import-feed.mjs 的 ingest()（2.1.0 AI 审查就在那里），不要另写入库。
import {needsFinanceReview} from './post-category.mjs';

const T = (id, name, category, extra = {}) => Object.freeze({
  id, name, category,
  label: extra.label || ('来自 ' + name),
  enabled: extra.enabled !== false,
  kind: extra.kind || 'rss',
  url: extra.url || '',
  avatarHosts: Object.freeze(extra.avatarHosts || []),
  disabledReason: extra.disabledReason || '',
});

// 目录里同时放启用和停用的源，方便对照线上探测结果。id 一经使用不要改。
export const FEED_SOURCES = Object.freeze([
  T('v2ex', 'V2EX', 'tech', {kind: 'builtin', label: '来自 V2EX', avatarHosts: ['v2ex.com', 'www.v2ex.com', 'cdn.v2ex.com', 'cdn.v2ex.co', 'i.v2ex.co']}),
  T('hn', 'Hacker News', 'tech', {kind: 'builtin', label: '来自 HN'}),

  // —— 中文科技（线上可访问）——
  T('sspai', '少数派', 'tech', {url: 'https://sspai.com/feed', avatarHosts: ['sspai.com', 'cdn.sspai.com']}),
  T('ithome', 'IT之家', 'tech', {url: 'https://www.ithome.com/rss/', avatarHosts: ['ithome.com', 'img.ithome.com']}),
  T('juejin', '掘金热榜', 'tech', {kind: 'juejin', url: 'https://api.juejin.cn/content_api/v1/content/article_rank?category_id=1&type=hot',
    avatarHosts: ['juejin.cn', 'byteimg.com', 'bytecdntp.com', 'bytednsdoc.com']}),
  T('solidot', 'Solidot', 'tech', {url: 'https://www.solidot.org/index.rss', avatarHosts: ['solidot.org']}),

  // —— 英文科技 ——
  T('github_trending', 'GitHub Trending', 'tech', {kind: 'github_trending', url: 'https://github.com/trending',
    avatarHosts: ['github.com', 'githubusercontent.com', 'avatars.githubusercontent.com']}),
  T('producthunt', 'Product Hunt', 'tech', {url: 'https://www.producthunt.com/feed',
    avatarHosts: ['producthunt.com', 'imgix.net']}),

  // —— 综合热点（B 站走官方接口，不走公共 RSSHub）——
  T('bilibili', 'B站热门', 'life', {kind: 'bilibili', url: 'https://api.bilibili.com/x/web-interface/popular?ps=20',
    avatarHosts: ['hdslb.com']}),

  // —— 币圈 / 游戏 / 财经（线上可访问）——
  T('panews', 'PANews', 'crypto', {url: 'https://www.panewslab.com/rss.xml?lang=zh&type=NEWS&featured=true',
    avatarHosts: ['panewslab.com']}),
  T('cointelegraph', 'Cointelegraph', 'crypto', {url: 'https://cointelegraph.com/rss',
    avatarHosts: ['cointelegraph.com']}),
  T('gcores', '机核', 'game', {url: 'https://www.gcores.com/rss', avatarHosts: ['gcores.com']}),
  T('ign', 'IGN', 'game', {url: 'https://feeds.feedburner.com/ign/all', avatarHosts: ['ign.com', 'ignimgs.com']}),
  T('wallstcn', '华尔街见闻', 'finance', {kind: 'wallstcn',
    url: 'https://api-one.wallstcn.com/apiv1/content/information-flow?channel=global&accept=article&limit=20',
    avatarHosts: ['wallstcn.com', 'awxcdn.com']}),

  // —— 停用：线上探测不可用，保留条目方便以后重试 ——
  T('36kr', '36氪', 'tech', {enabled: false, url: 'https://36kr.com/feed',
    disabledReason: 'https://36kr.com/feed 返回的是 HTML 网页，不是 RSS'}),
  T('huxiu', '虎嗅', 'tech', {enabled: false, url: 'https://www.huxiu.com/rss/0.xml',
    disabledReason: '线上请求超时'}),
  T('lobsters', 'Lobsters', 'tech', {enabled: false, url: 'https://lobste.rs/rss',
    disabledReason: '线上请求超时'}),
  T('reddit', 'Reddit r/technology', 'tech', {enabled: false, url: 'https://www.reddit.com/r/technology/.rss',
    disabledReason: '线上无法访问'}),
  T('weibo', '微博热搜', 'news', {enabled: false, kind: 'json', url: 'https://weibo.com/ajax/side/hotSearch',
    disabledReason: '线上被拦；公共 RSSHub 实例返回 403，需自建实例后再接'}),
  T('zhihu', '知乎热榜', 'news', {enabled: false, kind: 'json',
    url: 'https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=50',
    disabledReason: '线上被拦；公共 RSSHub 实例返回 403，需自建实例后再接'}),
  T('blockbeats', '律动 BlockBeats', 'crypto', {enabled: false, url: 'https://api.theblockbeats.news/v1/open-api/home-xml',
    disabledReason: '线上请求超时'}),
  T('coindesk', 'CoinDesk', 'crypto', {enabled: false, url: 'https://www.coindesk.com/arc/outboundfeeds/rss/',
    disabledReason: '线上返回 403'}),
  T('gamersky', '游民星空', 'game', {enabled: false, url: 'https://www.gamersky.com/rss/',
    disabledReason: '线上返回 403'}),
  T('cls', '财联社', 'finance', {enabled: false, kind: 'json', url: 'https://www.cls.cn/nodeapi/telegraphList?rn=20',
    disabledReason: '线上返回 404'}),
  T('xueqiu', '雪球热帖', 'finance', {enabled: false, kind: 'json',
    url: 'https://xueqiu.com/statuses/hot/listV2.json?since_id=-1&size=15',
    disabledReason: '线上返回防火墙拦截页'}),
]);

export const enabledFeedSources = () => FEED_SOURCES.filter(s => s.enabled);
export const disabledFeedSources = () => FEED_SOURCES.filter(s => !s.enabled);
export function feedSourceById(id) {
  const k = String(id || '');
  return FEED_SOURCES.find(s => s.id === k) || null;
}
export function sourceCategoryOf(id) {
  const s = feedSourceById(id);
  return s ? s.category : null;
}
export function sourceNeedsFinanceReview(id) {
  return needsFinanceReview(sourceCategoryOf(id));
}
export const IMPORT_SCOPES = Object.freeze(['all', ...FEED_SOURCES.map(s => s.id)]);
export function isImportScope(scope) {
  return IMPORT_SCOPES.includes(String(scope || ''));
}

export const SOURCE_LABEL = Object.freeze(Object.fromEntries(FEED_SOURCES.map(s => [s.id, s.label])));

export const AVATAR_HOSTS = Object.freeze([...new Set(FEED_SOURCES.flatMap(s => s.avatarHosts || []))]);

function decode(s) {
  let t = String(s == null ? '' : s);
  t = t.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  t = t.replace(/&nbsp;/gi, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
  t = t.replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ''; } });
  t = t.replace(/&#(\d+);/gi, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch { return ''; } });
  return t;
}

function inner(block, tag) {
  const re = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', 'i');
  const m = re.exec(block);
  return m ? decode(m[1]) : '';
}

function attrOf(tagAttrs, name) {
  const m = new RegExp('\\b' + name + '\\s*=\\s*["\']([^"\']+)["\']', 'i').exec(tagAttrs || '');
  return m ? decode(m[1]) : '';
}

function atomLink(block) {
  const re = /<link\b([^>]*?)\/?>/gi;
  let first = '', alt = '';
  let m;
  while ((m = re.exec(block))) {
    const href = attrOf(m[1], 'href');
    if (!href) continue;
    const rel = (attrOf(m[1], 'rel') || '').toLowerCase();
    if (!first) first = href;
    if (!rel || rel === 'alternate') {
      alt = href;
      if (rel === 'alternate') break;
    }
  }
  return alt || first;
}

function trimId(s) {
  return String(s || '').trim().slice(0, 240);
}

function asTime(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number' && Number.isFinite(v)) return v > 1e12 ? v : v * 1000;
  const n = Number(v);
  if (Number.isFinite(n) && n > 1e9) return n > 1e12 ? n : n * 1000;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : 0;
}

function item({sid, url, name, avatar, title, summary, createdAt}) {
  const titleText = String(title || '').replace(/<[^>]+>/g, '').trim();
  const u = String(url || '').trim();
  const id = trimId(sid || u || titleText);
  if (!id || (!titleText && !u)) return null;
  return {
    sid: id,
    url: u,
    name: String(name || '').replace(/<[^>]+>/g, '').trim(),
    avatar: avatar || null,
    title: titleText,
    summary: String(summary || '').trim(),
    createdAt: asTime(createdAt),
  };
}

export function parseRss(xml) {
  const s = String(xml || '');
  const out = [];
  const re = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(s))) {
    const block = m[2];
    const authorBlock = inner(block, 'author');
    const author = (authorBlock ? inner(authorBlock, 'name') || authorBlock : '')
      || inner(block, 'dc:creator') || inner(block, 'creator') || '';
    const link = inner(block, 'link').trim() || atomLink(block);
    const guid = inner(block, 'guid').trim() || inner(block, 'id').trim();
    const it = item({
      sid: guid || link,
      url: link || guid,
      name: author,
      title: inner(block, 'title'),
      summary: inner(block, 'content:encoded') || inner(block, 'content') || inner(block, 'description') || inner(block, 'summary'),
      createdAt: inner(block, 'pubDate') || inner(block, 'published') || inner(block, 'updated') || inner(block, 'dc:date'),
    });
    if (it) out.push(it);
  }
  return out;
}

export function parseGithubTrending(html) {
  const s = String(html || '');
  const out = [];
  const seen = new Set();
  const blocks = s.split(/<article\b/i).slice(1);
  const take = (block) => {
    const m = /href="\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)"/i.exec(block);
    if (!m) return;
    const repo = m[1];
    if (seen.has(repo)) return;
    seen.add(repo);
    const descM = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(block);
    const desc = descM ? decode(descM[1]).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
    const owner = repo.split('/')[0];
    const it = item({
      sid: repo,
      url: 'https://github.com/' + repo,
      name: owner,
      avatar: 'https://avatars.githubusercontent.com/' + owner + '?s=80&v=4',
      title: repo,
      summary: desc,
      createdAt: 0,
    });
    if (it) out.push(it);
  };
  if (blocks.length) blocks.forEach(take);
  if (!out.length) {
    const re = /<h2\b[^>]*>[\s\S]*?href="\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)"/gi;
    let m;
    while ((m = re.exec(s))) take(m[0] + ' href="/' + m[1] + '"');
  }
  return out;
}

function pick(obj, keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    if (obj[k] != null && obj[k] !== '') return obj[k];
  }
  return undefined;
}

export function parseJuejinRank(json) {
  const rows = (json && (json.data || json.items)) || [];
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const content = row.content || row.article_info || row.item_info || row;
    const author = row.author || row.author_info || content.author || {};
    const id = pick(content, ['content_id', 'article_id', 'item_id', 'id']) || pick(row, ['content_id', 'article_id', 'id']);
    const title = pick(content, ['title', 'content_title']) || pick(row, ['title']);
    const brief = pick(content, ['brief', 'brief_content', 'content', 'digest']) || '';
    const name = pick(author, ['user_name', 'name', 'author_name']) || pick(content, ['author_name']) || '';
    const avatar = pick(author, ['avatar_large', 'avatar', 'avatar_url']) || null;
    const url = id ? 'https://juejin.cn/post/' + id : (pick(content, ['url', 'link']) || '');
    const it = item({sid: id || url, url, name, avatar, title, summary: brief, createdAt: pick(content, ['ctime', 'created_at', 'mtime'])});
    if (it) out.push(it);
  }
  return out;
}

export function parseBilibiliPopular(json) {
  const list = (json && json.data && (json.data.list || json.data.archives)) || (json && json.list) || [];
  const out = [];
  for (const row of Array.isArray(list) ? list : []) {
    const owner = row.owner || row.author || {};
    const bvid = row.bvid || '';
    const aid = row.aid || row.id;
    const url = row.short_link_v2 || row.short_link || (bvid ? 'https://www.bilibili.com/video/' + bvid : '');
    const it = item({
      sid: bvid || (aid != null ? 'av' + aid : url),
      url,
      name: owner.name || owner.uname || '',
      avatar: owner.face || owner.avatar || null,
      title: row.title,
      summary: row.desc || row.description || '',
      createdAt: row.pubdate || row.ctime || row.pub_ts,
    });
    if (it) out.push(it);
  }
  return out;
}

export function parseWallstcnFlow(json) {
  const data = (json && json.data) || json || {};
  const rows = data.items || data.information_list || data.feeds || [];
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const r = row.resource || row.article || row;
    const id = pick(r, ['id', 'article_id']) || pick(row, ['id']);
    const url = pick(r, ['uri', 'url', 'page_url', 'share_url'])
      || (id ? 'https://wallstreetcn.com/articles/' + id : '');
    const author = r.author || r.user || {};
    const it = item({
      sid: id != null ? String(id) : url,
      url,
      name: pick(author, ['display_name', 'name', 'nickname']) || pick(r, ['source_name', 'author_name']) || '华尔街见闻',
      avatar: pick(author, ['avatar', 'avatar_url']) || null,
      title: pick(r, ['title', 'content_title']),
      summary: pick(r, ['content_short', 'content', 'summary', 'desc']) || '',
      createdAt: pick(r, ['display_time', 'display_time_ts', 'pub_time', 'created_at', 'time']),
    });
    if (it) out.push(it);
  }
  return out;
}

export function looksLikeRss(text, contentType = '') {
  const ct = String(contentType || '').toLowerCase();
  if (/rss|atom|xml/.test(ct) && !/html/.test(ct)) return true;
  const s = String(text || '').slice(0, 4000);
  return /<(rss|feed|rdf:RDF)\b/i.test(s) && /<(item|entry)\b/i.test(s);
}

export function parseSourcePayload(src, {text = '', json = null, contentType = ''} = {}) {
  const kind = src && src.kind;
  if (kind === 'rss' || kind === 'atom') {
    if (!looksLikeRss(text, contentType)) throw new Error('not rss: ' + (src && src.id));
    return parseRss(text);
  }
  if (kind === 'github_trending') return parseGithubTrending(text);
  if (kind === 'juejin') return parseJuejinRank(json);
  if (kind === 'bilibili') return parseBilibiliPopular(json);
  if (kind === 'wallstcn') return parseWallstcnFlow(json);
  throw new Error('unsupported source kind: ' + kind);
}
