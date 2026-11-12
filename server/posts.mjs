// M4.1 动态：发帖入库，权限在服务端校验。显示成功必须等服务端确认。
import {randomBytes} from 'node:crypto';
import {ApiError} from './errors.mjs';

const nid = () => 'po_' + randomBytes(12).toString('base64url');
const len = s => [...String(s)].length;

export function createPosts(db, {vip, profile, now}) {
  const ins = db.prepare(`INSERT INTO posts(id,author_id,text,created_at,updated_at,client_id) VALUES(?,?,?,?,?,?)`);
  const byId = db.prepare('SELECT * FROM posts WHERE id=?');
  const byClient = db.prepare('SELECT * FROM posts WHERE author_id=? AND client_id=?');
  const upd = db.prepare('UPDATE posts SET text=?, updated_at=? WHERE id=? AND author_id=? AND deleted_at IS NULL');
  const del = db.prepare('UPDATE posts SET deleted_at=? WHERE id=? AND author_id=? AND deleted_at IS NULL');
  const userBy = db.prepare('SELECT * FROM users WHERE id=?');
  const listSql = db.prepare(`SELECT * FROM posts WHERE deleted_at IS NULL
    AND (? IS NULL OR author_id=?)
    AND (created_at < ? OR (created_at = ? AND id < ?))
    ORDER BY created_at DESC, id DESC LIMIT ?`);
  const newest = db.prepare(`SELECT * FROM posts WHERE deleted_at IS NULL
    AND (? IS NULL OR author_id=?)
    ORDER BY created_at DESC, id DESC LIMIT ?`);
  const newestIn = db.prepare(`SELECT * FROM posts WHERE deleted_at IS NULL
    AND author_id IN (SELECT value FROM json_each(?))
    ORDER BY created_at DESC, id DESC LIMIT ?`);
  const listIn = db.prepare(`SELECT * FROM posts WHERE deleted_at IS NULL
    AND author_id IN (SELECT value FROM json_each(?))
    AND (created_at < ? OR (created_at = ? AND id < ?))
    ORDER BY created_at DESC, id DESC LIMIT ?`);

  function authorOf(id) {
    const u = userBy.get(id);
    if (!u) return {id, username: 'unknown', displayName: 'unknown', avatar: null, vip: false};
    const p = profile.publicOf(u);
    const v = vip.status(u);
    return {id: u.id, username: u.username, displayName: p.displayName, avatar: p.avatar, vip: !!v.active};
  }
  let extras = null;
  function attach(ex) { extras = Object.assign(extras || {}, ex); }
  function pub(row, me) {
    if (!row || row.deleted_at) return null;
    const out = {
      id: row.id,
      author: authorOf(row.author_id),
      text: row.text,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      edited: row.updated_at > row.created_at,
      mine: !!(me && Number(me.id) === Number(row.author_id)),
      reactions: [0, 0, 0, 0, 0, 0],
      myReaction: -1,
      commentCount: 0,
    };
    if (extras) {
      const rx = extras.reactOf(row.id, me);
      out.reactions = rx.reactions;
      out.myReaction = rx.myReaction;
      out.commentCount = extras.commentCount(row.id);
      if (extras.pollOf) out.poll = extras.pollOf(row.id, me);
      if (extras.hashtagsOf) out.hashtags = extras.hashtagsOf(row.id);
      if (extras.personalFilter && me) {
        const f = extras.personalFilter(out.text, me, row.author_id);
        if (f) { out.text = f.text; out.filtered = true; out.filteredBy = f.filteredBy; }
      }
    }
    return out;
  }
  function create(user, body) {
    const text = String((body && body.text) != null ? body.text : '').trim();
    if (!len(text)) throw new ApiError(400, 'BAD_TEXT', '请写下你想发布的内容');
    vip.requireTextLength(user, 'post', text);
    let clientId = body && body.clientId != null ? String(body.clientId).trim() : '';
    if (clientId) {
      if (clientId.length > 80) throw new ApiError(400, 'BAD_CLIENT_ID', 'clientId 过长');
      const existed = byClient.get(user.id, clientId);
      if (existed) {
        if (existed.deleted_at) throw new ApiError(409, 'GONE', '这条动态已被删除');
        return {post: pub(existed, user), idempotent: true};
      }
    } else clientId = null;
    const id = nid(), t = now();
    try { ins.run(id, user.id, text, t, t, clientId); }
    catch (e) {
      if (clientId && /UNIQUE/i.test(String(e.message))) {
        const existed = byClient.get(user.id, clientId);
        if (existed && !existed.deleted_at) return {post: pub(existed, user), idempotent: true};
      }
      throw e;
    }
    return {post: pub(byId.get(id), user), idempotent: false};
  }
  function get(user, id) {
    const row = byId.get(id);
    if (!row || row.deleted_at) throw new ApiError(404, 'NOT_FOUND', '动态不存在');
    return {post: pub(row, user)};
  }
  function edit(user, id, body) {
    const row = byId.get(id);
    if (!row || row.deleted_at) throw new ApiError(404, 'NOT_FOUND', '动态不存在');
    if (Number(row.author_id) !== Number(user.id)) throw new ApiError(403, 'FORBIDDEN', '只能编辑自己的动态');
    const text = String((body && body.text) != null ? body.text : '').trim();
    if (!len(text)) throw new ApiError(400, 'BAD_TEXT', '请写下你想发布的内容');
    vip.requireTextLength(user, 'post', text);
    upd.run(text, now(), id, user.id);
    return {post: pub(byId.get(id), user)};
  }
  function remove(user, id) {
    const row = byId.get(id);
    if (!row || row.deleted_at) throw new ApiError(404, 'NOT_FOUND', '动态不存在');
    if (Number(row.author_id) !== Number(user.id)) throw new ApiError(403, 'FORBIDDEN', '只能删除自己的动态');
    del.run(now(), id, user.id);
    return {deleted: id};
  }
  function list(user, q = {}) {
    const limit = Math.min(Math.max(+(q.limit) || 20, 1), 50);
    const author = q.author === 'me' && user ? user.id : (q.author || null);
    const take = limit + 1;
    const authors = q.authors || null; // 数字 id 数组，用于关注动态
    let rows;
    if (authors) {
      const js = JSON.stringify(authors.map(Number));
      if (q.cursor) {
        const cur = byId.get(String(q.cursor));
        if (!cur) throw new ApiError(400, 'BAD_CURSOR', '分页游标不正确');
        rows = listIn.all(js, cur.created_at, cur.created_at, cur.id, take);
      } else rows = newestIn.all(js, take);
    } else if (q.cursor) {
      const cur = byId.get(String(q.cursor));
      if (!cur) throw new ApiError(400, 'BAD_CURSOR', '分页游标不正确');
      rows = listSql.all(author, author, cur.created_at, cur.created_at, cur.id, take);
    } else {
      rows = newest.all(author, author, take);
    }
    const more = rows.length > limit;
    if (more) rows = rows.slice(0, limit);
    const last = rows[rows.length - 1];
    return {posts: rows.map(r => pub(r, user)), nextCursor: more && last ? last.id : null};
  }
  return {create, get, edit, remove, list, pub, byId, attach};
}
