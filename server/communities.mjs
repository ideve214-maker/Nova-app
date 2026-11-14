// M4.2 社区：创建/加入/角色/频道/邀请。权限在服务端校验，不信任客户端角色字段。
import {randomBytes} from 'node:crypto';
import {ApiError} from './errors.mjs';

const nid = p => p + '_' + randomBytes(12).toString('base64url');
const len = s => [...String(s)].length;
const ROLES = Object.freeze({owner: 4, admin: 3, mod: 2, member: 1});
const ROLE_CN = Object.freeze({owner: '所有者', admin: '管理员', mod: '版主', member: '成员'});
const CN_ROLE = Object.freeze({所有者: 'owner', 管理员: 'admin', 版主: 'mod', 成员: 'member'});
const NEED = Object.freeze({
  post: 1, postAnn: 2, pinMsg: 2, delMsg: 2, atAll: 3,
  addChannel: 3, editChannel: 3, delChannel: 3,
  invite: 2, kick: 3, setMod: 3, setAdmin: 4, editInfo: 3, dissolve: 4, ban: 3,
});

export function createCommunities(db, {profile, vip, now, notifications, blockwords} = {}) {
  const deps = {notifications: notifications || null, blockwords: blockwords || null};
  const userBy = db.prepare('SELECT * FROM users WHERE id=?');
  const insCm = db.prepare(`INSERT INTO communities(id,name,description,visibility,owner_id,created_at) VALUES(?,?,?,?,?,?)`);
  const byId = db.prepare('SELECT * FROM communities WHERE id=?');
  const byCode = db.prepare('SELECT * FROM community_invites WHERE code=?');
  const pubList = db.prepare(`SELECT * FROM communities WHERE deleted_at IS NULL AND visibility='public' AND IFNULL(status,'active')='active' ORDER BY created_at DESC`);
  const mineList = db.prepare(`SELECT c.* FROM communities c JOIN community_members m ON m.community_id=c.id
    WHERE c.deleted_at IS NULL AND m.user_id=? AND m.status='active' ORDER BY c.created_at DESC`);
  const insMem = db.prepare(`INSERT INTO community_members(community_id,user_id,role,status,joined_at) VALUES(?,?,?,?,?)
    ON CONFLICT(community_id,user_id) DO UPDATE SET role=excluded.role, status=excluded.status, joined_at=excluded.joined_at`);
  const mem = db.prepare(`SELECT * FROM community_members WHERE community_id=? AND user_id=?`);
  const mems = db.prepare(`SELECT * FROM community_members WHERE community_id=? AND status='active' ORDER BY joined_at`);
  const setRole = db.prepare(`UPDATE community_members SET role=? WHERE community_id=? AND user_id=?`);
  const setStatus = db.prepare(`UPDATE community_members SET status=? WHERE community_id=? AND user_id=?`);
  const nMem = db.prepare(`SELECT COUNT(*) AS n FROM community_members WHERE community_id=? AND status='active'`);
  const insCh = db.prepare(`INSERT INTO community_channels(id,community_id,name,kind,is_default,position,created_at) VALUES(?,?,?,?,?,?,?)`);
  const chBy = db.prepare('SELECT * FROM community_channels WHERE id=?');
  const chs = db.prepare(`SELECT * FROM community_channels WHERE community_id=? AND deleted_at IS NULL ORDER BY position, id`);
  const nCh = db.prepare(`SELECT COUNT(*) AS n FROM community_channels WHERE community_id=? AND deleted_at IS NULL`);
  const renCh = db.prepare(`UPDATE community_channels SET name=? WHERE id=?`);
  const delCh = db.prepare(`UPDATE community_channels SET deleted_at=? WHERE id=?`);
  const insInv = db.prepare(`INSERT INTO community_invites(id,community_id,code,created_by,created_at,expires_at,max_uses) VALUES(?,?,?,?,?,?,?)`);
  const invs = db.prepare(`SELECT * FROM community_invites WHERE community_id=? ORDER BY created_at DESC`);
  const revInv = db.prepare(`UPDATE community_invites SET revoked_at=? WHERE id=? AND community_id=?`);
  const useInv = db.prepare(`UPDATE community_invites SET uses=uses+1 WHERE id=?`);
  const delCm = db.prepare(`UPDATE communities SET deleted_at=? WHERE id=?`);
  const insMsg = db.prepare(`INSERT INTO community_messages(id,channel_id,author_id,text,created_at) VALUES(?,?,?,?,?)`);
  const msgs = db.prepare(`SELECT * FROM community_messages WHERE channel_id=? AND deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT ?`);

  function authorOf(id) {
    const u = userBy.get(id); if (!u) return {id, username: 'unknown', displayName: 'unknown'};
    const p = profile.publicOf(u);
    const dn = p && p.displayName != null ? String(p.displayName).trim() : '';
    return {id: u.id, username: u.username, displayName: dn || u.username, avatar: p.avatar, vip: !!vip.status(u).active};
  }
  function roleOf(cmId, userId) {
    const m = mem.get(cmId, userId);
    return m && m.status === 'active' ? m.role : '';
  }
  function requireMem(cm, user, act, min) {
    const m = mem.get(cm.id, user.id);
    if (m && m.status === 'banned') throw new ApiError(403, 'BANNED', '你已被这个社区封禁');
    const r = m && m.status === 'active' ? m.role : '';
    const need = min != null ? min : (NEED[act] || 1);
    if ((ROLES[r] || 0) < need) throw new ApiError(403, 'FORBIDDEN', '没有权限');
    return r;
  }
  function pubCh(row) {
    return {id: row.id, name: row.name, kind: row.kind === 'announce' ? '公告' : '文字', kindKey: row.kind, isDefault: !!row.is_default};
  }
  function cmStatus(row) { return (row && row.status) || 'active'; }
  function isTaken(row) { return cmStatus(row) === 'taken_down'; }
  function normCover(v) {
    if (v == null) return undefined;
    const s = String(v).trim();
    if (!s || s === 'default') return '';
    if (/^assets\/bg-[a-z0-9_-]+\.(jpg|png|webp)$/i.test(s) && s.length < 180) return s;
    const prefix = 'data:image/jpeg;base64,';
    if (s.startsWith(prefix)) {
      if (s.length > 450000) throw new ApiError(400, 'BAD_COVER', '封面太大，请换一张小一点的');
      const body = s.slice(prefix.length).replace(/\s+/g, '');
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) throw new ApiError(400, 'BAD_COVER', '封面格式不正确');
      return prefix + body;
    }
    throw new ApiError(400, 'BAD_COVER', '封面格式不正确');
  }
  function pubCm(row, user, {withMembers} = {}) {
    if (!row || row.deleted_at) return null;
    const m = user ? mem.get(row.id, user.id) : null;
    const joined = !!(m && m.status === 'active');
    const banned = !!(m && m.status === 'banned');
    const takenDown = isTaken(row);
    const channels = (!takenDown && (joined || row.visibility === 'public')) ? chs.all(row.id).map(pubCh) : [];
    const out = {
      id: row.id, name: row.name, description: row.description, visibility: row.visibility,
      cover: row.cover || null,
      status: cmStatus(row),
      takedownReason: takenDown ? (row.takedown_reason || '') : '',
      takenDownAt: takenDown ? (row.taken_down_at || null) : null,
      joinStatus: (m && m.status === 'active') ? 'joined' : (m && m.status === 'pending') ? 'pending' : 'none',
      owner: authorOf(row.owner_id), memberCount: nMem.get(row.id).n,
      joined, banned, role: joined ? ROLE_CN[m.role] : '', roleKey: joined ? m.role : '',
      mutedUntil: (m && m.muted_until) || null,
      channels, createdAt: row.created_at,
    };
    if (withMembers && joined && !takenDown) {
      out.members = mems.all(row.id).map(x => ({...authorOf(x.user_id), role: ROLE_CN[x.role], roleKey: x.role, joinedAt: x.joined_at, mutedUntil: x.muted_until || null}));
    }
    return out;
  }
  function getVisible(user, id) {
    const row = byId.get(id);
    if (!row || row.deleted_at) throw new ApiError(404, 'NOT_FOUND', '社区不存在');
    const m = user ? mem.get(id, user.id) : null;
    const inCm = m && m.status === 'active';
    if (isTaken(row)) {
      if (!inCm) throw new ApiError(404, 'NOT_FOUND', '社区不存在');
      return row;
    }
    if (row.visibility === 'private' && !inCm) throw new ApiError(404, 'NOT_FOUND', '社区不存在');
    return row;
  }
  function assertOpen(row) {
    if (isTaken(row)) throw new ApiError(403, 'COMMUNITY_TAKEN_DOWN', '这个社区已下架');
  }

  function create(user, body) {
    const name = String((body && body.name) || '').trim();
    const description = String((body && body.description) || '').trim();
    const visibility = (body && body.visibility) === 'private' ? 'private' : 'public';
    if (len(name) < 2 || len(name) > 20) throw new ApiError(400, 'BAD_NAME', '名称需要 2 到 20 个字');
    if (len(description) > 80) throw new ApiError(400, 'BAD_DESC', '简介最多 80 字');
    const id = nid('cm'), t = now();
    insCm.run(id, name, description, visibility, user.id, t);
    insMem.run(id, user.id, 'owner', 'active', t);
    insCh.run(nid('ch'), id, '大厅', 'text', 1, 0, t);
    insCh.run(nid('ch'), id, '公告', 'announce', 1, 1, t);
    return {community: pubCm(byId.get(id), user)};
  }
  const setInfo = db.prepare('UPDATE communities SET name=?, description=?, cover=? WHERE id=? AND deleted_at IS NULL');
  function update(user, id, body) {
    const row = getVisible(user, id);
    requireMem(row, user, 'editInfo');
    const name = body && body.name != null ? String(body.name).trim() : row.name;
    const description = body && body.description != null ? String(body.description).trim() : (row.description || '');
    if (len(name) < 2 || len(name) > 20) throw new ApiError(400, 'BAD_NAME', '名称需要 2 到 20 个字');
    if (len(description) > 80) throw new ApiError(400, 'BAD_DESC', '简介最多 80 字');
    let cover = row.cover || '';
    if (body && (body.cover !== undefined || body.bg !== undefined)) {
      const n = normCover(body.cover !== undefined ? body.cover : body.bg);
      if (n !== undefined) cover = n;
    }
    setInfo.run(name, description, cover || null, id);
    return {community: pubCm(byId.get(id), user)};
  }
  function get(user, id) { return {community: pubCm(getVisible(user, id), user, {withMembers: true})}; }
  function list(user, q = {}) {
    if (q.mine === '1' || q.mine === 'true' || q.scope === 'joined') {
      return {communities: mineList.all(user.id).map(r => pubCm(r, user))};
    }
    return {communities: pubList.all().map(r => pubCm(r, user))};
  }
  function join(user, id, body = {}) {
    const row = byId.get(id);
    if (!row || row.deleted_at) throw new ApiError(404, 'NOT_FOUND', '社区不存在');
    if (isTaken(row)) throw new ApiError(403, 'COMMUNITY_TAKEN_DOWN', '这个社区已下架');
    const m = mem.get(id, user.id);
    if (m && m.status === 'banned') throw new ApiError(403, 'BANNED', '你已被这个社区封禁');
    if (m && m.status === 'active') return {community: pubCm(row, user), already: true};
    if (row.visibility === 'private') {
      const inv = body.code ? byCode.get(String(body.code).trim()) : null;
      if (!inv || inv.community_id !== id || inv.revoked_at || (inv.expires_at && inv.expires_at < now()) || (inv.max_uses && inv.uses >= inv.max_uses)) {
        throw new ApiError(403, 'INVITE_REQUIRED', '私密社区需要有效邀请才能加入');
      }
      useInv.run(inv.id);
    }
    insMem.run(id, user.id, 'member', 'active', now());
    return {community: pubCm(byId.get(id), user), already: false};
  }
  function apply(user, id) {
    const row = byId.get(id);
    if (!row || row.deleted_at) throw new ApiError(404, 'NOT_FOUND', '社区不存在');
    if (isTaken(row)) throw new ApiError(403, 'COMMUNITY_TAKEN_DOWN', '这个社区已下架');
    const m = mem.get(id, user.id);
    if (m && m.status === 'banned') throw new ApiError(403, 'BANNED', '你已被这个社区封禁');
    if (m && m.status === 'active') return {community: pubCm(row, user), already: true, pending: false};
    if (row.visibility !== 'private') return join(user, id);
    if (m && m.status === 'pending') return {community: pubCm(row, user), already: true, pending: true};
    insMem.run(id, user.id, 'member', 'pending', now());
    return {community: pubCm(byId.get(id), user), already: false, pending: true};
  }
  function leave(user, id) {
    const row = getVisible(user, id);
    const m = mem.get(id, user.id);
    if (!m || m.status !== 'active') throw new ApiError(400, 'NOT_MEMBER', '你不在这个社区');
    if (m.role === 'owner') throw new ApiError(400, 'OWNER_LEAVE', '所有者不能直接退出，请先转让或解散社区');
    setStatus.run('left', id, user.id);
    return {left: id};
  }
  function members(user, id) {
    const row = getVisible(user, id);
    requireMem(row, user, 'post', 1);
    return {members: mems.all(id).map(x => ({...authorOf(x.user_id), role: ROLE_CN[x.role], roleKey: x.role, joinedAt: x.joined_at}))};
  }
  function setMemberRole(user, id, body) {
    const row = getVisible(user, id);
    const target = Number(body && (body.userId != null ? body.userId : body.id));
    const want = CN_ROLE[body.role] || body.role;
    if (!ROLES[want] || want === 'owner') throw new ApiError(400, 'BAD_ROLE', '角色不正确');
    const my = requireMem(row, user, 'kick');
    const tm = mem.get(id, target);
    if (!tm || tm.status !== 'active') throw new ApiError(404, 'NOT_FOUND', '成员不存在');
    if (tm.role === 'owner') throw new ApiError(403, 'FORBIDDEN', '不能改变所有者的角色');
    if ((ROLES[my] || 0) <= (ROLES[tm.role] || 0)) throw new ApiError(403, 'FORBIDDEN', '只能管理比自己等级低的成员');
    if (want === 'admin' && my !== 'owner') throw new ApiError(403, 'FORBIDDEN', '只有所有者能设管理员');
    if (want === 'mod' && (ROLES[my] || 0) < ROLES.admin) throw new ApiError(403, 'FORBIDDEN', '没有权限');
    setRole.run(want, id, target);
    return {member: {...authorOf(target), role: ROLE_CN[want], roleKey: want}};
  }
  function kick(user, id, body) {
    const row = getVisible(user, id);
    const target = Number(body && (body.userId != null ? body.userId : body.id));
    const my = requireMem(row, user, 'kick');
    const tm = mem.get(id, target);
    if (!tm || tm.status !== 'active') throw new ApiError(404, 'NOT_FOUND', '成员不存在');
    if (tm.role === 'owner' || (ROLES[my] || 0) <= (ROLES[tm.role] || 0)) throw new ApiError(403, 'FORBIDDEN', '不能将这个成员移出');
    const banned = !!(body && body.ban);
    setStatus.run(banned ? 'banned' : 'left', id, target);
    return {removed: target, banned};
  }
  function addChannel(user, id, body) {
    const row = getVisible(user, id);
    requireMem(row, user, 'addChannel');
    const name = String((body && body.name) || '').trim();
    const kind = (body && (body.kind === 'announce' || body.kind === '公告')) ? 'announce' : 'text';
    if (len(name) < 1 || len(name) > 20) throw new ApiError(400, 'BAD_NAME', '频道名需要 1 到 20 个字');
    const chsNow = chs.all(id);
    const chId = nid('ch');
    insCh.run(chId, id, name, kind, 0, chsNow.length, now());
    return {channel: pubCh(chBy.get(chId))};
  }
  function renameChannel(user, chId, body) {
    const ch = chBy.get(chId);
    if (!ch || ch.deleted_at) throw new ApiError(404, 'NOT_FOUND', '频道不存在');
    const row = getVisible(user, ch.community_id);
    requireMem(row, user, 'editChannel');
    const name = String((body && body.name) || '').trim();
    if (len(name) < 1 || len(name) > 20) throw new ApiError(400, 'BAD_NAME', '频道名需要 1 到 20 个字');
    renCh.run(name, chId);
    return {channel: pubCh(chBy.get(chId))};
  }
  function removeChannel(user, chId) {
    const ch = chBy.get(chId);
    if (!ch || ch.deleted_at) throw new ApiError(404, 'NOT_FOUND', '频道不存在');
    const row = getVisible(user, ch.community_id);
    requireMem(row, user, 'delChannel');
    if (ch.is_default) throw new ApiError(400, 'DEFAULT_CHANNEL', '默认频道不能删除');
    if (nCh.get(ch.community_id).n <= 1) throw new ApiError(400, 'LAST_CHANNEL', '至少保留一个频道');
    delCh.run(now(), chId);
    return {deleted: chId};
  }
  function postMessage(user, chId, body) {
    const ch = chBy.get(chId);
    if (!ch || ch.deleted_at) throw new ApiError(404, 'NOT_FOUND', '频道不存在');
    const row = getVisible(user, ch.community_id);
    assertOpen(row);
    const mine = mem.get(row.id, user.id);
    if (mine && mine.muted_until && Number(mine.muted_until) > now()) throw new ApiError(403, 'MUTED', '你在这个社区被禁言');
    requireMem(row, user, ch.kind === 'announce' ? 'postAnn' : 'post');
    const text = String((body && body.text) || '').trim();
    if (!len(text)) throw new ApiError(400, 'BAD_TEXT', '请写下内容');
    if (deps.blockwords) deps.blockwords.assertPlatform(text);
    vip.requireTextLength(user, 'channel', text);
    const id = nid('ms'), t = now();
    insMsg.run(id, chId, user.id, text, t);
    return {message: {id, channelId: chId, author: authorOf(user.id), text, createdAt: t, createdAtUtc: new Date(t).toISOString()}};
  }
  function listMessages(user, chId, q = {}) {
    const ch = chBy.get(chId);
    if (!ch || ch.deleted_at) throw new ApiError(404, 'NOT_FOUND', '频道不存在');
    const row = getVisible(user, ch.community_id);
    assertOpen(row);
    requireMem(row, user, 'post', 1);
    const limit = Math.min(Math.max(+(q.limit) || 50, 1), 100);
    return {messages: msgs.all(chId, limit).reverse().map(r => ({id: r.id, channelId: chId, author: authorOf(r.author_id), text: r.text, createdAt: r.created_at, createdAtUtc: new Date(r.created_at).toISOString()}))};
  }
  function invite(user, id, body = {}) {
    const row = getVisible(user, id);
    requireMem(row, user, 'invite');
    const code = nid('iv').replace('iv_', '');
    const expires = body.days ? now() + Number(body.days) * 864e5 : (body.expiresAt || null);
    const max = body.maxUses != null ? Number(body.maxUses) : null;
    const iid = nid('iv');
    insInv.run(iid, id, code, user.id, now(), expires, max);
    return {invite: {id: iid, code, communityId: id, expiresAt: expires, maxUses: max, uses: 0, revoked: false}};
  }
  function listInvites(user, id) {
    const row = getVisible(user, id);
    requireMem(row, user, 'invite');
    return {invites: invs.all(id).map(i => ({id: i.id, code: i.code, createdAt: i.created_at, expiresAt: i.expires_at, maxUses: i.max_uses, uses: i.uses, revoked: !!i.revoked_at}))};
  }
  function revokeInvite(user, id, body) {
    const row = getVisible(user, id);
    requireMem(row, user, 'invite');
    const iid = String((body && body.id) || '');
    const n = revInv.run(now(), iid, id);
    if (!n.changes) throw new ApiError(404, 'NOT_FOUND', '邀请不存在');
    return {revoked: iid};
  }
  function joinByCode(user, body) {
    const code = String((body && body.code) || '').trim();
    const inv = byCode.get(code);
    if (!inv || inv.revoked_at || (inv.expires_at && inv.expires_at < now()) || (inv.max_uses && inv.uses >= inv.max_uses)) {
      throw new ApiError(400, 'BAD_INVITE', '邀请无效或已失效');
    }
    return join(user, inv.community_id, {code});
  }
  function dissolve(user, id) {
    const row = getVisible(user, id);
    requireMem(row, user, 'dissolve');
    delCm.run(now(), id);
    return {deleted: id};
  }
  const setTaken = db.prepare(`UPDATE communities SET status=?, takedown_reason=?, taken_down_at=? WHERE id=?`);
  const setMute = db.prepare(`UPDATE community_members SET muted_until=? WHERE community_id=? AND user_id=?`);
  function peek(id) {
    const row = byId.get(id);
    if (!row || row.deleted_at) return null;
    return {id: row.id, name: row.name, status: cmStatus(row), takedownReason: row.takedown_reason || '', takenDownAt: row.taken_down_at || null, ownerId: row.owner_id};
  }
  function canAppeal(user, id) {
    if (!user) return false;
    const row = byId.get(id);
    if (!row || row.deleted_at) return false;
    const m = mem.get(id, user.id);
    return !!(m && m.status === 'active');
  }
  function requireReason(body) {
    const reason = String((body && (body.reason || body.note)) || '').trim();
    if ([...reason].length < 2 || [...reason].length > 500) throw new ApiError(400, 'BAD_REASON', '请填写原因（2–500 字）');
    return reason;
  }
  function liveRow(id) {
    const row = byId.get(id);
    if (!row || row.deleted_at) throw new ApiError(404, 'NOT_FOUND', '社区不存在');
    return row;
  }
  function notifyOwner(row, spec) {
    if (deps.notifications && row && row.owner_id) deps.notifications.push(row.owner_id, spec);
  }
  function takedown(id, body = {}) {
    const row = liveRow(id);
    const reason = requireReason(body);
    const t = now();
    setTaken.run('taken_down', reason, t, id);
    notifyOwner(row, {
      kind: 'community_takedown',
      title: '社区已下架',
      body: '「' + row.name + '」已被下架：' + reason + '。你可以直接提交申诉，不必进入社区。',
      refType: 'community_appeal',
      refId: row.id,
      dedupeKey: 'cmtd:' + row.id + ':' + t,
    });
    return {community: pubCm(byId.get(id), null)};
  }
  function restore(id) {
    const row = liveRow(id);
    setTaken.run('active', null, null, id);
    notifyOwner(row, {
      kind: 'community_restored',
      title: '社区已恢复',
      body: '「' + row.name + '」已恢复，可以正常使用。',
      refType: 'community',
      refId: row.id,
      dedupeKey: 'cmrs:' + row.id + ':' + now(),
    });
    return {community: pubCm(byId.get(id), null)};
  }
  function warn(id, body = {}) {
    const row = liveRow(id);
    const reason = requireReason(body);
    notifyOwner(row, {
      kind: 'community_warn',
      title: '社区警告',
      body: '「' + row.name + '」收到警告：' + reason,
      refType: 'community',
      refId: row.id,
      dedupeKey: 'cmwn:' + row.id + ':' + now(),
    });
    return {community: pubCm(row, null), warned: true, reason};
  }
  function adminDelete(id, body = {}) {
    const row = liveRow(id);
    requireReason(body);
    if (body.confirm != null && String(body.confirm) !== String(id)) throw new ApiError(400, 'CONFIRM_REQUIRED', '请确认要删除的社区');
    delCm.run(now(), id);
    return {deleted: id};
  }
  function muteMember(id, userId, body = {}) {
    liveRow(id);
    const reason = requireReason(body);
    const uid = Number(userId);
    const tm = mem.get(id, uid);
    if (!tm || tm.status !== 'active') throw new ApiError(404, 'NOT_FOUND', '成员不存在');
    if (tm.role === 'owner') throw new ApiError(403, 'FORBIDDEN', '不能禁言所有者');
    const hours = Number(body.hours || body.durationHours) || 24;
    const until = now() + Math.min(Math.max(hours, 1), 24 * 30) * 3600_000;
    setMute.run(until, id, uid);
    return {muted: uid, mutedUntil: until, reason};
  }
  function unmuteMember(id, userId) {
    liveRow(id);
    const uid = Number(userId);
    const tm = mem.get(id, uid);
    if (!tm) throw new ApiError(404, 'NOT_FOUND', '成员不存在');
    setMute.run(null, id, uid);
    return {unmuted: uid};
  }
  function removeMember(id, userId, body = {}) {
    liveRow(id);
    requireReason(body);
    const uid = Number(userId);
    const tm = mem.get(id, uid);
    if (!tm || tm.status !== 'active') throw new ApiError(404, 'NOT_FOUND', '成员不存在');
    if (tm.role === 'owner') throw new ApiError(403, 'FORBIDDEN', '不能移出所有者');
    setStatus.run(body.ban ? 'banned' : 'left', id, uid);
    return {removed: uid, banned: !!body.ban};
  }
  function attach(ex) {
    if (!ex) return;
    if (ex.notifications) deps.notifications = ex.notifications;
    if (ex.blockwords) deps.blockwords = ex.blockwords;
  }
  return {
    create, update, get, list, join, apply, leave, members, setMemberRole, kick,
    addChannel, renameChannel, removeChannel, postMessage, listMessages,
    invite, listInvites, revokeInvite, joinByCode, dissolve, getVisible, ROLE_CN, roleOf,
    peek, canAppeal, takedown, restore, warn, adminDelete, muteMember, unmuteMember, removeMember, attach,
  };
}
