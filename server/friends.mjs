// 双向好友：申请/同意/拒绝/取消/删除。M4.3.3 的门槛判断仍用 areFriends / isBlocked。
import {ApiError} from './errors.mjs';

export function createFriends(db, {now, profile} = {}) {
  const get = db.prepare('SELECT * FROM friendships WHERE user_lo=? AND user_hi=?');
  const upsert = db.prepare(`INSERT INTO friendships(user_lo,user_hi,status,created_at,updated_at) VALUES(?,?,?,?,?)
    ON CONFLICT(user_lo,user_hi) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at`);
  const del = db.prepare('DELETE FROM friendships WHERE user_lo=? AND user_hi=?');
  const blkGet = db.prepare('SELECT 1 FROM blocks WHERE blocker_id=? AND blocked_id=?');
  const insBlk = db.prepare('INSERT OR IGNORE INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)');
  const delBlk = db.prepare('DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?');
  const userBy = db.prepare('SELECT * FROM users WHERE id=?');
  const hasReq = (() => { try { db.prepare('SELECT requested_by FROM friendships LIMIT 1').get(); return true; } catch { return false; } })();
  const upsertReq = hasReq ? db.prepare(`INSERT INTO friendships(user_lo,user_hi,status,created_at,updated_at,requested_by) VALUES(?,?,?,?,?,?)
    ON CONFLICT(user_lo,user_hi) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at, requested_by=excluded.requested_by`) : null;
  const listAccepted = db.prepare(`SELECT * FROM friendships WHERE status='accepted' AND (user_lo=? OR user_hi=?) ORDER BY updated_at DESC, user_lo`);
  const listPendingFrom = hasReq ? db.prepare(`SELECT * FROM friendships WHERE status='pending' AND requested_by=? ORDER BY updated_at DESC`) : null;
  const listPendingTo = hasReq ? db.prepare(`SELECT * FROM friendships WHERE status='pending' AND requested_by IS NOT NULL AND requested_by<>? AND (user_lo=? OR user_hi=?) ORDER BY updated_at DESC`) : null;

  let notifications = null, onEvent = null;
  function attach(opts = {}) {
    if (opts.notifications) notifications = opts.notifications;
    if (opts.onEvent) onEvent = opts.onEvent;
  }

  function pair(a, b) {
    a = Number(a); b = Number(b);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a === b) return null;
    return a < b ? [a, b] : [b, a];
  }
  function areFriends(a, b) {
    const p = pair(a, b); if (!p) return false;
    const r = get.get(p[0], p[1]);
    return !!(r && r.status === 'accepted');
  }
  function setAccepted(a, b) {
    const p = pair(a, b); if (!p) return false;
    const t = now();
    upsert.run(p[0], p[1], 'accepted', t, t);
    return true;
  }
  function remove(a, b) {
    const p = pair(a, b); if (!p) return;
    del.run(p[0], p[1]);
  }
  function isBlocked(a, b) {
    a = Number(a); b = Number(b);
    return !!(blkGet.get(a, b) || blkGet.get(b, a));
  }
  function block(a, b) {
    a = Number(a); b = Number(b);
    if (a === b) return;
    const p = pair(a, b);
    const prev = p ? get.get(p[0], p[1]) : null;
    insBlk.run(a, b, now());
    // 拉黑同时解除好友与待处理申请。
    remove(a, b);
    if (prev) emit([a, b], 'friend.removed', {userId: b, by: authorOf(a), reason: 'blocked'});
  }
  function unblock(a, b) { delBlk.run(Number(a), Number(b)); }

  function requireUser(id) {
    const u = userBy.get(Number(id));
    if (!u || (u.status && u.status !== 'active')) throw new ApiError(404, 'NOT_FOUND', '找不到这个用户');
    return u;
  }
  function authorOf(id) {
    const u = userBy.get(Number(id));
    if (!u) return {id: Number(id), username: 'unknown', displayName: 'unknown'};
    const p = profile ? profile.publicOf(u) : {};
    return {id: u.id, username: u.username, displayName: p.displayName || u.username, avatar: p.avatar};
  }
  function pub(row, me) {
    if (!row) return null;
    const mid = Number(me);
    const other = Number(row.user_lo) === mid ? Number(row.user_hi) : Number(row.user_lo);
    const requestedBy = row.requested_by != null ? Number(row.requested_by) : null;
    return {
      userId: other,
      user: authorOf(other),
      status: row.status,
      requestedBy,
      incoming: row.status === 'pending' && requestedBy != null && requestedBy !== mid,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
  function emit(ids, type, payload) {
    if (typeof onEvent === 'function') onEvent(ids, type, payload);
  }
  function notify(userId, opts) {
    if (notifications && typeof notifications.push === 'function') return notifications.push(userId, opts);
  }
  function rowOf(a, b) {
    const p = pair(a, b);
    return p ? get.get(p[0], p[1]) : null;
  }

  function request(user, body) {
    if (!hasReq) throw new ApiError(503, 'NO_REQUESTS', '好友申请尚未就绪');
    const targetId = Number(body && (body.userId != null ? body.userId : body.id));
    if (!Number.isInteger(targetId) || targetId === Number(user.id)) throw new ApiError(400, 'BAD_USER', '请选择要申请的用户');
    const target = requireUser(targetId);
    if (isBlocked(user.id, targetId)) throw new ApiError(403, 'BLOCKED', '无法向对方发送好友申请');
    if (profile && typeof profile.privacyOf === 'function') {
      const priv = profile.privacyOf(target);
      if (priv.friendRequests === 'nobody') throw new ApiError(403, 'REQUESTS_CLOSED', '对方不接受好友申请');
    }
    const p = pair(user.id, targetId);
    const cur = get.get(p[0], p[1]);
    const t = now();
    if (cur && cur.status === 'accepted') return {friendship: pub(cur, user.id), idempotent: true};
    if (cur && cur.status === 'pending' && Number(cur.requested_by) === Number(user.id)) return {friendship: pub(cur, user.id), idempotent: true};
    if (cur && cur.status === 'pending' && Number(cur.requested_by) === targetId) {
      throw new ApiError(409, 'ALREADY_INCOMING', '对方已经向你发起了申请，请先处理');
    }
    upsertReq.run(p[0], p[1], 'pending', cur ? cur.created_at : t, t, Number(user.id));
    const row = get.get(p[0], p[1]);
    const out = {friendship: pub(row, user.id)};
    notify(targetId, {
      kind: 'friend_request', title: '收到好友申请',
      body: (authorOf(user.id).displayName || '') + ' 想加你为好友',
      refType: 'user', refId: String(user.id), actorId: user.id,
      dedupeKey: 'friend_request:' + user.id + ':' + t,
    });
    emit([Number(user.id), targetId], 'friend.request', {friendship: pub(row, targetId), from: authorOf(user.id)});
    return out;
  }

  function accept(user, body) {
    if (!hasReq) throw new ApiError(503, 'NO_REQUESTS', '好友申请尚未就绪');
    const otherId = Number(body && (body.userId != null ? body.userId : body.id));
    if (!Number.isInteger(otherId) || otherId === Number(user.id)) throw new ApiError(400, 'BAD_USER', '请选择要处理的申请');
    if (isBlocked(user.id, otherId)) throw new ApiError(403, 'BLOCKED', '无法接受该申请');
    const p = pair(user.id, otherId);
    const cur = get.get(p[0], p[1]);
    if (cur && cur.status === 'accepted') return {friendship: pub(cur, user.id), idempotent: true};
    if (!cur || cur.status !== 'pending' || Number(cur.requested_by) !== otherId) {
      throw new ApiError(404, 'NOT_FOUND', '没有来自对方的待处理申请');
    }
    const t = now();
    upsertReq.run(p[0], p[1], 'accepted', cur.created_at, t, cur.requested_by);
    const row = get.get(p[0], p[1]);
    notify(otherId, {
      kind: 'friend_accepted', title: '好友申请已通过',
      body: (authorOf(user.id).displayName || '') + ' 通过了你的好友申请',
      refType: 'user', refId: String(user.id), actorId: user.id,
      dedupeKey: 'friend_accepted:' + p[0] + ':' + p[1],
    });
    emit([Number(user.id), otherId], 'friend.accepted', {friendship: pub(row, otherId), by: authorOf(user.id)});
    return {friendship: pub(row, user.id)};
  }

  function decline(user, body) {
    if (!hasReq) throw new ApiError(503, 'NO_REQUESTS', '好友申请尚未就绪');
    const otherId = Number(body && (body.userId != null ? body.userId : body.id));
    if (!Number.isInteger(otherId) || otherId === Number(user.id)) throw new ApiError(400, 'BAD_USER', '请选择要处理的申请');
    const p = pair(user.id, otherId);
    const cur = get.get(p[0], p[1]);
    if (!cur || cur.status !== 'pending' || Number(cur.requested_by) !== otherId) {
      throw new ApiError(404, 'NOT_FOUND', '没有来自对方的待处理申请');
    }
    const t = now();
    upsertReq.run(p[0], p[1], 'declined', cur.created_at, t, cur.requested_by);
    const row = get.get(p[0], p[1]);
    emit([Number(user.id), otherId], 'friend.declined', {userId: Number(user.id), by: authorOf(user.id)});
    return {friendship: pub(row, user.id)};
  }

  function cancel(user, body) {
    if (!hasReq) throw new ApiError(503, 'NO_REQUESTS', '好友申请尚未就绪');
    const otherId = Number(body && (body.userId != null ? body.userId : body.id));
    if (!Number.isInteger(otherId) || otherId === Number(user.id)) throw new ApiError(400, 'BAD_USER', '请选择要取消的申请');
    const p = pair(user.id, otherId);
    const cur = get.get(p[0], p[1]);
    if (!cur || cur.status !== 'pending' || Number(cur.requested_by) !== Number(user.id)) {
      throw new ApiError(404, 'NOT_FOUND', '没有你发出的待处理申请');
    }
    del.run(p[0], p[1]);
    emit([Number(user.id), otherId], 'friend.cancelled', {userId: Number(user.id)});
    return {cancelled: true, userId: otherId};
  }

  function unfriend(user, body) {
    const otherId = Number(body && (body.userId != null ? body.userId : body.id));
    if (!Number.isInteger(otherId) || otherId === Number(user.id)) throw new ApiError(400, 'BAD_USER', '请选择要删除的好友');
    const p = pair(user.id, otherId);
    const cur = p && get.get(p[0], p[1]);
    if (!cur || cur.status !== 'accepted') throw new ApiError(404, 'NOT_FOUND', '你们还不是好友');
    del.run(p[0], p[1]);
    emit([Number(user.id), otherId], 'friend.removed', {userId: Number(user.id), by: authorOf(user.id)});
    return {removed: true, userId: otherId};
  }

  function list(user) {
    const rows = listAccepted.all(Number(user.id), Number(user.id));
    return {friends: rows.map(r => pub(r, user.id)), count: rows.length};
  }
  function listRequests(user) {
    if (!hasReq) return {incoming: [], outgoing: []};
    const uid = Number(user.id);
    const incoming = listPendingTo.all(uid, uid, uid).map(r => pub(r, uid));
    const outgoing = listPendingFrom.all(uid).map(r => pub(r, uid));
    return {incoming, outgoing};
  }
  function statusWith(user, otherId) {
    const cur = rowOf(user.id, otherId);
    if (!cur) return {status: 'none', friendship: null};
    return {status: cur.status, friendship: pub(cur, user.id)};
  }

  return {
    areFriends, setAccepted, remove, isBlocked, block, unblock, enforce: true,
    request, accept, decline, cancel, unfriend, list, listRequests, statusWith, attach, pub,
  };
}
