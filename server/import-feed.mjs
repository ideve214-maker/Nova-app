// V2EX / Hacker News 导入：把官方公开接口里的帖子和评论写成 posts、post_comments 里的真实行。
// 不冒充本站用户。界面显示原作者名、头像、来源标记和原帖链接。管理端删/藏/设热帖沿用现有逻辑。
import {randomBytes} from 'node:crypto';
import {hashPassword} from './auth.mjs';

export const IMPORT_USERNAME = 'vexo_import';
export const IMPORT_EMAIL = 'vexo-import@vexo.invalid';
export const IMPORT_UA = 'VEXO/2.1.0 (feed-import; +https://github.com/ideve214-maker/VEXOold)';
export const SOURCE_LABEL = Object.freeze({v2ex: '来自 V2EX', hn: '来自 HN'});
export const V2EX_HOT = 'https://www.v2ex.com/api/topics/hot.json';
export const V2EX_LATEST = 'https://www.v2ex.com/api/topics/latest.json';
export const v2exRepliesUrl = id => 'https://www.v2ex.com/api/replies/show.json?topic_id=' + encodeURIComponent(id);
export const HN_TOP = 'https://hacker-news.firebaseio.com/v0/topstories.json';
export const HN_NEW = 'https://hacker-news.firebaseio.com/v0/newstories.json';
export const HN_BEST = 'https://hacker-news.firebaseio.com/v0/beststories.json';
export const hnItemUrl = id => 'https://hacker-news.firebaseio.com/v0/item/' + encodeURIComponent(id) + '.json';
export const AVATAR_HOSTS = Object.freeze([
  'v2ex.com', 'www.v2ex.com', 'cdn.v2ex.com', 'cdn.v2ex.co', 'i.v2ex.co',
]);

const nid = (p = 'po_') => p + randomBytes(12).toString('base64url');
const sleep = ms => ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve();

export function htmlToText(s) {
  let t = String(s || '');
  t = t.replace(/\r\n/g, '\n');
  t = t.replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/<\/p>/gi, '\n').replace(/<\/div>/gi, '\n').replace(/<\/li>/gi, '\n');
  t = t.replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => {
    const lab = htmlToText(label).trim();
    return lab && lab !== href ? lab + ' (' + href + ')' : href;
  });
  t = t.replace(/<[^>]+>/g, '');
  t = t.replace(/&nbsp;/gi, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
  t = t.replace(/&#x([0-9a-f]+);/gi, (_, h) => {
    try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ''; }
  });
  t = t.replace(/&#(\d+);/g, (_, n) => {
    try { return String.fromCodePoint(Number(n)); } catch { return ''; }
  });
  return t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function absUrl(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  if (s.startsWith('//')) return 'https:' + s;
  return s;
}

export function isAllowedAvatarHost(u) {
  try {
    const x = new URL(absUrl(u));
    if (x.protocol !== 'https:' && x.protocol !== 'http:') return false;
    const host = x.hostname.toLowerCase();
    return AVATAR_HOSTS.some(h => host === h || host.endsWith('.' + h));
  } catch { return false; }
}

export function extAuthorId(source, name) {
  const n = String(name || 'anonymous').trim() || 'anonymous';
  return 'ext:' + source + ':' + n.replace(/[^\p{L}\p{N}_.-]+/gu, '_').slice(0, 40);
}

export function letterOf(name) {
  const s = String(name || '').trim();
  return [...s][0] || '?';
}

