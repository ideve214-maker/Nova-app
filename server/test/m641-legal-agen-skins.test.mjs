// 法律文档、注册同意、版本接口、管理端 createdAtUtc / 显示名、皮肤注册表。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';
import {legalDoc, legalConfig, LEGAL_DEFAULTS} from '../legal.mjs';
import {appVersion} from '../version.mjs';

let srv, base, seq = 0, adminTok;
test.before(async () => {
  srv = createApp({adminUsername: 'ops_m641', adminPassword: 'OpsM641Pass1'});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  const login = await call('POST', '/api/admin/auth/login', {username: 'ops_m641', password: 'OpsM641Pass1'});
  adminTok = login.j.token;
});
test.after(() => srv.close());

const call = async (m, p, body, tok) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  const ct = r.headers.get('content-type') || '';
  const text = await r.text();
  const j = ct.includes('json') && text ? JSON.parse(text) : null;
  return {s: r.status, j, text, headers: r.headers, ct};
};

test('配置默认值即运营者信息，渲染后无占位符', () => {
  const cfg = legalConfig({});
  assert.equal(cfg.operatorName, 'Sterling ideve');
  assert.equal(cfg.contactEmail, 'ideve217@gmail.com');
  assert.equal(cfg.effectiveDate, '2026年11月20日');
  assert.equal(LEGAL_DEFAULTS.operatorName, cfg.operatorName);
  for (const kind of ['privacy', 'terms']) {
    const d = legalDoc(kind, {});
    assert.match(d.body, /Sterling ideve/);
    assert.match(d.body, /ideve217@gmail.com/);
    assert.match(d.body, /2026年11月20日/);
    assert.equal(d.operatorName, 'Sterling ideve');
    assert.doesNotMatch(d.body, /\{\{|\}\}|【运营者|【联系|【生效|草案|不构成法律意见|reviewRequired/);
    assert.doesNotMatch(d.title, /草案/);
  }
});

