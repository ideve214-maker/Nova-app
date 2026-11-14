// M4.6 站内通知：系统通知、互动提醒、已读。重复事件（同一 dedupe_key）不重复插入。
import {randomBytes} from 'node:crypto';
import {ApiError} from './errors.mjs';

const nid = () => 'nt_' + randomBytes(12).toString('base64url');

export function createNotifications(db, {now, profile, vip, onEvent} = {}) {
  const ins = db.prepare(`INSERT INTO notifications(id,user_id,kind,title,body,ref_type,ref_id,actor_id,created_at,dedupe_key,data)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
  const byId = db.prepare('SELECT * FROM notifications WHERE id=?');
  // before：分页游标（上一页最后一条的 createdAt），用于“加载更多”。
  const listSql = db.prepare(`SELECT * FROM notifications WHERE user_id=? AND (?=0 OR read_at IS NULL) AND (? IS NULL OR created_at < ?)
    ORDER BY created_at DESC, id DESC LIMIT ?`);
  const setRead = db.prepare('UPDATE notifications SET read_at=? WHERE id=? AND user_id=? AND read_at IS NULL');
  const setAll = db.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL');
  const nUnread = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND read_at IS NULL');
  const userBy = db.prepare('SELECT * FROM users WHERE id=?');

  function authorOf(id) {
    if (id == null) return null;
    const u = userBy.get(Number(id));
    if (!u) return {id: Number(id), username: 'unknown', displayName: 'unknown'};
    const p = profile ? profile.publicOf(u) : {};
    return {id: u.id, username: u.username, displayName: p.displayName || u.username, avatar: p.avatar};
  }
  function parseData(raw) {
    if (!raw) return null;
    try { const j = JSON.parse(raw); return j && typeof j === 'object' ? j : null; } catch { return null; }
  }
  function pub(row) {
    const data = parseData(row.data);
    return {
      id: row.id, kind: row.kind, title: row.title, body: row.body,
      refType: row.ref_type, refId: row.ref_id,
      actor: authorOf(row.actor_id), createdAt: row.created_at,
      read: !!row.read_at, readAt: row.read_at || null,
      data, appealable: !!(data && data.appealable),
    };
  }

  /** 推送一条通知。同一 user+dedupe_key 已存在则跳过（不更新已读状态，避免把已读再变未读刷屏）。 */
  function push(userId, {kind, title, body, refType, refId, actorId, dedupeKey, data}) {
    const uid = Number(userId);
    if (actorId != null && Number(actorId) === uid) return {skipped: true, reason: 'self'};
    const id = nid(), t = now();
    try {
      ins.run(id, uid, kind, title || '', body || '', refType || null, refId || null, actorId != null ? Number(actorId) : null, t, dedupeKey || null, data ? JSON.stringify(data) : null);
    } catch (e) {
      if (/UNIQUE/i.test(String(e.message))) return {skipped: true, reason: 'duplicate'};
      throw e;
    }
    const row = byId.get(id);
    if (typeof onEvent === 'function') onEvent([uid], 'notification', {notification: pub(row)});
    return {notification: pub(row)};
  }

  function list(user, q = {}) {
    const unreadOnly = q.unread === '1' || q.unread === 'true' || q.unread === 1;
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 100);
    const before = q.before != null && q.before !== '' && Number.isFinite(Number(q.before)) ? Number(q.before) : null;
    const rows = listSql.all(Number(user.id), unreadOnly ? 1 : 0, before, before, limit + 1);
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    return {notifications: page.map(pub), unread: nUnread.get(Number(user.id)).n, hasMore: more,
      nextBefore: more && page.length ? page[page.length - 1].created_at : null};
  }

  function markRead(user, id) {
    const row = byId.get(id);
    if (!row || Number(row.user_id) !== Number(user.id)) throw new ApiError(404, 'NOT_FOUND', '找不到这条通知');
    setRead.run(now(), id, Number(user.id));
    return {notification: pub(byId.get(id))};
  }

  function markAll(user) {
    const info = setAll.run(now(), Number(user.id));
    return {read: info.changes || 0, unread: 0};
  }

  function unread(user) { return {unread: nUnread.get(Number(user.id)).n}; }

  return {push, list, markRead, markAll, unread, pub};
}
