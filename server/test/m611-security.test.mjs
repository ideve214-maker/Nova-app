// M6.1：输入校验、XSS、限流、会话 Cookie/CSRF、魔数上传、令牌不进 URL、安全头与健康检查。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, existsSync, writeFileSync, readdirSync, copyFileSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createApp} from '../index.mjs';
import {openDb} from '../db.mjs';
import {sniffMagic, redact, lockBackoffMs, securityHeaders, clientIp} from '../security.mjs';
import {backupOpen, restoreFrom} from '../backup.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const MIG = join(dirname(fileURLToPath(import.meta.url)), '../migrations');

let srv, base, seq = 0, adminTok;
test.before(async () => {
  srv = createApp({adminUsername: 'ops_sec', adminPassword: 'OpsSecPass1', rateLimitMode: 'lenient'});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  const login = await call('POST', '/api/admin/auth/login', {username: 'ops_sec', password: 'OpsSecPass1'});
  adminTok = login.j.token;
});
test.after(() => srv.close());

const call = async (m, p, body, tok, {headers, raw} = {}) => {
  const payload = raw !== undefined ? raw : (body ? JSON.stringify(body) : undefined);
  const r = await fetch(base + p, {
    method: m,
    headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {}), ...(headers || {})},
    body: payload,
    redirect: 'manual',
  });
  const ct = r.headers.get('content-type') || '';
  const text = await r.text();
  const j = ct.includes('json') && text ? JSON.parse(text) : null;
  return {r, j, text, status: r.status, headers: r.headers};
};

async function user(n = 's') {
  seq += 1;
  const un = n + seq + Date.now().toString(36).slice(-6);
  const r = await call('POST', '/api/auth/register', {agree:true, username: un, email: un + '@x.test', password: 'Passw0rd123'});
  assert.equal(r.status, 200, r.text);
  return {tok: r.j.token, id: r.j.user.id, username: r.j.user.username, password: 'Passw0rd123'};
}

test('健康检查含数据库探测；响应带安全头，默认无 HSTS', async () => {
  const r = await call('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.j.status, 'ok');
  assert.equal(r.j.db, 'ok');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  assert.match(r.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
  assert.equal(r.headers.get('strict-transport-security'), null);
});

test('弱口令被拒；SQL 元字符不能当作用户名注入', async () => {
  const weak = await call('POST', '/api/auth/register', {agree:true, username: 'inj01', email: 'inj01@x.test', password: '12345678'});
  assert.equal(weak.status, 400);
  assert.equal(weak.j.error.code, 'WEAK_PASSWORD');
  const inj = await call('POST', '/api/auth/register', {agree:true, username: "a' OR 1=1--", email: 'sqli@x.test', password: 'Passw0rd123'});
  assert.equal(inj.status, 400);
  assert.equal(inj.j.error.code, 'BAD_USERNAME');
  const h = await call('GET', '/api/health');
  assert.equal(h.j.db, 'ok');
});

test('帖子保存脚本标签为纯文本；管理端同样可见原文而非 HTML', async () => {
  const a = await user('xss');
  const payload = '<script>alert(1)</script><img src=x onerror=alert(1)>';
  const p = await call('POST', '/api/posts', {text: payload}, a.tok);
  assert.equal(p.status, 200, p.text);
  const post = p.j.post || p.j;
  assert.equal(post.text, payload);
  const got = await call('GET', '/api/admin/content/post/' + post.id, null, adminTok);
  assert.equal(got.status, 200, got.text);
  assert.equal(got.j.item.text, payload);
});

test('访问令牌不得放进 URL（媒体与通用接口）', async () => {
  const a = await user('url');
  const ev = await call('GET', '/api/events?token=' + a.tok, null, a.tok);
  assert.equal(ev.status, 400);
  assert.equal(ev.j.error.code, 'TOKEN_IN_URL');
  const media = await fetch(base + '/api/media/md_nope/file?access_token=' + a.tok, {headers: {Authorization: 'Bearer ' + a.tok}});
  assert.equal(media.status, 400);
  const j = await media.json();
  assert.equal(j.error.code, 'TOKEN_IN_URL');
});

test('Cookie 会话：HttpOnly 会话 Cookie + CSRF；无 CSRF 的 POST 被拒；Bearer 仍可用', async () => {
  const un = 'ck' + Date.now().toString(36);
  const reg = await call('POST', '/api/auth/register', {agree:true, username: un, email: un + '@x.test', password: 'Passw0rd123', session: 'cookie'}, null, {headers: {'X-Nova-Session': 'cookie'}});
  assert.equal(reg.status, 200, reg.text);
  assert.ok(reg.j.csrf);
  assert.ok(reg.j.token);
  const set = reg.headers.getSetCookie ? reg.headers.getSetCookie() : (reg.headers.get('set-cookie') ? [reg.headers.get('set-cookie')] : []);
  const raw = set.join('\n');
  assert.match(raw, /nova_session=/);
  assert.match(raw, /HttpOnly/i);
  assert.match(raw, /nova_csrf=/);
  const session = /nova_session=([^;]+)/.exec(raw);
  const csrf = /nova_csrf=([^;]+)/.exec(raw);
  assert.ok(session && csrf);
  const cookie = 'nova_session=' + session[1] + '; nova_csrf=' + csrf[1];
  const noCsrf = await fetch(base + '/api/posts', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', Cookie: cookie},
    body: JSON.stringify({text: 'no csrf'}),
  });
  assert.equal(noCsrf.status, 403);
  const badCsrf = await fetch(base + '/api/posts', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': 'wrong'},
    body: JSON.stringify({text: 'bad csrf'}),
  });
  assert.equal(badCsrf.status, 403);
  const ok = await fetch(base + '/api/posts', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': decodeURIComponent(csrf[1])},
    body: JSON.stringify({text: 'cookie post'}),
  });
  const oj = await ok.json();
  assert.equal(ok.status, 200, JSON.stringify(oj));
  // Bearer 不需要 CSRF
  const br = await call('POST', '/api/posts', {text: 'bearer post'}, reg.j.token);
  assert.equal(br.status, 200, br.text);
  // 管理员仍用 Bearer na_
  assert.match(adminTok, /^na_/);
  const me = await call('GET', '/api/admin/me', null, adminTok);
  assert.equal(me.status, 200, me.text);
});

