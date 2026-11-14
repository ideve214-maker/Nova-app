// M3.5 用户举报与管理端队列。私聊只保存并返回用户勾选的 messageIds，访问详情写审计。
import {randomBytes} from 'node:crypto';
import {ApiError} from './errors.mjs';

const TYPES = new Set(['user', 'post', 'comment', 'message', 'community', 'conversation']);
const STATUSES = new Set(['pending', 'reviewing', 'resolved', 'rejected']);
const ACTIONS = new Set(['resolve', 'reject', 'review']);
const REASON_MAX = 80, DETAIL_MAX = 1000;

// 管理端（admin 1.1.0）只传 action=resolve + note=所选处理方式的中文文案；
// 服务端据此（或显式 penalty 字段）真正执行处置，否则“删除内容/封禁”只改了举报状态。
const PENALTIES = new Set(['none', 'warn', 'delete', 'ban', 'delete_ban']);
function penaltyOf(body, note) {
  const explicit = String(body.penalty || '').trim();
  if (PENALTIES.has(explicit)) return explicit;
  const n = String(note || '');
  const del = /删除(内容|帖子|评论|消息)/.test(n);
  const ban = /封禁/.test(n);
  if (del && ban) return 'delete_ban';
  if (del) return 'delete';
  if (ban) return 'ban';
  if (/警告/.test(n)) return 'warn';
  return 'none';
}

