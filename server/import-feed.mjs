// V2EX / Hacker News 导入：把官方公开接口里的帖子和评论写成 posts、post_comments 里的真实行。
// 不冒充本站用户。界面显示原作者名、头像、来源标记和原帖链接。管理端删/藏/设热帖沿用现有逻辑。
import {randomBytes} from 'node:crypto';
import {hashPassword} from './auth.mjs';

export const IMPORT_USERNAME = 'vexo_import';
export const IMPORT_EMAIL = 'vexo-import@vexo.invalid';
export const IMPORT_UA = 'VEXO/2.0.6 (feed-import; +https://github.com/ideve214-maker/VEXOold)';
export const SOURCE_LABEL = Object.freeze({v2ex: '来自 V2EX', hn: '来自 HN'});
export const V2EX_HOT = 'https://www.v2ex.com/api/topics/hot.json';
export const v2exRepliesUrl = id => 'https://www.v2ex.com/api/replies/show.json?topic_id=' + encodeURIComponent(id);
export const HN_TOP = 'https://hacker-news.firebaseio.com/v0/topstories.json';
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

async function fetchJson(fetchFn, url, {timeoutMs = 15000, headers} = {}) {
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
  } finally { clearTimeout(t); }
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
  delayMs = 250,
  sourceLimit = 20,
  commentLimit = 10,
  intervalMs = 15 * 60 * 1000,
  log = (...a) => console.error(...a),
} = {}) {
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

  function ownerId() {
    return Number(ensureImportUser(db, {now}).id);
  }

  function blocked(row) {
    return !!(row && (row.deleted_at || row.admin_hidden));
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

  async function importV2ex() {
    const out = {ok: true, fetched: 0, imported: 0, comments: 0, skipped: 0, deletedKept: 0, error: null};
    let list;
    try {
      list = await fetchJson(fetchFn, V2EX_HOT);
    } catch (e) {
      out.ok = false;
      out.error = e.message || String(e);
      return out;
    }
    if (!Array.isArray(list)) {
      out.ok = false;
      out.error = 'v2ex hot is not a list';
      return out;
    }
    const batch = list.slice(0, sourceLimit);
    out.fetched = batch.length;
    for (const topic of batch) {
      const sid = topic && (topic.id != null ? String(topic.id) : '');
      if (!sid) { out.skipped++; continue; }
      const member = topic.member || {};
      const name = String(member.username || member.name || 'v2ex').trim() || 'v2ex';
      const avatar = absUrl(member.avatar_large || member.avatar_normal || member.avatar_mini || '');
      const url = String(topic.url || ('https://www.v2ex.com/t/' + sid));
      const title = String(topic.title || '').trim();
      const body = htmlToText(topic.content || topic.content_rendered || '');
      const text = [title, body].filter(Boolean).join('\n\n');
      const createdAt = (Number(topic.created) || 0) * 1000;
      const up = upsertPost({
        source: 'v2ex', sourceId: sid, sourceUrl: url,
        authorName: name, authorAvatar: avatar, text, createdAt,
      });
      if (up.skipped === 'deleted') { out.deletedKept++; continue; }
      if (!up.imported) { out.skipped++; }
      else out.imported++;
      const postId = up.row && up.row.id;
      if (!postId || !commentLimit) continue;
      await sleep(delayMs);
      let replies = [];
      try {
        const raw = await fetchJson(fetchFn, v2exRepliesUrl(sid));
        if (Array.isArray(raw)) replies = raw.slice(0, commentLimit);
      } catch (e) {
        log('import v2ex replies', sid, e.message || e);
        continue;
      }
      for (const r of replies) {
        const cid = r && r.id != null ? String(r.id) : '';
        if (!cid) continue;
        const rn = String((r.member && (r.member.username || r.member.name)) || 'v2ex').trim() || 'v2ex';
        const rav = absUrl((r.member && (r.member.avatar_large || r.member.avatar_normal || r.member.avatar_mini)) || '');
        const ctext = htmlToText(r.content || r.content_rendered || '');
        const cr = upsertComment({
          source: 'v2ex', sourceId: 'v2ex-reply-' + cid,
          sourceUrl: url + '#reply' + cid,
          postId, parentId: null, authorName: rn, authorAvatar: rav,
          text: ctext, createdAt: (Number(r.created) || 0) * 1000,
        });
        if (cr.imported) out.comments++;
      }
    }
    return out;
  }

  async function hnItem(id) {
    return fetchJson(fetchFn, hnItemUrl(id));
  }

  async function importHn() {
    const out = {ok: true, fetched: 0, imported: 0, comments: 0, skipped: 0, deletedKept: 0, error: null};
    let ids;
    try {
      ids = await fetchJson(fetchFn, HN_TOP);
    } catch (e) {
      out.ok = false;
      out.error = e.message || String(e);
      return out;
    }
    if (!Array.isArray(ids)) {
      out.ok = false;
      out.error = 'hn topstories is not a list';
      return out;
    }
    const picked = [];
    for (const rawId of ids) {
      if (picked.length >= sourceLimit) break;
      await sleep(delayMs);
      let item;
      try { item = await hnItem(rawId); }
      catch (e) { log('import hn item', rawId, e.message || e); continue; }
      if (!item || item.dead || item.deleted || item.type !== 'story') continue;
      picked.push(item);
    }
    out.fetched = picked.length;
    for (const story of picked) {
      const sid = String(story.id);
      const name = String(story.by || 'HN').trim() || 'HN';
      const url = story.url || ('https://news.ycombinator.com/item?id=' + sid);
      const title = String(story.title || '').trim(); // 英文标题保持原文
      const body = htmlToText(story.text || '');
      const parts = [title];
      if (story.url) parts.push(String(story.url));
      if (body) parts.push(body);
      const text = parts.filter(Boolean).join('\n\n');
      const up = upsertPost({
        source: 'hn', sourceId: sid,
        sourceUrl: 'https://news.ycombinator.com/item?id=' + sid,
        authorName: name, authorAvatar: null,
        text, createdAt: (Number(story.time) || 0) * 1000,
      });
      if (up.skipped === 'deleted') { out.deletedKept++; continue; }
      if (!up.imported) out.skipped++;
      else out.imported++;
      const postId = up.row && up.row.id;
      if (!postId || !commentLimit) continue;
      const idMap = new Map(); // hn id -> our comment id
      const queue = Array.isArray(story.kids) ? story.kids.slice() : [];
      let taken = 0;
      while (queue.length && taken < commentLimit) {
        const kid = queue.shift();
        await sleep(delayMs);
        let c;
        try { c = await hnItem(kid); }
        catch (e) { log('import hn comment', kid, e.message || e); continue; }
        if (!c || c.dead || c.deleted || c.type !== 'comment') {
          if (c && Array.isArray(c.kids)) queue.push(...c.kids);
          continue;
        }
        const ctext = htmlToText(c.text || '');
        if (!ctext) {
          if (Array.isArray(c.kids)) queue.push(...c.kids);
          continue;
        }
        const parentOur = c.parent != null ? idMap.get(Number(c.parent)) : null;
        const cr = upsertComment({
          source: 'hn', sourceId: 'hn-comment-' + c.id,
          sourceUrl: 'https://news.ycombinator.com/item?id=' + c.id,
          postId, parentId: parentOur || null,
          authorName: String(c.by || 'HN').trim() || 'HN',
          authorAvatar: null,
          text: ctext, createdAt: (Number(c.time) || 0) * 1000,
        });
        if (cr.imported || cr.row) {
          if (cr.row) idMap.set(Number(c.id), cr.row.id);
          if (cr.imported) { out.comments++; taken++; }
          else taken++;
        }
        if (Array.isArray(c.kids)) queue.push(...c.kids);
      }
    }
    return out;
  }

  async function run() {
    if (running) return last;
    running = true;
    const started = now();
    try {
      const v2ex = await importV2ex();
      const hn = await importHn();
      last = {at: started, v2ex, hn};
      return last;
    } finally { running = false; }
  }

  function start() {
    if (timer) return;
    const ms = Math.max(60 * 1000, Number(intervalMs) || 15 * 60 * 1000);
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