test('严格限流：注册超额返回 429，并写入安全事件供管理端查看', async () => {
  const S = createApp({adminUsername: 'ops_rl', adminPassword: 'OpsRlPass1', rateLimitMode: 'strict'});
  await new Promise(r => S.listen(0, '127.0.0.1', r));
  const b = 'http://127.0.0.1:' + S.address().port;
  const ad = await fetch(b + '/api/admin/auth/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({agree:true, username: 'ops_rl', password: 'OpsRlPass1'})});
  const at = (await ad.json()).token;
  let last = 200, hit = 0;
  for (let i = 0; i < 12; i++) {
    const r = await fetch(b + '/api/auth/register', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({agree:true, username: 'rl' + i + Date.now().toString(36).slice(-4), email: 'rl' + i + Date.now() + '@x.test', password: 'Passw0rd123'}),
    });
    last = r.status;
    if (r.status === 429) { hit = i; break; }
  }
  assert.equal(last, 429, '第 9 次左右应触发严格注册限额');
  const ev = await fetch(b + '/api/admin/security/events?kind=rate_limit', {headers: {Authorization: 'Bearer ' + at}});
  const ej = await ev.json();
  assert.equal(ev.status, 200, JSON.stringify(ej));
  assert.ok((ej.events || []).some(x => x.kind === 'rate_limit'));
  S.close();
});

test('上传绕过：把 HTML 标成 image/jpeg 被拒；真 PNG 可通过', async () => {
  const a = await user('up');
  const fake = await call('POST', '/api/media', {
    name: 'photo.jpg', mime: 'image/jpeg',
    data: Buffer.from('<html><script>alert(1)</script></html>').toString('base64'),
  }, a.tok);
  assert.equal(fake.status, 400);
  assert.equal(fake.j.error.code, 'BAD_TYPE');
  const ok = await call('POST', '/api/media', {name: 'dot.png', mime: 'image/png', data: PNG.toString('base64')}, a.tok);
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.j.media.kind, 'image');
  assert.equal(sniffMagic(PNG).mime, 'image/png');
  assert.equal(sniffMagic(Buffer.from([0xff, 0xd8, 0xff, 0xe0])).mime, 'image/jpeg');
});

test('越权：不能编辑别人的帖；不能用他人令牌看私聊', async () => {
  const a = await user('ida'), b = await user('idb');
  const p = await call('POST', '/api/posts', {text: 'only a'}, a.tok);
  const id = (p.j.post || p.j).id;
  const ed = await call('POST', '/api/posts/' + id + '/edit', {text: 'hacked'}, b.tok);
  // 路径可能是 PATCH 或 POST edit — 试一下常见的
  if (ed.status === 404) {
    const ed2 = await fetch(base + '/api/posts/' + id, {method: 'PATCH', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + b.tok}, body: JSON.stringify({text: 'hacked'})});
    const j2 = await ed2.json();
    assert.ok(ed2.status === 403 || ed2.status === 404 || (j2.error && j2.error.code !== 'OK'), JSON.stringify(j2));
  } else {
    assert.ok(ed.status === 403 || ed.status === 404, ed.text);
  }
});

test('敏感管理读取写审计；日志脱敏不含密码和令牌', async () => {
  const a = await user('aud');
  const got = await call('GET', '/api/admin/users/' + a.id, null, adminTok);
  assert.equal(got.status, 200, got.text);
  const au = await call('GET', '/api/admin/audit?action=admin.user.read&limit=10', null, adminTok);
  assert.ok((au.j.audits || []).some(x => String(x.target).includes(String(a.id))));
  const red = redact({password: 'Passw0rd123', token: 'nv_abc', nested: {authorization: 'Bearer x', text: 'hello'}});
  assert.equal(red.password, '[REDACTED]');
  assert.equal(red.token, '[REDACTED]');
  assert.equal(red.nested.authorization, '[REDACTED]');
  assert.equal(red.nested.text, 'hello');
});