export function letterAvatarData(name) {
  const l = letterOf(name).slice(0, 2);
  const c = colorOf(name);
  const safe = String(l).replace(/[<&]/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" rx="40" fill="${c}"/><text x="40" y="52" text-anchor="middle" fill="#fff" font-size="36" font-family="system-ui,sans-serif">${safe}</text></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

export function colorOf(name) {
  const PAL = ['#2F6F5E', '#5C4A3A', '#243044', '#6B3A4A', '#3A465C', '#6A5A3C'];
  const s = String(name || '');
  return PAL[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % PAL.length];
}

export function proxyAvatarPath(origin) {
  const u = absUrl(origin);
  if (!u || !isAllowedAvatarHost(u)) return '';
  return '/api/import/avatar?u=' + encodeURIComponent(u);
}

function sourceLabelOf(src) { return SOURCE_LABEL[src] || ('来自 ' + src); }

export const IMPORT_DELAY_MS = 800;
export const FETCH_TIMEOUT_MS = 20_000;
export const REPLIES_TIMEOUT_MS = 45_000;
export const FETCH_RETRIES = 3;
export const RETRY_BASE_MS = 1000;

export function isAbortError(e) {
  if (!e) return false;
  if (e.aborted || e.name === 'AbortError' || e.code === 'ABORT_ERR') return true;
  return /aborted/i.test(String(e.message || e));
}

export function describeFetchError(e, url, timeoutMs) {
  if (isAbortError(e)) return 'timeout/aborted after ' + timeoutMs + 'ms fetching ' + url;
  if (e && e.status) return 'HTTP ' + e.status + ' fetching ' + url;
  return String((e && e.message) || e || 'fetch failed') + ' fetching ' + url;
}

function isRetryable(e) {
  if (!e) return false;
  if (isAbortError(e)) return true;
  if (e.status && [429, 500, 502, 503, 504].includes(Number(e.status))) return true;
  return /timeout|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network|fetch failed/i.test(String(e.message || e));
}

async function fetchJson(fetchFn, url, {
  timeoutMs = FETCH_TIMEOUT_MS, headers, retries = FETCH_RETRIES, retryDelayMs = RETRY_BASE_MS, log,
} = {}) {
  const attempts = Math.max(1, Number(retries) || 1);
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetchFn(url, {
        method: 'GET',
        headers: {'User-Agent': IMPORT_UA, Accept: 'application/json', ...(headers || {})},
        signal: ac.signal,
        redirect: 'follow',
      });
      if (!res || !res.ok) {
        const err = new Error('fetch ' + url + ' -> ' + (res && res.status));
        err.status = res && res.status;
        throw err;
      }
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (isRetryable(e) && attempt < attempts) {
        const wait = Math.max(0, Number(retryDelayMs) || 0) * Math.pow(2, attempt - 1);
        if (log) log('import fetch retry', describeFetchError(e, url, timeoutMs), 'attempt', attempt + '/' + attempts, 'waitMs', wait);
        if (wait) await sleep(wait);
        continue;
      }
      if (isAbortError(e)) {
        const err = new Error(describeFetchError(e, url, timeoutMs));
        err.aborted = true;
        err.timeoutMs = timeoutMs;
        throw err;
      }
      throw e;
    } finally { clearTimeout(t); }
  }
  throw lastErr;
}

export function ensureImportUser(db, {now}) {
  const get = db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE');
  let u = get.get(IMPORT_USERNAME);
  if (u) return u;
  const t = now();
  const pw = hashPassword('x' + randomBytes(32).toString('base64url'));
  try {
    db.prepare('INSERT INTO users(username,email,password_hash,role,status,created_at) VALUES(?,?,?,?,?,?)')
      .run(IMPORT_USERNAME, IMPORT_EMAIL, pw, 'user', 'active', t);
  } catch (e) {
    u = get.get(IMPORT_USERNAME) || db.prepare('SELECT * FROM users WHERE email=? COLLATE NOCASE').get(IMPORT_EMAIL);
    if (u) return u;
    throw e;
  }
  return get.get(IMPORT_USERNAME);
}

export function isReservedImportIdentity(username, email) {
  const u = String(username || '').trim().toLowerCase();
  const e = String(email || '').trim().toLowerCase();
  return u === IMPORT_USERNAME || e === IMPORT_EMAIL;
}