export function createReports(db, {now, notifications, profile, moderation} = {}) {
  const nowFn = now || Date.now;
  const mod = () => (typeof moderation === 'function' ? moderation() : moderation) || null;
  const msgHide = db.prepare('UPDATE messages SET deleted_at=? WHERE id=? AND deleted_at IS NULL');
  const ins = db.prepare(`INSERT INTO reports(id,reporter_id,target_type,target_id,target_user_id,reason,detail,message_ids,context,status,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,'pending',?)`);
  const byId = db.prepare('SELECT * FROM reports WHERE id=?');
  const userBy = db.prepare('SELECT * FROM users WHERE id=?');
  const postBy = db.prepare('SELECT * FROM posts WHERE id=? AND deleted_at IS NULL');
  const cmtBy = db.prepare('SELECT * FROM post_comments WHERE id=? AND deleted_at IS NULL');
  const cmBy = db.prepare('SELECT * FROM communities WHERE id=? AND deleted_at IS NULL');
  const cvBy = db.prepare('SELECT * FROM conversations WHERE id=? AND deleted_at IS NULL');
  const memGet = db.prepare('SELECT * FROM conversation_members WHERE conversation_id=? AND user_id=? AND left_at IS NULL');
  const msgBy = db.prepare('SELECT * FROM messages WHERE id=? AND deleted_at IS NULL');
  const setDecision = db.prepare('UPDATE reports SET status=?, decision_action=?, decision_note=?, decided_by=?, decided_at=? WHERE id=?');
  const setStatus = db.prepare('UPDATE reports SET status=? WHERE id=?');

  function authorCard(id) {
    if (id == null) return null;
    const u = userBy.get(Number(id));
    if (!u) return {id: Number(id), username: 'unknown', displayName: 'unknown'};
    const p = profile && profile.publicOf ? profile.publicOf(u) : {};
    return {id: u.id, username: u.username, displayName: p.displayName || u.username};
  }

  function parseIds(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.map(String);
    try { const j = JSON.parse(raw); return Array.isArray(j) ? j.map(String) : []; } catch { return []; }
  }
  function parseCtx(raw) {
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw) || {}; } catch { return {}; }
  }

  function titleOf(row) {
    const typeLabel = {user: '用户', post: '帖子', comment: '评论', message: '私聊消息', community: '社区', conversation: '会话'}[row.target_type] || row.target_type;
    return `举报${typeLabel}`;
  }

  // 管理端列表兼容 open/done（管理端 App 的 ReportItem），同时保留 pending 等规范状态。
  function queueStatus(status) {
    return (status === 'resolved' || status === 'rejected') ? 'done' : 'open';
  }

  function pub(row, {includeMessages = false} = {}) {
    if (!row) return null;
    const messageIds = parseIds(row.message_ids);
    const context = parseCtx(row.context);
    const out = {
      id: row.id,
      status: row.status,
      queueStatus: queueStatus(row.status),
      targetType: row.target_type,
      targetId: row.target_id,
      targetUserId: row.target_user_id != null ? Number(row.target_user_id) : null,
      reason: row.reason,
      detail: row.detail || '',
      messageIds,
      context,
      reporterId: Number(row.reporter_id),
      reporter: authorCard(row.reporter_id),
      targetUser: authorCard(row.target_user_id),
      title: titleOf(row),
      target: String(row.target_type) + ':' + String(row.target_id),
      time: row.created_at,
      createdAt: row.created_at,
      decision: row.decision_action ? {
        action: row.decision_action,
        note: row.decision_note || '',
        decidedBy: row.decided_by,
        decidedAt: row.decided_at,
        resolution: (row.decision_action === 'reject' ? '已驳回' : '已处理') + (row.decision_note ? '：' + row.decision_note : ''),
      } : null,
    };
    if (includeMessages) out.messages = loadSelectedMessages(messageIds, context, row);
    return out;
  }

  function loadSelectedMessages(ids, context, row) {
    const out = [];
    const allowCv = context && context.conversationId ? String(context.conversationId) : null;
    for (const id of ids) {
      const m = msgBy.get(id);
      if (!m) continue;
      // 只返回用户提交的那些 id；并且必须属于举报上下文中的会话（若给了）。
      if (allowCv && String(m.conversation_id) !== allowCv) continue;
      // 若是私聊，确认举报人是该会话成员（提交时已校验，这里再防串会话）。
      if (row && !memGet.get(m.conversation_id, row.reporter_id)) continue;
      const copies = (context && context.messageCopies) || {};
      const enc = !!m.encrypted;
      out.push({
        id: m.id,
        conversationId: m.conversation_id,
        text: enc ? '' : m.text,
        encrypted: enc,
        // 加密消息的明文只能由举报人在客户端解密后提交副本，不是服务端解开的。
        submittedPlaintext: copies[m.id] != null ? String(copies[m.id]) : undefined,
        createdAt: m.created_at,
        author: authorCard(m.author_id),
      });
    }
    return out;
  }

  function resolveTarget(user, body) {
    const type = String(body.targetType || '').trim();
    if (!TYPES.has(type)) throw new ApiError(400, 'BAD_TARGET_TYPE', '不支持的举报对象类型');
    const targetId = body.targetId != null ? String(body.targetId) : '';
    let targetUserId = body.targetUserId != null ? Number(body.targetUserId) : null;
    const context = body.context && typeof body.context === 'object' ? {...body.context} : {};
    const rawIds = Array.isArray(body.messageIds) ? body.messageIds.map(String) : [];
    // 用户提交的解密副本（仅限其勾选的 messageIds）；服务端不当作自己解开的明文。
    if (body.messageCopies && typeof body.messageCopies === 'object') {
      const copies = {};
      for (const [id, txt] of Object.entries(body.messageCopies)) {
        if (typeof txt === 'string' && txt.length) copies[String(id)] = txt.slice(0, 4000);
      }
      if (Object.keys(copies).length) context.messageCopies = copies;
    }
    const messageIds = [];

    if (type === 'user') {
      const id = Number(targetId || targetUserId);
      if (!Number.isInteger(id)) throw new ApiError(400, 'BAD_TARGET', '请指定用户');
      const u = userBy.get(id);
      if (!u || u.status === 'deleted') throw new ApiError(404, 'NOT_FOUND', '找不到要举报的用户');
      targetUserId = id;
      return {type, targetId: String(id), targetUserId, messageIds: [], context};
    }
    if (type === 'post') {
      if (!targetId) throw new ApiError(400, 'BAD_TARGET', '请指定帖子');
      const p = postBy.get(targetId);
      if (!p) throw new ApiError(404, 'NOT_FOUND', '找不到要举报的帖子');
      if (targetUserId == null) targetUserId = p.author_id;
      return {type, targetId, targetUserId, messageIds: [], context};
    }
    if (type === 'comment') {
      if (!targetId) throw new ApiError(400, 'BAD_TARGET', '请指定评论');
      const c = cmtBy.get(targetId);
      if (!c) throw new ApiError(404, 'NOT_FOUND', '找不到要举报的评论');
      if (targetUserId == null) targetUserId = c.author_id;
      return {type, targetId, targetUserId, messageIds: [], context};
    }
    if (type === 'community') {
      if (!targetId) throw new ApiError(400, 'BAD_TARGET', '请指定社区');
      const c = cmBy.get(targetId);
      if (!c) throw new ApiError(404, 'NOT_FOUND', '找不到要举报的社区');
      if (targetUserId == null) targetUserId = c.owner_id;
      return {type, targetId, targetUserId, messageIds: [], context};
    }
    if (type === 'message' || type === 'conversation') {
      const cvId = String(context.conversationId || (type === 'conversation' ? targetId : '') || '');
      // 私聊：只能提交用户勾选的 messageIds，且必须是自己所在会话里的消息。
      const ids = rawIds.length ? rawIds : (type === 'message' && targetId ? [targetId] : []);
      if (!ids.length) {
        if (type === 'conversation' && cvId) {
          const cv = cvBy.get(cvId);
          if (!cv || cv.deleted_at) throw new ApiError(404, 'NOT_FOUND', '找不到会话');
          // 单聊仍必须勾选消息，避免把整段私聊交给管理员；群聊允许举报整个会话。
          if (cv.kind === 'group') {
            if (!memGet.get(cvId, user.id)) throw new ApiError(403, 'FORBIDDEN', '只能举报自己所在的会话');
            context.conversationId = cvId;
            if (targetUserId == null) targetUserId = cv.owner_id || null;
            return {type, targetId: cvId, targetUserId, messageIds: [], context};
          }
        }
        throw new ApiError(400, 'BAD_MESSAGE_IDS', '私聊举报请勾选要提交的消息');
      }
      let conv = cvId;
      for (const mid of ids) {
        const m = msgBy.get(mid);
        if (!m) throw new ApiError(404, 'NOT_FOUND', '找不到勾选的消息');
        if (!memGet.get(m.conversation_id, user.id)) {
          throw new ApiError(403, 'FORBIDDEN', '只能提交自己所在会话里勾选的消息');
        }
        if (conv && String(m.conversation_id) !== String(conv)) {
          throw new ApiError(400, 'BAD_MESSAGE_IDS', '勾选的消息必须属于同一会话');
        }
        conv = m.conversation_id;
        if (!messageIds.includes(m.id)) messageIds.push(m.id);
      }
      const cv = cvBy.get(conv);
      if (!cv) throw new ApiError(404, 'NOT_FOUND', '找不到会话');
      context.conversationId = conv;
      const tid = type === 'message' ? messageIds[0] : conv;
      if (targetUserId == null) {
        // 私聊默认被举报人 = 第一条勾选消息的作者（若是自己发的，则取对方）
        const first = msgBy.get(messageIds[0]);
        if (first && Number(first.author_id) !== Number(user.id)) targetUserId = first.author_id;
        else if (cv.kind === 'dm') {
          targetUserId = Number(cv.dm_lo) === Number(user.id) ? cv.dm_hi : cv.dm_lo;
        }
      }
      return {type, targetId: String(tid), targetUserId, messageIds, context};
    }
    throw new ApiError(400, 'BAD_TARGET_TYPE', '不支持的举报对象类型');
  }

  function submit(user, body = {}) {
    const reason = String(body.reason || '').trim();
    if (!reason) throw new ApiError(400, 'BAD_REASON', '请填写举报原因');
    if ([...reason].length > REASON_MAX) throw new ApiError(400, 'BAD_REASON', '举报原因过长');
    const detail = String(body.detail || '').trim();
    if ([...detail].length > DETAIL_MAX) throw new ApiError(400, 'BAD_DETAIL', '说明过长');
    const t = resolveTarget(user, body || {});
    if (t.targetUserId != null && Number(t.targetUserId) === Number(user.id) && t.type === 'user') {
      throw new ApiError(400, 'BAD_TARGET', '不能举报自己');
    }
    const id = 'rp_' + randomBytes(12).toString('base64url');
    if (t.context && t.context.messageCopies) {
      const keep = {};
      for (const id of t.messageIds || []) {
        if (t.context.messageCopies[id] != null) keep[id] = t.context.messageCopies[id];
      }
      if (Object.keys(keep).length) t.context.messageCopies = keep;
      else delete t.context.messageCopies;
    }
    ins.run(
      id, Number(user.id), t.type, t.targetId,
      t.targetUserId != null ? Number(t.targetUserId) : null,
      reason, detail || null,
      t.messageIds.length ? JSON.stringify(t.messageIds) : null,
      Object.keys(t.context).length ? JSON.stringify(t.context) : null,
      nowFn(),
    );
    const row = byId.get(id);
    return {report: pub(row)};
  }

  function list(q = {}) {
    const status = q.status ? String(q.status) : '';
    const targetType = q.targetType ? String(q.targetType) : '';
    const limit = Math.min(Math.max(Number(q.limit) || 20, 1), 50);
    // cursor 为 created_at 的整数时间戳（更早的一页）
    const cursor = q.cursor != null && q.cursor !== '' ? Number(q.cursor) : null;
    const where = [];
    const args = [];
    if (status === 'open') {
      where.push("status IN ('pending','reviewing')");
    } else if (status === 'done') {
      where.push("status IN ('resolved','rejected')");
    } else if (status && STATUSES.has(status)) {
      where.push('status=?'); args.push(status);
    }
    if (targetType && TYPES.has(targetType)) { where.push('target_type=?'); args.push(targetType); }
    if (cursor != null && Number.isFinite(cursor)) { where.push('created_at<?'); args.push(cursor); }
    const sql = 'SELECT * FROM reports' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY created_at DESC, id DESC LIMIT ?';
    const rows = db.prepare(sql).all(...args, limit + 1);
    const more = rows.length > limit;
    const slice = more ? rows.slice(0, limit) : rows;
    const nextCursor = more ? slice[slice.length - 1].created_at : null;
    return {reports: slice.map(r => pub(r)), nextCursor};
  }

  function get(id, {includeMessages = true} = {}) {
    const row = byId.get(String(id));
    if (!row) throw new ApiError(404, 'NOT_FOUND', '找不到该举报');
    return {report: pub(row, {includeMessages})};
  }

  function decide(admin, id, body = {}) {
    const row = byId.get(String(id));
    if (!row) throw new ApiError(404, 'NOT_FOUND', '找不到该举报');
    const action = String(body.action || '').trim();
    if (!ACTIONS.has(action)) throw new ApiError(400, 'BAD_ACTION', '处理动作不正确');
    const note = String(body.note || '').trim().slice(0, 500);
    const notify = body.notify !== false;
    if (action === 'review') {
      setStatus.run('reviewing', row.id);
      return {report: pub(byId.get(row.id)), notified: false};
    }
    const status = action === 'reject' ? 'rejected' : 'resolved';
    const penalty = action === 'reject' ? 'none' : penaltyOf(body, note);
    const enforced = {penalty, contentHidden: false, userBanned: false, skipped: []};
    db.exec('BEGIN');
    try {
      if (penalty === 'delete' || penalty === 'delete_ban') {
        const m = mod();
        const reason = '举报处理：' + (fresh0Reason(row)) + (note ? '（' + note + '）' : '');
        if ((row.target_type === 'post' || row.target_type === 'comment') && m && m.hideContent) {
          try {
            m.hideContent(admin, row.target_type, row.target_id, {reason, report: row.id});
            enforced.contentHidden = true;
          } catch (e) {
            if (!(e instanceof ApiError) || e.s !== 404) throw e;
            enforced.skipped.push('delete:not_found');
          }
        } else if (row.target_type === 'message') {
          const ids = parseIds(row.message_ids);
          const all = ids.length ? ids : [String(row.target_id)];
          let n = 0;
          for (const mid of all) n += Number(msgHide.run(nowFn(), mid).changes || 0);
          enforced.contentHidden = n > 0;
        } else {
          enforced.skipped.push('delete:' + row.target_type);
        }
      }
      if (penalty === 'ban' || penalty === 'delete_ban') {
        const m = mod();
        if (row.target_user_id != null && m && m.ban) {
          m.ban(admin, row.target_user_id, {reason: '举报处理：' + fresh0Reason(row) + (note ? '（' + note + '）' : '')});
          enforced.userBanned = true;
        } else {
          enforced.skipped.push('ban:no_target_user');
        }
      }
      setDecision.run(status, action, note || null, admin && admin.id, nowFn(), row.id);
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch {}
      throw e;
    }
    const fresh = byId.get(row.id);
    let notified = false;
    if (notify && notifications && typeof notifications.push === 'function') {
      const result = action === 'reject' ? '未成立（已驳回）' : '已处理';
      const bodyText = `你关注的举报（${fresh.reason}）处理结论：${result}` + (note ? '。说明：' + note : '。') + ' 如有疑问可再次联系管理员。';
      const reporterText = `你提交的举报（${fresh.reason}）处理结论：${result}` + (note ? '。说明：' + note : '。') + ' 如需申诉，请通过再次举报或联系运营说明情况。';
      const penaltyText = enforced.contentHidden && enforced.userBanned ? '相关内容已被删除，账号已被封禁。'
        : enforced.contentHidden ? '相关内容已被删除，这是一次警告，请遵守社区规范。'
        : enforced.userBanned ? '账号已被封禁。'
        : penalty === 'warn' ? '这是一次警告，请遵守社区规范。' : '';
      const targetText = `有用户对你的内容提出了举报（原因：${fresh.reason}），处理结论：${result}` + (note ? '。说明：' + note + '。' : '。') + penaltyText + ' 如需申诉，请联系运营并说明情况。';
      const payload = (uid, title, text) => notifications.push(uid, {
        kind: 'report_result',
        title,
        body: text,
        refType: 'report',
        refId: fresh.id,
        actorId: null,
        dedupeKey: 'report:' + fresh.id + ':result',
      });
      payload(fresh.reporter_id, '举报处理结果', reporterText);
      if (fresh.target_user_id != null && Number(fresh.target_user_id) !== Number(fresh.reporter_id)) {
        payload(fresh.target_user_id, '举报处理结果', targetText);
      }
      notified = true;
    }
    return {report: pub(fresh), notified, enforced};
  }

  function fresh0Reason(row) { return String(row.reason || '').slice(0, 80); }

  return {submit, list, get, decide, pub};
}
