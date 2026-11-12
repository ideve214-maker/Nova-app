// M4.3 单聊/群聊：会话、成员、消息。权限在服务端校验，不信任客户端角色。
import {randomBytes} from 'node:crypto';
import {ApiError} from './errors.mjs';

const nid = p => p + '_' + randomBytes(12).toString('base64url');
const len = s => [...String(s)].length;
const ROLES = Object.freeze({owner: 3, admin: 2, member: 1});
const ROLE_CN = Object.freeze({owner: '群主', admin: '管理员', member: '成员'});
const CN_ROLE = Object.freeze({群主: 'owner', 管理员: 'admin', 成员: 'member'});
const NEED = Object.freeze({addMember: 2, kick: 2, setAdmin: 3, rename: 2, atAll: 2, pinMsg: 2});
const MAX_GROUP = 50;
const NAME_MAX = 20;

export function createChats(db, {profile, vip, now, friends, onEvent} = {}) {
  const userBy = db.prepare('SELECT * FROM users WHERE id=?');
  const insCv = db.prepare(`INSERT INTO conversations(id,kind,name,owner_id,created_at,dm_lo,dm_hi) VALUES(?,?,?,?,?,?,?)`);
  const byId = db.prepare('SELECT * FROM conversations WHERE id=?');
  const byPair = db.prepare(`SELECT * FROM conversations WHERE kind='dm' AND dm_lo=? AND dm_hi=?`);
  const delCv = db.prepare('UPDATE conversations SET deleted_at=? WHERE id=?');
  const setOwner = db.prepare('UPDATE conversations SET owner_id=? WHERE id=?');
  const setName = db.prepare('UPDATE conversations SET name=? WHERE id=?');
  const insMem = db.prepare(`INSERT INTO conversation_members(conversation_id,user_id,role,joined_at,left_at) VALUES(?,?,?,?,NULL)
    ON CONFLICT(conversation_id,user_id) DO UPDATE SET role=excluded.role, joined_at=excluded.joined_at, left_at=NULL`);
  const mem = db.prepare(`SELECT * FROM conversation_members WHERE conversation_id=? AND user_id=?`);
  const mems = db.prepare(`SELECT * FROM conversation_members WHERE conversation_id=? AND left_at IS NULL ORDER BY joined_at, user_id`);
  const setRole = db.prepare(`UPDATE conversation_members SET role=? WHERE conversation_id=? AND user_id=?`);
  const setLeft = db.prepare(`UPDATE conversation_members SET left_at=? WHERE conversation_id=? AND user_id=?`);
  const clearLeft = db.prepare(`UPDATE conversation_members SET left_at=NULL, joined_at=? WHERE conversation_id=? AND user_id=?`);
  const mine = db.prepare(`SELECT c.* FROM conversations c
    JOIN conversation_members m ON m.conversation_id=c.id
    WHERE c.deleted_at IS NULL AND m.user_id=? AND m.left_at IS NULL
    ORDER BY c.created_at DESC, c.id DESC`);
  const nMem = db.prepare(`SELECT COUNT(*) AS n FROM conversation_members WHERE conversation_id=? AND left_at IS NULL`);
  const hasMsg = (() => { try { db.prepare('SELECT 1 FROM messages LIMIT 1').get(); return true; } catch { return false; } })();
  const nidMsg = () => nid('mg');
  const insMsg = hasMsg ? db.prepare(`INSERT INTO messages(id,conversation_id,author_id,kind,text,created_at,client_id) VALUES(?,?,?,?,?,?,?)`) : null;
  const msgById = hasMsg ? db.prepare('SELECT * FROM messages WHERE id=?') : null;
  const msgByClient = hasMsg ? db.prepare('SELECT * FROM messages WHERE conversation_id=? AND author_id=? AND client_id=?') : null;
  const lastMsg = hasMsg ? db.prepare(`SELECT * FROM messages WHERE conversation_id=? AND deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 1`) : null;
  const newestMsg = hasMsg ? db.prepare(`SELECT * FROM messages WHERE conversation_id=? AND deleted_at IS NULL
    ORDER BY created_at DESC, id DESC LIMIT ?`) : null;
  const olderMsg = hasMsg ? db.prepare(`SELECT * FROM messages WHERE conversation_id=? AND deleted_at IS NULL
    AND (created_at < ? OR (created_at = ? AND id < ?))
    ORDER BY created_at DESC, id DESC LIMIT ?`) : null;
  const afterMsg = hasMsg ? db.prepare(`SELECT * FROM messages WHERE conversation_id=? AND deleted_at IS NULL
    AND (created_at > ? OR (created_at = ? AND id > ?))
    ORDER BY created_at ASC, id ASC LIMIT ?`) : null;
  const afterById = hasMsg ? db.prepare(`SELECT * FROM messages WHERE conversation_id=? AND deleted_at IS NULL
    AND created_at >= (SELECT created_at FROM messages WHERE id=?)
    ORDER BY created_at ASC, id ASC LIMIT ?`) : null;


  let sendMsg = null, listMsg = null; // 由 attachMessages 在 M4.3.2 挂上

  function authorOf(id) {
    const u = userBy.get(Number(id));
    if (!u) return {id: Number(id), username: 'unknown', displayName: 'unknown'};
    const p = profile.publicOf(u);
    return {id: u.id, username: u.username, displayName: p.displayName, avatar: p.avatar, vip: !!(vip && vip.status(u).active)};
  }
  function pair(a, b) {
    a = Number(a); b = Number(b);
    return a < b ? [a, b] : [b, a];
  }
  function activeMem(cvId, userId) {
    const m = mem.get(cvId, Number(userId));
    return m && !m.left_at ? m : null;
  }
  function requireConv(id) {
    const row = byId.get(id);
    if (!row || row.deleted_at) throw new ApiError(404, 'NOT_FOUND', '找不到这个会话');
    return row;
  }
  function requireMem(row, user) {
    const m = activeMem(row.id, user.id);
    if (!m) throw new ApiError(404, 'NOT_FOUND', '找不到这个会话');
    return m;
  }
  function requireAct(m, act) {
    if ((ROLES[m.role] || 0) < (NEED[act] || 99)) throw new ApiError(403, 'FORBIDDEN', '没有权限');
  }
  function emit(userIds, type, payload) {
    if (typeof onEvent === 'function') onEvent(userIds, type, payload);
  }

  function pub(row, me) {
    if (!row || row.deleted_at) return null;
    const members = mems.all(row.id).map(m => ({
      ...authorOf(m.user_id), role: ROLE_CN[m.role], roleKey: m.role, joinedAt: m.joined_at,
    }));
    const my = members.find(m => Number(m.id) === Number(me.id));
    const out = {
      id: row.id,
      kind: row.kind,
      name: row.kind === 'group' ? row.name : null,
      owner: row.kind === 'group' && row.owner_id ? authorOf(row.owner_id) : null,
      memberCount: members.length,
      members,
      myRole: my ? my.role : '',
      myRoleKey: my ? my.roleKey : '',
      createdAt: row.created_at,
    };
    if (listMsg) {
      const last = listMsg.last(row.id);
      if (last) out.lastMessage = last;
    }
    return out;
  }

  function checkDmGate(a, b) {
    if (!friends) return;
    if (typeof friends.isBlocked === 'function' && friends.isBlocked(a, b)) {
      throw new ApiError(403, 'BLOCKED', '因拉黑无法私聊');
    }
    if (friends.enforce && typeof friends.areFriends === 'function' && !friends.areFriends(a, b)) {
      throw new ApiError(403, 'NOT_FRIENDS', '只有双向好友才能私聊');
    }
  }

  function openDm(user, otherId) {
    const oid = Number(otherId);
    if (!Number.isInteger(oid) || oid <= 0) throw new ApiError(400, 'BAD_USER', '请指定对方');
    if (oid === Number(user.id)) throw new ApiError(400, 'SELF_DM', '不能和自己发起私聊');
    const other = userBy.get(oid);
    if (!other || other.status !== 'active') throw new ApiError(404, 'NOT_FOUND', '找不到这位用户');
    checkDmGate(user.id, oid);
    const [lo, hi] = pair(user.id, oid);
    let row = byPair.get(lo, hi);
    const t = now();
    if (!row || row.deleted_at) {
      if (row && row.deleted_at) {
        // 不应出现：单聊不解散。防守性重建成员。
      }
      if (!row) {
        const id = nid('cv');
        insCv.run(id, 'dm', null, null, t, lo, hi);
        insMem.run(id, Number(user.id), 'member', t);
        insMem.run(id, oid, 'member', t);
        row = byId.get(id);
      }
    }
    const mineM = mem.get(row.id, Number(user.id));
    if (mineM && mineM.left_at) clearLeft.run(t, row.id, Number(user.id));
    return {conversation: pub(byId.get(row.id), user), created: !mineM || !!mineM.left_at};
  }

  function createGroup(user, body) {
    const name = String((body && body.name) || '').trim();
    if (len(name) < 1 || len(name) > NAME_MAX) throw new ApiError(400, 'BAD_NAME', '群名需要 1 到 20 个字');
    const raw = Array.isArray(body && body.userIds) ? body.userIds : [];
    const ids = [...new Set(raw.map(Number).filter(n => Number.isInteger(n) && n > 0 && n !== Number(user.id)))];
    if (!ids.length) throw new ApiError(400, 'NO_MEMBERS', '至少选择一位成员');
    if (ids.length + 1 > MAX_GROUP) throw new ApiError(400, 'TOO_MANY', '群成员最多 50 人');
    for (const id of ids) {
      const u = userBy.get(id);
      if (!u || u.status !== 'active') throw new ApiError(404, 'NOT_FOUND', '有成员不存在或不可用');
    }
    const t = now();
    const id = nid('cv');
    insCv.run(id, 'group', name, Number(user.id), t, null, null);
    insMem.run(id, Number(user.id), 'owner', t);
    for (const oid of ids) insMem.run(id, oid, 'member', t);
    return {conversation: pub(byId.get(id), user)};
  }

  function create(user, body) {
    const kind = body && body.kind;
    if (kind === 'dm') return openDm(user, body.userId);
    if (kind === 'group') return createGroup(user, body);
    throw new ApiError(400, 'BAD_KIND', '请指定单聊或群聊');
  }

  function list(user) {
    return {conversations: mine.all(Number(user.id)).map(r => pub(r, user))};
  }

  function get(user, id) {
    const row = requireConv(id);
    requireMem(row, user);
    return {conversation: pub(row, user)};
  }

  function addMember(user, id, body) {
    const row = requireConv(id);
    if (row.kind !== 'group') throw new ApiError(400, 'NOT_GROUP', '只有群聊能添加成员');
    const m = requireMem(row, user);
    requireAct(m, 'addMember');
    const oid = Number(body && body.userId);
    if (!Number.isInteger(oid) || oid <= 0) throw new ApiError(400, 'BAD_USER', '请指定要添加的成员');
    const u = userBy.get(oid);
    if (!u || u.status !== 'active') throw new ApiError(404, 'NOT_FOUND', '找不到这位用户');
    if (activeMem(id, oid)) return {member: {...authorOf(oid), role: ROLE_CN[mem.get(id, oid).role], roleKey: mem.get(id, oid).role}, already: true};
    if (nMem.get(id).n >= MAX_GROUP) throw new ApiError(400, 'TOO_MANY', '群成员最多 50 人');
    const t = now();
    const existed = mem.get(id, oid);
    if (existed) clearLeft.run(t, id, oid);
    else insMem.run(id, oid, 'member', t);
    setRole.run('member', id, oid);
    const out = {member: {...authorOf(oid), role: '成员', roleKey: 'member'}};
    emit([oid, ...mems.all(id).map(x => x.user_id)], 'conversation.member', {conversationId: id, ...out});
    return out;
  }

  function setMemberRole(user, id, body) {
    const row = requireConv(id);
    if (row.kind !== 'group') throw new ApiError(400, 'NOT_GROUP', '只有群聊能设置角色');
    const m = requireMem(row, user);
    const oid = Number(body && body.userId);
    const wantCn = String((body && body.role) || '');
    const want = CN_ROLE[wantCn] || (['owner', 'admin', 'member'].includes(wantCn) ? wantCn : null);
    if (!want) throw new ApiError(400, 'BAD_ROLE', '角色不正确');
    const t = activeMem(id, oid);
    if (!t) throw new ApiError(404, 'NOT_FOUND', '对方不在这个群');
    if (Number(oid) === Number(user.id)) throw new ApiError(400, 'SELF_ROLE', '不能更改自己的角色');
    if (t.role === 'owner') throw new ApiError(403, 'FORBIDDEN', '不能更改群主的角色');
    if (want === 'owner') {
      // 转让群主：仅现任群主
      if (m.role !== 'owner') throw new ApiError(403, 'FORBIDDEN', '只有群主能转让群主');
      setRole.run('member', id, Number(user.id));
      setRole.run('owner', id, oid);
      setOwner.run(oid, id);
      return {member: {...authorOf(oid), role: '群主', roleKey: 'owner'}, previousOwner: {...authorOf(user.id), role: '成员', roleKey: 'member'}};
    }
    if (want === 'admin') {
      if (m.role !== 'owner') throw new ApiError(403, 'FORBIDDEN', '只有群主能设管理员');
    } else if (want === 'member') {
      if ((ROLES[m.role] || 0) <= (ROLES[t.role] || 0)) throw new ApiError(403, 'FORBIDDEN', '没有权限');
    } else {
      throw new ApiError(400, 'BAD_ROLE', '角色不正确');
    }
    setRole.run(want, id, oid);
    return {member: {...authorOf(oid), role: ROLE_CN[want], roleKey: want}};
  }

  function kick(user, id, body) {
    const row = requireConv(id);
    if (row.kind !== 'group') throw new ApiError(400, 'NOT_GROUP', '只有群聊能移出成员');
    const m = requireMem(row, user);
    requireAct(m, 'kick');
    const oid = Number(body && body.userId);
    const t = activeMem(id, oid);
    if (!t) throw new ApiError(404, 'NOT_FOUND', '对方不在这个群');
    if (Number(oid) === Number(user.id)) throw new ApiError(400, 'SELF_KICK', '要退出请使用退出接口');
    if ((ROLES[m.role] || 0) <= (ROLES[t.role] || 0)) throw new ApiError(403, 'FORBIDDEN', '只能移出比自己等级低的成员');
    setLeft.run(now(), id, oid);
    return {removed: oid};
  }

  function leave(user, id, body) {
    const row = requireConv(id);
    const m = requireMem(row, user);
    const t = now();
    if (row.kind === 'dm') {
      setLeft.run(t, id, Number(user.id));
      return {left: true};
    }
    if (m.role === 'owner') {
      const others = mems.all(id).filter(x => Number(x.user_id) !== Number(user.id));
      const transferTo = body && body.transferTo != null ? Number(body.transferTo) : null;
      if (others.length && !transferTo) throw new ApiError(400, 'OWNER_LEAVE', '请先转让群主再退出');
      if (!others.length) {
        setLeft.run(t, id, Number(user.id));
        delCv.run(t, id);
        return {left: true, dissolved: true};
      }
      const nt = activeMem(id, transferTo);
      if (!nt) throw new ApiError(400, 'BAD_USER', '转让对象不在这个群');
      setRole.run('member', id, Number(user.id));
      setRole.run('owner', id, transferTo);
      setOwner.run(transferTo, id);
    }
    setLeft.run(t, id, Number(user.id));
    return {left: true};
  }

  function rename(user, id, body) {
    const row = requireConv(id);
    if (row.kind !== 'group') throw new ApiError(400, 'NOT_GROUP', '只有群聊能改名');
    const m = requireMem(row, user);
    requireAct(m, 'rename');
    const name = String((body && body.name) || '').trim();
    if (len(name) < 1 || len(name) > NAME_MAX) throw new ApiError(400, 'BAD_NAME', '群名需要 1 到 20 个字');
    setName.run(name, id);
    return {conversation: pub(byId.get(id), user)};
  }


  function pubMsg(row, me) {
    if (!row) return null;
    return {
      id: row.id,
      conversationId: row.conversation_id,
      author: authorOf(row.author_id),
      kind: row.kind,
      text: row.deleted_at ? '' : row.text,
      deleted: !!row.deleted_at,
      createdAt: row.created_at,
      mine: !!(me && Number(me.id) === Number(row.author_id)),
      clientId: row.client_id || undefined,
    };
  }
  function parseCursor(c) {
    if (!c) return null;
    const s = String(c);
    const i = s.indexOf(':');
    if (i < 1) {
      const row = msgById && msgById.get(s);
      return row ? {at: row.created_at, id: row.id} : null;
    }
    return {at: Number(s.slice(0, i)), id: s.slice(i + 1)};
  }
  function send(user, id, body) {
    if (!insMsg) throw new ApiError(503, 'NO_MESSAGES', '消息功能尚未就绪');
    const row = requireConv(id);
    requireMem(row, user);
    if (row.kind === 'dm') {
      const other = mems.all(id).find(m => Number(m.user_id) !== Number(user.id));
      if (other) checkDmGate(user.id, other.user_id);
    }
    const text = String((body && body.text) != null ? body.text : '').trim();
    if (!len(text)) throw new ApiError(400, 'BAD_TEXT', '请输入消息');
    if (vip) vip.requireTextLength(user, 'chat', text);
    let clientId = body && body.clientId != null ? String(body.clientId).trim() : '';
    if (clientId) {
      if (clientId.length > 80) throw new ApiError(400, 'BAD_CLIENT_ID', 'clientId 过长');
      const existed = msgByClient.get(id, Number(user.id), clientId);
      if (existed) {
        if (existed.deleted_at) throw new ApiError(409, 'GONE', '这条消息已被删除');
        return {message: pubMsg(existed, user), idempotent: true};
      }
    } else clientId = null;
    const mid = nidMsg(), t = now();
    try { insMsg.run(mid, id, Number(user.id), 'text', text, t, clientId); }
    catch (e) {
      if (clientId && /UNIQUE/i.test(String(e.message))) {
        const existed = msgByClient.get(id, Number(user.id), clientId);
        if (existed && !existed.deleted_at) return {message: pubMsg(existed, user), idempotent: true};
      }
      throw e;
    }
    const msg = pubMsg(msgById.get(mid), user);
    const others = mems.all(id).map(m => m.user_id);
    emit(others, 'conversation.message', {conversationId: id, message: msg});
    return {message: msg};
  }
  function listMessages(user, id, q = {}) {
    if (!newestMsg) throw new ApiError(503, 'NO_MESSAGES', '消息功能尚未就绪');
    const row = requireConv(id);
    requireMem(row, user);
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 100);
    if (q.after) {
      const cur = parseCursor(q.after);
      if (!cur) return {messages: [], nextCursor: null, hasMore: false};
      const rows = afterMsg.all(id, cur.at, cur.at, cur.id, limit + 1);
      const more = rows.length > limit;
      const page = more ? rows.slice(0, limit) : rows;
      return {
        messages: page.map(r => pubMsg(r, user)),
        nextCursor: more ? page[page.length - 1].created_at + ':' + page[page.length - 1].id : null,
        hasMore: more,
        direction: 'after',
      };
    }
    const cur = parseCursor(q.cursor);
    const rows = cur
      ? olderMsg.all(id, cur.at, cur.at, cur.id, limit + 1)
      : newestMsg.all(id, limit + 1);
    const more = rows.length > limit;
    const page = (more ? rows.slice(0, limit) : rows).reverse();
    const next = more ? page[0] : null; // oldest in this page — next older page starts here
    return {
      messages: page.map(r => pubMsg(r, user)),
      nextCursor: next ? next.created_at + ':' + next.id : null,
      hasMore: more,
    };
  }
  function lastOf(id) {
    if (!lastMsg) return null;
    const r = lastMsg.get(id);
    return r ? pubMsg(r, {id: -1}) : null;
  }

  function attachMessages(api) { sendMsg = api.send; listMsg = api; }
  // 自挂：本模块已含消息
  listMsg = {last: lastOf, list: listMessages};

  return {
    create, list, get, addMember, setMemberRole, kick, leave, rename,
    send, listMessages, pubMsg,
    attachMessages,
    requireConv, requireMem, activeMem, authorOf, checkDmGate, pub,
    ROLE_CN, ROLES, NEED, MAX_GROUP,
    // 供测试与后续步骤使用
    _byId: byId, _mems: mems,
  };
}