test('GET /api/legal 与 /legal 页面为正式文档，不含草案字样', async () => {
  for (const kind of ['privacy', 'terms']) {
    const api = await call('GET', '/api/legal/' + kind);
    assert.equal(api.s, 200, api.text);
    assert.equal(api.j.reviewRequired, undefined);
    assert.equal(api.j.disclaimer, undefined);
    assert.match(api.j.body, /Sterling ideve/);
    assert.match(api.j.body, /ideve217@gmail.com/);
    assert.match(api.j.body, /2026年11月20日/);
    assert.ok(api.j.version);
    const page = await fetch(base + '/legal/' + kind);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.match(html, /Sterling ideve/);
    assert.match(html, /ideve217@gmail.com/);
    assert.match(html, /2026年11月20日/);
    assert.doesNotMatch(html, /草案|不构成法律意见|\{\{/);
  }
});

test('注册必须同意协议并记录版本；拒绝则 400', async () => {
  const u = 'ag' + (++seq);
  const no = await call('POST', '/api/auth/register', {username: u, email: u + '@x.test', password: 'Passw0rd123'});
  assert.equal(no.s, 400);
  assert.equal(no.j.error.code, 'AGREE_REQUIRED');
  const no2 = await call('POST', '/api/auth/register', {username: u, email: u + '@x.test', password: 'Passw0rd123', agree: false});
  assert.equal(no2.s, 400);
  const ok = await call('POST', '/api/auth/register', {username: u, email: u + '@x.test', password: 'Passw0rd123', agree: true});
  assert.equal(ok.s, 200, ok.text);
  assert.equal(ok.j.legalVersion, legalConfig().version);
  assert.equal(ok.j.user.legalVersion, legalConfig().version);
  const row = srv.db.prepare('SELECT legal_version, legal_agreed_at FROM users WHERE id=?').get(ok.j.user.id);
  assert.equal(row.legal_version, legalConfig().version);
  assert.ok(row.legal_agreed_at > 0);
});

test('GET /api/version 与 /api/health 含版本和提交', async () => {
  const v = await call('GET', '/api/version');
  assert.equal(v.s, 200, v.text);
  assert.equal(v.j.version, appVersion().version);
  assert.match(v.j.version, /^\d+\.\d+\.\d+/);
  if (v.j.commit) assert.match(v.j.commit, /^[0-9a-f]{7,40}$/);
  const h = await call('GET', '/api/health');
  assert.equal(h.s, 200);
  assert.equal(h.j.status, 'ok');
  assert.equal(h.j.version, v.j.version);
  assert.equal(h.j.commit, v.j.commit);
});

test('管理端动态和公告含 ISO createdAtUtc', async () => {
  const u = 'ap' + (++seq);
  const acc = await call('POST', '/api/auth/register', {username: u, email: u + '@x.test', password: 'Passw0rd123', agree: true});
  const post = await call('POST', '/api/posts', {text: '管理端时间字段'}, acc.j.token);
  assert.equal(post.s, 200, post.text);
  const id = post.j.post.id;
  const one = await call('GET', '/api/admin/content/post/' + id, null, adminTok);
  assert.equal(one.s, 200, one.text);
  const item = one.j.item || one.j.post;
  assert.ok(item);
  assert.equal(typeof item.createdAt, 'number');
  assert.equal(item.createdAtUtc, new Date(item.createdAt).toISOString());
  assert.match(item.createdAtUtc, /Z$/);
  const add = await call('POST', '/api/admin/announcements', {title: '维护窗口', body: '今晚维护'}, adminTok);
  assert.equal(add.s, 200, add.text);
  const ann = (add.j.announcement) || (add.j.announcements || []).find(x => x.title === '维护窗口');
  assert.ok(ann, JSON.stringify(add.j));
  assert.equal(typeof ann.createdAt, 'number');
  assert.equal(ann.createdAtUtc, new Date(ann.createdAt).toISOString());
  assert.match(ann.createdAtUtc, /Z$/);
});

test('频道消息 author.displayName：有显示名用显示名，否则回退用户名；管理端同样', async () => {
  const u = 'ch' + (++seq);
  const acc = await call('POST', '/api/auth/register', {username: u, email: u + '@x.test', password: 'Passw0rd123', agree: true});
  const c = (await call('POST', '/api/communities', {name: '显示名社区'}, acc.j.token)).j.community;
  const hall = c.channels.find(ch => ch.isDefault) || c.channels[0];
  const sent = await call('POST', '/api/channels/' + hall.id + '/messages', {text: '你好'}, acc.j.token);
  assert.equal(sent.s, 200, sent.text);
  assert.equal(sent.j.message.author.username, u);
  assert.equal(sent.j.message.author.displayName, u, '未设显示名时应回退用户名，不能为空');
  assert.ok(String(sent.j.message.author.displayName).trim());
  const list = await call('GET', '/api/channels/' + hall.id + '/messages', null, acc.j.token);
  const m = (list.j.messages || []).find(x => x.text === '你好');
  assert.equal(m.author.displayName, u);
  const adminL = await call('GET', '/api/admin/channels/' + hall.id + '/messages', null, adminTok);
  assert.equal(adminL.s, 200, adminL.text);
  const am = (adminL.j.messages || []).find(x => x.text === '你好');
  assert.ok(am, JSON.stringify(adminL.j));
  assert.equal(am.author.displayName, u);
  await call('POST', '/api/me', {displayName: '星澜用户'}, acc.j.token);
  const sent2 = await call('POST', '/api/channels/' + hall.id + '/messages', {text: '第二句'}, acc.j.token);
  const dn = sent2.j.message.author.displayName;
  assert.ok(dn === '星澜用户' || dn === u, '显示名应取资料或回退用户名，得到 ' + dn);
});

test('皮肤注册表与资源可被静态访问；默认是星澜', async () => {
  const idx = await call('GET', '/assets/skins/index.json');
  assert.equal(idx.s, 200, idx.text);
  assert.equal(idx.j.defaultSkin, 'starlight');
  const ids = (idx.j.skins || []).map(s => s.id);
  assert.ok(ids.includes('starlight') && ids.includes('nova') && ids.includes('xinglan') && ids.includes('default'));
  const meta = await call('GET', '/assets/skins/xinglan/skin.json');
  assert.equal(meta.s, 200);
  assert.equal(meta.j.id, 'xinglan');
  const css = await fetch(base + '/assets/skins/xinglan/skin.css');
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /css/);
  const def = await fetch(base + '/assets/skins/default/skin.css');
  assert.equal(def.status, 200);
  const icon = await fetch(base + '/assets/skins/xinglan/icons/home.svg');
  assert.equal(icon.status, 200);
  const u = 'sk' + (++seq);
  const acc = await call('POST', '/api/auth/register', {username: u, email: u + '@x.test', password: 'Passw0rd123', agree: true});
  const set = await call('POST', '/api/me/prefs', {skin: 'default'}, acc.j.token);
  assert.equal(set.s, 200, set.text);
  assert.equal(set.j.skin, 'default');
  const bad = await call('POST', '/api/me/prefs', {skin: '../etc'}, acc.j.token);
  assert.equal(bad.s, 400);
});
