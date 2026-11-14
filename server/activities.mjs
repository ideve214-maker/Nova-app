// VEXO 2.0 活动：官方账号 / 官方授权账号在动态里发起活动（封面、时间、地点或线上、介绍、报名人数上限）。
// 报名每人一次，可取消；发起人能看报名名单；管理端能查看和移除。
import {randomBytes} from 'node:crypto';
import {ApiError} from './errors.mjs';

const nid = () => 'ac_' + randomBytes(12).toString('base64url');
const len = s => [...String(s == null ? '' : s)].length;
const MEDIA = /^md_[\w-]{6,80}$/;

export function createActivities(db, {now, notifications, authorOf}) {
  const ins = db.prepare(`INSERT INTO activities(id,post_id,author_id,title,cover_media_id,starts_at,ends_at,place,online,online_url,description,cap,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const byId = db.prepare('SELECT * FROM activities WHERE id=?');
  const byPost = db.prepare('SELECT * FROM activities WHERE post_id=? ORDER BY created_at LIMIT 1');
  const userBy = db.prepare('SELECT * FROM users WHERE id=?');
  const mediaBy = db.prepare('SELECT * FROM media WHERE id=?');
  const count = db.prepare('SELECT COUNT(*) AS n FROM activity_signups WHERE activity_id=? AND cancelled_at IS NULL');
  const mine = db.prepare('SELECT * FROM activity_signups WHERE activity_id=? AND user_id=?');
  const insS = db.prepare('INSERT INTO activity_signups(activity_id,user_id,created_at) VALUES(?,?,?)');
  const reS = db.prepare('UPDATE activity_signups SET cancelled_at=NULL, created_at=? WHERE activity_id=? AND user_id=?');
  const cancelS = db.prepare('UPDATE activity_signups SET cancelled_at=? WHERE activity_id=? AND user_id=? AND cancelled_at IS NULL');
  const listS = db.prepare('SELECT * FROM activity_signups WHERE activity_id=? AND cancelled_at IS NULL ORDER BY created_at');
  const isCover = db.prepare('SELECT 1 FROM activities WHERE cover_media_id=? AND deleted_at IS NULL LIMIT 1');
  const setDel = db.prepare('UPDATE activities SET deleted_at=?, removed_reason=? WHERE id=?');
  const admList = db.prepare(`SELECT a.*, u.username, (SELECT COUNT(*) FROM activity_signups s WHERE s.activity_id=a.id AND s.cancelled_at IS NULL) AS n
    FROM activities a LEFT JOIN users u ON u.id=a.author_id
    WHERE (? = '' OR a.title LIKE ? OR u.username LIKE ? OR a.place LIKE ?) AND (? = 'all' OR (? = 'removed') = (a.deleted_at IS NOT NULL))
    ORDER BY a.created_at DESC LIMIT ? OFFSET ?`);
  const tx = fn => { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

  function assertCanCreate(user) {
    const u = user && userBy.get(Number(user.id));
    if (!u || !u.badge) throw new ApiError(403, 'NOT_OFFICIAL', '只有官方账号或官方授权账号可以发起活动');
  }
  function validateSpec(spec = {}, user = null) {
    const title = String(spec.title || '').trim();
    if (!len(title) || len(title) > 60) throw new ApiError(400, 'BAD_TITLE', '请填写 1–60 字的活动标题');
    const startsAt = Number(spec.startsAt);
    if (!Number.isFinite(startsAt) || startsAt <= now()) throw new ApiError(400, 'BAD_TIME', '活动开始时间必须是未来的时间');
    let endsAt = spec.endsAt == null || spec.endsAt === '' ? null : Number(spec.endsAt);
    if (endsAt != null && (!Number.isFinite(endsAt) || endsAt <= startsAt)) throw new ApiError(400, 'BAD_TIME', '结束时间要晚于开始时间');
    const online = !!spec.online;
    const place = String(spec.place || '').trim();
    const onlineUrl = String(spec.onlineUrl || '').trim();
    if (len(place) > 80) throw new ApiError(400, 'BAD_PLACE', '地点最多 80 字');
    if (!online && !len(place)) throw new ApiError(400, 'BAD_PLACE', '请填写活动地点，或选择线上活动');
    if (onlineUrl && (!/^https?:\/\/[^\s]{3,300}$/i.test(onlineUrl))) throw new ApiError(400, 'BAD_URL', '线上链接需以 http:// 或 https:// 开头');
    const description = String(spec.description || '').trim();
    if (len(description) > 2000) throw new ApiError(400, 'BAD_DESC', '活动介绍最多 2000 字');
    let cap = spec.cap == null || spec.cap === '' || Number(spec.cap) === 0 ? null : Number(spec.cap);
    if (cap != null && (!Number.isInteger(cap) || cap < 1 || cap > 100000)) throw new ApiError(400, 'BAD_CAP', '人数上限需为 1–100000 的整数，不限人数请留空');
    let cover = spec.coverMediaId ? String(spec.coverMediaId) : null;
    if (cover) {
      const m = MEDIA.test(cover) && mediaBy.get(cover);
      if (!m || m.deleted_at || m.kind !== 'image') throw new ApiError(400, 'BAD_COVER', '封面需是已上传的图片');
      if (user && Number(m.owner_id) !== Number(user.id)) throw new ApiError(403, 'BAD_COVER', '只能使用自己上传的封面');
    }
    return {title, startsAt, endsAt, online, place, onlineUrl, description, cap, cover};
  }
  function textOf(spec) { return [spec && spec.title, spec && spec.place, spec && spec.description].filter(x => typeof x === 'string' && x.trim()).join('\n'); }

  function state(row) {
    const t = now();
    if (row.ends_at ? t >= row.ends_at : t >= row.starts_at + 6 * 3600e3) return 'ended';
    if (t >= row.starts_at) return 'ongoing';
    return 'upcoming';
  }
  function pub(row, me) {
    if (!row || row.deleted_at) return null;
    const n = count.get(row.id).n;
    const m = me ? mine.get(row.id, Number(me.id)) : null;
    const st = state(row);
    const isMine = !!(me && Number(me.id) === Number(row.author_id));
    return {
      id: row.id, postId: row.post_id || null, authorId: row.author_id, title: row.title,
      coverMediaId: row.cover_media_id || null, startsAt: row.starts_at, endsAt: row.ends_at || null,
      place: row.place || '', online: !!row.online, onlineUrl: row.online_url || '', description: row.description || '',
      cap: row.cap || null, count: n, full: !!(row.cap && n >= row.cap), state: st,
      joined: !!(m && !m.cancelled_at), mine: isMine, createdAt: row.created_at,
    };
  }
  function createForPost(user, postId, spec) {
    assertCanCreate(user);
    const v = validateSpec(spec, user);
    if (byPost.get(postId)) throw new ApiError(409, 'EXISTS', '这条动态已经有活动了');
    const id = nid();
    ins.run(id, postId, user.id, v.title, v.cover, v.startsAt, v.endsAt, v.place || null, v.online ? 1 : 0, v.onlineUrl || null, v.description, v.cap, now());
    return {activity: pub(byId.get(id), user)};
  }
  function ofPost(postId, me) { const r = byPost.get(postId); return r ? pub(r, me) : null; }
  function need(id) {
    const row = byId.get(id);
    if (!row || row.deleted_at) throw new ApiError(404, 'NOT_FOUND', '活动不存在或已被移除');
    return row;
  }
  function get(user, id) { return {activity: pub(need(id), user)}; }
  function signup(user, id) {
    const row = need(id);
    if (state(row) === 'ended') throw new ApiError(403, 'ENDED', '活动已结束');
    const r = tx(() => {
      const m = mine.get(id, Number(user.id));
      if (m && !m.cancelled_at) return {already: true};
      if (row.cap && count.get(id).n >= row.cap) throw new ApiError(409, 'FULL', '报名人数已满');
      if (m) reS.run(now(), id, Number(user.id)); else insS.run(id, Number(user.id), now());
      return {already: false};
    });
    if (!r.already && notifications && Number(row.author_id) !== Number(user.id)) {
      const who = authorOf ? authorOf(user.id) : null;
      try {
        notifications.push(row.author_id, {kind: 'activity_signup', title: '活动有新报名', body: ((who && who.displayName) || '有人') + ' 报名了「' + row.title + '」',
          refType: 'activity', refId: id, actorId: user.id, dedupeKey: 'actsign:' + id + ':' + user.id + ':' + now()});
      } catch {}
    }
    return {activity: pub(byId.get(id), user), already: r.already};
  }
  function cancel(user, id) {
    const row = need(id);
    cancelS.run(now(), id, Number(user.id));
    return {activity: pub(row, user)};
  }
  function signups(user, id) {
    const row = need(id);
    if (Number(row.author_id) !== Number(user.id)) throw new ApiError(403, 'FORBIDDEN', '只有发起人能查看报名名单');
    return {activity: pub(row, user), signups: listS.all(id).map(s => ({user: authorOf ? authorOf(s.user_id) : {id: s.user_id}, at: s.created_at}))};
  }
  function isCoverMedia(id) { try { return !!isCover.get(id); } catch { return false; } }

  function adminRow(r) {
    return {id: r.id, postId: r.post_id || null, authorId: r.author_id, author: r.username || null, title: r.title,
      startsAt: r.starts_at, endsAt: r.ends_at || null, place: r.place || '', online: !!r.online, cap: r.cap || null,
      count: r.n != null ? r.n : count.get(r.id).n, state: state(r), createdAt: r.created_at,
      removed: !!r.deleted_at, removedAt: r.deleted_at || null, removedReason: r.removed_reason || null};
  }
  function adminList(q = {}) {
    const term = String(q.q || '').trim().slice(0, 80), like = '%' + term + '%';
    const st = ['all', 'removed'].includes(q.status) ? q.status : 'active';
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200), offset = Math.max(Number(q.offset) || 0, 0);
    return {activities: admList.all(term, like, like, like, st, st, limit, offset).map(adminRow)};
  }
  function adminGet(id) {
    const row = byId.get(id);
    if (!row) throw new ApiError(404, 'NOT_FOUND', '活动不存在');
    return {activity: adminRow(row), signups: listS.all(id).map(s => ({user: authorOf ? authorOf(s.user_id) : {id: s.user_id}, at: s.created_at}))};
  }
  function adminRemove(id, reason) {
    const row = byId.get(id);
    if (!row) throw new ApiError(404, 'NOT_FOUND', '活动不存在');
    if (!row.deleted_at) setDel.run(now(), String(reason || '').slice(0, 200) || null, id);
    return {activity: adminRow(byId.get(id))};
  }
  function adminRestore(id) {
    if (!byId.get(id)) throw new ApiError(404, 'NOT_FOUND', '活动不存在');
    setDel.run(null, null, id);
    return {activity: adminRow(byId.get(id))};
  }
  /* 2.0.1 公开分享页 /e/<id>：标题、时间、地点、人数、介绍；不含线上会议链接和报名名单 */
  let postAlive = null; try { postAlive = db.prepare('SELECT deleted_at FROM posts WHERE id=?'); } catch {}
  function publicCard(id) {
    const r = byId.get(String(id || ''));
    if (!r || r.deleted_at) return null;
    if (r.post_id && postAlive) { const p = postAlive.get(r.post_id); if (!p || p.deleted_at) return null; }
    const n = count.get(r.id).n;
    return {id: r.id, title: r.title, startsAt: r.starts_at, endsAt: r.ends_at || null, place: r.place || '', online: !!r.online,
      description: String(r.description || '').slice(0, 600), cap: r.cap || null, count: n, state: state(r)};
  }
  return {publicCard, assertCanCreate, validateSpec, textOf, createForPost, ofPost, get, signup, cancel, signups, isCoverMedia, pub, adminList, adminGet, adminRemove, adminRestore};
}