export function createImportFeed(db, {
  fetchFn = globalThis.fetch,
  now = Date.now,
  delayMs = IMPORT_DELAY_MS,
  sourceLimit = 20,        // 2.1.0：每个来源每轮最多新入库多少帖（以前是「看多少帖」，已有的也算数，所以每轮几乎没有新帖）
  commentLimit = 20,       // 每帖最多导入多少条评论（2.1.0 起 10 → 20）
  scanLimit = 120,         // 每个来源每轮最多看多少个候选帖
  intervalMs = 2 * 60 * 1000,
  review = null,           // 2.1.0：ai-review.mjs 实例；有就先审后入库
  v2exPerHour = 100,       // V2EX 公开 API 每 IP 每小时约 120 次，自己留余量
  commentRefreshMs = 30 * 60 * 1000, // 已入库帖的评论多久补拉一次
  refreshPerRun = 3,       // 每个来源每轮最多给几条旧帖补拉评论
  hotEvery = 5,            // V2EX 热门榜每几轮拉一次
  timeoutMs = FETCH_TIMEOUT_MS,
  repliesTimeoutMs = REPLIES_TIMEOUT_MS,
  retries = FETCH_RETRIES,
  retryDelayMs,
  log = (...a) => console.error(...a),
} = {}) {
  const backoffMs = retryDelayMs != null ? retryDelayMs : (delayMs > 0 ? RETRY_BASE_MS : 0);
  const jsonOpts = {timeoutMs, retries, retryDelayMs: backoffMs, log};
  const repliesOpts = {timeoutMs: repliesTimeoutMs, retries, retryDelayMs: backoffMs, log};
  const selPost = db.prepare('SELECT * FROM posts WHERE source=? AND source_id=?');
  const selCmt = db.prepare('SELECT * FROM post_comments WHERE source=? AND source_id=?');
  const insPost = db.prepare(`INSERT INTO posts(id,author_id,text,created_at,updated_at,client_id,audience,source,source_id,source_url,ext_author_name,ext_author_avatar)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insCmt = db.prepare(`INSERT INTO post_comments(id,post_id,author_id,parent_id,text,created_at,source,source_id,source_url,ext_author_name,ext_author_avatar)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
  const avatarCache = new Map(); // url -> {buf, mime, at}
  let timer = null;
  let running = false;
  let last = {at: 0, v2ex: null, hn: null};
  let runCount = 0;
  const v2exCalls = [];              // 最近一小时 V2EX 请求时间
  let v2exCooldownUntil = 0;
  const commentFetchedAt = new Map(); // source:sid -> 上次拉评论时间
  async function v2exJson(url, opts = jsonOpts) {
    const t = now();
    while (v2exCalls.length && v2exCalls[0] <= t - 3600e3) v2exCalls.shift();
    if (v2exCooldownUntil > t) throw Object.assign(new Error('v2ex cooldown'), {budget: true});
    if (v2exCalls.length >= v2exPerHour) throw Object.assign(new Error('v2ex hourly budget used'), {budget: true});
    v2exCalls.push(t);
    try { return await fetchJson(fetchFn, url, opts); }
    catch (e) {
      if (e && (e.status === 429 || e.status === 403)) v2exCooldownUntil = now() + 15 * 60e3;
      throw e;
    }
  }
  // 已入库帖要不要补拉评论：评论还没到 commentLimit 条（含上次超时没拉到的），且距上次成功拉取超过 commentRefreshMs
  function refreshDue(source, sid, row) {
    if (!commentLimit || !needsCommentBackfill(row.id)) return false;
    const at = commentFetchedAt.get(source + ':' + sid) || 0;
    return now() - at >= commentRefreshMs;
  }
  function noteFetched(source, sid) {
    if (commentFetchedAt.size > 5000) commentFetchedAt.delete(commentFetchedAt.keys().next().value);
    commentFetchedAt.set(source + ':' + sid, now());
  }
  const newOut = () => ({ok: true, fetched: 0, scanned: 0, imported: 0, comments: 0, skipped: 0, deletedKept: 0,
    rejected: 0, rejectedKept: 0, pending: 0, commentsRejected: 0, commentsPending: 0, error: null});

  /*
   * 2.1.0 入库流程（先审后入库）：
   * post: {source, sid, url, name, avatar, text, createdAt}; comments: [{sourceId, sourceUrl, parentSourceId, authorName, authorAvatar, text, createdAt}]
   * 返回 'imported' | 'exists' | 'rejected' | 'pending' | 'kept'
   */
  async function ingest(post, loadComments, out, state) {
    const existed = selPost.get(post.source, String(post.sid));
    if (existed && blocked(existed)) { out.deletedKept++; return 'kept'; }
    if (!existed && review && review.isRejected(post.source, post.sid)) { out.rejectedKept++; return 'kept'; }
    if (!existed && state.aiDown) { out.pending++; return 'pending'; } // AI 本轮已不可用，不再浪费请求
    if (existed) out.skipped++;
    let comments = [];
    if (commentLimit && (!existed || refreshDue(post.source, post.sid, existed))) {
      if (existed) { if (state.refreshed >= refreshPerRun) return 'exists'; state.refreshed++; }
      try { comments = (await loadComments()) || []; noteFetched(post.source, post.sid); }
      catch (e) {
        if (!e || !e.budget) log('import ' + (post.source === 'v2ex' ? 'v2ex replies' : post.source + ' comments') + ' topic=' + post.sid + (existed ? ' backfill' : '')
          + ' failed: ' + String((e && e.message) || e) + '; will retry on next run');
        comments = [];
      }
    }
    comments = comments.filter(c => c && String(c.text || '').trim() && !selCmt.get(post.source, String(c.sourceId))
      && !(review && review.isRejected(post.source, c.sourceId))).slice(0, commentLimit);
    if (existed && !comments.length) return 'exists';
    let r = null;
    if (review) {
      r = await review.reviewImport({
        post: existed ? null : {source: post.source, sourceId: post.sid, text: post.text},
        comments: comments.map(c => ({source: post.source, sourceId: c.sourceId, text: c.text})),
      });
      if (!r.ok && r.error) state.aiDown = true;
    }
    let postId = existed && existed.id;
    if (!existed) {
      const v = r && r.post;
      if (v && v.verdict === 'block') {
        out.rejected++;
        review.noteImport({target: 'post', source: post.source, sourceId: post.sid, result: v, action: 'rejected', text: post.text});
        return 'rejected';
      }
      if (v && v.verdict === 'pending') {
        out.pending++;
        review.noteImport({target: 'post', source: post.source, sourceId: post.sid, result: v, action: 'deferred'});
        commentFetchedAt.delete(post.source + ':' + post.sid);
        return 'pending';
      }
      const up = upsertPost({source: post.source, sourceId: post.sid, sourceUrl: post.url, authorName: post.name, authorAvatar: post.avatar, text: post.text, createdAt: post.createdAt});
      if (up.skipped === 'deleted') { out.deletedKept++; return 'kept'; }
      if (up.imported) out.imported++; else out.skipped++;
      postId = up.row && up.row.id;
      if (review && v && up.imported) review.noteImport({target: 'post', source: post.source, sourceId: post.sid, refId: postId, result: v, action: 'inserted'});
    }
    if (!postId) return existed ? 'exists' : 'imported';
    for (const c of comments) {
      const v = r && r.comments.get(String(c.sourceId));
      if (v && v.verdict === 'block') {
        out.commentsRejected++;
        review.noteImport({target: 'comment', source: post.source, sourceId: c.sourceId, postRefId: postId, result: v, action: 'rejected', text: c.text});
        continue;
      }
      if (v && v.verdict === 'pending') { out.commentsPending++; commentFetchedAt.delete(post.source + ':' + post.sid); continue; }
      let parentId = null;
      if (c.parentSourceId) { const pr = selCmt.get(post.source, String(c.parentSourceId)); if (pr && pr.post_id === postId) parentId = pr.id; }
      const cr = upsertComment({source: post.source, sourceId: c.sourceId, sourceUrl: c.sourceUrl, postId, parentId,
        authorName: c.authorName, authorAvatar: c.authorAvatar, text: c.text, createdAt: c.createdAt});
      if (cr.imported) {
        out.comments++;
        if (review && v) review.noteImport({target: 'comment', source: post.source, sourceId: c.sourceId, refId: cr.row.id, postRefId: postId, result: v, action: 'inserted'});
      }
    }
    return existed ? 'exists' : 'imported';
  }

  function ownerId() {
    return Number(ensureImportUser(db, {now}).id);
  }

  function blocked(row) {
    return !!(row && (row.deleted_at || row.admin_hidden));
  }

  const countImportedComments = db.prepare(
    "SELECT COUNT(*) n FROM post_comments WHERE post_id=? AND source IS NOT NULL AND IFNULL(deleted_at,0)=0",
  );
  function needsCommentBackfill(postId) {
    if (!postId || !commentLimit) return false;
    return Number(countImportedComments.get(postId).n) < commentLimit;
  }

  function upsertPost({source, sourceId, sourceUrl, authorName, authorAvatar, text, createdAt}) {
    const existed = selPost.get(source, String(sourceId));
    if (existed) {
      if (blocked(existed)) return {row: existed, skipped: 'deleted', imported: false};
      return {row: existed, skipped: 'exists', imported: false};
    }
    const id = nid('po_');
    const t = Number(createdAt) > 0 ? Number(createdAt) : now();
    const av = authorAvatar ? (proxyAvatarPath(authorAvatar) || absUrl(authorAvatar)) : null;
    try {
      insPost.run(id, ownerId(), text, t, t, null, 'public', source, String(sourceId), sourceUrl || '', authorName || '', av);
    } catch (e) {
      if (/UNIQUE/i.test(String(e.message))) {
        const again = selPost.get(source, String(sourceId));
        if (again) return {row: again, skipped: blocked(again) ? 'deleted' : 'exists', imported: false};
      }
      throw e;
    }
    return {row: selPost.get(source, String(sourceId)), skipped: null, imported: true};
  }

  function upsertComment({source, sourceId, sourceUrl, postId, parentId, authorName, authorAvatar, text, createdAt}) {
    const existed = selCmt.get(source, String(sourceId));
    if (existed) {
      if (blocked(existed)) return {row: existed, skipped: 'deleted', imported: false};
      return {row: existed, skipped: 'exists', imported: false};
    }
    const body = String(text || '').trim();
    if (!body) return {row: null, skipped: 'empty', imported: false};
    const id = nid('co_');
    const t = Number(createdAt) > 0 ? Number(createdAt) : now();
    const av = authorAvatar ? (proxyAvatarPath(authorAvatar) || absUrl(authorAvatar)) : null;
    try {
      insCmt.run(id, postId, ownerId(), parentId || null, body, t, source, String(sourceId), sourceUrl || '', authorName || '', av);
    } catch (e) {
      if (/UNIQUE/i.test(String(e.message))) {
        const again = selCmt.get(source, String(sourceId));
        if (again) return {row: again, skipped: blocked(again) ? 'deleted' : 'exists', imported: false};
      }
      throw e;
    }
    return {row: selCmt.get(source, String(sourceId)), skipped: null, imported: true};
  }

  async function importV2ex(state) {
    const out = newOut();
    const lists = [];
    const errors = [];
    // 最新帖每轮拉；热门帖变化慢，每 hotEvery 轮拉一次，省下 V2EX 每小时的请求额度给评论
    const urls = (runCount - 1) % hotEvery === 0 ? [V2EX_LATEST, V2EX_HOT] : [V2EX_LATEST];
    for (const u of urls) {
      try {
        const raw = await v2exJson(u);
        if (Array.isArray(raw)) lists.push(raw); else errors.push('v2ex list is not a list');
      } catch (e) { errors.push(e.message || String(e)); }
    }
    if (!lists.length && !urls.includes(V2EX_HOT)) { // 最新榜失败时退回热门榜
      try { const raw = await v2exJson(V2EX_HOT); if (Array.isArray(raw)) lists.push(raw); } catch (e) { errors.push(e.message || String(e)); }
    }
    if (!lists.length) { out.ok = false; out.error = errors[errors.length - 1] || 'v2ex hot is not a list'; return out; }
    if (errors.length) out.error = errors.join('; ');
    const seen = new Set();
    const batch = [];
    for (const t of lists.flat()) {
      const sid = t && (t.id != null ? String(t.id) : '');
      if (!sid) { out.skipped++; continue; }
      if (seen.has(sid)) continue;
      seen.add(sid); batch.push(t);
    }
    out.fetched = batch.length;
    for (const topic of batch.slice(0, scanLimit)) {
      if (out.imported >= sourceLimit) break;
      out.scanned++;
      const sid = String(topic.id);
      const member = topic.member || {};
      const name = String(member.username || member.name || 'v2ex').trim() || 'v2ex';
      const avatar = absUrl(member.avatar_large || member.avatar_normal || member.avatar_mini || '');
      const url = String(topic.url || ('https://www.v2ex.com/t/' + sid));
      const title = String(topic.title || '').trim();
      const body = htmlToText(topic.content || topic.content_rendered || '');
      const text = [title, body].filter(Boolean).join('\n\n');
      const createdAt = (Number(topic.created) || 0) * 1000;
      await ingest({source: 'v2ex', sid, url, name, avatar, text, createdAt}, async () => {
        await sleep(delayMs);
        const raw = await v2exJson(v2exRepliesUrl(sid), repliesOpts);
        if (!Array.isArray(raw)) return [];
        return raw.slice(0, commentLimit * 2).map(r => {
          const cid = r && r.id != null ? String(r.id) : '';
          if (!cid) return null;
          const m = r.member || {};
          return {
            sourceId: 'v2ex-reply-' + cid, sourceUrl: url + '#reply' + cid, parentSourceId: null,
            authorName: String(m.username || m.name || 'v2ex').trim() || 'v2ex',
            authorAvatar: absUrl(m.avatar_large || m.avatar_normal || m.avatar_mini || ''),
            text: htmlToText(r.content || r.content_rendered || ''), createdAt: (Number(r.created) || 0) * 1000,
          };
        }).filter(Boolean);
      }, out, state);
    }
    return out;
  }

  // HN 官方 Firebase 接口没有频率限制，用更短的间隔；V2EX 仍按 delayMs（默认 800ms）
  const hnDelayMs = Math.min(delayMs, 100);
  async function hnItem(id) {
    return fetchJson(fetchFn, hnItemUrl(id), jsonOpts);
  }

  async function importHn(state) {
    const out = newOut();
    const lists = [];
    const errors = [];
    for (const u of [HN_TOP, HN_NEW, HN_BEST]) {
      try {
        const raw = await fetchJson(fetchFn, u, jsonOpts);
        if (Array.isArray(raw)) lists.push(raw); else errors.push('hn list is not a list');
      } catch (e) { errors.push(e.message || String(e)); }
    }
    if (!lists.length) { out.ok = false; out.error = errors[0] || 'hn topstories is not a list'; return out; }
    if (errors.length) out.error = errors.join('; ');
    // 交错合并：热门、最新、最佳轮流取，去重
    const ids = [], seen = new Set();
    for (let i = 0; ids.length < scanLimit && lists.some(l => i < l.length); i++) {
      for (const l of lists) {
        const id = l[i];
        if (id == null || seen.has(String(id))) continue;
        seen.add(String(id)); ids.push(id);
        if (ids.length >= scanLimit) break;
      }
    }
    out.fetched = ids.length;
    for (const rawId of ids) {
      if (out.imported >= sourceLimit) break;
      const sid = String(rawId);
      const existed = selPost.get('hn', sid);
      if (existed && blocked(existed)) { out.deletedKept++; continue; }
      if (!existed && review && review.isRejected('hn', sid)) { out.rejectedKept++; continue; }
      if (existed && !(state.refreshed < refreshPerRun && refreshDue('hn', sid, existed))) { out.skipped++; continue; }
      if (!existed && state.aiDown) { out.pending++; continue; }
      out.scanned++;
      await sleep(hnDelayMs);
      let story;
      try { story = await hnItem(rawId); }
      catch (e) { log('import hn item', rawId, e.message || e); continue; }
      if (!story || story.dead || story.deleted || story.type !== 'story') continue;
      const name = String(story.by || 'HN').trim() || 'HN';
      const title = String(story.title || '').trim(); // 英文标题保持原文
      const body = htmlToText(story.text || '');
      const parts = [title];
      if (story.url) parts.push(String(story.url));
      if (body) parts.push(body);
      const text = parts.filter(Boolean).join('\n\n');
      await ingest({source: 'hn', sid, url: 'https://news.ycombinator.com/item?id=' + sid, name, avatar: null, text,
        createdAt: (Number(story.time) || 0) * 1000}, async () => {
        const got = [];
        const queue = Array.isArray(story.kids) ? story.kids.slice() : [];
        let tries = 0;
        while (queue.length && got.length < commentLimit && tries < commentLimit * 3) {
          const kid = queue.shift();
          tries++;
          await sleep(hnDelayMs);
          let c;
          try { c = await hnItem(kid); }
          catch (e) { log('import hn comment', kid, e.message || e); continue; }
          if (!c) continue;
          if (Array.isArray(c.kids)) queue.push(...c.kids);
          if (c.dead || c.deleted || c.type !== 'comment') continue;
          const ctext = htmlToText(c.text || '');
          if (!ctext) continue;
          got.push({
            sourceId: 'hn-comment-' + c.id, sourceUrl: 'https://news.ycombinator.com/item?id=' + c.id,
            parentSourceId: c.parent != null && String(c.parent) !== sid ? 'hn-comment-' + c.parent : null,
            authorName: String(c.by || 'HN').trim() || 'HN', authorAvatar: null,
            text: ctext, createdAt: (Number(c.time) || 0) * 1000,
          });
        }
        return got;
      }, out, state);
    }
    return out;
  }

  async function run() {
    if (running) return last;
    running = true;
    const started = now();
    try {
      runCount++;
      const state = {aiDown: false, refreshed: 0};
      const v2ex = await importV2ex(state);
      state.refreshed = 0;
      const hn = await importHn(state);
      let backfill = null;
      if (review) {
        review.pruneLogs();
        const st = review.settings();
        // 2.1.0：已发布但还没审过的外部帖，每轮顺带补审一小批（AI 本轮可用时）
        if (st.enabled && st.autoBackfill && !state.aiDown) {
          try { backfill = await review.backfill({limit: Math.min(10, st.backfillBatch)}); }
          catch (e) { log('import backfill', e.message || e); }
        }
      }
      const sum = k => (v2ex[k] || 0) + (hn[k] || 0);
      last = {at: started, durationMs: now() - started, v2ex, hn,
        total: {imported: sum('imported'), comments: sum('comments'), rejected: sum('rejected'), pending: sum('pending'),
          commentsRejected: sum('commentsRejected'), commentsPending: sum('commentsPending')},
        aiDown: state.aiDown, backfill};
      return last;
    } finally { running = false; }
  }

  function start() {
    if (timer) return;
    const ms = Math.max(60 * 1000, Number(intervalMs) || 2 * 60 * 1000);
    // 启动后稍等再拉，避免和别的启动任务挤在一起
    timer = setTimeout(() => {
      run().catch(e => log('import run', e.message || e));
      timer = setInterval(() => { run().catch(e => log('import run', e.message || e)); }, ms);
      if (typeof timer.unref === 'function') timer.unref();
    }, Math.min(20 * 1000, ms));
    if (typeof timer.unref === 'function') timer.unref();
  }

  function stop() {
    if (timer) { clearTimeout(timer); clearInterval(timer); timer = null; }
  }

  async function avatar(originUrl) {
    const u = absUrl(originUrl);
    if (!isAllowedAvatarHost(u)) return null;
    const hit = avatarCache.get(u);
    if (hit && (now() - hit.at) < 24 * 3600 * 1000) return hit;
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 10000);
    try {
      const res = await fetchFn(u, {
        method: 'GET',
        headers: {'User-Agent': IMPORT_UA, Accept: 'image/*'},
        signal: ac.signal,
        redirect: 'follow',
      });
      if (!res || !res.ok) return null;
      const mime = String((res.headers && (res.headers.get && res.headers.get('content-type'))) || 'image/jpeg').split(';')[0].trim();
      if (!/^image\//i.test(mime) || /svg/i.test(mime)) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length || buf.length > 1024 * 1024) return null;
      const rec = {buf, mime, at: now()};
      if (avatarCache.size > 200) {
        const first = avatarCache.keys().next().value;
        avatarCache.delete(first);
      }
      avatarCache.set(u, rec);
      return rec;
    } catch { return null; }
    finally { clearTimeout(t); }
  }

  return {
    run, start, stop, last: () => last, ensureUser: () => ensureImportUser(db, {now}),
    avatar, upsertPost, upsertComment,
  };
}

export function extAuthorPayload(row, source) {
  const src = source || row.source;
  const name = row.ext_author_name || 'unknown';
  const avatarUrl = row.ext_author_avatar || null;
  return {
    id: extAuthorId(src, name),
    username: name,
    displayName: name,
    avatar: {
      kind: 'image',
      image: avatarUrl || letterAvatarData(name),
      color: colorOf(name),
      letter: letterOf(name),
    },
    vip: false,
    badge: null,
    external: true,
    source: src,
    sourceLabel: sourceLabelOf(src),
    sourceUrl: row.source_url || null,
  };
}
