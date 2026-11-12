// M5.3.2 话题标签：创建、搜索、热门；每帖上限与新标签速率限制防滥用。
import {ApiError} from './errors.mjs';

export const MAX_TAGS_PER_POST = 5;
export const TAG_MIN = 2;
export const TAG_MAX = 24;
export const NEW_TAGS_PER_HOUR = 20;

const TAG_RE = /^[\p{L}\p{N}_]+$/u;

export function normalizeTag(s) {
  return String(s || '').trim().replace(/^#/, '').toLowerCase();
}
export function validName(name) {
  const n = normalizeTag(name);
  const L = [...n].length;
  return n && L >= TAG_MIN && L <= TAG_MAX && TAG_RE.test(n);
}
export function extractTags(text) {
  const re = /#([\p{L}\p{N}_]{2,24})/gu;
  const seen = new Set(), out = [];
  let m;
  while ((m = re.exec(String(text || '')))) {
    const n = m[1].toLowerCase();
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

export function createHashtags(db, {now, posts, blockwords} = {}) {
  const byName = db.prepare('SELECT * FROM hashtags WHERE name=?');
  const ins = db.prepare('INSERT INTO hashtags(name,created_at,created_by) VALUES(?,?,?)');
  const byId = db.prepare('SELECT * FROM hashtags WHERE id=?');
  const clearP = db.prepare('DELETE FROM post_hashtags WHERE post_id=?');
  const link = db.prepare('INSERT OR IGNORE INTO post_hashtags(post_id,tag_id) VALUES(?,?)');
  const ofPostQ = db.prepare('SELECT h.name FROM post_hashtags ph JOIN hashtags h ON h.id=ph.tag_id WHERE ph.post_id=? ORDER BY h.name');
  const searchQ = db.prepare("SELECT h.name, (SELECT COUNT(*) FROM post_hashtags ph JOIN posts p ON p.id=ph.post_id AND p.deleted_at IS NULL WHERE ph.tag_id=h.id) AS uses FROM hashtags h WHERE h.name LIKE ? ESCAPE '\\' ORDER BY uses DESC, h.name LIMIT ?");
  const trendQ = db.prepare(`SELECT h.name, COUNT(*) AS uses FROM post_hashtags ph
    JOIN hashtags h ON h.id=ph.tag_id
    JOIN posts p ON p.id=ph.post_id AND p.deleted_at IS NULL
    WHERE p.created_at >= ?
    GROUP BY h.id ORDER BY uses DESC, h.name LIMIT ?`);
  const postsQ = db.prepare(`SELECT p.* FROM post_hashtags ph JOIN posts p ON p.id=ph.post_id
    WHERE ph.tag_id=? AND p.deleted_at IS NULL ORDER BY p.created_at DESC, p.id DESC LIMIT ?`);
  const newCount = db.prepare('SELECT COUNT(*) AS n FROM hashtag_creates WHERE user_id=? AND created_at>=?');
  const insCreate = db.prepare('INSERT INTO hashtag_creates(user_id,tag_id,created_at) VALUES(?,?,?)');
  const getP = db.prepare('SELECT * FROM posts WHERE id=?');

  function assertName(name) {
    const n = normalizeTag(name);
    if (!validName(n)) throw new ApiError(400, 'BAD_TAG', '话题标签为 2–24 个字母、数字或下划线');
    if (blockwords && blockwords.platformHits && blockwords.platformHits(n).length) {
      throw new ApiError(400, 'BLOCKED_WORD', '这个标签不可用');
    }
    return n;
  }
  function getOrCreate(user, name, {allowCreate = true} = {}) {
    const n = assertName(name);
    const exist = byName.get(n);
    if (exist) return {row: exist, created: false};
    if (!allowCreate) throw new ApiError(404, 'NOT_FOUND', '还没有这个话题');
    const hourAgo = now() - 3600_000;
    const nNew = newCount.get(user.id, hourAgo).n;
    if (nNew >= NEW_TAGS_PER_HOUR) {
      throw new ApiError(429, 'TAG_RATE', '创建新话题过快，请稍后再试（每小时最多 ' + NEW_TAGS_PER_HOUR + ' 个新标签）');
    }
    const r = ins.run(n, now(), user.id);
    const row = byId.get(Number(r.lastInsertRowid));
    insCreate.run(user.id, row.id, now());
    return {row, created: true};
  }
  function syncPost(user, post, {text} = {}) {
    const body = text != null ? text : (post && post.text);
    const tags = extractTags(body);
    if (tags.length > MAX_TAGS_PER_POST) {
      throw new ApiError(400, 'TOO_MANY_TAGS', '每条动态最多 ' + MAX_TAGS_PER_POST + ' 个话题标签');
    }
    const pid = post.id || post;
    clearP.run(pid);
    const names = [];
    for (const n of tags) {
      const {row} = getOrCreate(user, n);
      link.run(pid, row.id);
      names.push(row.name);
    }
    return names;
  }
  function ofPost(postId) {
    return ofPostQ.all(postId).map(r => r.name);
  }
  function search(q, {limit} = {}) {
    const raw = normalizeTag(q);
    if (!raw) return {tags: []};
    const escaped = raw.replace(/[%_\\]/g, '\\$&') + '%';
    const lim = Math.min(Math.max(+(limit) || 20, 1), 50);
    return {tags: searchQ.all(escaped, lim).map(r => ({name: r.name, uses: r.uses}))};
  }
  function trending({windowMs, limit} = {}) {
    const win = Number(windowMs) > 0 ? Number(windowMs) : 24 * 3600_000;
    const lim = Math.min(Math.max(+(limit) || 20, 1), 50);
    return {tags: trendQ.all(now() - win, lim).map(r => ({name: r.name, uses: r.uses})), windowMs: win};
  }
  function get(name, me) {
    const n = assertName(name);
    const row = byName.get(n);
    if (!row) throw new ApiError(404, 'NOT_FOUND', '还没有这个话题');
    const list = postsQ.all(row.id, 50);
    const postsOut = posts && me ? list.map(r => posts.pub(r, me)).filter(Boolean) : list.map(r => ({id: r.id, text: r.text, createdAt: r.created_at}));
    return {tag: {name: row.name, createdAt: row.created_at}, posts: postsOut};
  }
  function create(user, body = {}) {
    const {row, created} = getOrCreate(user, body.name || body.tag);
    return {tag: {name: row.name, createdAt: row.created_at}, created};
  }
  function attach(ex) { if (ex && ex.blockwords) blockwords = ex.blockwords; }
  return {syncPost, ofPost, search, trending, get, create, extractTags, MAX_TAGS_PER_POST, NEW_TAGS_PER_HOUR, attach};
}
