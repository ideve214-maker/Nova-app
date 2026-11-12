// M4.1.3 评论、回复、反应。关系与计数由服务端维护；删除和权限在服务端校验。
import {randomBytes} from 'node:crypto';
import {ApiError} from './errors.mjs';

const nid = () => 'co_' + randomBytes(12).toString('base64url');
const len = s => [...String(s)].length;
export const COMMENT_MAX = 280;
export const COMMENT_MAX_DEPTH = 20;
/** 展示时超过此深度不再继续缩进，改为「回复 @某人」。 */
export const COMMENT_COLLAPSE_DEPTH = 2;
export const EMOJIS = Object.freeze(['❤️', '😂', '👍', '😮', '😢', '🔥']);

export function createComments(db, {profile, vip, posts, now}) {
  let extras = null;
  function attach(ex) { extras = Object.assign(extras || {}, ex); }
  const insC = db.prepare(`INSERT INTO post_comments(id,post_id,author_id,parent_id,text,created_at) VALUES(?,?,?,?,?,?)`);
  const byId = db.prepare('SELECT * FROM post_comments WHERE id=?');
  const listC = db.prepare('SELECT * FROM post_comments WHERE post_id=? AND (deleted_at IS NULL OR id IN (SELECT parent_id FROM post_comments WHERE post_id=? AND parent_id IS NOT NULL AND deleted_at IS NULL)) ORDER BY created_at ASC, id ASC');
  const listAll = db.prepare('SELECT * FROM post_comments WHERE post_id=? ORDER BY created_at ASC, id ASC');
  const delC = db.prepare('UPDATE post_comments SET deleted_at=?, text=? WHERE id=? AND author_id=? AND deleted_at IS NULL');
  const cntC = db.prepare('SELECT COUNT(*) AS n FROM post_comments WHERE post_id=? AND deleted_at IS NULL');
  const replies = db.prepare('SELECT COUNT(*) AS n FROM post_comments WHERE parent_id=? AND deleted_at IS NULL');
  const userBy = db.prepare('SELECT * FROM users WHERE id=?');
  const insLike = db.prepare('INSERT INTO comment_likes(comment_id,user_id,created_at) VALUES(?,?,?)');
  const delLike = db.prepare('DELETE FROM comment_likes WHERE comment_id=? AND user_id=?');
  const hasLike = db.prepare('SELECT 1 FROM comment_likes WHERE comment_id=? AND user_id=?');
  const cntLike = db.prepare('SELECT COUNT(*) AS n FROM comment_likes WHERE comment_id=?');
  const insRx = db.prepare('INSERT INTO post_reactions(post_id,user_id,emoji_idx,created_at) VALUES(?,?,?,?) ON CONFLICT(post_id,user_id) DO UPDATE SET emoji_idx=excluded.emoji_idx, created_at=excluded.created_at');
  const delRx = db.prepare('DELETE FROM post_reactions WHERE post_id=? AND user_id=?');
  const myRx = db.prepare('SELECT emoji_idx FROM post_reactions WHERE post_id=? AND user_id=?');
  const grpRx = db.prepare('SELECT emoji_idx, COUNT(*) AS n FROM post_reactions WHERE post_id=? GROUP BY emoji_idx');

  function authorOf(id) {
    const u = userBy.get(id);
    if (!u) return {id, username: 'unknown', displayName: 'unknown', avatar: null, vip: false};
    const p = profile.publicOf(u);
    return {id: u.id, username: u.username, displayName: p.displayName, avatar: p.avatar, vip: !!vip.status(u).active};
  }
  function reactOf(postId, me) {
    const counts = [0, 0, 0, 0, 0, 0];
    for (const r of grpRx.all(postId)) counts[r.emoji_idx] = r.n;
    const mine = me ? myRx.get(postId, me.id) : null;
    return {reactions: counts, myReaction: mine ? mine.emoji_idx : -1};
  }
  function commentCount(postId) { return cntC.get(postId).n; }

  function pubC(row, me) {
    const gone = !!row.deleted_at;
    const out = {
      id: row.id, postId: row.post_id, parentId: row.parent_id || null,
      author: authorOf(row.author_id),
      text: gone ? '' : row.text,
      deleted: gone,
      createdAt: row.created_at,
      createdAtUtc: new Date(row.created_at).toISOString(),
      likeCount: gone ? 0 : cntLike.get(row.id).n,
      liked: !!(me && !gone && hasLike.get(row.id, me.id)),
      mine: !!(me && Number(me.id) === Number(row.author_id)),
      depth: 0,
      rootId: row.id,
      replyTo: null,
      replyCount: 0,
    };
    if (!gone && extras && extras.personalFilter && me) {
      const f = extras.personalFilter(out.text, me, row.author_id);
      if (f) { out.text = f.text; out.filtered = true; out.filteredBy = f.filteredBy; }
    }
    return out;
  }
  function ensurePost(id) {
    const row = posts.byId.get(id);
    if (!row || row.deleted_at) throw new ApiError(404, 'NOT_FOUND', '动态不存在');
    return row;
  }
  function chainInfo(row, cache = new Map()) {
    if (cache.has(row.id)) return cache.get(row.id);
    if (!row.parent_id) {
      const v = {depth: 0, rootId: row.id};
      cache.set(row.id, v);
      return v;
    }
    const parent = byId.get(row.parent_id);
    if (!parent) {
      const v = {depth: 1, rootId: row.id};
      cache.set(row.id, v);
      return v;
    }
    const up = chainInfo(parent, cache);
    const v = {depth: up.depth + 1, rootId: up.rootId};
    cache.set(row.id, v);
    return v;
  }
  function replyToOf(row) {
    if (!row.parent_id) return null;
    const p = byId.get(row.parent_id);
    if (!p) return {id: row.parent_id, deleted: true, missing: true, author: null, text: ''};
    const a = authorOf(p.author_id);
    return {
      id: p.id,
      deleted: !!p.deleted_at,
      author: {id: a.id, username: a.username, displayName: a.displayName},
      text: p.deleted_at ? '' : String(p.text || '').slice(0, 80),
    };
  }
  function enrich(row, me, cache, counts) {
    const out = pubC(row, me);
    const ch = chainInfo(row, cache);
    out.depth = ch.depth;
    out.rootId = ch.rootId;
    out.replyTo = replyToOf(row);
    out.replyCount = counts.get(row.id) || 0;
    return out;
  }
  function livingDescendants(id, kids) {
    const ch = kids.get(id) || [];
    return ch.some(k => !k.deleted_at || livingDescendants(k.id, kids));
  }

  function add(user, postId, body) {
    ensurePost(postId);
    const text = String((body && body.text) != null ? body.text : '').trim();
    if (!len(text)) throw new ApiError(400, 'BAD_TEXT', '请写下评论');
    if (len(text) > COMMENT_MAX) throw new ApiError(403, 'TEXT_TOO_LONG', '评论最多 ' + COMMENT_MAX + ' 字', {limit: COMMENT_MAX, length: len(text)});
    let parent = null;
    const pid = body && body.parentId;
    if (pid) {
      parent = byId.get(String(pid));
      if (!parent || parent.post_id !== postId) throw new ApiError(400, 'BAD_PARENT', '回复的评论不存在');
      const d = chainInfo(parent).depth;
      if (d + 1 > COMMENT_MAX_DEPTH) throw new ApiError(400, 'TOO_DEEP', '回复层级过深（最多 ' + COMMENT_MAX_DEPTH + ' 层）');
    }
    const id = nid(), ts = now();
    insC.run(id, postId, user.id, parent ? parent.id : null, text, ts);
    const kids = new Map();
    return {comment: enrich(byId.get(id), user, new Map(), kids), commentCount: commentCount(postId)};
  }
  function list(user, postId) {
    ensurePost(postId);
    const all = listAll.all(postId);
    const kids = new Map();
    const counts = new Map();
    for (const r of all) {
      if (r.parent_id) {
        if (!kids.has(r.parent_id)) kids.set(r.parent_id, []);
        kids.get(r.parent_id).push(r);
        if (!r.deleted_at) counts.set(r.parent_id, (counts.get(r.parent_id) || 0) + 1);
      }
    }
    const rows = all.filter(r => !r.deleted_at || livingDescendants(r.id, kids));
    const cache = new Map();
    return {comments: rows.map(r => enrich(r, user, cache, counts)), commentCount: commentCount(postId), collapseDepth: COMMENT_COLLAPSE_DEPTH};
  }
  function remove(user, id) {
    const row = byId.get(id);
    if (!row || row.deleted_at) throw new ApiError(404, 'NOT_FOUND', '评论不存在');
    if (Number(row.author_id) !== Number(user.id)) throw new ApiError(403, 'FORBIDDEN', '只能删除自己的评论');
    delC.run(now(), '', id, user.id);
    return {deleted: id, commentCount: commentCount(row.post_id)};
  }
  function like(user, id) {
    const row = byId.get(id);
    if (!row || row.deleted_at) throw new ApiError(404, 'NOT_FOUND', '评论不存在');
    if (hasLike.get(id, user.id)) delLike.run(id, user.id);
    else insLike.run(id, user.id, now());
    const n = replies.get(id).n;
    return {comment: enrich(byId.get(id), user, new Map(), new Map([[id, n]]))};
  }
  function react(user, postId, body) {
    ensurePost(postId);
    let idx = body && body.index != null ? +body.index : EMOJIS.indexOf(String((body && body.emoji) || ''));
    if (!Number.isInteger(idx) || idx < 0 || idx >= EMOJIS.length) throw new ApiError(400, 'BAD_REACTION', '表态不正确');
    const cur = myRx.get(postId, user.id);
    if (cur && cur.emoji_idx === idx) delRx.run(postId, user.id);
    else insRx.run(postId, user.id, idx, now());
    return {postId, ...reactOf(postId, user)};
  }
  return {add, list, remove, like, react, reactOf, commentCount, COMMENT_MAX, COMMENT_MAX_DEPTH, COMMENT_COLLAPSE_DEPTH, EMOJIS, attach, enrich, chainInfo};
}
