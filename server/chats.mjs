// M4.3 单聊/群聊：会话、成员、消息。权限在服务端校验，不信任客户端角色。
import {randomBytes} from 'node:crypto';
import {ApiError} from './errors.mjs';
import {parseCiphertext} from './e2ee.mjs';

const nid = p => p + '_' + randomBytes(12).toString('base64url');
const len = s => [...String(s)].length;
const ROLES = Object.freeze({owner: 3, admin: 2, member: 1});
const ROLE_CN = Object.freeze({owner: '群主', admin: '管理员', member: '成员'});
const CN_ROLE = Object.freeze({群主: 'owner', 管理员: 'admin', 成员: 'member'});
const NEED = Object.freeze({addMember: 2, kick: 2, setAdmin: 3, rename: 2, atAll: 2, pinMsg: 2});
const MAX_GROUP = 50;
const NAME_MAX = 20;
const RECALL_MS = 2 * 60 * 1000; // 撤回时间窗：2 分钟
const PUBLIC_PIN_MAX = 5;

export function createChats(db, {profile, vip, now, friends, onEvent, media, stickers, blockwords} = {}) {
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
  const lastMsg = hasMsg ? db.prepare(`SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at DESC, id DESC LIMIT 1`) : null;
  const newestMsg = hasMsg ? db.prepare(`SELECT * FROM messages WHERE conversation_id=?
    ORDER BY created_at DESC, id DESC LIMIT ?`) : null;
  const olderMsg = hasMsg ? db.prepare(`SELECT * FROM messages WHERE conversation_id=?
    AND (created_at < ? OR (created_at = ? AND id < ?))
    ORDER BY created_at DESC, id DESC LIMIT ?`) : null;
  const afterMsg = hasMsg ? db.prepare(`SELECT * FROM messages WHERE conversation_id=?
    AND (created_at > ? OR (created_at = ? AND id > ?))
    ORDER BY created_at ASC, id ASC LIMIT ?`) : null;
  const afterById = hasMsg ? db.prepare(`SELECT * FROM messages WHERE conversation_id=?
    AND created_at >= (SELECT created_at FROM messages WHERE id=?)
    ORDER BY created_at ASC, id ASC LIMIT ?`) : null;

  const hasRead = (() => { try { db.prepare('SELECT last_read_at FROM conversation_members LIMIT 1').get(); return true; } catch { return false; } })();
  const setRead = hasRead ? db.prepare('UPDATE conversation_members SET last_read_message_id=?, last_read_at=? WHERE conversation_id=? AND user_id=?') : null;
  const setMuted = hasRead ? db.prepare('UPDATE conversation_members SET muted=? WHERE conversation_id=? AND user_id=?') : null;
  const setPinned = hasRead ? db.prepare('UPDATE conversation_members SET pinned=? WHERE conversation_id=? AND user_id=?') : null;
  const unreadSql = hasMsg ? db.prepare(`SELECT COUNT(*) AS n FROM messages
    WHERE conversation_id=? AND deleted_at IS NULL AND author_id<>?
    AND (? IS NULL OR created_at > ? OR (created_at = ? AND id > ?))`) : null;
  const readersSql = hasRead ? db.prepare(`SELECT user_id, last_read_message_id, last_read_at FROM conversation_members
    WHERE conversation_id=? AND left_at IS NULL AND last_read_at IS NOT NULL`) : null;

  const hasPin = (() => { try { db.prepare('SELECT 1 FROM message_pins LIMIT 1').get(); return true; } catch { return false; } })();
  const insPin = hasPin ? db.prepare('INSERT INTO message_pins(conversation_id,message_id,kind,user_id,pinned_at,pinned_by) VALUES(?,?,?,?,?,?)') : null;
  const delPinPub = hasPin ? db.prepare("DELETE FROM message_pins WHERE conversation_id=? AND message_id=? AND kind='public'") : null;
  const delPinMe = hasPin ? db.prepare("DELETE FROM message_pins WHERE conversation_id=? AND message_id=? AND kind='personal' AND user_id=?") : null;
  const pinsPub = hasPin ? db.prepare("SELECT * FROM message_pins WHERE conversation_id=? AND kind='public' ORDER BY pinned_at") : null;
  const pinsMe = hasPin ? db.prepare("SELECT * FROM message_pins WHERE conversation_id=? AND kind='personal' AND user_id=? ORDER BY pinned_at") : null;
  const nPinPub = hasPin ? db.prepare("SELECT COUNT(*) AS n FROM message_pins WHERE conversation_id=? AND kind='public'") : null;
  const delMsg = hasMsg ? db.prepare('UPDATE messages SET deleted_at=? WHERE id=? AND conversation_id=? AND deleted_at IS NULL') : null;
  const hasAt = (() => { try { db.prepare('SELECT at_all FROM messages LIMIT 1').get(); return true; } catch { return false; } })();
  const hasSticker = (() => { try { db.prepare('SELECT sticker FROM messages LIMIT 1').get(); return true; } catch { return false; } })();
  const hasE2ee = (() => { try { db.prepare('SELECT encrypted FROM messages LIMIT 1').get(); return true; } catch { return false; } })();
  const setE2ee = hasE2ee ? db.prepare('UPDATE messages SET encrypted=1, text=?, ciphertext=?, e2ee_type=?, sender_device_id=?, recipient_device_id=?, olm_session_id=? WHERE id=?') : null;
  const hasReply = (() => { try { db.prepare('SELECT reply_to_id FROM messages LIMIT 1').get(); return true; } catch { return false; } })();
  const setReply = hasReply ? db.prepare('UPDATE messages SET reply_to_id=? WHERE id=?') : null;
  const hasForward = (() => { try { db.prepare('SELECT forwarded FROM messages LIMIT 1').get(); return true; } catch { return false; } })();
  const setFwd = hasForward ? db.prepare('UPDATE messages SET forwarded=1, forward_from_message_id=?, forward_from_user_id=?, forward_from_conversation_id=?, forward_label=? WHERE id=?') : null;
  const hasRx = (() => { try { db.prepare('SELECT 1 FROM message_reactions LIMIT 1').get(); return true; } catch { return false; } })();
  const insRx = hasRx ? db.prepare('INSERT INTO message_reactions(message_id,conversation_id,user_id,emoji,created_at) VALUES(?,?,?,?,?)') : null;
  const delRx = hasRx ? db.prepare('DELETE FROM message_reactions WHERE message_id=? AND user_id=? AND emoji=?') : null;
  const getRx = hasRx ? db.prepare('SELECT * FROM message_reactions WHERE message_id=? AND user_id=? AND emoji=?') : null;
  const listRx = hasRx ? db.prepare('SELECT emoji, user_id FROM message_reactions WHERE message_id=? ORDER BY created_at, emoji') : null;
  const hasDraft = (() => { try { db.prepare('SELECT 1 FROM message_drafts LIMIT 1').get(); return true; } catch { return false; } })();
  const getDraft = hasDraft ? db.prepare('SELECT * FROM message_drafts WHERE user_id=? AND conversation_id=?') : null;
  const listDrafts = hasDraft ? db.prepare('SELECT * FROM message_drafts WHERE user_id=? ORDER BY updated_at DESC') : null;
  const upsDraft = hasDraft ? db.prepare('INSERT INTO message_drafts(user_id,conversation_id,text,reply_to_id,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id,conversation_id) DO UPDATE SET text=excluded.text, reply_to_id=excluded.reply_to_id, updated_at=excluded.updated_at') : null;
  const delDraft = hasDraft ? db.prepare('DELETE FROM message_drafts WHERE user_id=? AND conversation_id=?') : null;








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
      nickname: m.nickname || null,
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
      myNickname: my ? (my.nickname || null) : null,
      createdAt: row.created_at,
    };
    if (listMsg) {
      const last = listMsg.last(row.id);
      if (last) out.lastMessage = last;
    }
    const myMem = mem.get(row.id, Number(me.id));
    if (myMem) {
      out.lastReadMessageId = myMem.last_read_message_id || null;
      out.muted = !!(hasRead && myMem.muted);
      out.pinned = !!(hasRead && myMem.pinned);
      out.unread = unreadOf(row.id, me.id, myMem);
    }
    if (pinsPub) {
      out.publicPins = pinsPub.all(row.id).map(p => p.message_id);
      out.personalPins = pinsMe.all(row.id, Number(me.id)).map(p => p.message_id);
    }
    return out;
  }

  function checkDmGate(a, b) {
    if (!friends) return;
    if (typeof friends.isBlocked === 'function' && friends.isBlocked(a, b)) {
      throw new ApiError(403, 'BLOCKED', '因拉黑无法私聊');
    }
    if (typeof friends.areFriends === 'function' && friends.areFriends(a, b)) return;
    // 已接受的消息请求，或互相关注，可直接进入正常会话
    try {
      const acc = db.prepare(`SELECT 1 FROM message_requests WHERE status='accepted' AND ((sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?))`).get(Number(a), Number(b), Number(b), Number(a));
      if (acc) return;
    } catch {}
    try {
      const ab = db.prepare('SELECT 1 FROM follows WHERE follower_id=? AND followee_id=?').get(Number(a), Number(b));
      const ba = db.prepare('SELECT 1 FROM follows WHERE follower_id=? AND followee_id=?').get(Number(b), Number(a));
      if (ab && ba) return;
    } catch {}
    if (friends.enforce) {
      throw new ApiError(403, 'NOT_FRIENDS', '只有双向好友才能直接私聊，请先发送消息请求');
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

  const setNick = db.prepare('UPDATE conversation_members SET nickname=? WHERE conversation_id=? AND user_id=?');
  function setNickname(user, id, body) {
    const row = requireConv(id);
    if (row.kind !== 'group') throw new ApiError(400, 'NOT_GROUP', '只有群聊能设置本群昵称');
    requireMem(row, user);
    const nick = String((body && body.nickname) || '').trim();
    if (len(nick) > 20) throw new ApiError(400, 'BAD_NICK', '昵称最多 20 个字');
    setNick.run(nick || null, id, Number(user.id));
    return {nickname: nick || null, conversation: pub(byId.get(id), user)};
  }

  function dissolve(user, id) {
    const row = requireConv(id);
    if (row.kind !== 'group') throw new ApiError(400, 'NOT_GROUP', '只有群聊能解散');
    const m = requireMem(row, user);
    if (m.role !== 'owner') throw new ApiError(403, 'FORBIDDEN', '只有群主能解散群聊');
    const t = now();
    for (const x of mems.all(id)) setLeft.run(t, id, x.user_id);
    delCv.run(t, id);
    return {dissolved: id};
  }

  function quoteOf(row) {
    if (!hasReply || !row || !row.reply_to_id) return null;
    const orig = msgById.get(row.reply_to_id);
    if (!orig) return {id: row.reply_to_id, deleted: true, missing: true, state: 'deleted', text: ''};
    const gone = !!orig.deleted_at;
    const enc = !!(hasE2ee && orig.encrypted);
    return {
      id: orig.id,
      conversationId: orig.conversation_id,
      author: authorOf(orig.author_id),
      text: (gone || enc) ? '' : String(orig.text || '').slice(0, 200),
      encrypted: !!(enc && !gone),
      deleted: gone,
      state: gone ? 'deleted' : 'ok',
    };
  }
  function pubMsg(row, me) {
    if (!row) return null;
    const enc = !!(hasE2ee && row.encrypted);
    const out = {
      id: row.id,
      conversationId: row.conversation_id,
      author: authorOf(row.author_id),
      kind: row.kind,
      // 加密消息的 text 永远为空，密文只放在 ciphertext 里，避免误当明文展示或入库索引。
      text: (row.deleted_at || enc) ? '' : row.text,
      encrypted: enc,
      ciphertext: (enc && !row.deleted_at) ? row.ciphertext : undefined,
      e2eeType: (enc && !row.deleted_at) ? (row.e2ee_type || 'olm') : undefined,
      senderDeviceId: (enc && !row.deleted_at) ? (row.sender_device_id || undefined) : undefined,
      recipientDeviceId: (enc && !row.deleted_at) ? (row.recipient_device_id || undefined) : undefined,
      sessionId: (enc && !row.deleted_at) ? (row.olm_session_id || undefined) : undefined,
      deleted: !!row.deleted_at,
      createdAt: row.created_at,
      createdAtUtc: new Date(row.created_at).toISOString(),
      mine: !!(me && Number(me.id) === Number(row.author_id)),
      clientId: row.client_id || undefined,
      atAll: !!(hasAt && row.at_all),
      mediaId: row.media_id || undefined,
      media: (row.media_id && media) ? media.pub(media._byId.get(row.media_id)) : undefined,
      sticker: (!row.deleted_at && row.sticker) ? (() => { try { return JSON.parse(row.sticker); } catch { return undefined; } })() : undefined,
      ...receiptOf(row, me),
      replyTo: quoteOf(row),
      forwarded: !!(hasForward && row.forwarded),
      forwardFrom: forwardFromOf(row, me),
      reactions: reactionsOf(row, me),
    };
    if (!enc && !row.deleted_at && blockwords && blockwords.personalFilter && me) {
      const f = blockwords.personalFilter(out.text, me, row.author_id);
      if (f) { out.text = f.text; out.filtered = true; out.filteredBy = f.filteredBy; }
    }
    return out;
  }
  function hideForwardAuthor(authorId, viewerId) {
    if (authorId == null || viewerId == null) return false;
    if (Number(authorId) === Number(viewerId)) return false;
    if (friends && typeof friends.isBlocked === 'function' && friends.isBlocked(authorId, viewerId)) return true;
    const u = userBy.get(Number(authorId));
    if (u && profile && typeof profile.privacyOf === 'function') {
      const vis = profile.privacyOf(u).profileVisibility;
      if (vis === 'private') return true;
      if (vis === 'friends' && friends && typeof friends.areFriends === 'function' && !friends.areFriends(authorId, viewerId)) return true;
    }
    return false;
  }
  function forwardFromOf(row, me) {
    if (!hasForward || !row || !row.forwarded) return null;
    const viewer = me && me.id;
    const hidden = hideForwardAuthor(row.forward_from_user_id, viewer);
    const name = hidden ? '一位用户' : (row.forward_label || (row.forward_from_user_id ? authorOf(row.forward_from_user_id).displayName : '一条消息'));
    return {
      messageId: hidden ? null : (row.forward_from_message_id || null),
      userId: hidden ? null : (row.forward_from_user_id || null),
      conversationId: hidden ? null : (row.forward_from_conversation_id || null),
      displayName: name,
      hidden,
      label: '转发',
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
    let text = String((body && body.text) != null ? body.text : '').trim();
    const mediaId = body && body.mediaId ? String(body.mediaId) : '';
    let stickerObj = null;
    const wantEnc = !!(body && (body.encrypted === true || body.ciphertext));
    let ctObj = null;
    if (wantEnc) {
      if (!hasE2ee || !setE2ee) throw new ApiError(503, 'NO_E2EE', '加密消息功能尚未就绪');
      if (row.kind !== 'dm') throw new ApiError(400, 'E2EE_GROUP', '群聊暂不支持端到端加密');
      if (text) throw new ApiError(400, 'PLAINTEXT_WITH_CIPHERTEXT', '加密消息不得附带明文');
      if (body.sticker) throw new ApiError(400, 'E2EE_STICKER', '请将贴纸放入密文后发送');
      ctObj = parseCiphertext(String(body.ciphertext || ''));
    }
    if (body && body.sticker) {
      if (wantEnc) throw new ApiError(400, 'E2EE_STICKER', '请将贴纸放入密文后发送');
      if (!stickers) throw new ApiError(503, 'NO_STICKERS', '贴纸功能尚未就绪');
      if (mediaId) throw new ApiError(400, 'BAD_STICKER', '贴纸不能和文件一起发送');
      const used = stickers.use(user, body.sticker);
      stickerObj = used.sticker;
      if (!text) text = stickerObj.glyph || '';
    }
    if (!wantEnc && !len(text) && !mediaId && !stickerObj) throw new ApiError(400, 'BAD_TEXT', '请输入消息');
    if (vip && len(text) && !wantEnc) vip.requireTextLength(user, 'chat', text);
    if (!wantEnc && text && blockwords && blockwords.assertPlatform) blockwords.assertPlatform(text);
    const wantAtAll = text.includes('@所有人');
    if (wantAtAll && row.kind === 'group') {
      const m = activeMem(id, user.id);
      if ((ROLES[m.role] || 0) < NEED.atAll) throw new ApiError(403, 'AT_ALL_FORBIDDEN', '只有群主和管理员能@所有人');
    }
    let clientId = body && body.clientId != null ? String(body.clientId).trim() : '';
    if (clientId) {
      if (clientId.length > 80) throw new ApiError(400, 'BAD_CLIENT_ID', 'clientId 过长');
      const existed = msgByClient.get(id, Number(user.id), clientId);
      if (existed) {
        if (existed.deleted_at) throw new ApiError(409, 'GONE', '这条消息已被删除');
        return {message: pubMsg(existed, user), idempotent: true};
      }
    } else clientId = null;
    const replyToIdEarly = body && (body.replyToId || body.reply_to_id || (body.replyTo && body.replyTo.id));
    if (replyToIdEarly) {
      if (!setReply) throw new ApiError(503, 'NO_REPLY', '引用回复尚未就绪');
      const orig0 = msgById.get(String(replyToIdEarly));
      if (!orig0 || orig0.conversation_id !== id) throw new ApiError(400, 'BAD_REPLY', '只能引用同一会话里的消息');
    }
    const mid = nidMsg(), t = now();
    try { insMsg.run(mid, id, Number(user.id), 'text', text, t, clientId); if (wantAtAll && hasAt) db.prepare('UPDATE messages SET at_all=1 WHERE id=?').run(mid); }
    catch (e) {
      if (clientId && /UNIQUE/i.test(String(e.message))) {
        const existed = msgByClient.get(id, Number(user.id), clientId);
        if (existed && !existed.deleted_at) return {message: pubMsg(existed, user), idempotent: true};
      }
      throw e;
    }
    if (mediaId && media) {
      const md = media.get(user, mediaId).media;
      if (Number(md.ownerId) !== Number(user.id)) throw new ApiError(403, 'FORBIDDEN', '只能发送自己上传的文件');
      db.prepare('UPDATE messages SET media_id=? WHERE id=?').run(mediaId, mid);
      media.attachToMessage(mediaId, id, mid);
    }
    if (stickerObj && hasSticker) {
      db.prepare('UPDATE messages SET sticker=? WHERE id=?').run(JSON.stringify(stickerObj), mid);
    }
    if (ctObj && setE2ee) {
      const stored = JSON.stringify(ctObj);
      const senderDev = body.senderDeviceId ? String(body.senderDeviceId).slice(0, 64) : null;
      const recip = ctObj.envelopes.length === 1 ? ctObj.envelopes[0].deviceId : 'multi';
      const sess = (body.sessionId || (ctObj.envelopes[0] && ctObj.envelopes[0].sessionId) || '').slice(0, 80) || null;
      setE2ee.run('', stored, 'olm', senderDev, recip, sess, mid);
    }
    const replyToId = body && (body.replyToId || body.reply_to_id || (body.replyTo && body.replyTo.id));
    if (replyToId) {
      if (!setReply) throw new ApiError(503, 'NO_REPLY', '引用回复尚未就绪');
      const orig = msgById.get(String(replyToId));
      if (!orig || orig.conversation_id !== id) throw new ApiError(400, 'BAD_REPLY', '只能引用同一会话里的消息');
      setReply.run(orig.id, mid);
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


  function unreadOf(cvId, userId, myMem) {
    if (!unreadSql) return 0;
    const at = myMem && myMem.last_read_at, mid = myMem && myMem.last_read_message_id;
    return unreadSql.get(cvId, Number(userId), at || null, at || 0, at || 0, mid || '').n;
  }
  function receiptOf(row, me) {
    if (!readersSql || !row) return {status: '已发送', readBy: []};
    const readers = readersSql.all(row.conversation_id).filter(r => {
      if (Number(r.user_id) === Number(row.author_id)) return false;
      if (r.last_read_at > row.created_at) return true;
      if (r.last_read_at === row.created_at && r.last_read_message_id && r.last_read_message_id >= row.id) return true;
      return false;
    });
    const readBy = readers.map(r => Number(r.user_id));
    const mine = me && Number(me.id) === Number(row.author_id);
    // 不假装「已送达」：没有设备级投递回执。只区分已发送 / 已读。
    let status = '已发送';
    if (mine && readBy.length) status = '已读';
    return {status, readBy, readCount: readBy.length};
  }
  function markRead(user, id, body) {
    const row = requireConv(id);
    requireMem(row, user);
    if (!setRead) throw new ApiError(503, 'NO_READ', '已读功能尚未就绪');
    let target = null;
    const mid = body && body.messageId;
    if (mid) {
      target = msgById.get(String(mid));
      if (!target || target.conversation_id !== id) throw new ApiError(404, 'NOT_FOUND', '找不到这条消息');
    } else {
      target = lastMsg && lastMsg.get(id);
      if (!target) return {read: true, lastReadMessageId: null, unread: 0};
    }
    const myMem = mem.get(id, Number(user.id));
    const curAt = myMem && myMem.last_read_at, curId = myMem && myMem.last_read_message_id;
    if (curAt && (target.created_at < curAt || (target.created_at === curAt && curId && target.id <= curId))) {
      return {read: true, lastReadMessageId: curId, unread: unreadOf(id, user.id, myMem), unchanged: true};
    }
    setRead.run(target.id, target.created_at, id, Number(user.id));
    const fresh = mem.get(id, Number(user.id));
    emit(mems.all(id).map(m => m.user_id), 'conversation.read', {
      conversationId: id, userId: Number(user.id), lastReadMessageId: target.id,
    });
    return {read: true, lastReadMessageId: target.id, unread: unreadOf(id, user.id, fresh)};
  }
  function setMute(user, id, body) {
    const row = requireConv(id);
    requireMem(row, user);
    if (!setMuted) throw new ApiError(503, 'NO_MUTE', '静音功能尚未就绪');
    const on = !!(body && (body.mute === true || body.mute === 1 || body.muted === true));
    setMuted.run(on ? 1 : 0, id, Number(user.id));
    return {muted: on};
  }
  function setConvPin(user, id, body) {
    const row = requireConv(id);
    requireMem(row, user);
    if (!setPinned) throw new ApiError(503, 'NO_PIN', '置顶功能尚未就绪');
    const on = !!(body && (body.pin === true || body.pin === 1 || body.pinned === true));
    setPinned.run(on ? 1 : 0, id, Number(user.id));
    return {pinned: on};
  }


  function recall(user, mid) {
    const row = msgById && msgById.get(mid);
    if (!row || row.deleted_at) {
      // 已撤回：幂等返回
      if (row && row.deleted_at) {
        const cv = requireConv(row.conversation_id);
        requireMem(cv, user);
        if (Number(row.author_id) !== Number(user.id)) throw new ApiError(403, 'FORBIDDEN', '只能撤回自己的消息');
        return {message: pubMsg(row, user), idempotent: true};
      }
      throw new ApiError(404, 'NOT_FOUND', '找不到这条消息');
    }
    const cv = requireConv(row.conversation_id);
    requireMem(cv, user);
    if (Number(row.author_id) !== Number(user.id)) throw new ApiError(403, 'FORBIDDEN', '只能撤回自己的消息');
    if (now() - row.created_at > RECALL_MS) throw new ApiError(400, 'RECALL_EXPIRED', '已超过 2 分钟，不能撤回');
    delMsg.run(now(), row.id, row.conversation_id);
    const fresh = msgById.get(row.id);
    emit(mems.all(cv.id).map(m => m.user_id), 'conversation.recall', {conversationId: cv.id, message: pubMsg(fresh, user)});
    return {message: pubMsg(fresh, user)};
  }
  function pinMessage(user, mid, body) {
    const row = msgById && msgById.get(mid);
    if (!row || row.deleted_at) throw new ApiError(404, 'NOT_FOUND', '找不到这条消息');
    const cv = requireConv(row.conversation_id);
    const m = requireMem(cv, user);
    const kind = (body && body.kind) === 'personal' ? 'personal' : 'public';
    if (kind === 'public') {
      if (cv.kind === 'group') requireAct(m, 'pinMsg');
      if (nPinPub.get(cv.id).n >= PUBLIC_PIN_MAX) {
        // 已置顶同一条则幂等
        const already = pinsPub.all(cv.id).some(p => p.message_id === mid);
        if (!already) throw new ApiError(400, 'PIN_LIMIT', '公共置顶最多 5 条');
      }
      try { insPin.run(cv.id, mid, 'public', null, now(), Number(user.id)); }
      catch (e) {
        if (!/UNIQUE/i.test(String(e.message))) throw e;
      }
    } else {
      try { insPin.run(cv.id, mid, 'personal', Number(user.id), now(), Number(user.id)); }
      catch (e) {
        if (!/UNIQUE/i.test(String(e.message))) throw e;
      }
    }
    return {kind, messageId: mid, publicPins: pinsPub.all(cv.id).map(p => p.message_id), personalPins: pinsMe.all(cv.id, Number(user.id)).map(p => p.message_id)};
  }
  function unpinMessage(user, mid, body) {
    const row = msgById && msgById.get(mid);
    if (!row) throw new ApiError(404, 'NOT_FOUND', '找不到这条消息');
    const cv = requireConv(row.conversation_id);
    const m = requireMem(cv, user);
    const kind = (body && body.kind) === 'personal' ? 'personal' : 'public';
    if (kind === 'public') {
      if (cv.kind === 'group') requireAct(m, 'pinMsg');
      delPinPub.run(cv.id, mid);
    } else {
      delPinMe.run(cv.id, mid, Number(user.id));
    }
    return {kind, messageId: mid, publicPins: pinsPub.all(cv.id).map(p => p.message_id), personalPins: pinsMe.all(cv.id, Number(user.id)).map(p => p.message_id)};
  }

  function attachMessages(api) { sendMsg = api.send; listMsg = api; }
  // 自挂：本模块已含消息
  listMsg = {last: lastOf, list: listMessages};



  function normalizeEmoji(s) {
    const t = String(s || '').trim();
    const chars = [...t];
    if (!chars.length || chars.length > 8) throw new ApiError(400, 'BAD_EMOJI', '请选择一个表情（最多 8 个字符）');
    if (/[\u0000-\u001f]/.test(t)) throw new ApiError(400, 'BAD_EMOJI', '表情不合法');
    return t;
  }
  function reactionsOf(row, me) {
    if (!hasRx || !row || !listRx) return [];
    const rows = listRx.all(row.id);
    const map = new Map();
    for (const r of rows) {
      const cur = map.get(r.emoji) || {emoji: r.emoji, count: 0, me: false};
      cur.count++;
      if (me && Number(r.user_id) === Number(me.id)) cur.me = true;
      map.set(r.emoji, cur);
    }
    return [...map.values()];
  }
  function react(user, mid, body = {}, {remove = false} = {}) {
    if (!hasRx) throw new ApiError(503, 'NO_REACTIONS', '表情反应尚未就绪');
    const row = msgById.get(String(mid));
    if (!row || row.deleted_at) throw new ApiError(404, 'NOT_FOUND', '消息不存在或已删除');
    const cv = requireConv(row.conversation_id);
    requireMem(cv, user);
    const emoji = normalizeEmoji(body.emoji || body.reaction);
    const undo = remove || body.remove === true || body.undo === true;
    const existed = getRx.get(row.id, Number(user.id), emoji);
    if (undo || (body.toggle && existed)) {
      if (existed) delRx.run(row.id, Number(user.id), emoji);
      const msg = pubMsg(msgById.get(row.id), user);
      emit(mems.all(cv.id).map(m => m.user_id), 'conversation.reaction', {conversationId: cv.id, messageId: row.id, reactions: msg.reactions, userId: user.id, emoji, added: false});
      return {message: msg, emoji, added: false, already: !existed, removed: !!existed};
    }
    if (existed) {
      return {message: pubMsg(msgById.get(row.id), user), emoji, added: false, already: true};
    }
    insRx.run(row.id, cv.id, Number(user.id), emoji, now());
    const msg = pubMsg(msgById.get(row.id), user);
    emit(mems.all(cv.id).map(m => m.user_id), 'conversation.reaction', {conversationId: cv.id, messageId: row.id, reactions: msg.reactions, userId: user.id, emoji, added: true});
    return {message: msg, emoji, added: true, already: false};
  }


  function pubDraft(r) {
    if (!r) return {text: '', replyToId: null, updatedAt: null, empty: true};
    return {conversationId: r.conversation_id, text: r.text || '', replyToId: r.reply_to_id || null, updatedAt: r.updated_at, empty: !(r.text && String(r.text).length)};
  }
  function getMessageDraft(user, cid) {
    const cv = requireConv(cid);
    requireMem(cv, user);
    if (!hasDraft) return {draft: pubDraft(null), conversationId: cv.id};
    return {draft: pubDraft(getDraft.get(Number(user.id), cv.id)), conversationId: cv.id};
  }
  function listMessageDrafts(user) {
    if (!hasDraft) return {drafts: []};
    return {drafts: listDrafts.all(Number(user.id)).map(pubDraft)};
  }
  function putMessageDraft(user, cid, body = {}) {
    const cv = requireConv(cid);
    requireMem(cv, user);
    if (!hasDraft) throw new ApiError(503, 'NO_DRAFTS', '草稿尚未就绪');
    const text = String(body.text == null ? '' : body.text);
    if ([...text].length > 4000) throw new ApiError(400, 'TOO_LONG', '草稿过长');
    const replyToId = body.replyToId ? String(body.replyToId) : null;
    if (!text.trim()) {
      delDraft.run(Number(user.id), cv.id);
      const out = {draft: pubDraft(null), conversationId: cv.id, cleared: true};
      emit([Number(user.id)], 'draft.sync', {conversationId: cv.id, draft: out.draft, cleared: true});
      return out;
    }
    upsDraft.run(Number(user.id), cv.id, text, replyToId, now());
    const out = {draft: pubDraft(getDraft.get(Number(user.id), cv.id)), conversationId: cv.id, cleared: false};
    emit([Number(user.id)], 'draft.sync', {conversationId: cv.id, draft: out.draft, cleared: false});
    return out;
  }
  function clearMessageDraft(user, cid) {
    return putMessageDraft(user, cid, {text: ''});
  }

  function messageOf(user, mid, {allowMissing = false} = {}) {
    const row = msgById.get(String(mid));
    if (!row) {
      if (allowMissing) return null;
      throw new ApiError(404, 'NOT_FOUND', '消息不存在');
    }
    const cv = requireConv(row.conversation_id);
    requireMem(cv, user);
    return row;
  }
  function forward(user, mid, body = {}) {
    if (!hasForward || !setFwd) throw new ApiError(503, 'NO_FORWARD', '转发功能尚未就绪');
    const src = msgById.get(String(mid));
    if (!src || src.deleted_at) throw new ApiError(404, 'NOT_FOUND', '消息不存在或已删除');
    const srcCv = requireConv(src.conversation_id);
    requireMem(srcCv, user);
    const destId = String((body && (body.conversationId || body.conversation_id)) || '').trim();
    if (!destId) throw new ApiError(400, 'BAD_DEST', '请选择要转发到的会话');
    const dest = requireConv(destId);
    requireMem(dest, user);
    if (dest.kind === 'dm') {
      const other = mems.all(destId).find(m => Number(m.user_id) !== Number(user.id));
      if (other) checkDmGate(user.id, other.user_id);
    }
    const srcEnc = !!(hasE2ee && src.encrypted);
    const wantEnc = !!(body && (body.encrypted === true || body.ciphertext));
    if (srcEnc && dest.kind === 'dm' && !wantEnc) {
      throw new ApiError(400, 'E2EE_REENCRYPT', '加密私聊的转发须由客户端重新加密后再发送，服务端不能代为解密。');
    }
    if (srcEnc && dest.kind !== 'dm' && !String((body && body.text) || '').trim() && !(body && body.sticker)) {
      throw new ApiError(400, 'E2EE_REENCRYPT', '转发到未加密会话时，请在客户端解密后再提交。');
    }
    let sendBody;
    if (wantEnc) {
      sendBody = {
        encrypted: true, ciphertext: body.ciphertext, senderDeviceId: body.senderDeviceId,
        clientId: body.clientId, sessionId: body.sessionId,
      };
    } else {
      const text = (body && body.text != null) ? String(body.text) : (srcEnc ? '' : src.text);
      if (!String(text).trim() && !src.sticker && !src.media_id) throw new ApiError(400, 'BAD_TEXT', '没有可转发的内容');
      sendBody = {text, clientId: body && body.clientId};
      if (body && body.sticker) sendBody.sticker = body.sticker;
      else if (src.sticker && hasSticker) {
        try { sendBody.sticker = JSON.parse(src.sticker); } catch { /* skip */ }
      }
    }
    const sent = send(user, destId, sendBody);
    const label = authorOf(src.author_id).displayName;
    setFwd.run(src.id, src.author_id, src.conversation_id, String(label).slice(0, 80), sent.message.id);
    return {message: pubMsg(msgById.get(sent.message.id), user)};
  }

  function memberIds(id) {
    requireConv(id);
    return mems.all(id).map(m => Number(m.user_id));
  }
  return {
    create, list, get, addMember, setMemberRole, kick, leave, rename, setNickname, dissolve,
    send, listMessages, pubMsg, quoteOf, forward, react, messageOf, getMessageDraft, listMessageDrafts, putMessageDraft, clearMessageDraft, markRead, setMute, setConvPin, unreadOf, receiptOf,
    recall, pinMessage, unpinMessage, RECALL_MS,
    attachMessages,
    requireConv, requireMem, memberIds, activeMem, authorOf, checkDmGate, pub,
    ROLE_CN, ROLES, NEED, MAX_GROUP,
    // 供测试与后续步骤使用
    _byId: byId, _mems: mems,
  };
}
