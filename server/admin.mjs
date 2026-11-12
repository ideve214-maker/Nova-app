// 平台管理员账号与鉴权。与普通用户分表、分令牌；没有内置默认密码。
import {randomBytes} from 'node:crypto';
import {ApiError} from './errors.mjs';
import {hashPassword, verifyPassword, newToken, tokenHash} from './auth.mjs';

const SESSION_MS = 30 * 864e5;
const LOCK_FAILS = 5, LOCK_MS = 15 * 60e3;
const DUMMY = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '==';
const PW_OK = pw => typeof pw === 'string' && pw.length >= 8 && pw.length <= 128 && /[A-Za-z]/.test(pw) && /\d/.test(pw);

export function createAdmins(db, {now} = {}) {
  const nowFn = now || Date.now;
  const byName = db.prepare('SELECT * FROM admins WHERE username = ? COLLATE NOCASE');
  const byId = db.prepare('SELECT * FROM admins WHERE id=?');
  const ins = db.prepare('INSERT INTO admins(username,email,password_hash,role,status,created_at) VALUES(?,?,?,?,?,?)');
  const setLogin = db.prepare('UPDATE admins SET last_login_at=? WHERE id=?');
  const insSess = db.prepare('INSERT INTO admin_sessions(token_hash,admin_id,created_at,expires_at,ip,ua) VALUES(?,?,?,?,?,?)');
  const sess = db.prepare('SELECT * FROM admin_sessions WHERE token_hash=?');
  const delSess = db.prepare('DELETE FROM admin_sessions WHERE token_hash=?');
  const attGet = db.prepare('SELECT * FROM login_attempts WHERE key=?');
  const attSet = db.prepare('INSERT INTO login_attempts(key,fails,locked_until) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET fails=excluded.fails, locked_until=excluded.locked_until');
  const attClr = db.prepare('DELETE FROM login_attempts WHERE key=?');
  const list = db.prepare('SELECT id,username,email,role,status,created_at,last_login_at FROM admins ORDER BY id');

  function pub(a) {
    if (!a) return null;
    return {id: a.id, username: a.username, email: a.email || '', role: a.role, status: a.status, createdAt: a.created_at, lastLoginAt: a.last_login_at || null};
  }

  function create({username, password, email, role} = {}, {allowEmpty = false} = {}) {
    const name = String(username || '').trim();
    if (!/^[A-Za-z0-9_\u4e00-\u9fff]{2,32}$/.test(name)) {
      throw new ApiError(400, 'BAD_USERNAME', '管理员用户名需 2–32 位，仅限文字、数字、下划线');
    }
    if (!PW_OK(password)) throw new ApiError(400, 'WEAK_PASSWORD', '密码需 8–128 位，且同时包含字母和数字');
    if (byName.get(name)) throw new ApiError(409, 'EXISTS', '该管理员用户名已存在');
    const r = ins.run(name, email ? String(email).trim().toLowerCase() : null, hashPassword(password), role === 'root' ? 'root' : 'admin', 'active', nowFn());
    return pub(byId.get(Number(r.lastInsertRowid)));
  }

  // 启动时从环境变量创建：仅当用户名与密码都显式给出、且该用户还不存在。绝不用内置默认密码。
  function seedFromEnv({username, password} = {}) {
    const name = String(username || '').trim();
    const pw = password;
    if (!name && (pw === undefined || pw === null || pw === '')) return {created: false, reason: 'unset'};
    if (!name || pw === undefined || pw === null || String(pw) === '') {
      console.warn('NOVA：已设置管理员用户名或密码其中之一，但两者必须同时提供才会创建账号。不会使用默认密码。');
      return {created: false, reason: 'incomplete'};
    }
    if (!PW_OK(pw)) {
      console.warn('NOVA：NOVA_ADMIN_PASSWORD 不符合强度要求（8–128 位且含字母和数字），未创建管理员。');
      return {created: false, reason: 'weak'};
    }
    if (byName.get(name)) return {created: false, reason: 'exists', admin: pub(byName.get(name))};
    const admin = create({username: name, password: pw});
    return {created: true, admin};
  }

  function issue(admin, req = {}) {
    const t = 'na_' + randomBytes(32).toString('base64url');
    const n = nowFn();
    const ip = (req.socket && req.socket.remoteAddress) || '';
    const ua = String((req.headers && req.headers['user-agent']) || '').slice(0, 200);
    insSess.run(tokenHash(t), admin.id, n, n + SESSION_MS, ip, ua);
    return {token: t, expiresAt: n + SESSION_MS};
  }

  function login(body = {}, req = {}) {
    const id = String(body.username || body.account || body.email || '').trim();
    const pw = String(body.password || '');
    if (!id || !pw) throw new ApiError(400, 'BAD_REQUEST', '请输入管理员账号和密码');
    const key = 'admin:' + id.toLowerCase();
    const a = attGet.get(key);
    if (a && a.locked_until > nowFn()) {
      throw new ApiError(429, 'LOCKED', `尝试次数过多，请 ${Math.ceil((a.locked_until - nowFn()) / 60e3)} 分钟后再试`);
    }
    const admin = byName.get(id);
    const ok = admin ? verifyPassword(pw, admin.password_hash) : (verifyPassword(pw, DUMMY), false);
    if (!ok) {
      const f = (a ? a.fails : 0) + 1;
      attSet.run(key, f >= LOCK_FAILS ? 0 : f, f >= LOCK_FAILS ? nowFn() + LOCK_MS : 0);
      throw new ApiError(401, 'BAD_CREDENTIALS', '账号或密码错误');
    }
    if (admin.status !== 'active') throw new ApiError(403, 'BANNED', '该管理员账号已被停用');
    attClr.run(key);
    setLogin.run(nowFn(), admin.id);
    return {admin: pub(admin), ...issue(admin, req)};
  }

  function fromToken(token) {
    if (!token) return null;
    const s = sess.get(tokenHash(token));
    if (!s || s.expires_at < nowFn()) {
      if (s) delSess.run(s.token_hash);
      return null;
    }
    const admin = byId.get(s.admin_id);
    if (!admin || admin.status !== 'active') return null;
    return pub(admin);
  }

  function logout(token) {
    if (token) delSess.run(tokenHash(token));
    return {};
  }

  return {create, seedFromEnv, login, fromToken, logout, pub, list: () => list.all().map(pub), passwordOk: PW_OK};
}
