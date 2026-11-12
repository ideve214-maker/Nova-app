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
import {createMedia} from './media.mjs';
import {createNotifications} from './notifications.mjs';
import {createSearch} from './search.mjs';
import {createAdmins} from './admin.mjs';
import {createReports} from './reports.mjs';
import {createE2ee, safetyNumber} from './e2ee.mjs';
import {createPay} from './pay.mjs';
import {createAdminOps} from './admin-ops.mjs';
import {mkdirSync} from 'node:fs';
import {join as pathJoin} from 'node:path';

const SESSION_MS = 30 * 864e5, LOCK_FAILS = 5, LOCK_MS = 15 * 60e3;
class HttpError extends Error { constructor(s, code, msg) { super(msg); this.s = s; this.code = code; } }
const bad = (code, msg, s = 400) => new HttpError(s, code, msg);

// clock 仅用于测试注入固定时间；生产一律用系统时间。
// env：只有严格等于 'development' 才会开启 VIP 测试切换（默认 production）；任何拼写变体都按生产处理。
export function createApp({dbPath = ':memory:', corsOrigin = process.env.NOVA_CORS_ORIGIN || '*', clock = Date.now,
  env = process.env.NOVA_ENV || 'production', vipTestToggle = process.env.NOVA_VIP_TEST_TOGGLE !== '0',
  mediaDir, mediaScan, eventsOpts = {},
  adminUsername = process.env.NOVA_ADMIN_USERNAME,
  adminPassword = process.env.NOVA_ADMIN_PASSWORD,
  payEnv = process.env, payDir} = {}) {
  const testToggleOn = env === 'development' && vipTestToggle !== false;
  const now = () => clock();
  // CORS：未设置或 * 时与原先一致（允许任意来源）。逗号分隔白名单只回显匹配的 Origin。
  function corsHeaders(req) {
    const out = {
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-File-Name, Last-Event-ID, Last-Event-Id',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    };
    const raw = (corsOrigin == null || String(corsOrigin).trim() === '') ? '*' : String(corsOrigin).trim();
    if (raw === '*') {
      out['Access-Control-Allow-Origin'] = '*';
      return out;
    }
    const list = raw.split(',').map(s => s.trim()).filter(Boolean);
    const origin = req && req.headers && (req.headers.origin || req.headers.Origin);
    out['Vary'] = 'Origin';
    if (origin && list.includes(origin)) out['Access-Control-Allow-Origin'] = origin;
    return out;
  }

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
  const friends = createFriends(db, {now, profile});
  const e2ee = createE2ee(db, {now, friends});
  const events = createEvents(db, {now, ...eventsOpts});
  const mediaRoot = mediaDir || pathJoin(dirname(fileURLToPath(import.meta.url)), '../data/media');
  const media = createMedia(db, {now, vip, profile, mediaDir: mediaRoot, scanImpl: mediaScan});
  let notifications;
  const onEvent = (ids, type, payload) => {
    events.publish(ids, type, payload);
    if (notifications && type === 'conversation.message' && payload && payload.message && payload.message.atAll) {
      const actor = payload.message.author && payload.message.author.id;
      const text = String(payload.message.text || '').slice(0, 120);
      for (const uid of ids) {
        if (Number(uid) === Number(actor)) continue;
        notifications.push(uid, {
          kind: 'at_all', title: '有人@了所有人', body: text,
          refType: 'conversation', refId: payload.conversationId,
          actorId: actor, dedupeKey: 'at_all:' + payload.message.id,
        });
      }
    }
  };
  const chats = createChats(db, {profile, vip, now, friends, media, stickers, onEvent});
  notifications = createNotifications(db, {now, profile, vip, onEvent: (ids, type, payload) => events.publish(ids, type, payload)});
  friends.attach({notifications, onEvent: (ids, type, payload) => events.publish(ids, type, payload)});
  profile.attach({friends});
  const search = createSearch(db, {profile, vip, now});
  const admins = createAdmins(db, {now});
  const adminSeed = admins.seedFromEnv({username: adminUsername, password: adminPassword});
  const reports = createReports(db, {now, notifications, profile});

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
  const payRoot = payDir || pathJoin(dirname(fileURLToPath(import.meta.url)), '../data/pay');
  const pay = createPay(db, {now, vip, audit, dataDir: payRoot, env: payEnv || process.env});
  const adminOps = createAdminOps(db, {now, vip, profile, pay, audit});
  const srvPostAuthor = (postId) => {
    const r = db.prepare('SELECT author_id FROM posts WHERE id=? AND deleted_at IS NULL').get(postId);
    return r ? r.author_id : null;
  };

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
  function adminAuth(req) {
    const m = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
    if (!m) throw bad('UNAUTHORIZED', '请先登录管理员账号', 401);
    const admin = admins.fromToken(m[1]);
    if (admin) return {admin, token: m[1]};
    try {
      const s = q.sess.get(tokenHash(m[1]));
      if (s && s.expires_at >= now()) throw bad('FORBIDDEN', '需要管理员权限', 403);
    } catch (e) { if (e instanceof HttpError || e instanceof ApiError) throw e; }
    throw bad('UNAUTHORIZED', '登录已过期，请重新登录', 401);
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
    'GET /api/users/:id'(req) {
      const {user} = auth(req);
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) throw bad('BAD_USER', '请指定用户', 400);
      const target = q.userBy.get(id);
      return profile.viewFor(user, target);
    },
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
    'GET /api/vip/catalog'() {
      const c = vip.catalog({testToggle: {enabled: testToggleOn}});
      c.plans.vip.purchase = pay.purchaseInfo();
      c.pay = pay.publicConfig();
      return c;
    },
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
      const post = srvPostAuthor(req.params.id);
      if (post) notifications.push(post, {
        kind: 'comment', title: '有人评论了你的动态', body: String((r.comment && r.comment.text) || '').slice(0, 120),
        refType: 'post', refId: req.params.id, actorId: user.id, dedupeKey: 'comment:' + r.comment.id,
      });
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
      const r = comments.like(user, req.params.id);
      if (r && r.comment && r.comment.liked) {
        const c = db.prepare('SELECT author_id, post_id FROM post_comments WHERE id=?').get(req.params.id);
        if (c) notifications.push(c.author_id, {
          kind: 'like', title: '有人赞了你的评论', body: '',
          refType: 'comment', refId: req.params.id, actorId: user.id, dedupeKey: 'like:' + req.params.id + ':' + user.id,
        });
      }
      return r;
    },
    'POST /api/posts/:id/react'(req, b) {
      const {user} = auth(req);
      const r = comments.react(user, req.params.id, b || {});
      if (r && (r.myReaction != null && r.myReaction >= 0 || r.reacted)) {
        const post = srvPostAuthor(req.params.id);
        if (post) notifications.push(post, {
          kind: 'react', title: '有人对你的动态表态', body: '',
          refType: 'post', refId: req.params.id, actorId: user.id, dedupeKey: 'react:' + req.params.id + ':' + user.id,
        });
      }
      return r;
    },
    'POST /api/follows'(req, b) {
      const {user} = auth(req);
      const r = follows.add(user, b || {});
      audit(user.id, 'follow.add', 'user:' + (b && (b.userId || b.id)), ip(req));
      if (r && r.following && r.user) notifications.push(r.user.id, {
        kind: 'follow', title: '有人关注了你', body: '',
        refType: 'user', refId: String(user.id), actorId: user.id, dedupeKey: 'follow:' + user.id,
      });
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

    'GET /api/friends'(req) {
      const {user} = auth(req);
      return friends.list(user);
    },
    'GET /api/friends/requests'(req) {
      const {user} = auth(req);
      return friends.listRequests(user);
    },
    'GET /api/friends/status'(req) {
      const {user} = auth(req);
      const id = Number((req.query || {}).userId);
      if (!Number.isInteger(id)) throw bad('BAD_USER', '请指定用户', 400);
      return friends.statusWith(user, id);
    },
    'POST /api/friends/request'(req, b) {
      const {user} = auth(req);
      const r = friends.request(user, b || {});
      audit(user.id, 'friend.request', 'user:' + (b && (b.userId || b.id)), ip(req));
      return r;
    },
    'POST /api/friends/accept'(req, b) {
      const {user} = auth(req);
      const r = friends.accept(user, b || {});
      audit(user.id, 'friend.accept', 'user:' + (b && (b.userId || b.id)), ip(req));
      return r;
    },
    'POST /api/friends/decline'(req, b) {
      const {user} = auth(req);
      const r = friends.decline(user, b || {});
      audit(user.id, 'friend.decline', 'user:' + (b && (b.userId || b.id)), ip(req));
      return r;
    },
    'POST /api/friends/cancel'(req, b) {
      const {user} = auth(req);
      const r = friends.cancel(user, b || {});
      audit(user.id, 'friend.cancel', 'user:' + (b && (b.userId || b.id)), ip(req));
      return r;
    },
    'POST /api/friends/remove'(req, b) {
      const {user} = auth(req);
      const r = friends.unfriend(user, b || {});
      audit(user.id, 'friend.remove', 'user:' + (b && (b.userId || b.id)), ip(req));
      return r;
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
      events.assertCanSubscribe(user);
      res.writeHead(200, {
        ...corsHeaders(req),
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

    'POST /api/messages/:id/recall'(req) {
      const {user} = auth(req);
      const r = chats.recall(user, req.params.id);
      audit(user.id, 'chat.recall', 'message:' + req.params.id, ip(req));
      return r;
    },
    'GET /api/drafts'(req) {
      const {user} = auth(req);
      return chats.listMessageDrafts(user);
    },
    'GET /api/conversations/:id/draft'(req) {
      const {user} = auth(req);
      return chats.getMessageDraft(user, req.params.id);
    },
    'PUT /api/conversations/:id/draft'(req, b) {
      const {user} = auth(req);
      return chats.putMessageDraft(user, req.params.id, b || {});
    },
    'DELETE /api/conversations/:id/draft'(req) {
      const {user} = auth(req);
      return chats.clearMessageDraft(user, req.params.id);
    },
    'POST /api/messages/:id/save'(req, b) {
      const {user} = auth(req);
      const mid = req.params.id;
      const row = chats.messageOf(user, mid);
      const r = saved.add(user, {
        kind: 'message',
        target: row.conversation_id + ':' + mid,
        title: (b && b.title) || '消息',
        excerpt: (b && b.excerpt) || '',
      });
      return {saved: true, item: r.item, existed: r.existed, count: r.count, limit: r.limit, publicPinsUnchanged: true};
    },
    'POST /api/messages/:id/unsave'(req) {
      const {user} = auth(req);
      const mid = req.params.id;
      const row = chats.messageOf(user, mid, {allowMissing: true});
      const target = row ? (row.conversation_id + ':' + mid) : null;
      const r = target
        ? saved.remove(user, {kind: 'message', target})
        : saved.remove(user, {kind: 'message', target: mid});
      return {saved: false, removed: r.removed, count: r.count};
    },
    'GET /api/saved-messages'(req) {
      const {user} = auth(req);
      const all = saved.list(user);
      const items = (all.items || []).filter(i => i.kind === 'message');
      return {items, count: items.length, limit: all.limit, plan: all.plan, kind: 'message', separateFromPublicPins: true};
    },
    'POST /api/messages/:id/react'(req, b) {
      const {user} = auth(req);
      return chats.react(user, req.params.id, b || {});
    },
    'POST /api/messages/:id/unreact'(req, b) {
      const {user} = auth(req);
      return chats.react(user, req.params.id, b || {}, {remove: true});
    },
    'POST /api/messages/:id/forward'(req, b) {
      const {user} = auth(req);
      const r = chats.forward(user, req.params.id, b || {});
      audit(user.id, 'chat.forward', 'message:' + req.params.id, ip(req), {dest: b && (b.conversationId || b.conversation_id)});
      return r;
    },
    'POST /api/messages/:id/pin'(req, b) {
      const {user} = auth(req);
      const r = chats.pinMessage(user, req.params.id, b || {});
      audit(user.id, 'chat.pin', 'message:' + req.params.id, ip(req), {kind: b && b.kind});
      return r;
    },
    'POST /api/messages/:id/unpin'(req, b) {
      const {user} = auth(req);
      return chats.unpinMessage(user, req.params.id, b || {});
    },

    'POST /api/media'(req, b) {
      const {user} = auth(req);
      const buf = b && b._buffer;
      const name = (b && (b.name || b.filename)) || 'file';
      const mime = (b && (b.mime || b.type)) || 'application/octet-stream';
      const data = buf || (b && b.data ? Buffer.from(b.data, 'base64') : null);
      const r = media.upload(user, {buffer: data, mime, name, kind: b && b.kind});
      audit(user.id, 'media.upload', 'media:' + r.media.id, ip(req), {kind: r.media.kind, size: r.media.size});
      return r;
    },
    'GET /api/media/usage'(req) {
      const {user} = auth(req);
      return {usage: media.usage(user)};
    },
    'GET /api/media/:id'(req) {
      const {user} = auth(req);
      return media.get(user, req.params.id);
    },
    'POST /api/media/:id/ticket'(req) {
      const {user} = auth(req);
      return media.ticket(user, req.params.id);
    },
    'POST /api/media/:id/delete'(req) {
      const {user} = auth(req);
      const r = media.remove(user, req.params.id);
      audit(user.id, 'media.delete', 'media:' + req.params.id, ip(req));
      return r;
    },

    'GET /api/notifications'(req) {
      const {user} = auth(req);
      return notifications.list(user, req.query || {});
    },
    'POST /api/notifications/:id/read'(req) {
      const {user} = auth(req);
      return notifications.markRead(user, req.params.id);
    },
    'POST /api/notifications/read-all'(req) {
      const {user} = auth(req);
      return notifications.markAll(user);
    },
    'GET /api/notifications/unread'(req) {
      const {user} = auth(req);
      return notifications.unread(user);
    },

    'GET /api/search'(req) {
      const {user} = auth(req);
      return search.search(user, req.query || {});
    },
    'POST /api/blocks'(req, b) {
      const {user} = auth(req);
      const id = Number((b || {}).userId || (b || {}).id);
      if (!Number.isInteger(id)) throw bad('BAD_USER', '请指定用户', 400);
      if (id === Number(user.id)) throw bad('BAD_USER', '不能拉黑自己', 400);
      const u = q.userBy.get(id);
      if (!u || (u.status && u.status !== 'active' && u.status !== 'banned')) throw bad('NOT_FOUND', '用户不存在', 404);
      if (u.status === 'deleted') throw bad('NOT_FOUND', '用户不存在', 404);
      friends.block(user.id, id);
      audit(user.id, 'block.add', 'user:' + id, ip(req));
      return {blocked: true, userId: id};
    },
    'POST /api/blocks/remove'(req, b) {
      const {user} = auth(req);
      const id = Number((b || {}).userId || (b || {}).id);
      if (!Number.isInteger(id)) throw bad('BAD_USER', '请指定用户', 400);
      friends.unblock(user.id, id);
      audit(user.id, 'block.remove', 'user:' + id, ip(req));
      return {blocked: false, userId: id};
    },
    'POST /api/blocks/unblock'(req, b) {
      const {user} = auth(req);
      const id = Number((b || {}).userId || (b || {}).id);
      if (!Number.isInteger(id)) throw bad('BAD_USER', '请指定用户', 400);
      friends.unblock(user.id, id);
      audit(user.id, 'block.remove', 'user:' + id, ip(req));
      return {blocked: false, userId: id};
    },
    'GET /api/blocks'(req) {
      const {user} = auth(req);
      return friends.listBlocked(user);
    },

    'POST /api/reports'(req, b) {
      const {user} = auth(req);
      const r = reports.submit(user, b || {});
      audit(user.id, 'report.submit', 'report:' + r.report.id, ip(req), {targetType: r.report.targetType, targetId: r.report.targetId});
      return r;
    },

    'POST /api/admin/auth/login'(req, b) {
      const r = admins.login(b || {}, req);
      audit(r.admin.id, 'admin.login', 'admin:' + r.admin.id, ip(req));
      return r;
    },
    'POST /api/admin/auth/logout'(req) {
      const {admin, token} = adminAuth(req);
      admins.logout(token);
      audit(admin.id, 'admin.logout', 'admin:' + admin.id, ip(req));
      return {};
    },
    'GET /api/admin/me'(req) {
      const {admin} = adminAuth(req);
      return {admin};
    },
    'GET /api/admin/reports'(req) {
      const {admin} = adminAuth(req);
      return reports.list(req.query || {});
    },
    'GET /api/admin/reports/:id'(req) {
      const {admin} = adminAuth(req);
      const r = reports.get(req.params.id, {includeMessages: true});
      audit(admin.id, 'admin.report.view', 'report:' + r.report.id, ip(req), {adminUsername: admin.username});
      return r;
    },
    'POST /api/admin/reports/:id/decision'(req, b) {
      const {admin} = adminAuth(req);
      const r = reports.decide(admin, req.params.id, b || {});
      audit(admin.id, 'admin.report.decision', 'report:' + r.report.id, ip(req), {action: (b && b.action), adminUsername: admin.username});
      return r;
    },
    'GET /api/admin/audit'(req) {
      const {admin} = adminAuth(req);
      const limit = Math.min(Math.max(Number((req.query || {}).limit) || 50, 1), 100);
      const cursor = (req.query || {}).cursor != null && (req.query || {}).cursor !== '' ? Number((req.query || {}).cursor) : null;
      const action = String((req.query || {}).action || '');
      const where = [];
      const args = [];
      if (action) { where.push('action LIKE ?'); args.push(action + '%'); }
      if (cursor != null && Number.isFinite(cursor)) { where.push('id<?'); args.push(cursor); }
      const sql = 'SELECT * FROM audit_log' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY id DESC LIMIT ?';
      const rows = db.prepare(sql).all(...args, limit + 1);
      const more = rows.length > limit;
      const slice = more ? rows.slice(0, limit) : rows;
      const audits = slice.map(r => ({
        id: String(r.id),
        kind: String(r.action || '').startsWith('admin.') ? 'admin' : 'security',
        action: r.action,
        target: r.target || '',
        time: r.at,
        at: r.at,
        ip: r.ip || '',
        actorId: r.actor_id,
        detail: r.detail ? (() => { try { return JSON.parse(r.detail); } catch { return r.detail; } })() : null,
      }));
      return {audits, nextCursor: more ? slice[slice.length - 1].id : null};
    },

    'GET /api/admin/users'(req) {
      const {admin} = adminAuth(req);
      return adminOps.listUsers(req.query || {});
    },
    'GET /api/admin/users/:id'(req) {
      const {admin} = adminAuth(req);
      return adminOps.oneUser(req.params.id);
    },
    'POST /api/admin/users/:id/ban'(req, b) {
      const {admin} = adminAuth(req);
      return adminOps.ban(admin, req.params.id, b || {});
    },
    'POST /api/admin/users/:id/unban'(req, b) {
      const {admin} = adminAuth(req);
      return adminOps.unban(admin, req.params.id, b || {});
    },
    'POST /api/admin/users/:id/reset-password'(req, b) {
      const {admin} = adminAuth(req);
      return adminOps.resetPassword(admin, req.params.id, b || {});
    },
    'POST /api/admin/vip/grant'(req, b) {
      const {admin} = adminAuth(req);
      return adminOps.grantVip(admin, b || {});
    },
    'POST /api/admin/vip/revoke'(req, b) {
      const {admin} = adminAuth(req);
      return adminOps.revokeVip(admin, b || {});
    },
    'GET /api/admin/content'(req) {
      const {admin} = adminAuth(req);
      return adminOps.listContent(req.query || {});
    },
    'GET /api/admin/content/:type/:id'(req) {
      const {admin} = adminAuth(req);
      return adminOps.getContent(req.params.type, req.params.id);
    },
    'POST /api/admin/content/:type/:id/delete'(req, b) {
      const {admin} = adminAuth(req);
      return adminOps.hideContent(admin, req.params.type, req.params.id, b || {});
    },
    'POST /api/admin/content/:type/:id/restore'(req, b) {
      const {admin} = adminAuth(req);
      return adminOps.restoreContent(admin, req.params.type, req.params.id, b || {});
    },
    'GET /api/admin/stats'(req) {
      const {admin} = adminAuth(req);
      return adminOps.stats();
    },
    'GET /api/admin/announcements'(req) {
      const {admin} = adminAuth(req);
      return adminOps.listAnnouncements(req.query || {});
    },
    'POST /api/admin/announcements'(req, b) {
      const {admin} = adminAuth(req);
      return adminOps.addAnnouncement(admin, b || {});
    },
    'POST /api/admin/announcements/:id/delete'(req) {
      const {admin} = adminAuth(req);
      return adminOps.removeAnnouncement(admin, req.params.id);
    },
    'GET /api/admin/payments'(req) {
      const {admin} = adminAuth(req);
      return pay.adminList(req.query || {});
    },
    'GET /api/admin/payments/:id'(req) {
      const {admin} = adminAuth(req);
      return pay.getFor(admin, req.params.id, {admin: true});
    },
    'POST /api/admin/payments/:id/confirm'(req, b) {
      const {admin} = adminAuth(req);
      return pay.confirm(admin, req.params.id, b || {});
    },
    'POST /api/admin/payments/:id/reject'(req, b) {
      const {admin} = adminAuth(req);
      return pay.reject(admin, req.params.id, b || {});
    },
    'POST /api/admin/payments/:id/refund'(req, b) {
      const {admin} = adminAuth(req);
      return pay.refund(admin, req.params.id, b || {});
    },

    'GET /api/pay/config'() { return pay.publicConfig(); },
    'GET /api/pay/methods'() { return pay.publicConfig(); },
    'POST /api/pay/orders'(req, b) {
      const {user} = auth(req);
      return pay.create(user, b || {});
    },
    'GET /api/pay/orders'(req) {
      const {user} = auth(req);
      return pay.listFor(user, req.query || {});
    },
    'GET /api/pay/orders/:id'(req) {
      const {user} = auth(req);
      return pay.getFor(user, req.params.id);
    },
    'POST /api/pay/orders/:id/paid'(req, b) {
      const {user} = auth(req);
      return pay.markPaid(user, req.params.id, b || {});
    },
    'POST /api/pay/webhook/:provider'(req, b) {
      const raw = req.rawBody || Buffer.from(JSON.stringify(b || {}));
      return pay.webhook(req.params.provider, raw, req.headers || {}, b || {});
    },

    'POST /api/e2ee/keys'(req, b) {
      const {user} = auth(req);
      const r = e2ee.upload(user, b || {});
      audit(user.id, 'e2ee.keys_upload', 'device:' + (r.device && r.device.deviceId), ip(req), {added: r.added});
      return r;
    },
    'GET /api/e2ee/keys'(req) {
      const {user} = auth(req);
      const qid = req.query && (req.query.userId || req.query.user_id);
      if (qid) return e2ee.listOf(user, qid);
      return e2ee.listMine(user);
    },
    'GET /api/e2ee/keys/:userId'(req) {
      const {user} = auth(req);
      return e2ee.listOf(user, req.params.userId);
    },
    'GET /api/e2ee/devices'(req) {
      const {user} = auth(req);
      const qid = req.query && (req.query.userId || req.query.user_id);
      if (qid) return e2ee.listOf(user, qid);
      return e2ee.listMine(user);
    },
    'POST /api/e2ee/keys/claim'(req, b) {
      const {user} = auth(req);
      return e2ee.claim(user, b || {});
    },
    'POST /api/e2ee/devices/:id/revoke'(req) {
      const {user} = auth(req);
      const r = e2ee.revoke(user, req.params.id);
      audit(user.id, 'e2ee.device_revoke', 'device:' + req.params.id, ip(req));
      return r;
    },
    'GET /api/e2ee/safety/:userId'(req) {
      const {user} = auth(req);
      const theirs = e2ee.listOf(user, req.params.userId);
      const mine = e2ee.listMine(user);
      const myDev = (mine.devices || []).find(d => !d.revoked);
      const theirDev = (theirs.devices || []).find(d => !d.revoked);
      if (!myDev || !theirDev) return {userId: Number(req.params.userId), safetyNumber: null, devices: theirs.devices};
      return {
        userId: Number(req.params.userId),
        safetyNumber: safetyNumber(myDev.identityKey.ed25519, theirDev.identityKey.ed25519),
        myDeviceId: myDev.deviceId,
        theirDeviceId: theirDev.deviceId,
        myIdentity: myDev.identityKey,
        theirIdentity: theirDev.identityKey,
        theirDevices: theirs.devices,
      };
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
    const h = {...corsHeaders(req),
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
    const mediaFile = /^\/api\/media\/([^/]+)\/(file|preview)$/.exec(path);
    if (req.method === 'GET' && mediaFile) {
      try {
        if (req.query.token || req.query.access_token || req.query.authorization) throw bad('TOKEN_IN_URL', '不要把访问令牌放在 URL 里', 400);
        const mid = decodeURIComponent(mediaFile[1]);
        const preview = mediaFile[2] === 'preview';
        const who = req.query.ticket ? {ticket: req.query.ticket} : auth(req).user;
        const f = media.fileOf(who, mid, {preview});
        const data = readFileSync(f.path);
        res.writeHead(200, {
          ...corsHeaders(req),
          'Content-Type': f.mime,
          'Content-Length': data.length,
          'Content-Disposition': (preview ? 'inline' : 'inline') + '; filename="' + (f.name || 'file').replace(/["\\]/g, '') + '"',
          'Cache-Control': 'private, max-age=60',
          'X-Content-Type-Options': 'nosniff',
        });
        return res.end(data);
      } catch (e) {
        if (e instanceof HttpError || e instanceof VipError || e instanceof ApiError) send(e.s, {error: {code: e.code, message: e.message, ...(e.extra || {})}});
        else { console.error('内部错误:', e.message); send(500, {error: {code: 'INTERNAL', message: '服务器开小差了'}}); }
      }
      return;
    }
    const payQr = /^\/api\/pay\/qr\/(wechat|alipay)$/.exec(path);
    if (req.method === 'GET' && payQr) {
      try {
        const m = pay.methods().find(x => x.id === payQr[1]);
        if (m && m.source === 'url') {
          res.writeHead(302, {...h, Location: m.qrUrl});
          return res.end();
        }
        const f = pay.qrFile(payQr[1]);
        res.writeHead(200, {
          ...h,
          'Content-Type': f.mime,
          'Content-Length': f.buf.length,
          'Cache-Control': 'public, max-age=300',
          'X-Content-Type-Options': 'nosniff',
        });
        return res.end(f.buf);
      } catch (e) {
        if (e instanceof HttpError || e instanceof VipError || e instanceof ApiError) send(e.s, {error: {code: e.code, message: e.message, ...(e.extra || {})}});
        else { console.error('内部错误:', e.message); send(500, {error: {code: 'INTERNAL', message: '服务器开小差了'}}); }
        return;
      }
    }
    const payRcpt = /^\/api\/admin\/payments\/([^/]+)\/receipt$/.exec(path);
    if (req.method === 'GET' && payRcpt) {
      try {
        const {admin} = adminAuth(req);
        const got = pay.getFor(admin, decodeURIComponent(payRcpt[1]), {admin: true});
        const row = pay.get(got.order.id);
        const f = pay.receiptFile(row);
        res.writeHead(200, {
          ...corsHeaders(req),
          'Content-Type': f.mime,
          'Content-Length': f.buf.length,
          'Content-Disposition': 'inline; filename="' + String(f.name || 'receipt').replace(/["\\]/g, '') + '"',
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        return res.end(f.buf);
      } catch (e) {
        if (e instanceof HttpError || e instanceof VipError || e instanceof ApiError) send(e.s, {error: {code: e.code, message: e.message, ...(e.extra || {})}});
        else { console.error('内部错误:', e.message); send(500, {error: {code: 'INTERNAL', message: '服务器开小差了'}}); }
        return;
      }
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
    const bodyLimit = (req.method === 'POST' && path === '/api/media') ? 100 * 1024 * 1024
      : (req.method === 'POST' && /\/api\/pay\/orders\/[^/]+\/paid$/.test(path)) ? 8 * 1024 * 1024
      : 1e6;
    req.on('data', c => { size += c.length; if (size > bodyLimit) { send(413, {error: {code: 'TOO_LARGE', message: '请求过大'}}); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      try {
        let b = {};
        const raw = chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0);
        req.rawBody = raw;
        const ct = String(req.headers['content-type'] || '');
        if (path === '/api/media' && req.method === 'POST' && raw.length && !ct.includes('application/json')) {
          b = {_buffer: raw, name: decodeURIComponent(String(req.headers['x-file-name'] || 'file')), mime: ct.split(';')[0] || 'application/octet-stream'};
        } else if (raw.length) {
          try { b = JSON.parse(raw.toString('utf8')); } catch { throw bad('BAD_JSON', '请求格式不正确'); }
          if (b === null || typeof b !== 'object') throw bad('BAD_JSON', '请求格式不正确');
        }
        send(200, {ok: true, ...fn(req, b)});
      } catch (e) {
        if (e instanceof HttpError || e instanceof VipError || e instanceof ApiError) send(e.s, {error: {code: e.code, message: e.message, ...(e.extra || {})}});
        else { console.error('内部错误:', e.message); send(500, {error: {code: 'INTERNAL', message: '服务器开小差了'}}); }
      }
    });
  });
  server.db = db; server.vip = vip; server.saved = saved; server.profile = profile; server.posts = posts; server.comments = comments; server.follows = follows; server.communities = communities; server.chats = chats; server.friends = friends; server.events = events; server.media = media; server.notifications = notifications; server.search = search; server.admins = admins; server.reports = reports; server.e2ee = e2ee; server.adminSeed = adminSeed; server.pay = pay; server.adminOps = adminOps;
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
