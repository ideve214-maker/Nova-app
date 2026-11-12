// M6 安全工具：限流、安全事件、可信代理 IP、安全响应头、Cookie 会话、日志脱敏、文件魔数。
import {createHmac, randomBytes, timingSafeEqual} from 'node:crypto';
import {ApiError} from './errors.mjs';

export const SENSITIVE_KEY = /pass(word|wd)|passwd|token|secret|authorization|cookie|set-cookie|api[_-]?key|private[_-]?key|pickle|ciphertext|plain(text)?|receipt|card[_-]?number|cvv|session/i;
const REDACT = '[REDACTED]';

export function redactValue(key, val) {
  if (val == null) return val;
  if (SENSITIVE_KEY.test(String(key || ''))) return REDACT;
  if (typeof val === 'string' && val.length > 16 && /^(na_|nv_|Bearer\s)/i.test(val)) return REDACT;
  return val;
}

export function redact(input, depth = 0) {
  if (input == null || depth > 6) return input;
  if (typeof input === 'string') {
    return input.replace(/(password|token|secret|authorization|ciphertext|pickle)\s*[:=]\s*([^\s&]+)/gi, (_, k) => k + '=' + REDACT);
  }
  if (Array.isArray(input)) return input.map(v => redact(v, depth + 1));
  if (typeof input === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(input)) {
      if (SENSITIVE_KEY.test(k)) out[k] = REDACT;
      else if (v && typeof v === 'object') out[k] = redact(v, depth + 1);
      else out[k] = v;
    }
    return out;
  }
  return input;
}

export function slog(level, msg, fields = {}) {
  const row = {ts: new Date().toISOString(), level, msg, ...redact(fields)};
  const line = JSON.stringify(row);
  if (level === 'error' || level === 'alert') console.error(line);
  else console.log(line);
  return row;
}

