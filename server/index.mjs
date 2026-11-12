// NOVA 统一后端 · M2.1 账号系统。零依赖。用法：node server/index.mjs
import http from 'node:http';
import {createReadStream, existsSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openDb} from './db.mjs';
import {hashPassword, verifyPassword, newToken, tokenHash} from './auth.mjs';
import {createVip, VipError} from './vip.mjs';
import {createSaved, PUBLIC_PIN_MAX} from './saved.mjs';
import {createStickers} from './stickers.mjs';
import {createProfile, newSessionId, maskIp, deviceOf} from './profile.mjs';
import {ApiError} from './errors.mjs';
import {createPosts} from './posts.mjs';
import {createComments} from './comments.mjs';
import {createFollows} from './follows.mjs';
import {createCommunities} from './communities.mjs';
import {createChats} from './chats.mjs';
import {createFriends} from './friends.mjs';
import {createEvents} from './events.mjs';

const SESSION_MS = 30 * 864e5, LOCK_FAILS = 5, LOCK_MS = 15 * 60e3;
class HttpError extends Error { constructor(s, code, msg) { super(msg); this.s = s; this.code = code; } }
const bad = (code, msg, s = 400) => new HttpError(s, code, msg);

// clock 仅用于测试注入固定时间；生产一律用系统时间。
// env：只有严格等于 'development' 才会开启 VIP 测试切换（默认 production）；任何拼写变体都按生产处理。
export function createApp({dbPath = ':memory:', corsOrigin = process.env.NOVA_CORS_ORIGIN || '*', clock = Date.now,
  env = process.env.NOVA_ENV || 'production', vipTestToggle = process.env.NOVA_VIP_TEST_TOGGLE !== '0'} = {}) {
  const testToggleOn = env === 'development' && vipTestToggle !== false;
  const now = () => clock();
  const db = openDb(dbPath);
  const vip = createVip(db, {clock});
  const saved = createSaved(db, {vip, now});
  const stickers = createStickers({vip});
  const profile = createProfile(db, {now});
  const posts = createPosts(db, {vip, profile, now});
  const comments = createComments(db, {profile, vip, posts, now});
  posts.attach(comments);
  const follows = createFollows(db, {profile, vip, now});
  const communities = createCommunities(db, {profile, vip, now});
  const friends = createFriends(db, {now});
  const events = createEvents(db, {now});
  const chats = createChats(db, {profile, vip, now, friends, onEvent: (ids, type, payload) => events.publish(ids, type, payload)});
  // vip 是否有效由服务端按到期时间算出，不信任任何客户端字段。
  const pubUser = u => { const v = vip.status(u); return {id: u.id, username: u.username, email: u.email, role: u.role, vip: v.active, vipUntil: v.active ? v.until : null, mustChangePw: !!u.must_change_pw, createdAt: u.created_at, profile: profile.publicOf(u)}; };
  const q = {
    userBy: db.prepare('SELECT * FROM users WHERE id=?'),
    userByLogin: db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE OR email = ?'),
    insUser: db.prepare('INSERT INTO users(username,email,password_hash,created_at) VALUES(?,?,?,?)'),
    insSess: db.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at,ip,ua,public_id) VALUES(?,?,?,?,?,?,?)'),
    sess: db.prepare('SELECT * FROM sessions WHERE token_hash=?'),
    delSess: db.prepare('DELETE FROM sessions WHERE token_hash=?'),
    delOther: db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?'),
    att: db.prepare('SELECT * FROM login_attempts WHERE key=?'),
    setAtt: db.prepare('INSERT INTO login_attempts(key,fails,locked_until) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET fails=excluded.fails, locked_until=excluded.locked_until'),
    clrAtt: db.prepare('DELETE FROM login_attempts WHERE key=?'),
    audit: db.prepare('INSERT INTO audit_log(at,actor_id,action,target,ip,detail) VALUES(?,?,?,?,?,?)'),
    setPw: db.prepare('UPDATE users SET password_hash=?, must_change_pw=0 WHERE id=?'),
    seen: db.prepare('UPDATE users SET last_login_at=? WHERE id=?'),
    mySess: db.prepare('SELECT token_hash,created_at,expires_at,ip,ua,public_id FROM sessions WHERE user_id=? ORDER BY created_at DESC'),
    setSid: db.prepare('UPDATE sessions SET public_id=? WHERE token_hash=?'),
    sessBySid: db.prepare('SELECT * FROM sessions WHERE public_id=? AND user_id=?'),
    delSid: db.prepare('DELETE FROM sessions WHERE public_id=? AND user_id=? AND token_hash<>?'),
  };
  const audit = (actor, action, target, ip, detail) => q.audit.run(now(), actor || null, action, target || null, ip || null, detail ? JSON.stringify(detail) : null);

  const validate = {
    username: v => /^[\p{L}\p{N}_]{3,20}$/u.test(v || ''),
    email: v => typeof v === 'string' && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v),
    password: v => typeof v === 'string' && v.length >= 8 && v.length <= 128 && /[A-Za-z]/.test(v) && /\d/.test(v),
  };
  const PW_MSG = '密码需 8–128 位，且同时包含字母和数字';

  function issue(user, req) {
    const t = newToken(), n = now();
    q.insSess.run(tokenHash(t), user.id, n, n + SESSION_MS, ip(req), String(req.headers['user-agent'] || '').slice(0, 200), newSessionId());
    return {token: t, expiresAt: n + SESSION_MS};
  }
  const ip = req => req.socket.remoteAddress || '';
  function auth(req) {
    const m = /^Bearer (\S+)$/.exec(req.headers.authorization || ''); if (!m) throw bad('UNAUTHORIZED', '请先登录', 401);
    const h = tokenHash(m[1]), s = q.sess.get(h);
    if (!s || s.expires_at < now()) { if (s) q.delSess.run(h); throw bad('UNAUTHORIZED', '登录已过期，请重新登录', 401); }
    const u = q.userBy.get(s.user_id);
    if (!u || u.status !== 'active') throw bad('FORBIDDEN', '账号不可用', 403);
    return {user: u, hash: h};
  }

  const routes = {
    'POST /api/auth/register'(req, b) {
      const username = String(b.username || '').trim(), email = String(b.email || '').trim().toLowerCase(), pw = b.password;
      if (!validate.username(username)) throw bad('BAD_USERNAME', '用户名需 3–20 位，仅限文字、数字、下划线');
      if (!validate.email(email)) throw bad('BAD_EMAIL', '邮箱格式不正确');
      if (!validate.password(pw)) throw bad('WEAK_PASSWORD', PW_MSG);
      if (q.userByLogin.get(username, email)) throw bad('EXISTS', '用户名或邮箱已被注册', 409);
      const r = q.insUser.run(username, email, hashPassword(pw), now());
      const u = q.userBy.get(Number(r.lastInsertRowid));
      audit(u.id, 'user.register', 'user:' + u.id, ip(req));
      return {user: pubUser(u), ...issue(u, req)};
    },
    'POST /api/auth/login'(req, b) {
      const id = String(b.account || '').trim().toLowerCase(), pw = String(b.password || ''), key = 'a:' + id;
      if (!id || !pw) throw bad('BAD_REQUEST', '请输入账号和密码');
      const a = q.att.get(key);
      if (a && a.locked_until > now()) throw bad('LOCKED', `尝试次数过多，请 ${Math.ceil((a.locked_until - now()) / 60e3)} 分钟后再试`, 429);
      const u = q.userByLogin.get(id, id);
      // 账号不存在时也做一次哈希，避免通过耗时判断账号是否存在
      const ok = u ? verifyPassword(pw, u.password_hash) : (verifyPassword(pw, 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '=='), false);
      if (!ok) {
        const f = (a ? a.fails : 0) + 1; q.setAtt.run(key, f >= LOCK_FAILS ? 0 : f, f >= LOCK_FAILS ? now() + LOCK_MS : 0);
        audit(u && u.id, 'auth.login_fail', key, ip(req));
        throw bad('BAD_CREDENTIALS', '账号或密码错误', 401);
      }
      if (u.status !== 'active') { audit(u.id, 'auth.login_banned', key, ip(req)); throw bad('BANNED', '账号已被封禁，请联系管理员', 403); }
      q.clrAtt.run(key); q.seen.run(now(), u.id); audit(u.id, 'auth.login', 'user:' + u.id, ip(req));
      return {user: pubUser(u), ...issue(u, req)};
    },
    'POST /api/auth/logout'(req) { const {user, hash} = auth(req); q.delSess.run(hash); audit(user.id, 'auth.logout', 'user:' + user.id, ip(req)); return {}; },
    'GET /api/me'(req) { return {user: pubUser(auth(req).user)}; },
    'POST /api/me/password'(req, b) {
      const {user, hash} = auth(req);
      if (!verifyPassword(String(b.oldPassword || ''), user.password_hash)) throw bad('BAD_CREDENTIALS', '原密码不正确', 401);
      if (!validate.password(b.newPassword)) throw bad('WEAK_PASSWORD', PW_MSG);
      q.setPw.run(hashPassword(b.newPassword), user.id); q.delOther.run(user.id, hash); // 改密后踢掉其他设备
      audit(user.id, 'user.password_change', 'user:' + user.id, ip(req));
      return {};
    },
    'GET /api/me/sessions'(req) {
      const {user, hash} = auth(req);
      const sessions = q.mySess.all(user.id).map(s => {
        let sid = s.public_id;
        if (!sid) { sid = newSessionId(); q.setSid.run(sid, s.token_hash); }
        return {id: sid, current: s.token_hash === hash, createdAt: s.created_at, ip: maskIp(s.ip), device: deviceOf(s.ua)};
      });
      return {sessions};
    },
    // 退出其他设备：其他令牌服务端立即失效；当前设备默认保留。
    'POST /api/me/sessions/revoke-others'(req) {
      const {user, hash} = auth(req);
      const before = q.mySess.all(user.id).length;
      q.delOther.run(user.id, hash);
      const after = q.mySess.all(user.id).length;
      audit(user.id, 'auth.revoke_others', 'user:' + user.id, ip(req), {revoked: before - after});
      return {revoked: before - after, kept: after, keptCurrent: true};
    },
    'POST /api/me/sessions/revoke'(req, b) {
      const {user, hash} = auth(req);
      const sid = String(b.id || '').trim();
      if (!sid) throw bad('BAD_REQUEST', '请指定要退出的设备');
      const s = q.sessBySid.get(sid, user.id);
      if (!s) throw bad('NOT_FOUND', '找不到这台设备的登录', 404);
      if (s.token_hash === hash) throw bad('CURRENT_SESSION', '不能退出当前设备，请使用「退出登录」', 400);
      q.delSid.run(sid, user.id, hash);
      audit(user.id, 'auth.revoke_session', 'session:' + sid, ip(req));
      return {revoked: 1};
    },
    'GET /api/me/profile'(req) { const {user} = auth(req); return {profile: profile.publicOf(user)}; },
    'POST /api/me/profile'(req, b) {
      const {user} = auth(req);
      const p = profile.save(user, b || {});
      audit(user.id, 'user.profile_update', 'user:' + user.id, ip(req));
      return {profile: p, user: pubUser(q.userBy.get(user.id))};
    },
    'POST /api/me/avatar'(req, b) {
      const {user} = auth(req);
      const p = profile.save(user, {avatar: (b && b.avatar) || b || {}});
      audit(user.id, 'user.avatar_update', 'user:' + user.id, ip(req));
      return {profile: p, user: pubUser(q.userBy.get(user.id))};
    },
    'GET /api/me/privacy'(req) { const {user} = auth(req); return {privacy: profile.privacyOf(user), defaults: profile.PRIVACY_DEFAULTS}; },
    'POST /api/me/privacy'(req, b) {
      const {user} = auth(req);
      const prv = profile.savePrivacy(user, b || {});
      audit(user.id, 'user.privacy_update', 'user:' + user.id, ip(req));
      return {privacy: prv};
    },
    // ---- VIP（M2.4.2）----
    'GET /api/vip/catalog'() { return vip.catalog({testToggle: {enabled: testToggleOn}}); },
    'GET /api/vip/me'(req) {
      const {user} = auth(req);
      return {now: now(), vip: vip.status(user), entitlements: vip.entitlements(user)};
    },
    // 仅开发环境：给「调用者自己」开/关测试 VIP。生产环境一律 403；不改动管理员/支付开通的正式 VIP。
    'POST /api/vip/test-toggle'(req, b) {
      const {user} = auth(req);
      if (!testToggleOn) { audit(user.id, 'vip.test_denied', 'user:' + user.id, ip(req)); throw bad('TEST_MODE_DISABLED', '测试模式未开启', 403); }
      if (typeof b.on !== 'boolean') throw bad('BAD_REQUEST', '请指定 on: true 或 false');
      const st = vip.status(user);
      if (st.active && st.source !== 'test') throw bad('REAL_VIP_ACTIVE', '你已有正式开通的 VIP，测试开关不会改动它', 409);
      if (b.on && !st.active) { vip.grant(user.id, {days: vip.config.expiry.testGrantDays, source: 'test', actorId: user.id, note: '测试开关'}); audit(user.id, 'vip.test_on', 'user:' + user.id, ip(req)); }
      if (!b.on && st.active) { vip.revoke(user.id, {source: 'test', actorId: user.id, note: '测试开关'}); audit(user.id, 'vip.test_off', 'user:' + user.id, ip(req)); }
      const u = q.userBy.get(user.id);
      return {now: now(), vip: vip.status(u), entitlements: vip.entitlements(u)};
    },
    // 统一权益检查入口：只返回调用者自己的结果。flag 未开通/到期 403；不能靠隐藏按钮绕过。
    'POST /api/vip/gate'(req, b) {
      const {user} = auth(req);
      const key = String(b.key || '').trim();
      return {ok: true, now: now(), ...vip.requireEntitlement(user, key)};
    },
    // 个人收藏（M2.5.3）：私有额度，服务端执行；与公共置顶无关。
    'GET /api/me/saved'(req) { const {user} = auth(req); return saved.list(user); },
    'POST /api/me/saved'(req, b) { const {user} = auth(req); const r = saved.add(user, b || {}); audit(user.id, 'saved.add', 'saved:' + r.item.id, ip(req), {kind: r.item.kind}); return r; },
    'POST /api/me/saved/remove'(req, b) { const {user} = auth(req); const r = saved.remove(user, b || {}); audit(user.id, 'saved.remove', 'saved:' + r.removed.id, ip(req)); return r; },
    // 文本长度（M2.5.4）：前端提示与服务端限制必须一致。scope = post | chat | channel。
    'POST /api/content/check'(req, b) {
      const {user} = auth(req);
      const scope = String(b.scope || ''), text = b.text;
      return {ok: true, now: now(), ...vip.requireTextLength(user, scope, text)};
    },
    // 贴纸（M2.5.5）：目录所有人可看（未登录也可）；选用专属包必须经 requireEntitlement。
    'GET /api/stickers'(req) {
      let user = null;
      try { user = auth(req).user; } catch (e) { if (!(e && e.code === 'UNAUTHORIZED')) throw e; }
      return stickers.catalog(user);
    },
    'POST /api/stickers/use'(req, b) {
      const {user} = auth(req);
      return stickers.use(user, b || {});
    },
    // ---- 动态（M4.1）帖子真实入库；发布成功以服务端响应为准 ----
    'POST /api/posts'(req, b) {
      const {user} = auth(req);
      const r = posts.create(user, b || {});
      audit(user.id, 'post.create', 'post:' + r.post.id, ip(req));
      return r;
    },
    'GET /api/posts'(req) {
      const {user} = auth(req);
      const q = {...(req.query || {})};
      if (q.feed === 'follow') {
        const ids = follows.followingIds(user.id);
        ids.push(user.id);
        q.authors = ids;
      }
      return posts.list(user, q);
    },
    'GET /api/posts/:id'(req) {
      const {user} = auth(req);
      return posts.get(user, req.params.id);
    },
    'POST /api/posts/:id/edit'(req, b) {
      const {user} = auth(req);
      const r = posts.edit(user, req.params.id, b || {});
      audit(user.id, 'post.edit', 'post:' + r.post.id, ip(req));
      return r;
    },
    'POST /api/posts/:id/delete'(req) {
      const {user} = auth(req);
      const r = posts.remove(user, req.params.id);
      audit(user.id, 'post.delete', 'post:' + r.deleted, ip(req));
      return r;
    },
    'GET /api/posts/:id/comments'(req) {
      const {user} = auth(req);
      return comments.list(user, req.params.id);
    },
    'POST /api/posts/:id/comments'(req, b) {
      const {user} = auth(req);
      const r = comments.add(user, req.params.id, b || {});
      audit(user.id, 'post.comment', 'comment:' + r.comment.id, ip(req));
      return r;
    },
    'POST /api/comments/:id/delete'(req) {
      const {user} = auth(req);
      const r = comments.remove(user, req.params.id);
      audit(user.id, 'post.comment_delete', 'comment:' + r.deleted, ip(req));
      return r;
    },
    'POST /api/comments/:id/like'(req) {
      const {user} = auth(req);
      return comments.like(user, req.params.id);
    },
    'POST /api/posts/:id/react'(req, b) {
      const {user} = auth(req);
      return comments.react(user, req.params.id, b || {});
    },
    'POST /api/follows'(req, b) {
      const {user} = auth(req);
      const r = follows.add(user, b || {});
      audit(user.id, 'follow.add', 'user:' + (b && (b.userId || b.id)), ip(req));
      return r;
    },
    'POST /api/follows/remove'(req, b) {
      const {user} = auth(req);
      const r = follows.remove(user, b || {});
      audit(user.id, 'follow.remove', 'user:' + (b && (b.userId || b.id)), ip(req));
      return r;
    },
    'GET /api/follows'(req) {
      const {user} = auth(req);
      return follows.list(user, req.query || {});
    },

    'POST /api/communities'(req, b) {
      const {user} = auth(req);
      const r = communities.create(user, b || {});
      audit(user.id, 'community.create', 'community:' + r.community.id, ip(req));
      return r;
    },
    'GET /api/communities'(req) {
      const {user} = auth(req);
      return communities.list(user, req.query || {});
    },
    'GET /api/communities/:id'(req) {
      const {user} = auth(req);
      return communities.get(user, req.params.id);
    },
    'POST /api/communities/:id/join'(req, b) {
      const {user} = auth(req);
      const r = communities.join(user, req.params.id, b || {});
      audit(user.id, 'community.join', 'community:' + req.params.id, ip(req));
      return r;
    },
    'POST /api/communities/:id/leave'(req) {
      const {user} = auth(req);
      const r = communities.leave(user, req.params.id);
      audit(user.id, 'community.leave', 'community:' + req.params.id, ip(req));
      return r;
    },
    'GET /api/communities/:id/members'(req) {
      const {user} = auth(req);
      return communities.members(user, req.params.id);
    },
    'POST /api/communities/:id/role'(req, b) {
      const {user} = auth(req);
      const r = communities.setMemberRole(user, req.params.id, b || {});
      audit(user.id, 'community.role', 'community:' + req.params.id, ip(req), {userId: b && b.userId, role: b && b.role});
      return r;
    },
    'POST /api/communities/:id/kick'(req, b) {
      const {user} = auth(req);
      const r = communities.kick(user, req.params.id, b || {});
      audit(user.id, 'community.kick', 'community:' + req.params.id, ip(req), {userId: b && b.userId, ban: b && b.ban});
      return r;
    },
    'POST /api/communities/:id/channels'(req, b) {
      const {user} = auth(req);
      return communities.addChannel(user, req.params.id, b || {});
    },
    'POST /api/channels/:id/rename'(req, b) {
      const {user} = auth(req);
      return communities.renameChannel(user, req.params.id, b || {});
    },
    'POST /api/channels/:id/delete'(req) {
      const {user} = auth(req);
      return communities.removeChannel(user, req.params.id);
    },
    'GET /api/channels/:id/messages'(req) {
      const {user} = auth(req);
      return communities.listMessages(user, req.params.id, req.query || {});
    },
    'POST /api/channels/:id/messages'(req, b) {
      const {user} = auth(req);
      const r = communities.postMessage(user, req.params.id, b || {});
      audit(user.id, 'community.message', 'channel:' + req.params.id, ip(req));
      return r;
    },
    'POST /api/communities/:id/invites'(req, b) {
      const {user} = auth(req);
      return communities.invite(user, req.params.id, b || {});
    },
    'GET /api/communities/:id/invites'(req) {
      const {user} = auth(req);
      return communities.listInvites(user, req.params.id);
    },
    'POST /api/communities/:id/invites/revoke'(req, b) {
      const {user} = auth(req);
      return communities.revokeInvite(user, req.params.id, b || {});
    },
    'POST /api/communities/join-code'(req, b) {
      const {user} = auth(req);
      const r = communities.joinByCode(user, b || {});
      audit(user.id, 'community.join_code', 'community:' + r.community.id, ip(req));
      return r;
    },
    'POST /api/communities/:id/dissolve'(req) {
      const {user} = auth(req);
      const r = communities.dissolve(user, req.params.id);
      audit(user.id, 'community.dissolve', 'community:' + req.params.id, ip(req));
      return r;
    },

    // ---- 会话（M4.3.1）----
    'POST /api/conversations'(req, b) {
      const {user} = auth(req);
      const r = chats.create(user, b || {});
      audit(user.id, 'chat.create', 'conversation:' + r.conversation.id, ip(req), {kind: r.conversation.kind});
      return r;
    },
    'GET /api/conversations'(req) {
      const {user} = auth(req);
      return chats.list(user);
    },
    'GET /api/conversations/:id'(req) {
      const {user} = auth(req);
      return chats.get(user, req.params.id);
    },
    'POST /api/conversations/:id/members'(req, b) {
      const {user} = auth(req);
      const r = chats.addMember(user, req.params.id, b || {});
      audit(user.id, 'chat.add_member', 'conversation:' + req.params.id, ip(req), {userId: b && b.userId});
      return r;
    },
    'POST /api/conversations/:id/role'(req, b) {
      const {user} = auth(req);
      const r = chats.setMemberRole(user, req.params.id, b || {});
      audit(user.id, 'chat.role', 'conversation:' + req.params.id, ip(req), {userId: b && b.userId, role: b && b.role});
      return r;
    },
    'POST /api/conversations/:id/kick'(req, b) {
      const {user} = auth(req);
      const r = chats.kick(user, req.params.id, b || {});
      audit(user.id, 'chat.kick', 'conversation:' + req.params.id, ip(req), {userId: b && b.userId});
      return r;
    },
    'POST /api/conversations/:id/leave'(req, b) {
      const {user} = auth(req);
      const r = chats.leave(user, req.params.id, b || {});
      audit(user.id, 'chat.leave', 'conversation:' + req.params.id, ip(req));
      return r;
    },
    'POST /api/conversations/:id/rename'(req, b) {
      const {user} = auth(req);
      const r = chats.rename(user, req.params.id, b || {});
      audit(user.id, 'chat.rename', 'conversation:' + req.params.id, ip(req));
      return r;
    },

    'POST /api/conversations/:id/messages'(req, b) {
      const {user} = auth(req);
      const r = chats.send(user, req.params.id, b || {});
      audit(user.id, 'chat.message', 'conversation:' + req.params.id, ip(req), {messageId: r.message && r.message.id});
      return r;
    },
    'GET /api/conversations/:id/messages'(req) {
      const {user} = auth(req);
      return chats.listMessages(user, req.params.id, req.query || {});
    },

    'GET /api/events'(req, res) {
      const q = req.query || {};
      if (q.token || q.access_token || q.auth || q.authorization) throw bad('TOKEN_IN_URL', '不要把访问令牌放在 URL 里', 400);
      const {user} = auth(req);
      const lastId = req.headers['last-event-id'] || q.after || '';
      res.writeHead(200, {
        'Access-Control-Allow-Origin': corsOrigin,
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, Last-Event-ID, Last-Event-Id',
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'X-Content-Type-Options': 'nosniff',
      });
      res.write(': ok\n\n');
      events.subscribe(user, res, {lastId});
    },

    'POST /api/conversations/:id/read'(req, b) {
      const {user} = auth(req);
      return chats.markRead(user, req.params.id, b || {});
    },
    'POST /api/conversations/:id/mute'(req, b) {
      const {user} = auth(req);
      const r = chats.setMute(user, req.params.id, b || {});
      audit(user.id, 'chat.mute', 'conversation:' + req.params.id, ip(req), {muted: r.muted});
      return r;
    },
    'POST /api/conversations/:id/pin'(req, b) {
      const {user} = auth(req);
      return chats.setConvPin(user, req.params.id, b || {});
    },
    'GET /api/health'() { return {status: 'ok', time: now()}; },



  };

  function findRoute(method, path) {
    const exact = routes[method + ' ' + path];
    if (exact) return {fn: exact, params: {}};
    for (const [k, fn] of Object.entries(routes)) {
      const i = k.indexOf(' ');
      const m = k.slice(0, i), pat = k.slice(i + 1);
      if (m !== method || !pat.includes(':')) continue;
      const names = [];
      const re = new RegExp('^' + pat.split('/').map(seg => {
        if (seg.startsWith(':')) { names.push(seg.slice(1)); return '([^/]+)'; }
        return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }).join('/') + '$');
      const mm = re.exec(path);
      if (mm) {
        const params = {};
        names.forEach((n, i) => { params[n] = decodeURIComponent(mm[i + 1]); });
        return {fn, params};
      }
    }
    return null;
  }

  const root = dirname(fileURLToPath(import.meta.url));
  const assetRoot = join(root, '../assets');
  const server = http.createServer((req, res) => {
    const h = {'Access-Control-Allow-Origin': corsOrigin, 'Access-Control-Allow-Headers': 'Authorization, Content-Type, Last-Event-ID, Last-Event-Id', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8'};
    const send = (s, o) => { res.writeHead(s, h); res.end(JSON.stringify(o)); };
    if (req.method === 'OPTIONS') { res.writeHead(204, h); return res.end(); }
    const parsed = new URL(req.url, 'http://x');
    const path = parsed.pathname;
    req.query = Object.fromEntries(parsed.searchParams);
    req.params = {};
    if (req.method === 'GET' && path.startsWith('/assets/')) {
      const name = decodeURIComponent(path.slice('/assets/'.length));
      if (!/^[\w.-]+$/.test(name)) return send(400, {error: {code: 'BAD_PATH', message: '路径不正确'}});
      const fp = join(assetRoot, name);
      if (!existsSync(fp)) return send(404, {error: {code: 'NOT_FOUND', message: '文件不存在'}});
      const ext = name.endsWith('.png') ? 'image/png' : name.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
      res.writeHead(200, {...h, 'Content-Type': ext, 'Cache-Control': 'public, max-age=86400'});
      return createReadStream(fp).pipe(res);
    }
    if (req.method === 'GET' && (path === '/' || path === '/index.html' || path === '/nova_v5.html')) {
      try {
        const html = readFileSync(join(root, '../dist/nova_v5.html'));
        res.writeHead(200, {...h, 'Content-Type': 'text/html; charset=utf-8'});
        return res.end(html);
      } catch { return send(503, {error: {code: 'NO_BUILD', message: '前端还没构建'}}); }
    }
    const found = findRoute(req.method, path);
    if (!found) return send(404, {error: {code: 'NOT_FOUND', message: '接口不存在'}});
    const fn = found.fn; req.params = found.params;
    if (req.method === 'GET' && path === '/api/events') {
      try { fn(req, res); }
      catch (e) {
        if (e instanceof HttpError || e instanceof VipError || e instanceof ApiError) send(e.s, {error: {code: e.code, message: e.message, ...(e.extra || {})}});
        else { console.error('内部错误:', e.message); send(500, {error: {code: 'INTERNAL', message: '服务器开小差了'}}); }
      }
      return;
    }
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 1e6) { send(413, {error: {code: 'TOO_LARGE', message: '请求过大'}}); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      try {
        let b = {}; if (chunks.length) { try { b = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw bad('BAD_JSON', '请求格式不正确'); } }
        if (b === null || typeof b !== 'object') throw bad('BAD_JSON', '请求格式不正确');
        send(200, {ok: true, ...fn(req, b)});
      } catch (e) {
        if (e instanceof HttpError || e instanceof VipError || e instanceof ApiError) send(e.s, {error: {code: e.code, message: e.message, ...(e.extra || {})}});
        else { console.error('内部错误:', e.message); send(500, {error: {code: 'INTERNAL', message: '服务器开小差了'}}); }
      }
    });
  });
  server.db = db; server.vip = vip; server.saved = saved; server.profile = profile; server.posts = posts; server.comments = comments; server.follows = follows; server.communities = communities; server.chats = chats; server.friends = friends; server.events = events;
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = +process.env.PORT || 8787, host = process.env.HOST || '0.0.0.0', dbPath = process.env.NOVA_DB || './nova.db';
  const app = createApp({dbPath});
  app.listen(port, host, () => {
    console.log(`NOVA 后端已启动 http://${host}:${port}  数据库:${dbPath}`);
    if (process.env.NOVA_ENV === 'development' && process.env.NOVA_VIP_TEST_TOGGLE !== '0') console.log('⚠ 开发环境：VIP 测试切换已开启（任何登录用户都能给自己开/关测试 VIP）。不要用于公开部署。');
  });
}
