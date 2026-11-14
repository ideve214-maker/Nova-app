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
import {createPolls} from './polls.mjs';
import {createHashtags} from './hashtags.mjs';
import {createSchedule} from './schedule.mjs';
import {createBlockwords} from './blockwords.mjs';
import {createPresence} from './presence.mjs';
import {createExporter} from './export.mjs';
import {createComments} from './comments.mjs';
import {createFollows} from './follows.mjs';
import {createCommunities} from './communities.mjs';
import {createChats} from './chats.mjs';
import {createFriends} from './friends.mjs';
import {createMessageRequests} from './message_requests.mjs';
import {createEvents} from './events.mjs';
import {createMedia} from './media.mjs';
import {createNsfwScan} from './nsfw-scan.mjs';
import {createNotifications} from './notifications.mjs';
import {createSearch} from './search.mjs';
import {createAdmins} from './admin.mjs';
import {createReports} from './reports.mjs';
import {createE2ee, safetyNumber} from './e2ee.mjs';
import {createPay} from './pay.mjs';
import {createAdminOps} from './admin-ops.mjs';
import {createFeatured} from './featured.mjs';
import {
  clientIp, forwardedProto, securityHeaders, cookieAuth, assertCsrf, needsCsrf,
  sessionCookies, clearSessionCookies, newCsrf, createRateLimit, createSecurityEvents,
  slog, redact, lockBackoffMs,
} from './security.mjs';
import {createAccount} from './account.mjs';
import {createFlags} from './flags.mjs';
import {createMarketing} from './marketing.mjs';
import {createPostStats} from './post-stats.mjs';
import {createBoost} from './boost.mjs';
import {createAiModeration} from './ai-moderation.mjs';
import {createAlerts} from './alerts.mjs';
import {backupOpen} from './backup.mjs';
import {readFileSync as _readLegal} from 'node:fs';
import {legalDoc as loadLegal, renderLegalHtml, legalConfig, LEGAL_DEFAULTS} from './legal.mjs';
import {appVersion} from './version.mjs';
import {mkdirSync} from 'node:fs';
import {join as pathJoin} from 'node:path';

const SESSION_MS = 30 * 864e5, LOCK_FAILS = 5, LOCK_MS = 15 * 60e3;
class HttpError extends Error { constructor(s, code, msg) { super(msg); this.s = s; this.code = code; } }
const bad = (code, msg, s = 400) => new HttpError(s, code, msg);