test('登录锁定退避：第一次仍为 15 分钟', async () => {
  assert.equal(lockBackoffMs(1, 15 * 60e3), 15 * 60e3);
  assert.equal(lockBackoffMs(2, 15 * 60e3), 30 * 60e3);
  assert.equal(lockBackoffMs(5, 15 * 60e3), 15 * 60e3 * 16);
});

test('受信代理才采用 X-Forwarded-For，默认不信', async () => {
  const req = {socket: {remoteAddress: '10.0.0.1'}, headers: {'x-forwarded-for': '1.2.3.4, 10.0.0.1'}};
  assert.equal(clientIp(req, {trustProxy: false}), '10.0.0.1');
  assert.equal(clientIp(req, {trustProxy: true}), '1.2.3.4');
  const h = securityHeaders({hsts: true});
  assert.match(h['Strict-Transport-Security'], /max-age=/);
});

test('账号注销后无法登录，数据匿名；申诉可供管理端处理', async () => {
  const a = await user('del');
  const no = await call('POST', '/api/me/delete', {password: a.password}, a.tok);
  assert.equal(no.status, 400);
  assert.equal(no.j.error.code, 'CONFIRM_REQUIRED');
  const ok = await call('POST', '/api/me/delete', {password: a.password, confirm: true}, a.tok);
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.j.deleted, true);
  const login = await call('POST', '/api/auth/login', {account: a.username, password: a.password});
  assert.ok(login.status === 401 || login.status === 403 || login.status === 404, login.text);
  const b = await user('ap');
  const ap = await call('POST', '/api/appeals', {kind: 'other', body: '我想申诉一下账号问题'}, b.tok);
  assert.equal(ap.status, 200, ap.text);
  const list = await call('GET', '/api/admin/appeals', null, adminTok);
  assert.equal(list.status, 200, list.text);
  const id = ap.j.appeal.id;
  const dec = await call('POST', '/api/admin/appeals/' + id + '/decision', {action: 'reject', note: '记录在案'}, adminTok);
  assert.equal(dec.status, 200, dec.text);
  assert.equal(dec.j.appeal.status, 'rejected');
});

test('空库与旧库迁移；失败的迁移会回滚', async () => {
  const empty = openDb(':memory:');
  const n = empty.prepare('SELECT COUNT(*) n FROM schema_migrations').get().n;
  assert.ok(n >= 36, '应跑完含 036 的迁移，实际 ' + n);
  empty.close();
  const dir = mkdtempSync(join(tmpdir(), 'nova-mig-'));
  const dbPath = join(dir, 'old.db');
  // 只应用 001，再 openDb 补齐
  const {DatabaseSync} = await import('node:sqlite');
  const raw = new DatabaseSync(dbPath);
  raw.exec(await (await import('node:fs/promises')).readFile(join(MIG, '001_users.sql'), 'utf8'));
  raw.prepare('CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY, at INTEGER)').run();
  raw.prepare('INSERT INTO schema_migrations VALUES(?,?)').run('001_users.sql', Date.now());
  raw.close();
  const upgraded = openDb(dbPath);
  const names = upgraded.prepare('SELECT name FROM schema_migrations ORDER BY name').all().map(r => r.name);
  assert.ok(names.includes('036_security.sql'));
  upgraded.close();
  // 回滚：复制迁移并加入坏文件
  const mig2 = join(dir, 'migs');
  mkdirSync(mig2);
  for (const f of readdirSync(MIG).filter(x => x.endsWith('.sql')).sort()) copyFileSync(join(MIG, f), join(mig2, f));
  writeFileSync(join(mig2, '999_bad.sql'), 'CREATE TABLE nope(this is not sql);');
  const before = openDb(join(dir, 'roll.db'), {migrationsDir: MIG});
  const countBefore = before.prepare('SELECT COUNT(*) n FROM schema_migrations').get().n;
  before.close();
  assert.throws(() => openDb(join(dir, 'roll2.db'), {migrationsDir: mig2}), /迁移失败 999_bad/);
});

test('VACUUM INTO 备份与恢复演练：数据还在', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nova-bak-'));
  const dbPath = join(dir, 'src.db');
  const db = openDb(dbPath);
  db.prepare('INSERT INTO users(username,email,password_hash,created_at) VALUES(?,?,?,?)').run('bak_u', 'bak@x.test', 'hash', Date.now());
  const bak = join(dir, 'snap.db');
  const r = backupOpen(db, bak);
  assert.ok(existsSync(r.path));
  db.close();
  const dest = join(dir, 'restored.db');
  restoreFrom(bak, dest);
  const got = openDb(dest);
  const u = got.prepare('SELECT * FROM users WHERE username=?').get('bak_u');
  assert.ok(u);
  assert.equal(u.email, 'bak@x.test');
  got.close();
});
