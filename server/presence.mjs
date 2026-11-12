// M5.4.1 在线状态：在线/离开/隐身；对外展示以隐私设置为准，隐身对外一律离线。
// M5.4.2 输入中提示在 events.publishLive 中发送，本模块不存储输入状态。
import {ApiError} from './errors.mjs';

const MODES = new Set(['online', 'away', 'invisible']);
const VIS = new Set(['everyone', 'friends', 'nobody']);
export const AWAY_AFTER = 5 * 60_000;
export const OFFLINE_AFTER = 30 * 60_000;
export const TYPING_MS = 5000;

export function createPresence(db, {now, friends, events, chats} = {}) {
  function attach(ex = {}) {
    if (ex.chats) chats = ex.chats;
    if (ex.events) events = ex.events;
    if (ex.friends) friends = ex.friends;
  }
  const getQ = db.prepare('SELECT * FROM user_presence WHERE user_id=?');
  const ups = db.prepare(`INSERT INTO user_presence(user_id,mode,visibility,last_seen,updated_at)
    VALUES(?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET mode=excluded.mode, visibility=excluded.visibility,
      last_seen=excluded.last_seen, updated_at=excluded.updated_at`);
  const setSeen = db.prepare(`INSERT INTO user_presence(user_id,mode,visibility,last_seen,updated_at)
    VALUES(?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET last_seen=excluded.last_seen, updated_at=excluded.updated_at`);

  function rowOf(userId) {
    return getQ.get(Number(userId)) || {user_id: Number(userId), mode: 'online', visibility: 'friends', last_seen: null, updated_at: null};
  }
  function activityState(row) {
    if (row.mode === 'invisible') return 'invisible';
    if (row.mode === 'away') return 'away';
    const seen = row.last_seen;
    if (!seen) return 'offline';
    const age = now() - seen;
    if (age >= OFFLINE_AFTER) return 'offline';
    if (age >= AWAY_AFTER) return 'away';
    return 'online';
  }
  function canSee(viewer, row) {
    if (!viewer) return false;
    if (Number(viewer.id) === Number(row.user_id)) return true;
    if (row.mode === 'invisible') return false;
    if (row.visibility === 'nobody') return false;
    if (row.visibility === 'friends') return !!(friends && friends.areFriends(viewer.id, row.user_id));
    return true; // everyone
  }
  function viewFor(viewer, targetId) {
    const row = rowOf(targetId);
    const self = !!(viewer && Number(viewer.id) === Number(targetId));
    if (self) {
      return {
        userId: Number(targetId),
        state: activityState(row),
        mode: row.mode,
        visibility: row.visibility,
        lastSeen: row.last_seen,
        self: true,
        privacyFirst: true,
      };
    }
    if (!canSee(viewer, row)) {
      return {userId: Number(targetId), state: 'offline', lastSeen: null, self: false};
    }
    const st = activityState(row);
    return {userId: Number(targetId), state: st === 'invisible' ? 'offline' : st, lastSeen: row.last_seen, self: false};
  }
  function mine(user) {
    return viewFor(user, user.id);
  }
  function save(user, body = {}) {
    const cur = rowOf(user.id);
    const mode = body.mode != null ? String(body.mode) : cur.mode;
    const visibility = body.visibility != null ? String(body.visibility) : cur.visibility;
    if (!MODES.has(mode)) throw new ApiError(400, 'BAD_MODE', '状态只能是 online / away / invisible');
    if (!VIS.has(visibility)) throw new ApiError(400, 'BAD_VISIBILITY', '可见范围只能是 everyone / friends / nobody');
    const seen = mode === 'invisible' ? cur.last_seen : now();
    ups.run(Number(user.id), mode, visibility, seen, now());
    return mine(user);
  }
  function ping(user) {
    const cur = rowOf(user.id);
    if (cur.mode === 'invisible') return mine(user);
    const mode = cur.mode === 'away' ? 'away' : (cur.mode || 'online');
    setSeen.run(Number(user.id), mode, cur.visibility || 'friends', now(), now());
    return mine(user);
  }
  function onConnect(user) {
    return ping(user);
  }
  function onDisconnect(user) {
    // 不立刻改成离线，留给 last_seen 自然过期，避免刷新时闪断。
    return mine(user);
  }

  function typing(user, conversationId, body = {}) {
    if (!chats) throw new ApiError(503, 'NO_CHATS', '会话尚未就绪');
    const cv = chats.requireConv(conversationId);
    chats.requireMem(cv, user);
    const on = body.on !== false;
    const payload = {
      conversationId: cv.id,
      userId: Number(user.id),
      on,
      until: on ? now() + TYPING_MS : now(),
      ephemeral: true,
      stored: false,
    };
    const ids = chats.memberIds(cv.id).filter(id => Number(id) !== Number(user.id));
    if (events && events.publishLive) events.publishLive(ids, 'conversation.typing', payload);
    else throw new ApiError(503, 'NO_LIVE', '实时通道尚未就绪');
    return {typing: payload};
  }

  return {viewFor, mine, save, ping, onConnect, onDisconnect, typing, attach, AWAY_AFTER, OFFLINE_AFTER, TYPING_MS};
}