// clock 仅用于测试注入固定时间；生产一律用系统时间。
// env：只有严格等于 'development' 才会开启 VIP 测试切换（默认 production）；任何拼写变体都按生产处理。
// r10：媒体文件支持 Range（iOS 播放音频/视频必须能按段请求，否则语音和视频放不出来）。
function sendRanged(req, res, buf, headers) {
  const total = buf.length;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || '').trim());
  if (m && (m[1] !== '' || m[2] !== '')) {
    let start, end;
    if (m[1] === '') { start = Math.max(0, total - Number(m[2])); end = total - 1; }
    else { start = Number(m[1]); end = m[2] === '' ? total - 1 : Math.min(Number(m[2]), total - 1); }
    if (start >= total || start > end) {
      res.writeHead(416, {...headers, 'Content-Range': 'bytes */' + total, 'Accept-Ranges': 'bytes'});
      return res.end();
    }
    res.writeHead(206, {...headers, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Length': end - start + 1});
    return res.end(req.method === 'HEAD' ? undefined : buf.subarray(start, end + 1));
  }
  res.writeHead(200, {...headers, 'Accept-Ranges': 'bytes', 'Content-Length': total});
  return res.end(req.method === 'HEAD' ? undefined : buf);
}

export function createApp({dbPath = ':memory:', corsOrigin = process.env.NOVA_CORS_ORIGIN || '*', clock = Date.now,
  env = process.env.NOVA_ENV || 'production', vipTestToggle = process.env.NOVA_VIP_TEST_TOGGLE !== '0',
  mediaDir, mediaScan, eventsOpts = {},
  adminUsername = process.env.NOVA_ADMIN_USERNAME,
  adminPassword = process.env.NOVA_ADMIN_PASSWORD,
  payEnv = process.env, payDir, scheduleAuto, scheduleInterval = 5000,
  trustProxy = process.env.NOVA_TRUST_PROXY === '1',
  trustedProxies = process.env.NOVA_TRUSTED_PROXIES || '',
  cookieSession = process.env.NOVA_COOKIE_SESSION === '1',
  cookieSecure = process.env.NOVA_COOKIE_SECURE,
  hsts = process.env.NOVA_HSTS === '1',
  rateLimitMode = process.env.NOVA_RATE_LIMIT || '',
  alertWebhook = process.env.NOVA_ALERT_WEBHOOK || '',
  aiEnv = process.env, aiFetch,
  } = {}) {
  const testToggleOn = env === 'development' && vipTestToggle !== false;
  const now = () => clock();
  const trustOpts = {trustProxy: !!trustProxy, trustedProxies};
  const rateMode = (rateLimitMode === '0' || rateLimitMode === 'off') ? 'off'
    : (rateLimitMode === 'strict' ? 'strict' : (env === 'production' && dbPath !== ':memory:' && rateLimitMode !== 'lenient' ? 'lenient' : 'lenient'));
  // 默认 lenient：单元测试与本机不会误伤；生产可设 NOVA_RATE_LIMIT=strict。:memory: 测试同样 lenient。
  const cookieOn = !!cookieSession;

  // CORS：未设置或 * 时与原先一致（允许任意来源）。逗号分隔白名单只回显匹配的 Origin。
  function corsHeaders(req) {
    const out = {
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-File-Name, X-Media-Duration, Last-Event-ID, Last-Event-Id, X-CSRF-Token, X-Nova-Session',
      'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
    };
    const raw = (corsOrigin == null || String(corsOrigin).trim() === '') ? '*' : String(corsOrigin).trim();
    if (raw === '*') {
      out['Access-Control-Allow-Origin'] = '*';
      return out;
    }
    const list = raw.split(',').map(s => s.trim()).filter(Boolean);
    const origin = req && req.headers && (req.headers.origin || req.headers.Origin);
    out['Vary'] = 'Origin';
    if (origin && list.includes(origin)) {
      out['Access-Control-Allow-Origin'] = origin;
      out['Access-Control-Allow-Credentials'] = 'true';
    }
    return out;
  }

  const db = openDb(dbPath);
  const flags = createFlags(db, {now});
  const vip = createVip(db, {clock});
  const saved = createSaved(db, {vip, now});
  const stickers = createStickers({vip});
  const profile = createProfile(db, {now});
  const posts = createPosts(db, {vip, profile, now});
  const comments = createComments(db, {profile, vip, posts, now});
  posts.attach(comments);
  const follows = createFollows(db, {profile, vip, now});
  const communities = createCommunities(db, {profile, vip, now});
  const polls = createPolls(db, {now, posts, follows, communities});
  const hashtags = createHashtags(db, {now, posts});
  const schedule = createSchedule(db, {now, posts, hashtags, polls, intervalMs: scheduleInterval});
  posts.attach({pollOf: (id, me) => polls.ofPost(id, me), hashtagsOf: id => hashtags.ofPost(id)});
  const friends = createFriends(db, {now, profile});
  const e2ee = createE2ee(db, {now, friends});
  const events = createEvents(db, {now, ...eventsOpts});
  const mediaRoot = mediaDir || pathJoin(dirname(fileURLToPath(import.meta.url)), '../data/media');
  const media = createMedia(db, {now, vip, profile, mediaDir: mediaRoot, scanImpl: mediaScan || createNsfwScan()});
  media.attachLook(id => communities.look.isLookMedia(id));
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
  const blockwords = createBlockwords(db, {now});
  const marketing = createMarketing(db, {now, blockwords, dataDir: pathJoin(mediaRoot, '..', 'marketing')});
  const postStats = createPostStats(db, {now, posts, comments});
  const aiMod = createAiModeration(db, {now, env: aiEnv || process.env, fetchImpl: aiFetch});
  const presence = createPresence(db, {now, friends, events, chats: null});
  const chats = createChats(db, {profile, vip, now, friends, media, stickers, onEvent, blockwords});
  presence.attach({chats, events, friends});
  const msgReq = createMessageRequests(db, {now, profile, friends, chats, follows, notifications: null});
  // notifications 在后面赋值，accept/send 里对 notifications 做了空判断；启动后再挂。
  let attachMsgReqNotif = () => {};

  const exporter = createExporter(db, {now, posts, profile, chats, vip, saved});
  posts.attach({personalFilter: (text, me, authorId) => blockwords.personalFilter(text, me, authorId)});
  comments.attach({personalFilter: (text, me, authorId) => blockwords.personalFilter(text, me, authorId)});
  hashtags.attach({blockwords});
  notifications = createNotifications(db, {now, profile, vip, onEvent: (ids, type, payload) => events.publish(ids, type, payload)});
  friends.attach({notifications, onEvent: (ids, type, payload) => events.publish(ids, type, payload)});
  profile.attach({friends});
  const search = createSearch(db, {profile, vip, now});
  const admins = createAdmins(db, {now});
  const adminSeed = admins.seedFromEnv({username: adminUsername, password: adminPassword});
  const reports = createReports(db, {now, notifications, profile, moderation: () => adminOps});

  // vip 是否有效由服务端按到期时间算出，不信任任何客户端字段。
  const pubUser = u => { const v = vip.status(u); return {id: u.id, username: u.username, email: u.email, role: u.role, vip: v.active, vipUntil: v.active ? v.until : null, mustChangePw: !!u.must_change_pw, createdAt: u.created_at, legalVersion: u.legal_version || null, legalAgreedAt: u.legal_agreed_at || null, skin: u.ui_skin || null, profile: profile.publicOf(u)}; };
  const q = {
    userBy: db.prepare('SELECT * FROM users WHERE id=?'),
    userByLogin: db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE OR email = ?'),
    insUser: db.prepare('INSERT INTO users(username,email,password_hash,created_at) VALUES(?,?,?,?)'),
    insSess: db.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at,ip,ua,public_id) VALUES(?,?,?,?,?,?,?)'),
    sess: db.prepare('SELECT * FROM sessions WHERE token_hash=?'),
    delSess: db.prepare('DELETE FROM sessions WHERE token_hash=?'),
    delOther: db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?'),
    att: db.prepare('SELECT * FROM login_attempts WHERE key=?'),
    setAtt: db.prepare('INSERT INTO login_attempts(key,fails,locked_until,locks) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET fails=excluded.fails, locked_until=excluded.locked_until, locks=excluded.locks'),
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
  const boost = createBoost(db, {now, pay, posts, audit});
  postStats.onView((row, user) => boost.onView(row, user));
  posts.attach({boostOf: (id, me) => boost.badgeFor(id, me)});
  const adminOps = createAdminOps(db, {now, vip, profile, pay, audit, notifications});
  const featured = createFeatured(db, {now, posts, pubPost: adminOps.pubPost, audit});
  const secEvents = createSecurityEvents(db, {now});
  const alerts = createAlerts({webhook: alertWebhook, now, dataDir: dbPath && dbPath !== ':memory:' ? dbPath : '.'});
  const rate = rateMode === 'off' ? null : createRateLimit({now, mode: rateMode === 'strict' ? 'strict' : 'lenient', onEvent: ev => {
    secEvents.record({...ev, ip: ev.ip, actorId: ev.actorId});
  }});
  const account = createAccount(db, {now, profile, hashPassword, verifyPassword, audit, notifications, moderation: () => adminOps});
  account.attach({communities});
  communities.attach({notifications, blockwords, media});
  media.attachChannelAccess((user, chId) => communities.canReadChannel(user, chId));
  schedule.attach({blockwords});
  posts.attach({assertPlatform: (text) => blockwords.assertPlatform(text)});

  function assertPollText(spec) {
    if (!spec) return;
    if (spec.question) blockwords.assertPlatform(spec.question);
    const raw = Array.isArray(spec.options) ? spec.options : [];
    for (const o of raw) {
      const t = typeof o === 'string' ? o : (o && o.text);
      if (t) blockwords.assertPlatform(String(t));
    }
  }
  // r10：名称、简介、昵称等也按平台屏蔽词拦截。
  function assertNames(b, keys) {
    if (!b) return;
    for (const k of keys) if (b[k] != null && String(b[k]).trim()) blockwords.assertPlatform(String(b[k]));
  }
  function maintenanceBlocks(method, path) {
    if (!flags.read().maintenance) return false;
    const m = String(method || 'GET').toUpperCase();
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return false;
    if (path.startsWith('/api/admin')) return false;
    if (path === '/api/app/status' || path === '/api/health' || path === '/api/version') return false;
    if (path === '/api/auth/logout' || path === '/api/auth/login' || path === '/api/auth/csrf') return false;
    if (path === '/api/appeals' || path.startsWith('/api/appeals/')) return false;
    if (path.startsWith('/api/legal')) return false;
    // r10：已读、输入中、在线心跳、通知已读这类后台请求不算“写内容”，维护期间照常放行，避免刷屏报错。
    if (/\/(read|typing|read-all)$/.test(path) || path === '/api/me/presence/ping' || path.startsWith('/api/notifications')) return false;
    if (path === '/api/auth/refresh' || path === '/api/media/' || /^\/api\/media\/[^/]+\/ticket$/.test(path)) return false;
    return true;
  }

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

  function wantCookie(req, body) {
    const h = String((req.headers && (req.headers['x-nova-session'] || req.headers['X-Nova-Session'])) || '').toLowerCase();
    if (h === 'bearer') return false;
    if (h === 'cookie') return true;
    if (body && (body.session === 'cookie' || body.sessionMode === 'cookie')) return true;
    return false;
  }
  function cookieSecureFor(req) {
    if (cookieSecure === '1' || cookieSecure === true) return true;
    if (cookieSecure === '0' || cookieSecure === false) return false;
    return forwardedProto(req, trustOpts) === 'https';
  }
  function issue(user, req, body) {
    const t = newToken(), n = now();
    q.insSess.run(tokenHash(t), user.id, n, n + SESSION_MS, ip(req), String(req.headers['user-agent'] || '').slice(0, 200), newSessionId());
    const out = {token: t, expiresAt: n + SESSION_MS};
    if (wantCookie(req, body) || (cookieOn && wantCookie(req, body))) {
      const csrf = newCsrf();
      req._setCookies = sessionCookies(t, csrf, {secure: cookieSecureFor(req), maxAge: SESSION_MS / 1000});
      out.csrf = csrf;
      out.sessionMode = 'cookie';
    }
    // cookieOn + X-Nova-Session cookie already handled; also honor cookieOn with explicit want
    if (cookieOn && !out.sessionMode && wantCookie(req, body || {})) {
      /* already set */
    }
    return out;
  }
  const ip = req => clientIp(req, trustOpts) || (req.socket && req.socket.remoteAddress) || '';
  function sessFromToken(raw) {
    const h = tokenHash(raw), s = q.sess.get(h);
    if (!s || s.expires_at < now()) { if (s) q.delSess.run(h); throw bad('UNAUTHORIZED', '登录已过期，请重新登录', 401); }
    const u = q.userBy.get(s.user_id);
    if (!u || u.status !== 'active') throw bad('FORBIDDEN', '账号不可用', 403);
    return {user: u, hash: h};
  }
  function auth(req) {
    const m = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
    if (m) return sessFromToken(m[1]);
    const ck = cookieAuth(req);
    if (ck.token) {
      if (needsCsrf(req)) assertCsrf(req, ck.csrf);
      return {...sessFromToken(ck.token), via: 'cookie'};
    }
    throw bad('UNAUTHORIZED', '请先登录', 401);
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

  function legalDoc(kind) {
    return loadLegal(kind, process.env);
  }
  const verInfo = appVersion();
  const routes = {
    'POST /api/auth/register'(req, b) {
      if (flags.read().registrationOpen === false) throw bad('REGISTRATION_CLOSED', '暂不开放注册', 403);
      const username = String(b.username || '').trim(), email = String(b.email || '').trim().toLowerCase(), pw = b.password;
      if (!validate.username(username)) throw bad('BAD_USERNAME', '用户名需 3–20 位，仅限文字、数字、下划线');
      if (!validate.email(email)) throw bad('BAD_EMAIL', '邮箱格式不正确');
      if (!validate.password(pw)) throw bad('WEAK_PASSWORD', PW_MSG);
      if (b.agree === false || b.agree === 0 || b.agree === '0' || b.agree === 'no' || b.agree === 'false') {
        throw bad('AGREE_REQUIRED', '请阅读并同意《用户协议》和《隐私政策》');
      }
      if (!(b.agree === true || b.agree === '1' || b.agree === 'yes' || b.agree === 'on')) {
        throw bad('AGREE_REQUIRED', '请阅读并同意《用户协议》和《隐私政策》');
      }
      if (q.userByLogin.get(username, email)) throw bad('EXISTS', '用户名或邮箱已被注册', 409);
      const r = q.insUser.run(username, email, hashPassword(pw), now());
      const u0 = q.userBy.get(Number(r.lastInsertRowid));
      const lv = legalConfig(process.env).version;
      try { db.prepare('UPDATE users SET legal_version=?, legal_agreed_at=? WHERE id=?').run(lv, now(), u0.id); } catch {}
      const u = q.userBy.get(u0.id);
      audit(u.id, 'user.register', 'user:' + u.id, ip(req), {legalVersion: lv});
      return {user: pubUser(u), legalVersion: lv, ...issue(u, req, b)};
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
        const locks = (a && a.locks) || 0;
        const f = (a ? a.fails : 0) + 1;
        if (f >= LOCK_FAILS) {
          const next = locks + 1;
          q.setAtt.run(key, 0, now() + lockBackoffMs(next, LOCK_MS), next);
        } else {
          q.setAtt.run(key, f, 0, locks);
        }
        audit(u && u.id, 'auth.login_fail', key, ip(req));
        throw bad('BAD_CREDENTIALS', '账号或密码错误', 401);
      }
      if (u.status !== 'active') { audit(u.id, 'auth.login_banned', key, ip(req)); throw bad('BANNED', '账号已被封禁，请联系管理员', 403); }
      q.clrAtt.run(key); q.seen.run(now(), u.id); audit(u.id, 'auth.login', 'user:' + u.id, ip(req));
      return {user: pubUser(u), ...issue(u, req, b)};
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
      let e2eeDevices = [];
      try { e2eeDevices = (e2ee.listMine(user).devices) || []; } catch {}
      return {sessions, e2eeDevices, e2eeRevokeHint: 'POST /api/e2ee/devices/:id/revoke', e2eeNote: '撤销登录会话不会自动撤销 E2EE 设备。'};
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
      assertNames(b, ['displayName', 'bio']);
      const p = profile.save(user, b || {});
      audit(user.id, 'user.profile_update', 'user:' + user.id, ip(req));
      return {profile: p, user: pubUser(q.userBy.get(user.id))};
    },
    'POST /api/me/look'(req, b) {
      const {user} = auth(req);
      const p = profile.saveLook(user, b || {});
      audit(user.id, 'user.look_update', 'user:' + user.id, ip(req));
      return {profile: p, user: pubUser(q.userBy.get(user.id))};
    },
    'POST /api/me/avatar'(req, b) {
      const {user} = auth(req);
      const avIn = (b && b.avatar) || b || {};
      const p = (avIn.kind === 'image' || avIn.kind === 'default') ? profile.saveLook(user, {avatar: avIn}) : profile.save(user, {avatar: avIn});
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
      if (text != null && String(text).trim()) blockwords.assertPlatform(String(text));
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
    async 'POST /api/posts'(req, b) {
      const {user} = auth(req);
      const body = b || {};
      if (body.poll) polls.validateSpec(body.poll);
      if (body.text) blockwords.assertPlatform(body.text);
      if (body.poll) assertPollText(body.poll);
      // r10 AI 审查：关键词过滤之后再交给 AI；AI 不可用时已由上面的关键词过滤兜底。
      const aiText = [body.text, body.poll && body.poll.question, ...((body.poll && body.poll.options) || []).map(o => (o && o.text) || o)].filter(x => typeof x === 'string' && x.trim()).join('\n');
      const ai = await aiMod.enforce(aiText, {user, kind: 'post'});
      const r = posts.create(user, body);
      aiMod.linkPost(ai, r.post.id);
      if (body.poll) {
        const pr = polls.createForPost(user, r.post.id, body.poll);
        r.post.poll = pr.poll;
      }
      r.post.hashtags = hashtags.syncPost(user, r.post);
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
      // feed=topic 由 posts.list 按话题/标签过滤，并套用受众权限。
      const r = posts.list(user, q);
      // r10 营销帖：推荐 / 关注流的第一页附带为这个用户随机挑选的广告，客户端每 every 条普通帖插 1 条。
      if (!q.cursor && q.feed !== 'topic' && !q.author) {
        const m = marketing.pickFor(user);
        r.ads = m.ads; r.adEvery = m.every;
        if (q.feed !== 'follow') { const bz = boost.pickFor(user); r.boosts = bz.posts; r.boostSlots = bz.slots; }
      }
      return r;
    },
    // r7 热门话题：管理员挑选的帖子，按管理员设定的顺序；结构同 GET /api/posts。
    'GET /api/hot-posts'(req) {
      const {user} = auth(req);
      return featured.forUser(user, req.query || {});
    },
    // r7 公告弹窗：当前发布中的公告，不需要登录；没有时 announcement:null。
    'GET /api/announcements/current'() {
      return adminOps.currentAnnouncement();
    },
    'GET /api/posts/:id'(req) {
      const {user} = auth(req);
      return posts.get(user, req.params.id);
    },
    async 'POST /api/posts/:id/edit'(req, b) {
      const {user} = auth(req);
      if (b && b.text) blockwords.assertPlatform(b.text);
      const ai = b && typeof b.text === 'string' ? await aiMod.enforce(b.text, {user, kind: 'edit'}) : null;
      const r = posts.edit(user, req.params.id, b || {});
      aiMod.linkPost(ai, req.params.id);
      r.post.hashtags = hashtags.syncPost(user, r.post);
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
      if (b && b.text) blockwords.assertPlatform(b.text);
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
      assertNames(b, ['name', 'description']);
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
    'POST /api/communities/:id/edit'(req, b) {
      const {user} = auth(req);
      assertNames(b, ['name', 'description']);
      const r = communities.update(user, req.params.id, b || {});
      audit(user.id, 'community.edit', 'community:' + req.params.id, ip(req));
      return r;
    },
    'POST /api/communities/:id/apply'(req) {
      const {user} = auth(req);
      return communities.apply(user, req.params.id);
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
    'POST /api/channel-messages/:id/delete'(req) {
      const {user} = auth(req);
      const r = communities.deleteMessage(user, req.params.id);
      audit(user.id, 'community.message.delete', 'channel_message:' + req.params.id, ip(req));
      return r;
    },
    'POST /api/channel-messages/:id/pin'(req) {
      const {user} = auth(req);
      const r = communities.pinMessage(user, req.params.id);
      audit(user.id, 'community.message.pin', 'channel_message:' + req.params.id, ip(req));
      return r;
    },
    'POST /api/channel-messages/:id/unpin'(req) {
      const {user} = auth(req);
      const r = communities.unpinMessage(user, req.params.id);
      audit(user.id, 'community.message.unpin', 'channel_message:' + req.params.id, ip(req));
      return r;
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
    'POST /api/message-requests'(req, b) {
      const {user} = auth(req);
      return msgReq.send(user, b || {});
    },
    'GET /api/message-requests'(req) {
      const {user} = auth(req);
      return msgReq.list(user, req.query || {});
    },
    'GET /api/message-requests/:id'(req) {
      const {user} = auth(req);
      return msgReq.get(user, req.params.id);
    },
    'POST /api/message-requests/:id/accept'(req) {
      const {user} = auth(req);
      const r = msgReq.accept(user, req.params.id);
      audit(user.id, 'mreq.accept', 'mreq:' + req.params.id, ip(req));
      return r;
    },
    'POST /api/message-requests/:id/decline'(req) {
      const {user} = auth(req);
      const r = msgReq.decline(user, req.params.id);
      audit(user.id, 'mreq.decline', 'mreq:' + req.params.id, ip(req));
      return r;
    },
    'POST /api/message-requests/:id/delete'(req) {
      const {user} = auth(req);
      const r = msgReq.decline(user, req.params.id);
      audit(user.id, 'mreq.decline', 'mreq:' + req.params.id, ip(req));
      return r;
    },
    'POST /api/message-requests/:id/block'(req) {
      const {user} = auth(req);
      const r = msgReq.block(user, req.params.id);
      audit(user.id, 'mreq.block', 'mreq:' + req.params.id, ip(req), {userId: r.userId});
      return r;
    },
        'POST /api/conversations'(req, b) {
      const {user} = auth(req);
      assertNames(b, ['name']);
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
      assertNames(b, ['name']);
      const r = chats.rename(user, req.params.id, b || {});
      audit(user.id, 'chat.rename', 'conversation:' + req.params.id, ip(req));
      return r;
    },
    'POST /api/conversations/:id/avatar'(req, b) {
      const {user} = auth(req);
      const r = chats.setAvatar(user, req.params.id, b || {}, communities.look);
      audit(user.id, 'chat.avatar', 'conversation:' + req.params.id, ip(req));
      return r;
    },
    'POST /api/conversations/:id/nickname'(req, b) {
      const {user} = auth(req);
      assertNames(b, ['nickname']);
      const r = chats.setNickname(user, req.params.id, b || {});
      audit(user.id, 'chat.nickname', 'conversation:' + req.params.id, ip(req));
      return r;
    },
    'POST /api/conversations/:id/dissolve'(req, b) {
      const {user} = auth(req);
      const r = chats.dissolve(user, req.params.id, b || {});
      audit(user.id, 'chat.dissolve', 'conversation:' + req.params.id, ip(req));
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
      presence.onConnect(user);
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

    async 'POST /api/media'(req, b) {
      const {user} = auth(req);
      const buf = b && b._buffer;
      const name = (b && (b.name || b.filename)) || 'file';
      const mime = (b && (b.mime || b.type)) || 'application/octet-stream';
      const data = buf || (b && b.data ? Buffer.from(b.data, 'base64') : null);
      const r = await media.upload(user, {buffer: data, mime, name, kind: b && b.kind, durationHint: b && b.durationMs});
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
      audit(admin.id, 'admin.report.decision', 'report:' + r.report.id, ip(req), {action: (b && b.action), penalty: r.enforced && r.enforced.penalty, contentHidden: !!(r.enforced && r.enforced.contentHidden), userBanned: !!(r.enforced && r.enforced.userBanned), adminUsername: admin.username});
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
      audit(admin.id, 'admin.user.read', 'user:' + req.params.id, ip(req), {adminUsername: admin.username});
      return adminOps.oneUser(req.params.id);
    },
    'POST /api/admin/users/:id/ban'(req, b) {
      const {admin} = adminAuth(req);
      return adminOps.ban(admin, req.params.id, b || {}, ip(req));
    },
    'POST /api/admin/users/:id/unban'(req, b) {
      const {admin} = adminAuth(req);
      return adminOps.unban(admin, req.params.id, b || {}, ip(req));
    },
    'POST /api/admin/users/:id/reset-password'(req, b) {
      const {admin} = adminAuth(req);
      return adminOps.resetPassword(admin, req.params.id, b || {}, ip(req));
    },
    'POST /api/admin/vip/grant'(req, b) {
      const {admin} = adminAuth(req);
      return adminOps.grantVip(admin, b || {}, ip(req));
    },
    'POST /api/admin/vip/revoke'(req, b) {
      const {admin} = adminAuth(req);
      return adminOps.revokeVip(admin, b || {}, ip(req));
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
      return adminOps.hideContent(admin, req.params.type, req.params.id, b || {}, ip(req));
    },
    'POST /api/admin/content/:type/:id/restore'(req, b) {
      const {admin} = adminAuth(req);
      return adminOps.restoreContent(admin, req.params.type, req.params.id, b || {}, ip(req));
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
      return adminOps.addAnnouncement(admin, b || {}, ip(req));
    },
    'POST /api/admin/announcements/:id/delete'(req) {
      const {admin} = adminAuth(req);
      return adminOps.removeAnnouncement(admin, req.params.id, ip(req));
    },
    'PATCH /api/admin/announcements/:id'(req, b) {
      const {admin} = adminAuth(req);
      return adminOps.editAnnouncement(admin, req.params.id, b || {}, ip(req));
    },
    'POST /api/admin/announcements/:id/edit'(req, b) {
      const {admin} = adminAuth(req);
      return adminOps.editAnnouncement(admin, req.params.id, b || {}, ip(req));
    },
    'POST /api/admin/announcements/:id/withdraw'(req) {
      const {admin} = adminAuth(req);
      return adminOps.withdrawAnnouncement(admin, req.params.id, ip(req));
    },
    'POST /api/admin/announcements/:id/publish'(req) {
      const {admin} = adminAuth(req);
      return adminOps.publishAnnouncement(admin, req.params.id, ip(req));
    },
    // r7 热门话题（管理端）：列表、加入、移出、整体排序；都返回完整 items。
    'GET /api/admin/hot-posts'(req) {
      adminAuth(req);
      return featured.list();
    },
    'POST /api/admin/hot-posts'(req, b) {
      const {admin} = adminAuth(req);
      return featured.add(admin, b || {}, ip(req));
    },
    'POST /api/admin/hot-posts/order'(req, b) {
      const {admin} = adminAuth(req);
      return featured.order(admin, b || {}, ip(req));
    },
    'POST /api/admin/hot-posts/:postId/delete'(req) {
      const {admin} = adminAuth(req);
      return featured.remove(admin, req.params.postId, ip(req));
    },
    'GET /api/admin/communities'(req) {
      const {admin} = adminAuth(req);
      return adminOps.listCommunities(req.query || {});
    },
    'GET /api/admin/communities/:id'(req) {
      const {admin} = adminAuth(req);
      return adminOps.getCommunity(req.params.id);
    },
    'POST /api/admin/communities/:id/takedown'(req, b) {
      const {admin} = adminAuth(req);
      return adminOps.takedownCommunity(admin, req.params.id, b || {}, ip(req));
    },
    'POST /api/admin/communities/:id/restore'(req, b) {
      const {admin} = adminAuth(req);
      return adminOps.restoreCommunity(admin, req.params.id, b || {}, ip(req));
    },
    'POST /api/admin/communities/:id/warn'(req, b) {
      const {admin} = adminAuth(req);
      return adminOps.warnCommunity(admin, req.params.id, b || {}, ip(req));
    },
    'POST /api/admin/communities/:id/delete'(req, b) {
      const {admin} = adminAuth(req);
      return adminOps.deleteCommunity(admin, req.params.id, b || {}, ip(req));
    },
    'POST /api/admin/communities/:id/members/:userId/remove'(req, b) {
      const {admin} = adminAuth(req);
      return adminOps.removeMember(admin, req.params.id, req.params.userId, b || {}, ip(req));
    },
    'POST /api/admin/communities/:id/members/:userId/mute'(req, b) {
      const {admin} = adminAuth(req);
      return adminOps.muteMember(admin, req.params.id, req.params.userId, b || {}, ip(req));
    },
    'POST /api/admin/communities/:id/members/:userId/unmute'(req, b) {
      const {admin} = adminAuth(req);
      return adminOps.unmuteMember(admin, req.params.id, req.params.userId, b || {}, ip(req));
    },
    'GET /api/admin/channels/:id/messages'(req) {
      const {admin} = adminAuth(req);
      return adminOps.listChannelMessages(req.params.id, req.query || {});
    },
    'GET /api/admin/payments'(req) {
      const {admin} = adminAuth(req);
      return pay.adminList(req.query || {});
    },
    'GET /api/admin/payments/:id'(req) {
      const {admin} = adminAuth(req);
      audit(admin.id, 'admin.payment.read', 'payment:' + req.params.id, ip(req), {adminUsername: admin.username});
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

    'GET /api/me/sync-policy'(req) {
      auth(req);
      return {
        policy: {
          sessions: '所有登录会话可在 GET /api/me/sessions 查看。POST /api/me/sessions/revoke 不能撤销当前设备；revoke-others 保留当前会话。',
          readState: '已读状态通过 conversation.read 事件同步到同一用户的其他在线设备。',
          drafts: '非加密会话草稿经 PUT /api/conversations/:id/draft 写入服务端，并通过 draft.sync 推到其他设备。端到端私聊草稿默认只留在本机，避免把明文上传到服务器。',
          e2eeDevices: '每个设备有独立密钥，服务端不保存 pickle、不同步加密私钥。撤销登录会话不会自动撤销 E2EE 设备，需另外调用 POST /api/e2ee/devices/:id/revoke。',
        },
        endpoints: {
          sessions: 'GET /api/me/sessions',
          revoke: 'POST /api/me/sessions/revoke',
          revokeOthers: 'POST /api/me/sessions/revoke-others',
          e2eeDevices: 'GET /api/e2ee/devices',
          e2eeRevoke: 'POST /api/e2ee/devices/:id/revoke',
          drafts: 'GET/PUT /api/conversations/:id/draft',
          read: 'POST /api/conversations/:id/read',
        },
      };
    },
    'GET /api/me/export'(req) {
      const {user} = auth(req);
      audit(user.id, 'user.export', 'user:' + user.id, ip(req));
      return {export: exporter.exportAll(user)};
    },
    'POST /api/me/export'(req) {
      const {user} = auth(req);
      audit(user.id, 'user.export', 'user:' + user.id, ip(req));
      return {export: exporter.exportAll(user)};
    },
    'GET /api/me/presence'(req) {
      const {user} = auth(req);
      return {presence: presence.mine(user)};
    },
    'PUT /api/me/presence'(req, b) {
      const {user} = auth(req);
      return {presence: presence.save(user, b || {})};
    },
    'POST /api/me/presence/ping'(req) {
      const {user} = auth(req);
      return {presence: presence.ping(user)};
    },
    'GET /api/users/:id/presence'(req) {
      const {user} = auth(req);
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) throw bad('BAD_USER', '请指定用户', 400);
      if (!q.userBy.get(id)) throw bad('NOT_FOUND', '用户不存在', 404);
      return {presence: presence.viewFor(user, id)};
    },
    'POST /api/conversations/:id/typing'(req, b) {
      const {user} = auth(req);
      return presence.typing(user, req.params.id, b || {});
    },
    'GET /api/me/blockwords'(req) {
      const {user} = auth(req);
      return blockwords.listPersonal(user);
    },
    'POST /api/me/blockwords'(req, b) {
      const {user} = auth(req);
      return blockwords.addPersonal(user, b || {});
    },
    'POST /api/me/blockwords/remove'(req, b) {
      const {user} = auth(req);
      return blockwords.removePersonal(user, b || {});
    },
    'GET /api/admin/blockwords'(req) {
      adminAuth(req);
      return blockwords.listPlatform();
    },
    'POST /api/admin/blockwords'(req, b) {
      const {admin} = adminAuth(req);
      const r = blockwords.addPlatform(admin, b || {});
      audit(admin.id, 'admin.blockword.add', 'blockword:' + r.blockword.id, ip(req), {word: r.blockword.word});
      return r;
    },
    'POST /api/admin/blockwords/:id/delete'(req) {
      const {admin} = adminAuth(req);
      const r = blockwords.removePlatform(admin, req.params.id);
      audit(admin.id, 'admin.blockword.delete', 'blockword:' + r.removed.id, ip(req), {word: r.removed.word});
      return r;
    },
    'GET /api/post-drafts'(req) {
      const {user} = auth(req);
      return schedule.list(user);
    },
    'POST /api/post-drafts'(req, b) {
      const {user} = auth(req);
      if (b && b.text) blockwords.assertPlatform(b.text);
      return schedule.create(user, b || {});
    },
    'GET /api/post-drafts/:id'(req) {
      const {user} = auth(req);
      return schedule.get(user, req.params.id);
    },
    'PUT /api/post-drafts/:id'(req, b) {
      const {user} = auth(req);
      return schedule.update(user, req.params.id, b || {});
    },
    'POST /api/post-drafts/:id/schedule'(req, b) {
      const {user} = auth(req);
      return schedule.scheduleOne(user, req.params.id, b || {});
    },
    'POST /api/post-drafts/:id/cancel'(req) {
      const {user} = auth(req);
      return schedule.cancel(user, req.params.id);
    },
    'POST /api/post-drafts/:id/publish'(req) {
      const {user} = auth(req);
      return schedule.publishNow(user, req.params.id);
    },
    'GET /api/hashtags/search'(req) {
      auth(req);
      return hashtags.search((req.query || {}).q, {limit: (req.query || {}).limit});
    },
    'GET /api/hashtags/trending'(req) {
      auth(req);
      const q = req.query || {};
      const windowMs = q.window === '7d' ? 7 * 24 * 3600_000 : (q.windowMs ? Number(q.windowMs) : 24 * 3600_000);
      return hashtags.trending({windowMs, limit: q.limit});
    },
    'POST /api/hashtags'(req, b) {
      const {user} = auth(req);
      return hashtags.create(user, b || {});
    },
    'GET /api/hashtags/:name'(req) {
      const {user} = auth(req);
      return hashtags.get(req.params.name, user);
    },
    'GET /api/polls/:id'(req) {
      const {user} = auth(req);
      return polls.get(user, req.params.id);
    },
    'POST /api/polls/:id/vote'(req, b) {
      const {user} = auth(req);
      return polls.vote(user, req.params.id, b || {});
    },
    'POST /api/posts/:id/poll'(req, b) {
      const {user} = auth(req);
      return polls.createForPost(user, req.params.id, b || {});
    },
    'GET /api/communities/:id/polls'(req) {
      const {user} = auth(req);
      return polls.listCommunity(user, req.params.id);
    },
    'POST /api/communities/:id/polls'(req, b) {
      const {user} = auth(req);
      assertPollText(b || {});
      const r = polls.createForCommunity(user, req.params.id, b || {});
      audit(user.id, 'poll.create', 'poll:' + r.poll.id, ip(req), {communityId: req.params.id});
      return r;
    },

    // ---- AI 审查（智谱 AI，OpenAI 兼容接口） ----
    'GET /api/admin/ai-moderation'(req) { adminAuth(req); return {settings: aiMod.settings(), status: aiMod.status(), logs: aiMod.logs(req.query || {})}; },
    'POST /api/admin/ai-moderation'(req, b) {
      const {admin} = adminAuth(req);
      const st = aiMod.save(b || {});
      audit(admin.id, 'admin.ai_moderation', 'ai', ip(req), {enabled: st.enabled, mode: st.mode, model: st.model});
      return {settings: st, status: aiMod.status()};
    },
    async 'POST /api/admin/ai-moderation/test'(req, b) {
      adminAuth(req);
      const text = String((b && b.text) || '').trim();
      if (!text) throw bad('BAD_TEXT', '请输入要测试的内容');
      return {result: await aiMod.check(text, {kind: 'test', force: true}), status: aiMod.status()};
    },
    // ---- r10 推流 / 加热 ----
    'GET /api/boost/catalog'(req) { const {user} = auth(req); return boost.catalog(user); },
    'GET /api/boost/orders'(req) { const {user} = auth(req); return boost.listMine(user, req.query || {}); },
    'POST /api/boost/orders'(req, b) { const {user} = auth(req); return boost.create(user, b || {}); },
    'POST /api/boost/orders/:id/paid'(req) { const {user} = auth(req); return boost.markPaid(user, req.params.id); },
    'GET /api/admin/boost/orders'(req) { adminAuth(req); return boost.adminList(req.query || {}); },
    'POST /api/admin/boost/orders/:id/confirm'(req) { const {admin} = adminAuth(req); const r = boost.confirm(admin, req.params.id); audit(admin.id, 'admin.boost.confirm', 'boost:' + req.params.id, ip(req)); return r; },
    'POST /api/admin/boost/orders/:id/reject'(req, b) { const {admin} = adminAuth(req); const r = boost.reject(admin, req.params.id, b || {}); audit(admin.id, 'admin.boost.reject', 'boost:' + req.params.id, ip(req)); return r; },
    'POST /api/admin/boost/orders/:id/stop'(req, b) { const {admin} = adminAuth(req); const r = boost.stop(admin, req.params.id, b || {}); audit(admin.id, 'admin.boost.stop', 'boost:' + req.params.id, ip(req), {refund: !!(b && b.refund)}); return r; },
    'POST /api/admin/boost/settings'(req, b) { const {admin} = adminAuth(req); const r = boost.saveSettings(b || {}); audit(admin.id, 'admin.boost.settings', 'boost', ip(req)); return r; },
    // ---- r10 数据调整 ----
    'POST /api/posts/:id/view'(req) { const {user} = auth(req); return postStats.view(user, req.params.id); },
    'GET /api/admin/marketing/posts'(req) { adminAuth(req); return postStats.search(req.query || {}); },
    'POST /api/admin/marketing/posts/:id/stats'(req, b) {
      const {admin} = adminAuth(req);
      const r = postStats.setShown(req.params.id, b || {});
      audit(admin.id, 'admin.marketing.stats', 'post:' + req.params.id, ip(req), {shown: r.post.shown, real: r.post.real});
      return r;
    },
    // ---- r10 营销帖 ----
    'POST /api/marketing/ads/:id/impression'(req) { const {user} = auth(req); return marketing.track(user, req.params.id, 'impression'); },
    'POST /api/marketing/ads/:id/click'(req) { const {user} = auth(req); return marketing.track(user, req.params.id, 'click'); },
    'POST /api/marketing/ads/:id/hide'(req, b) { const {user} = auth(req); return marketing.track(user, req.params.id, 'hide', b || {}); },
    'GET /api/admin/marketing/ads'(req) { adminAuth(req); return marketing.adminList(); },
    'POST /api/admin/marketing/ads'(req, b) { const {admin} = adminAuth(req); const r = marketing.create(b || {}); audit(admin.id, 'admin.marketing.ad.create', 'ad:' + r.ad.id, ip(req)); return r; },
    'POST /api/admin/marketing/ads/:id'(req, b) { const {admin} = adminAuth(req); const r = marketing.update(req.params.id, b || {}); audit(admin.id, 'admin.marketing.ad.update', 'ad:' + r.ad.id, ip(req)); return r; },
    'POST /api/admin/marketing/ads/:id/delete'(req) { const {admin} = adminAuth(req); const r = marketing.remove(req.params.id); audit(admin.id, 'admin.marketing.ad.delete', 'ad:' + req.params.id, ip(req)); return r; },
    'POST /api/admin/marketing/settings'(req, b) { const {admin} = adminAuth(req); const st = marketing.saveSettings(b || {}); audit(admin.id, 'admin.marketing.settings', 'marketing', ip(req), st); return {settings: st}; },
    'POST /api/admin/marketing/media'(req, b) { adminAuth(req); return marketing.saveMedia(b || {}); },
    'GET /api/app/status'() {
      const f = flags.read();
      return {
        maintenance: f.maintenance,
        maintenanceMessage: f.maintenanceMessage,
        registrationOpen: f.registrationOpen,
        reviewRequired: f.reviewRequired,
        loginProtect: f.loginProtect,
        flags: f,
      };
    },
    'GET /api/admin/flags'(req) {
      adminAuth(req);
      return {flags: flags.read()};
    },
    'POST /api/admin/flags'(req, b) {
      const {admin} = adminAuth(req);
      const saved = flags.save(b || {});
      audit(admin.id, 'admin.flags', 'flags', ip(req), saved);
      return {flags: saved};
    },
    'GET /api/health'() {
      try {
        const row = db.prepare('SELECT 1 AS n').get();
        if (!row || row.n !== 1) throw new Error('db ping failed');
      } catch (e) {
        try { alerts.dbError(e, {path: '/api/health'}); } catch {}
        throw bad('DB_UNAVAILABLE', '数据库不可用', 503);
      }
      let disk;
      try { disk = alerts.disk(); } catch { disk = {}; }
      return {
        status: 'ok', time: now(), db: 'ok',
        uptime: Math.round(process.uptime()),
        version: verInfo.version, commit: verInfo.commit,
        disk: disk && disk.free != null ? {free: disk.free, low: !!disk.low} : undefined,
      };
    },
    'GET /api/version'() {
      return verInfo;
    },
    'GET /api/metrics'(req) {
      const {admin} = adminAuth(req);
      let disk = {};
      try { disk = alerts.disk(); } catch {}
      return {
        time: now(), uptime: process.uptime(),
        memory: process.memoryUsage(),
        rate: rate ? rate.snapshot() : {mode: 'off'},
        disk,
        sse: typeof events.stats === 'function' ? events.stats() : undefined,
      };
    },
    'GET /api/admin/metrics'(req) {
      const {admin} = adminAuth(req);
      return routes['GET /api/metrics'](req);
    },
    'GET /api/admin/security/events'(req) {
      const {admin} = adminAuth(req);
      return secEvents.listEvents(req.query || {});
    },
    'POST /api/me/delete'(req, b) {
      const {user} = auth(req);
      const r = account.deleteAccount(user, {...(b || {}), _ip: ip(req)});
      req._setCookies = clearSessionCookies({secure: cookieSecureFor(req)});
      return r;
    },
    'POST /api/appeals'(req, b) {
      try {
        const {user} = auth(req);
        return account.submitAppeal(user, {...(b || {}), _ip: ip(req)});
      } catch (e) {
        if (e && (e.code === 'UNAUTHORIZED' || e.s === 401)) {
          return account.submitAppealWithPassword(b || {}, {ip: ip(req)});
        }
        throw e;
      }
    },
    'GET /api/appeals'(req) {
      const {user} = auth(req);
      return account.listMine(user, req.query || {});
    },
    'GET /api/admin/appeals'(req) {
      const {admin} = adminAuth(req);
      return account.listAll(req.query || {});
    },
    'GET /api/admin/appeals/:id'(req) {
      const {admin} = adminAuth(req);
      return account.get(req.params.id);
    },
    'POST /api/admin/appeals/:id/decision'(req, b) {
      const {admin} = adminAuth(req);
      return account.decideAppeal(admin, req.params.id, b || {}, ip(req));
    },
    'GET /api/legal/privacy'() { return legalDoc('privacy'); },
    'GET /api/legal/terms'() { return legalDoc('terms'); },
    'POST /api/me/prefs'(req, b) {
      const {user} = auth(req);
      const body = b || {};
      const out = {skin: user.ui_skin || null, legalVersion: user.legal_version || null};
      if (body.skin !== undefined) {
        const skin = String(body.skin || '').trim();
        if (skin && !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(skin)) throw bad('BAD_SKIN', '皮肤编号不正确');
        try { db.prepare('UPDATE users SET ui_skin=? WHERE id=?').run(skin || null, user.id); } catch {}
        out.skin = skin || null;
      }
      return out;
    },
    'GET /api/auth/csrf'(req) {
      const csrf = newCsrf();
      req._setCookies = [
        ...(req._setCookies || []),
        sessionCookies('x', csrf, {secure: cookieSecureFor(req), maxAge: SESSION_MS / 1000})[1],
      ];
      return {csrf};
    },




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
    const h = {...corsHeaders(req), ...securityHeaders({hsts: !!hsts, html: false}),
      'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8'};
    const send = (s, o) => {
      const hdrs = {...h};
      if (req._setCookies && req._setCookies.length) hdrs['Set-Cookie'] = req._setCookies;
      if (s === 429 && o && o.error && o.error.retryAfter) hdrs['Retry-After'] = String(o.error.retryAfter);
      res.writeHead(s, hdrs); res.end(JSON.stringify(o));
    };
    if (req.method === 'OPTIONS') { res.writeHead(204, h); return res.end(); }
    const parsed = new URL(req.url, 'http://x');
    const path = parsed.pathname;
    req.query = Object.fromEntries(parsed.searchParams);
    req.params = {};
    if (rate && path !== '/api/health' && path !== '/api/version' && !path.startsWith('/legal/')) {
      try {
        const id = ip(req) || 'unknown';
        let kind = 'global';
        if (req.method === 'POST' && path === '/api/auth/register') kind = 'register';
        else if (req.method === 'POST' && (path === '/api/auth/login' || path === '/api/admin/auth/login')) kind = 'login';
        else if (req.method === 'POST' && path === '/api/reports') kind = 'report';
        else if (req.method === 'POST' && path === '/api/media') kind = 'upload';
        else if (req.method === 'POST' && path === '/api/posts') kind = 'post';
        else if (req.method === 'POST' && (/\/messages$/.test(path))) kind = 'message';
        else if (req.method === 'POST' && path === '/api/appeals') kind = 'appeal';
        rate.check(kind, id, path);
      } catch (e) {
        if (e instanceof HttpError || e instanceof VipError || e instanceof ApiError) {
          return send(e.s, {error: {code: e.code, message: e.message, ...(e.extra || {})}});
        }
        throw e;
      }
    }
    if (req.method === 'GET' && (path === '/legal/privacy' || path === '/legal/terms')) {
      const doc = legalDoc(path.endsWith('terms') ? 'terms' : 'privacy');
      const html = renderLegalHtml(doc);
      res.writeHead(200, {...h, ...securityHeaders({hsts: !!hsts, html: true, connectSrc: process.env.NOVA_API_BASE || ''}), 'Content-Type': 'text/html; charset=utf-8'});
      return res.end(html);
    }
    if (req.method === 'GET' && path.startsWith('/assets/')) {
      const name = decodeURIComponent(path.slice('/assets/'.length));
      if (!name || name.includes('..') || name.startsWith('/') || !/^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/.test(name)) {
        return send(400, {error: {code: 'BAD_PATH', message: '路径不正确'}});
      }
      const fp = join(assetRoot, name);
      if (!existsSync(fp)) return send(404, {error: {code: 'NOT_FOUND', message: '文件不存在'}});
      const lower = name.toLowerCase();
      const ext = lower.endsWith('.svg') ? 'image/svg+xml'
        : lower.endsWith('.css') ? 'text/css; charset=utf-8'
        : lower.endsWith('.json') ? 'application/json; charset=utf-8'
        : lower.endsWith('.png') ? 'image/png'
        : lower.endsWith('.webp') ? 'image/webp'
        : lower.endsWith('.woff2') ? 'font/woff2'
        : lower.endsWith('.js') ? 'text/javascript; charset=utf-8'
        : lower.endsWith('.html') ? 'text/html; charset=utf-8'
        : 'image/jpeg';
      res.writeHead(200, {...h, 'Content-Type': ext, 'Cache-Control': 'public, max-age=86400'});
      return createReadStream(fp).pipe(res);
    }
    if (req.method === 'GET' && (path === '/' || path === '/index.html' || path === '/nova_v5.html')) {
      try {
        const html = readFileSync(join(root, '../dist/nova_v5.html'));
        res.writeHead(200, {...h, ...securityHeaders({hsts: !!hsts, html: true, connectSrc: process.env.NOVA_API_BASE || ''}), 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': securityHeaders({html: true, connectSrc: process.env.NOVA_API_BASE || ''})['Content-Security-Policy']});
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
        return sendRanged(req, res, data, {
          ...corsHeaders(req),
          'Content-Type': f.mime,
          'Content-Disposition': "inline; filename=\"" + String(f.name || 'file').replace(/[^\x20-\x7e]|["\\]/g, '_') + "\"; filename*=UTF-8''" + encodeURIComponent(f.name || 'file'),
          'Cache-Control': 'private, max-age=60',
          'X-Content-Type-Options': 'nosniff',
        });
      } catch (e) {
        if (e instanceof HttpError || e instanceof VipError || e instanceof ApiError) send(e.s, {error: {code: e.code, message: e.message, ...(e.extra || {})}});
        else { slog('error', 'internal_error', {error: e.message, path}); try { alerts.crash(e, {path}); } catch {} send(500, {error: {code: 'INTERNAL', message: '服务器开小差了'}}); }
      }
      return;
    }
    const mkMedia = /^\/api\/marketing\/media\/([A-Za-z0-9_.-]+)$/.exec(path);
    if (req.method === 'GET' && mkMedia) {
      try {
        const f = marketing.mediaFile(mkMedia[1]);
        return sendRanged(req, res, f.buf, {...corsHeaders(req), 'Content-Type': f.mime, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff'});
      } catch (e) {
        if (e instanceof ApiError) return send(e.s, {error: {code: e.code, message: e.message}});
        return send(500, {error: {code: 'INTERNAL', message: '服务器开小差了'}});
      }
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
        else { slog('error', 'internal_error', {error: e.message, path}); try { alerts.crash(e, {path}); } catch {} send(500, {error: {code: 'INTERNAL', message: '服务器开小差了'}}); }
        return;
      }
    }
    const payRcpt = /^\/api\/admin\/payments\/([^/]+)\/receipt$/.exec(path);
    if ((req.method === 'GET' || req.method === 'HEAD') && payRcpt) {
      try {
        const {admin} = adminAuth(req);
        const got = pay.getFor(admin, decodeURIComponent(payRcpt[1]), {admin: true});
        const row = pay.get(got.order.id);
        const f = pay.receiptFile(row);
        audit(admin.id, 'admin.payment.receipt', 'payment:' + got.order.id, ip(req), {adminUsername: admin.username, method: req.method});
        res.writeHead(200, {
          ...corsHeaders(req),
          ...securityHeaders({hsts: !!hsts}),
          'Content-Type': f.mime,
          'Content-Length': f.buf.length,
          'Content-Disposition': 'inline; filename="' + String(f.name || 'receipt').replace(/["\\]/g, '') + '"',
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        if (req.method === 'HEAD') return res.end();
        return res.end(f.buf);
      } catch (e) {
        if (e instanceof HttpError || e instanceof VipError || e instanceof ApiError) send(e.s, {error: {code: e.code, message: e.message, ...(e.extra || {})}});
        else { slog('error', 'internal_error', {error: e.message, path}); try { alerts.crash(e, {path}); } catch {} send(500, {error: {code: 'INTERNAL', message: '服务器开小差了'}}); }
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
        else { slog('error', 'internal_error', {error: e.message, path}); try { alerts.crash(e, {path}); } catch {} send(500, {error: {code: 'INTERNAL', message: '服务器开小差了'}}); }
      }
      return;
    }
    let size = 0; const chunks = [];
    const bodyLimit = (req.method === 'POST' && path === '/api/media') ? 100 * 1024 * 1024
      : (req.method === 'POST' && path === '/api/admin/marketing/media') ? 42 * 1024 * 1024
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
          b = {_buffer: raw, name: decodeURIComponent(String(req.headers['x-file-name'] || 'file')), mime: ct.split(';')[0] || 'application/octet-stream', durationMs: req.headers['x-media-duration']};
        } else if (raw.length) {
          try { b = JSON.parse(raw.toString('utf8')); } catch { throw bad('BAD_JSON', '请求格式不正确'); }
          if (b === null || typeof b !== 'object') throw bad('BAD_JSON', '请求格式不正确');
        }
        if (maintenanceBlocks(req.method, path)) {
          const st = flags.read();
          throw bad('MAINTENANCE', st.maintenanceMessage || '系统维护中，请稍后再试', 503);
        }
        const finish = (val) => send(200, {ok: true, ...(val || {})});
        const fail = (e) => {
          if (e instanceof HttpError || e instanceof VipError || e instanceof ApiError) send(e.s, {error: {code: e.code, message: e.message, ...(e.extra || {})}});
          else { slog('error', 'internal_error', {error: e.message, path}); try { alerts.crash(e, {path}); } catch {} send(500, {error: {code: 'INTERNAL', message: '服务器开小差了'}}); }
        };
        const out = fn(req, b);
        if (out && typeof out.then === 'function') out.then(finish, fail);
        else finish(out);
      } catch (e) {
        if (e instanceof HttpError || e instanceof VipError || e instanceof ApiError) send(e.s, {error: {code: e.code, message: e.message, ...(e.extra || {})}});
        else { slog('error', 'internal_error', {error: e.message, path}); try { alerts.crash(e, {path}); } catch {} send(500, {error: {code: 'INTERNAL', message: '服务器开小差了'}}); }
      }
    });
  });
  server.db = db; server.vip = vip; server.saved = saved; server.profile = profile; server.posts = posts; server.comments = comments; server.follows = follows; server.communities = communities; server.chats = chats; server.friends = friends; server.events = events; server.media = media; server.notifications = notifications; server.search = search; server.admins = admins; server.reports = reports; server.e2ee = e2ee; server.adminSeed = adminSeed; server.pay = pay; server.adminOps = adminOps; server.featured = featured; server.polls = polls; server.hashtags = hashtags; server.schedule = schedule; server.blockwords = blockwords; server.flags = flags; server.marketing = marketing; server.postStats = postStats; server.boost = boost; server.aiMod = aiMod; server.presence = presence; server.exporter = exporter; server.account = account; server.secEvents = secEvents; server.alerts = alerts; server.rate = rate; server.backupOpen = (dest) => backupOpen(db, dest);

  const autoSched = scheduleAuto != null ? !!scheduleAuto : (dbPath !== ':memory:');
  if (autoSched) schedule.start();
  const _close = server.close.bind(server);
  server.close = function(cb) {
    try { schedule.stop(); } catch {}
    try { events.closeAll(); } catch {}
    return _close(cb);
  };

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
