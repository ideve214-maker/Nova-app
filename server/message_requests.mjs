// M7 陌生人消息请求。接受前不建立正常会话；接受前不向发送者泄露已读。
import {randomBytes} from 'node:crypto';
import {ApiError} from './errors.mjs';

const nid = (p = 'mr') => p + '_' + randomBytes(12).toString('base64url');
const MAX_PREVIEWS = 8;
const MIN_GAP_MS = 4000;

export function createMessageRequests(db, {now, profile, friends, chats, follows, notifications} = {}) {
  const byId = db.prepare('SELECT * FROM message_requests WHERE id=?');
  const byPair = db.prepare('SELECT * FROM message_requests WHERE sender_id=? AND receiver_id=?');
  const ins = db.prepare(`INSERT INTO message_requests(id,sender_id,receiver_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?)`);
  const setSt = db.prepare('UPDATE message_requests SET status=?, updated_at=? WHERE id=?');
  const listIn = db.prepare(`SELECT * FROM message_requests WHERE receiver_id=? AND status='pending' ORDER BY updated_at DESC`);
  const listOut = db.prepare(`SELECT * FROM message_requests WHERE sender_id=? AND status='pending' ORDER BY updated_at DESC`);
  const cntIn = db.prepare(`SELECT COUNT(*) n FROM message_requests WHERE receiver_id=? AND status='pending'`);
  const insPrev = db.prepare(`INSERT INTO message_request_previews(id,request_id,sender_id,text,created_at) VALUES(?,?,?,?,?)`);
  const previewsOf = db.prepare('SELECT * FROM message_request_previews WHERE request_id=? ORDER BY created_at ASC');
  const lastPrev = db.prepare('SELECT * FROM message_request_previews WHERE request_id=? ORDER BY created_at DESC LIMIT 1');
  const nPrev = db.prepare('SELECT COUNT(*) n FROM message_request_previews WHERE request_id=?');
  const userBy = db.prepare('SELECT * FROM users WHERE id=?');

  function authorOf(id) {
    const u = userBy.get(id);
    if (!u) return {id, username: 'unknown', displayName: 'unknown', avatar: null};
    const p = profile ? profile.publicOf(u) : {};
    return {id: u.id, username: u.username, displayName: p.displayName || u.username, avatar: p.avatar};
  }
  function mutualFollow(a, b) {
    if (!follows) return false;
    try {
      const ab = db.prepare('SELECT 1 FROM follows WHERE follower_id=? AND followee_id=?').get(Number(a), Number(b));
      const ba = db.prepare('SELECT 1 FROM follows WHERE follower_id=? AND followee_id=?').get(Number(b), Number(a));
      return !!(ab && ba);
    } catch { return false; }
  }
  function isAccepted(a, b) {
    const r1 = byPair.get(Number(a), Number(b));
    const r2 = byPair.get(Number(b), Number(a));
    return (r1 && r1.status === 'accepted') || (r2 && r2.status === 'accepted');
  }
  function canDirect(a, b) {
    if (friends && typeof friends.areFriends === 'function' && friends.areFriends(a, b)) return true;
    if (isAccepted(a, b)) return true;
    if (mutualFollow(a, b)) return true;
    return false;
  }
  function commonInfo(senderId, receiverId) {
    let mutualFriends = 0, mutualCommunities = 0;
    try {
      if (friends && typeof friends.list === 'function') {
        // 粗略：两边已接受好友的交集（SQL）
        const q = db.prepare(`
          SELECT COUNT(*) n FROM (
            SELECT CASE WHEN user_lo=? THEN user_hi ELSE user_lo END oid FROM friendships WHERE status='accepted' AND (user_lo=? OR user_hi=?)
          ) a JOIN (
            SELECT CASE WHEN user_lo=? THEN user_hi ELSE user_lo END oid FROM friendships WHERE status='accepted' AND (user_lo=? OR user_hi=?)
          ) b ON a.oid=b.oid`);
        mutualFriends = q.get(senderId, senderId, senderId, receiverId, receiverId, receiverId).n || 0;
      }
    } catch {}
    try {
      const q = db.prepare(`
        SELECT COUNT(*) n FROM community_members m1
        JOIN community_members m2 ON m1.community_id=m2.community_id
        WHERE m1.user_id=? AND m2.user_id=? AND m1.status='active' AND m2.status='active'`);
      mutualCommunities = q.get(senderId, receiverId).n || 0;
    } catch {}
    return {mutualFriends, mutualCommunities};
  }
  function pub(row, me, withPreviews = true) {
    if (!row) return null;
    const prev = withPreviews ? previewsOf.all(row.id) : [];
    const last = prev[prev.length - 1];
    const mid = me && Number(me.id);
    const otherId = Number(row.sender_id) === mid ? Number(row.receiver_id) : Number(row.sender_id);
    const common = commonInfo(row.sender_id, row.receiver_id);
    return {
      id: row.id,
      senderId: row.sender_id,
      receiverId: row.receiver_id,
      sender: authorOf(row.sender_id),
      receiver: authorOf(row.receiver_id),
      other: authorOf(otherId),
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      firstMessage: prev[0] ? prev[0].text : '',
      lastMessage: last ? last.text : '',
      lastAt: last ? last.created_at : row.updated_at,
      previews: prev.map(p => ({id: p.id, text: p.text, createdAt: p.created_at, mine: mid && Number(p.sender_id) === mid})),
      mutualFriends: common.mutualFriends,
      mutualCommunities: common.mutualCommunities,
      incoming: mid && Number(row.receiver_id) === mid,
    };
  }

  function send(user, body) {
    const oid = Number(body && (body.userId != null ? body.userId : body.receiverId));
    if (!Number.isInteger(oid) || oid <= 0 || oid === Number(user.id)) throw new ApiError(400, 'BAD_USER', '请选择要发消息的用户');
    const other = userBy.get(oid);
    if (!other || other.status !== 'active') throw new ApiError(404, 'NOT_FOUND', '找不到这位用户');
    if (friends && friends.isBlocked && friends.isBlocked(user.id, oid)) throw new ApiError(403, 'BLOCKED', '因拉黑无法发送');
    if (canDirect(user.id, oid)) throw new ApiError(409, 'DIRECT_OK', '你们已经可以正常聊天');
    const text = String((body && body.text) != null ? body.text : '').trim();
    if (!text) throw new ApiError(400, 'BAD_TEXT', '请输入消息');
    if ([...text].length > 2000) throw new ApiError(400, 'BAD_TEXT', '消息过长');
    let row = byPair.get(Number(user.id), oid);
    const t = now();
    let reopened = false;
    if (row && row.status === 'declined') {
      // 被删除后允许再发，重建为 pending，不受上一条间隔限制
      setSt.run('pending', t, row.id);
      row = byId.get(row.id);
      reopened = true;
    }
    if (row && (row.status === 'blocked')) throw new ApiError(403, 'BLOCKED', '无法再发送请求');
    if (row && row.status === 'accepted') throw new ApiError(409, 'DIRECT_OK', '你们已经可以正常聊天');
    if (!row) {
      // 对方是否已向我发过？提示去处理
      const incoming = byPair.get(oid, Number(user.id));
      if (incoming && incoming.status === 'pending') throw new ApiError(409, 'ALREADY_INCOMING', '对方已经向你发起了消息请求');
      const id = nid('mr');
      ins.run(id, Number(user.id), oid, 'pending', t, t);
      row = byId.get(id);
    }
    const n = nPrev.get(row.id).n;
    if (n >= MAX_PREVIEWS) throw new ApiError(429, 'TOO_MANY', '这条请求的预览消息已达上限');
    const last = lastPrev.get(row.id);
    if (!reopened && last && (t - last.created_at) < MIN_GAP_MS) throw new ApiError(429, 'RATE_LIMIT', '发送过于频繁，请稍后再试');
    insPrev.run(nid('mp'), row.id, Number(user.id), text, t);
    setSt.run('pending', t, row.id);
    row = byId.get(row.id);
    if (notifications && typeof notifications.push === 'function' && n === 0) {
      notifications.push(oid, {
        kind: 'message_request', title: '新的消息请求',
        body: (authorOf(user.id).displayName || '') + '：' + text.slice(0, 40),
        refType: 'message_request', refId: row.id, actorId: user.id,
        dedupeKey: 'mreq:' + row.id,
      });
    }
    return {request: pub(row, user)};
  }

  function list(user, q = {}) {
    const box = q.box === 'out' || q.box === 'outgoing' ? 'out' : 'in';
    const rows = box === 'out' ? listOut.all(Number(user.id)) : listIn.all(Number(user.id));
    return {requests: rows.map(r => pub(r, user)), pendingCount: cntIn.get(Number(user.id)).n};
  }
  function get(user, id) {
    const row = byId.get(id);
    if (!row) throw new ApiError(404, 'NOT_FOUND', '请求不存在');
    const mid = Number(user.id);
    if (Number(row.sender_id) !== mid && Number(row.receiver_id) !== mid) throw new ApiError(404, 'NOT_FOUND', '请求不存在');
    // 发送者在 pending 时不能得知「已读」，只返回自己发出的预览
    return {request: pub(row, user)};
  }
  function accept(user, id) {
    const row = byId.get(id);
    if (!row) throw new ApiError(404, 'NOT_FOUND', '请求不存在');
    if (Number(row.receiver_id) !== Number(user.id)) throw new ApiError(403, 'FORBIDDEN', '只能接受发给你的请求');
    if (row.status === 'accepted') {
      const cv = chats && chats.create ? chats.create(user, {kind:'dm', userId: row.sender_id}) : null;
      return {request: pub(byId.get(id), user), conversation: cv && cv.conversation, idempotent: true};
    }
    if (row.status !== 'pending') throw new ApiError(400, 'BAD_STATUS', '该请求已处理');
    setSt.run('accepted', now(), row.id);
    let conversation = null;
    if (chats && typeof chats.create === 'function') {
      conversation = chats.create(user, {kind:'dm', userId: row.sender_id}).conversation;
      // 把预览写入会话，不泄露已读给发送方之外的内容
      const prev = previewsOf.all(row.id);
      if (conversation && prev.length && chats.importPreviews) {
        chats.importPreviews(conversation.id, prev);
      } else if (conversation && prev.length) {
        try {
          const insMsg = db.prepare(`INSERT INTO messages(id,conversation_id,author_id,kind,text,created_at,client_id) VALUES(?,?,?,?,?,?,?)`);
          for (const p of prev) {
            const mid = nid('m');
            try { insMsg.run(mid, conversation.id, p.sender_id, 'text', p.text, p.created_at, 'mr:' + p.id); } catch {}
          }
        } catch {}
      }
    }
    return {request: pub(byId.get(row.id), user), conversation};
  }
  function decline(user, id) {
    const row = byId.get(id);
    if (!row) throw new ApiError(404, 'NOT_FOUND', '请求不存在');
    if (Number(row.receiver_id) !== Number(user.id)) throw new ApiError(403, 'FORBIDDEN', '只能处理发给你的请求');
    if (row.status === 'accepted') throw new ApiError(400, 'BAD_STATUS', '已接受的请求不能删除');
    setSt.run('declined', now(), row.id);
    return {request: pub(byId.get(id), user), deleted: true};
  }
  function block(user, id) {
    const row = byId.get(id);
    if (!row) throw new ApiError(404, 'NOT_FOUND', '请求不存在');
    if (Number(row.receiver_id) !== Number(user.id)) throw new ApiError(403, 'FORBIDDEN', '只能处理发给你的请求');
    setSt.run('blocked', now(), row.id);
    if (friends && typeof friends.block === 'function') friends.block(user.id, row.sender_id);
    return {request: pub(byId.get(id), user), blocked: true, userId: row.sender_id};
  }

  return {send, list, get, accept, decline, block, isAccepted, canDirect, pub, byId};
}