/** 可信代理下取客户端 IP。默认不信任 X-Forwarded-For（防伪造）。 */
export function clientIp(req, {trustProxy = false, trustedProxies = []} = {}) {
  const peer = (req.socket && (req.socket.remoteAddress || req.socket.remoteFamily)) || '';
  if (!trustProxy) return peer || '';
  const list = Array.isArray(trustedProxies) ? trustedProxies : String(trustedProxies || '').split(',').map(s => s.trim()).filter(Boolean);
  if (list.length && peer && !list.includes(peer) && !list.includes('*')) return peer;
  const xff = String((req.headers && (req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For'])) || '');
  if (!xff) {
    const real = req.headers && (req.headers['x-real-ip'] || req.headers['X-Real-IP']);
    return real ? String(real).trim() : peer;
  }
  const parts = xff.split(',').map(s => s.trim()).filter(Boolean);
  // 单一受信反代：取链上最左边（原始客户端）
  return parts[0] || peer;
}

export function forwardedProto(req, {trustProxy = false} = {}) {
  if (!trustProxy) return (req.socket && req.socket.encrypted) ? 'https' : 'http';
  const p = req.headers && (req.headers['x-forwarded-proto'] || req.headers['X-Forwarded-Proto']);
  if (p) return String(p).split(',')[0].trim().toLowerCase();
  return (req.socket && req.socket.encrypted) ? 'https' : 'http';
}

export function securityHeaders({hsts = false, html = false, connectSrc} = {}) {
  const cspHtml = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    "connect-src 'self'" + (connectSrc ? ' ' + connectSrc : ''),
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; ');
  const cspApi = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";
  const h = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': html ? cspHtml : cspApi,
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'X-DNS-Prefetch-Control': 'off',
  };
  if (hsts) h['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return h;
}

export function parseCookies(req) {
  const raw = String((req.headers && req.headers.cookie) || '');
  const out = {};
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  }
  return out;
}

export function cookieHeader(name, value, {maxAge, httpOnly, secure, sameSite = 'Lax', path = '/', expires} = {}) {
  let s = name + '=' + encodeURIComponent(value) + '; Path=' + path + '; SameSite=' + sameSite;
  if (httpOnly) s += '; HttpOnly';
  if (secure) s += '; Secure';
  if (maxAge != null) s += '; Max-Age=' + Math.floor(maxAge);
  if (expires) s += '; Expires=' + expires;
  return s;
}

export function clearCookie(name, opts = {}) {
  return cookieHeader(name, '', {...opts, maxAge: 0, expires: 'Thu, 01 Jan 1970 00:00:00 GMT'});
}

const SESSION_COOKIE = 'nova_session';
const CSRF_COOKIE = 'nova_csrf';
const SAFE_METHOD = /^(GET|HEAD|OPTIONS)$/i;

export function newCsrf() { return randomBytes(24).toString('base64url'); }

export function cookieAuth(req, {secure = false} = {}) {
  const cookies = parseCookies(req);
  return {token: cookies[SESSION_COOKIE] || '', csrf: cookies[CSRF_COOKIE] || '', cookies};
}

export function assertCsrf(req, csrf) {
  const sent = String(req.headers['x-csrf-token'] || req.headers['x-csrf'] || (req.body && req.body._csrf) || '');
  if (!csrf || !sent) throw new ApiError(403, 'CSRF', '缺少 CSRF 令牌');
  const a = Buffer.from(sent), b = Buffer.from(csrf);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ApiError(403, 'CSRF', 'CSRF 令牌无效');
}

export function needsCsrf(req) { return !SAFE_METHOD.test(req.method || 'GET'); }

export function sessionCookies(token, csrf, {secure = false, maxAge = 30 * 86400} = {}) {
  return [
    cookieHeader(SESSION_COOKIE, token, {httpOnly: true, secure, sameSite: 'Lax', maxAge, path: '/'}),
    cookieHeader(CSRF_COOKIE, csrf, {httpOnly: false, secure, sameSite: 'Lax', maxAge, path: '/'}),
  ];
}

export function clearSessionCookies({secure = false} = {}) {
  return [
    clearCookie(SESSION_COOKIE, {httpOnly: true, secure, sameSite: 'Lax', path: '/'}),
    clearCookie(CSRF_COOKIE, {httpOnly: false, secure, sameSite: 'Lax', path: '/'}),
  ];
}

const DEFAULT_LIMITS = {
  lenient: {
    register: {n: 500, window: 3600e3},
    login: {n: 500, window: 900e3},
    report: {n: 200, window: 3600e3},
    upload: {n: 200, window: 3600e3},
    post: {n: 500, window: 3600e3},
    message: {n: 600, window: 60e3},
    appeal: {n: 60, window: 3600e3},
    global: {n: 20000, window: 60e3},
    highFreq: 15000,
  },
  strict: {
    register: {n: 8, window: 3600e3},
    login: {n: 30, window: 900e3},
    report: {n: 20, window: 3600e3},
    upload: {n: 40, window: 3600e3},
    post: {n: 60, window: 3600e3},
    message: {n: 120, window: 60e3},
    appeal: {n: 8, window: 3600e3},
    global: {n: 300, window: 60e3},
    highFreq: 180,
  },
};

export function createRateLimit({now = Date.now, onEvent, mode = 'lenient'} = {}) {
  const limits = DEFAULT_LIMITS[mode] || DEFAULT_LIMITS.lenient;
  const buckets = new Map(); // key -> {t: number[], lastEvent}
  function prune(arr, window) {
    const cut = now() - window;
    while (arr.length && arr[0] < cut) arr.shift();
  }
  function hit(key, n, window) {
    let b = buckets.get(key);
    if (!b) { b = {t: [], lastEvent: 0}; buckets.set(key, b); }
    prune(b.t, window);
    if (b.t.length >= n) return {ok: false, retryAfter: Math.ceil((b.t[0] + window - now()) / 1000), count: b.t.length};
    b.t.push(now());
    return {ok: true, count: b.t.length};
  }
  function check(kind, id, path) {
    const lim = limits[kind] || limits.global;
    const r = hit(kind + ':' + id, lim.n, lim.window);
    if (!r.ok) {
      if (onEvent) onEvent({kind: 'rate_limit', severity: 'warn', path, detail: {bucket: kind, id, count: r.count}});
      const err = new ApiError(429, 'RATE_LIMIT', '请求过于频繁，请稍后再试', {retryAfter: r.retryAfter, bucket: kind});
      throw err;
    }
    const g = hit('global:' + id, limits.global.n, limits.global.window);
    if (!g.ok) {
      if (onEvent) onEvent({kind: 'rate_limit', severity: 'warn', path, detail: {bucket: 'global', id, count: g.count}});
      throw new ApiError(429, 'RATE_LIMIT', '请求过于频繁，请稍后再试', {retryAfter: g.retryAfter, bucket: 'global'});
    }
    if (g.count >= limits.highFreq) {
      const b = buckets.get('global:' + id);
      if (!b || now() - (b.lastEvent || 0) > 60e3) {
        if (b) b.lastEvent = now();
        if (onEvent) onEvent({kind: 'high_frequency', severity: 'warn', path, detail: {id, count: g.count, windowMs: limits.global.window}});
      }
    }
    return r;
  }
  function snapshot() { return {mode, buckets: buckets.size, limits}; }
  return {check, hit, snapshot, limits, mode};
}

export function createSecurityEvents(db, {now = Date.now} = {}) {
  const ins = db.prepare('INSERT INTO security_events(at,kind,severity,ip,actor_id,path,detail) VALUES(?,?,?,?,?,?,?)');
  const list = db.prepare('SELECT * FROM security_events WHERE (? IS NULL OR kind=?) AND (? IS NULL OR id<?) ORDER BY id DESC LIMIT ?');
  function record({kind, severity = 'info', ip, actorId, path, detail} = {}) {
    const r = ins.run(now(), String(kind || 'event').slice(0, 80), String(severity).slice(0, 16),
      ip || null, actorId || null, path ? String(path).slice(0, 200) : null,
      detail ? JSON.stringify(redact(detail)).slice(0, 4000) : null);
    return {id: Number(r.lastInsertRowid)};
  }
  function listEvents(q = {}) {
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
    const kind = q.kind ? String(q.kind) : null;
    const cursor = q.cursor != null && q.cursor !== '' ? Number(q.cursor) : null;
    const rows = list.all(kind, kind, cursor, cursor, limit + 1);
    const more = rows.length > limit;
    const slice = more ? rows.slice(0, limit) : rows;
    return {
      events: slice.map(r => ({
        id: String(r.id), kind: r.kind, severity: r.severity, ip: r.ip || '',
        actorId: r.actor_id, path: r.path, time: r.at, at: r.at,
        detail: r.detail ? (() => { try { return JSON.parse(r.detail); } catch { return r.detail; } })() : null,
      })),
      nextCursor: more ? slice[slice.length - 1].id : null,
    };
  }
  return {record, listEvents};
}

/** 按文件头判断类型，不只看扩展名或声明的 MIME。 */
export function sniffMagic(buf) {
  if (!buf || !buf.length) return {kind: null, mime: null};
  const b = buf;
  const at = (i, ...xs) => xs.every((x, j) => b[i + j] === x);
  const str = (i, s) => s.split('').every((c, j) => b[i + j] === c.charCodeAt(0));
  if (at(0, 0xff, 0xd8, 0xff)) return {kind: 'image', mime: 'image/jpeg'};
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return {kind: 'image', mime: 'image/png'};
  if (str(0, 'GIF87a') || str(0, 'GIF89a')) return {kind: 'image', mime: 'image/gif'};
  if (str(0, 'RIFF') && str(8, 'WEBP')) return {kind: 'image', mime: 'image/webp'};
  if (str(0, '%PDF')) return {kind: 'file', mime: 'application/pdf'};
  if (at(0, 0x50, 0x4b, 0x03, 0x04) || at(0, 0x50, 0x4b, 0x05, 0x06)) return {kind: 'file', mime: 'application/zip'};
  if (str(0, 'ftyp') || (b.length > 8 && str(4, 'ftyp'))) {
    // mp4 / qt / m4a
    const brand = b.slice(8, 12).toString('ascii');
    if (/mp4|isom|iso2|avc1|dash|msnv|ndas|ndsc|mmp4/i.test(brand)) return {kind: 'video', mime: 'video/mp4'};
    if (/M4A|M4B|M4P/i.test(brand)) return {kind: 'audio', mime: 'audio/mp4'};
    return {kind: 'video', mime: 'video/mp4'};
  }
  if (str(0, '\x1aE\xdf\xa3') || (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3)) return {kind: 'video', mime: 'video/webm'};
  if (str(0, 'OggS')) return {kind: 'audio', mime: 'audio/ogg'};
  if (at(0, 0x49, 0x44, 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return {kind: 'audio', mime: 'audio/mpeg'};
  if (str(0, 'RIFF') && str(8, 'WAVE')) return {kind: 'audio', mime: 'audio/wav'};
  // 纯文本：可打印 + 换行，给 text/plain 用
  if (b.length && b.every(c => c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127) || c >= 128)) {
    return {kind: 'file', mime: 'text/plain', weak: true};
  }
  return {kind: null, mime: null};
}

export function assertMagic(buffer, claimedKind, claimedMime) {
  const sniff = sniffMagic(buffer);
  const kind = claimedKind;
  const mime = String(claimedMime || '').toLowerCase().split(';')[0].trim();
  if (kind === 'image') {
    if (sniff.kind !== 'image') throw new ApiError(400, 'BAD_TYPE', '文件内容与声明的图片类型不符');
    return sniff;
  }
  if (kind === 'video') {
    if (sniff.kind !== 'video' && sniff.kind !== 'audio') throw new ApiError(400, 'BAD_TYPE', '文件内容与声明的视频类型不符');
    return sniff;
  }
  if (kind === 'audio') {
    if (sniff.kind !== 'audio' && sniff.mime !== 'video/webm') throw new ApiError(400, 'BAD_TYPE', '文件内容与声明的音频类型不符');
    return sniff;
  }
  // 通用文件：若自称 pdf/zip 必须匹配；html/js 伪装成图片已在上面拒绝
  if (mime === 'application/pdf' && sniff.mime !== 'application/pdf') {
    throw new ApiError(400, 'BAD_TYPE', '文件内容不是 PDF');
  }
  if ((mime === 'application/zip' || mime === 'application/x-zip-compressed') && sniff.mime !== 'application/zip') {
    throw new ApiError(400, 'BAD_TYPE', '文件内容不是 ZIP');
  }
  // 拒绝把 HTML / 脚本当作可执行图片已经处理；再拒绝明显的 HTML 头当任意文件上传为图片类
  if (buffer && buffer.length >= 8) {
    const head = buffer.slice(0, 64).toString('utf8').toLowerCase();
    if (kind === 'image' || kind === 'video') {
      if (/^\s*<(!doctype\s+html|html|script|svg)/.test(head)) {
        throw new ApiError(400, 'BAD_TYPE', '文件内容与声明的类型不符');
      }
    }
  }
  return sniff;
}

export function lockBackoffMs(locks, baseMs) {
  const n = Math.max(1, Number(locks) || 1);
  return baseMs * Math.pow(2, Math.min(n - 1, 4)); // 1x,2x,4x,8x,16x
}

export {SESSION_COOKIE, CSRF_COOKIE, DEFAULT_LIMITS};
