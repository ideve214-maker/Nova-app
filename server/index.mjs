// NOVA 统一后端 · M2.1 账号系统。零依赖。用法：node server/index.mjs
import http from 'node:http';
import {createReadStream, existsSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openDb} from './db.mjs';
import {hashPassword, verifyPassword, newToken, tokenHash} from './auth.mjs';
import {createVip} from './vip.mjs';

const SESSION_MS = 30 * 864e5, LOCK_FAILS = 5, LOCK_MS = 15 * 60e3;
class HttpError extends Error { constructor(s, code, msg) { super(msg); this.s = s; this.code = code; } }
const bad = (code, msg, s = 400) => new HttpError(s, code, msg);

// clock 仅用于测试注入固定时间；生产一律用系统时间。
export function createApp({dbPath = ':memory:', corsOrigin = process.env.NOVA_CORS_ORIGIN || '*', clock = Date.now} = {}) {
  const now = () => clock();
  const db = openDb(dbPath);
  const vip = createVip(db, {clock});
  // vip 是否有效由服务端按到期时间算出，不信任任何客户端字段。
  const pubUser = u => { const v = vip.status(u); return {id: u.id, username: u.username, email: u.email, role: u.role, vip: v.active, vipUntil: v.active ? v.until : null, mustChangePw: !!u.must_change_pw, createdAt: u.created_at}; };
  const q = {
    userBy: db.prepare('SELECT * FROM users WHERE id=?'),
    userByLogin: db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE OR email = ?'),
    insUser: db.prepare('INSERT INTO users(username,email,password_hash,created_at) VALUES(?,?,?,?)'),
    insSess: db.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at,ip,ua) VALUES(?,?,?,?,?,?)'),
    sess: db.prepare('SELECT * FROM sessions WHERE token_hash=?'),
    delSess: db.prepare('DELETE FROM sessions WHERE token_hash=?'),
    delOther: db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?'),
    att: db.prepare('SELECT * FROM login_attempts WHERE key=?'),
    setAtt: db.prepare('INSERT INTO login_attempts(key,fails,locked_until) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET fails=excluded.fails, locked_until=excluded.locked_until'),
    clrAtt: db.prepare('DELETE FROM login_attempts WHERE key=?'),
    audit: db.prepare('INSERT INTO audit_log(at,actor_id,action,target,ip,detail) VALUES(?,?,?,?,?,?)'),
    setPw: db.prepare('UPDATE users SET password_hash=?, must_change_pw=0 WHERE id=?'),
    seen: db.prepare('UPDATE users SET last_login_at=? WHERE id=?'),
    mySess: db.prepare('SELECT token_hash,created_at,expires_at,ip,ua FROM sessions WHERE user_id=? ORDER BY created_at DESC'),
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
    q.insSess.run(tokenHash(t), user.id, n, n + SESSION_MS, ip(req), String(req.headers['user-agent'] || '').slice(0, 200));
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
      return {sessions: q.mySess.all(user.id).map(s => ({id: s.token_hash.slice(0, 12), current: s.token_hash === hash, createdAt: s.created_at, ip: s.ip, ua: s.ua}))};
    },
    // ---- VIP（M2.4.2）----
    'GET /api/vip/catalog'() { return vip.catalog(); },
    'GET /api/vip/me'(req) {
      const {user} = auth(req);
      return {now: now(), vip: vip.status(user), entitlements: vip.entitlements(user)};
    },
    'GET /api/health'() { return {status: 'ok', time: now()}; },
  };

  const root = dirname(fileURLToPath(import.meta.url));
  const assetRoot = join(root, '../assets');
  const server = http.createServer((req, res) => {
    const h = {'Access-Control-Allow-Origin': corsOrigin, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8'};
    const send = (s, o) => { res.writeHead(s, h); res.end(JSON.stringify(o)); };
    if (req.method === 'OPTIONS') { res.writeHead(204, h); return res.end(); }
    const path = new URL(req.url, 'http://x').pathname;
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
    const fn = routes[req.method + ' ' + path];
    if (!fn) return send(404, {error: {code: 'NOT_FOUND', message: '接口不存在'}});
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 1e6) { send(413, {error: {code: 'TOO_LARGE', message: '请求过大'}}); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      try {
        let b = {}; if (chunks.length) { try { b = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw bad('BAD_JSON', '请求格式不正确'); } }
        if (b === null || typeof b !== 'object') throw bad('BAD_JSON', '请求格式不正确');
        send(200, {ok: true, ...fn(req, b)});
      } catch (e) {
        if (e instanceof HttpError) send(e.s, {error: {code: e.code, message: e.message}});
        else { console.error('内部错误:', e.message); send(500, {error: {code: 'INTERNAL', message: '服务器开小差了'}}); }
      }
    });
  });
  server.db = db; server.vip = vip;
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = +process.env.PORT || 8787, host = process.env.HOST || '0.0.0.0', dbPath = process.env.NOVA_DB || './nova.db';
  createApp({dbPath}).listen(port, host, () => console.log(`NOVA 后端已启动 http://${host}:${port}  数据库:${dbPath}`));
}
