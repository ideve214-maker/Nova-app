// 服务端 2.1.0：全站 AI 模型设置（/api/admin/ai/model）、私聊文件 / 视频类型、外部帖头像返回完整地址。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createApp} from '../index.mjs';
import {zhipuThinkingExtras, minTokensFor, DEFAULT_AI_MODEL} from '../ai-model.mjs';
import {sniffMagic} from '../security.mjs';
import {extAuthorPayload, setImportPublicOrigin} from '../import-feed.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X89QAAAAASUVORK5CYII=', 'base64');

async function boot(opts = {}, env = {AI_API_KEY: 'test-key-not-real', AI_RPM: '1000', AI_RPD: '100000'}) {
  const seen = [];
  const aiFetch = async (url, opt) => {
    const body = JSON.parse(opt.body);
    seen.push({url: String(url), model: body.model, thinking: body.thinking, max_tokens: body.max_tokens});
    const sys = String((body.messages[0] || {}).content || '');
    const content = /blocked/.test(sys) ? '{"blocked":[]}' : (body.response_format ? '{"verdict":"allow","text":"hi","translation":"hi"}' : '你好');
    return Response.json({choices: [{message: {role: 'assistant', content}}], usage: {prompt_tokens: 1, completion_tokens: 1, total_tokens: 2}});
  };
  const dir = mkdtempSync(join(tmpdir(), 'nova-m39-'));
  const srv = createApp({adminUsername: 'ops_m39', adminPassword: 'OpsM39Pass1!', aiEnv: env, aiFetch, mediaDir: join(dir, 'media'), importAuto: false, importDelayMs: 0, ...opts});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const call = async (m, p, body, tok) => {
    const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
    let j = null; try { j = await r.json(); } catch {}
    return {s: r.status, j};
  };
  const adm = (await call('POST', '/api/admin/auth/login', {username: 'ops_m39', password: 'OpsM39Pass1!'})).j.token;
  let seq = 0;
  const user = async () => { const u = 'm39u' + (++seq); const r = await call('POST', '/api/auth/register', {agree: true, username: u, email: u + '@x.test', password: 'Passw0rd123'}); return r.j.token; };
  const close = () => new Promise(r => { srv.close(r); srv.closeAllConnections?.(); });
  return {srv, base, call, adm, user, seen, dir, close, db: srv.db};
}

test('AI 模型设置：默认 glm-4.7-flash；保存后审查 / 助手 / 运营日报 / 额度与接口列表都用新模型；校验、权限、审计', async () => {
  const b = await boot();
  try {
    const g0 = await b.call('GET', '/api/admin/ai/model', null, b.adm);
    assert.equal(g0.s, 200);
    assert.equal(g0.j.model, 'glm-4.7-flash'); assert.equal(g0.j.provider, 'zhipu'); assert.equal(g0.j.saved, false);
    assert.equal(DEFAULT_AI_MODEL, 'glm-4.7-flash');
    assert.equal((await b.call('GET', '/api/admin/ai/model')).s, 401, '要管理员登录');
    for (const bad of ['deepseek-chat', 'a b', '<script>', 'x'.repeat(81)]) {
      const r = await b.call('POST', '/api/admin/ai/model', {provider: 'zhipu', model: bad}, b.adm);
      assert.equal(r.s, 400, bad); assert.equal(r.j.error.code, 'BAD_MODEL');
    }
    const s1 = await b.call('POST', '/api/admin/ai/model', {provider: 'zhipu', model: 'glm-5.3-flash'}, b.adm);
    assert.equal(s1.s, 200, JSON.stringify(s1.j));
    assert.deepEqual([s1.j.provider, s1.j.model, s1.j.saved], ['zhipu', 'glm-5.3-flash', true]);
    assert.equal((await b.call('GET', '/api/admin/ai/model', null, b.adm)).j.model, 'glm-5.3-flash');
    // 审计
    assert.equal(b.db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='admin.ai.model'").get().n, 1);
    // AI 审查
    const mod = await b.call('GET', '/api/admin/ai-moderation', null, b.adm);
    assert.equal(mod.j.settings.model, 'glm-5.3-flash');
    b.seen.length = 0;
    await b.call('POST', '/api/admin/ai-moderation/test', {text: '今天天气不错'}, b.adm);
    assert.ok(b.seen.length >= 1 && b.seen.every(x => x.model === 'glm-5.3-flash'), JSON.stringify(b.seen));
    assert.ok(b.seen[0].max_tokens >= 4096, 'GLM-5.x 只能开思考，max_tokens 要留够');
    assert.equal(b.seen[0].thinking, undefined, 'GLM-5.x 不发 thinking:disabled');
    // 批量审查（外部帖）
    b.seen.length = 0;
    const cm = await b.srv.aiReview.reviewImport({post: {source: 'v2ex', sourceId: 'x1', text: 'hello'}, comments: []});
    assert.ok(cm.ok, JSON.stringify(cm));
    assert.equal(b.seen[0].model, 'glm-5.3-flash');
    // 额度卡片 / 接口列表：服务器默认（智谱）显示设置里的模型
    const pv = await b.call('GET', '/api/admin/ai/providers', null, b.adm);
    assert.equal(pv.s, 200);
    const envP = pv.j.providers.find(p => p.id === 'env');
    assert.equal(envP.model, 'glm-5.3-flash');
    assert.equal(pv.j.types.find(t => t.type === 'zhipu').model, 'glm-5.3-flash');
    const qv = await b.call('GET', '/api/admin/ai/quota', null, b.adm);
    if (qv.s === 200) assert.doesNotMatch(JSON.stringify(qv.j), /glm-4-flash"/);
    // 运营日报
    const rp = await b.call('GET', '/api/admin/ai-assistant/report', null, b.adm);
    assert.equal(rp.j.model, 'glm-5.3-flash');
    // 用户端 AI 助手 / 翻译
    const tok = await b.user();
    b.seen.length = 0;
    await b.call('POST', '/api/ai/translate', {text: 'hello world'}, tok);
    if (b.seen.length) assert.equal(b.seen[0].model, 'glm-5.3-flash');
    // 改回 4.7：关思考
    await b.call('POST', '/api/admin/ai/model', {provider: 'zhipu', model: 'glm-4.7-flash'}, b.adm);
    b.seen.length = 0;
    await b.call('POST', '/api/admin/ai-moderation/test', {text: '再测一次'}, b.adm);
    assert.equal(b.seen[0].model, 'glm-4.7-flash');
    assert.deepEqual(b.seen[0].thinking, {type: 'disabled'});
    // 清除设置 → 回默认
    const clr = await b.call('POST', '/api/admin/ai/model', {model: ''}, b.adm);
    assert.equal(clr.j.saved, false); assert.equal(clr.j.model, 'glm-4.7-flash');
  } finally { await b.close(); }
});

test('AI 模型：thinking / max_tokens 规则；.env 的 AI_MODEL 在没保存设置时仍生效', async () => {
  assert.deepEqual(zhipuThinkingExtras('glm-4.7-flash', 'https://open.bigmodel.cn/api/paas/v4'), {thinking: {type: 'disabled'}});
  assert.deepEqual(zhipuThinkingExtras('glm-5.3-flash', 'https://open.bigmodel.cn/api/paas/v4'), {});
  assert.deepEqual(zhipuThinkingExtras('glm-4.7-flash', 'https://api.openai.com/v1'), {});
  assert.equal(minTokensFor('glm-5.3-flash', 300), 4096);
  assert.equal(minTokensFor('glm-4.7-flash', 300), 300);
  const b = await boot({}, {AI_API_KEY: 'k-not-real', AI_MODEL: 'glm-4-flash-250414', AI_RPM: '1000', AI_RPD: '100000'});
  try {
    const g = await b.call('GET', '/api/admin/ai/model', null, b.adm);
    assert.equal(g.j.model, 'glm-4-flash-250414'); assert.equal(g.j.source, 'env');
    await b.call('POST', '/api/admin/ai/model', {model: 'glm-5.3-flash'}, b.adm);
    b.seen.length = 0;
    await b.call('POST', '/api/admin/ai-moderation/test', {text: '测试'}, b.adm);
    assert.equal(b.seen[0].model, 'glm-5.3-flash', '管理端设置优先于 .env');
  } finally { await b.close(); }
});

test('私聊文件：doc（OLE）/ docx（ZIP）/ xlsx / pdf 可发；手机给 octet-stream 且没扩展名也能识别；伪造的 docx、可执行文件拒收；HTML 不按 text/html 存', async () => {
  const b = await boot();
  try {
    const tok = await b.user();
    const up = async (buf, name, mime) => {
      const r = await fetch(b.base + '/api/media', {method: 'POST', headers: {Authorization: 'Bearer ' + tok, 'Content-Type': mime, 'X-File-Name': encodeURIComponent(name)}, body: buf});
      return {s: r.status, j: await r.json()};
    };
    const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504)]);
    const docx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(26), Buffer.from('[Content_Types].xml'), Buffer.alloc(20), Buffer.from('word/document.xml')]);
    const xlsx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(26), Buffer.from('[Content_Types].xml xl/workbook.xml')]);
    assert.equal(sniffMagic(docx).office, 'docx');
    assert.ok(sniffMagic(ole).ole);
    const cases = [
      [ole, '报告.doc', 'application/msword'],
      [ole, '报告.doc', 'application/octet-stream'],
      [ole, '旧表.xls', 'application/vnd.ms-excel'],
      [docx, '方案.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      [docx, '方案.docx', ''],
      [docx, '方案.docx', 'application/wps-office.docx'],
      [docx, 'document:1234', 'application/octet-stream'],
      [ole, 'document:5678', 'application/octet-stream'],
      [xlsx, '表.xlsx', 'application/octet-stream'],
      [Buffer.from('%PDF-1.4\n%xx\n'), 'a.pdf', 'application/pdf'],
    ];
    for (const [buf, name, mime] of cases) {
      const r = await up(buf, name, mime || 'application/octet-stream');
      assert.equal(r.s, 200, name + ' ' + mime + ' ' + JSON.stringify(r.j));
      assert.equal(r.j.media.kind, 'file', name);
    }
    const fake = await up(Buffer.from('not a zip at all'), '假的.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert.equal(fake.s, 400); assert.equal(fake.j.error.code, 'BAD_TYPE');
    const exe = await up(Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100)]), 'setup.txt', 'text/plain');
    assert.equal(exe.s, 400); assert.equal(exe.j.error.code, 'BAD_TYPE');
    const html = await up(Buffer.from('<html><script>alert(1)</script></html>'), 'x.txt', 'text/html');
    assert.equal(html.s, 200);
    const row = b.db.prepare('SELECT mime FROM media WHERE id=?').get(html.j.media.id);
    assert.notEqual(row.mime, 'text/html', '不能按 text/html 存');
  } finally { await b.close(); }
});

test('私聊视频：苹果 .mov（video/quicktime）、安卓 .3gp、老式 QuickTime 头都能上传', async (t) => {
  const ff = spawnSync('ffmpeg', ['-version']);
  if (ff.status !== 0) return t.skip('没有 ffmpeg');
  const b = await boot();
  try {
    const tok = await b.user();
    const mk = (ext, extra = []) => {
      const p = join(b.dir, 'v.' + ext);
      const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=10:duration=2', ...extra, p], {timeout: 30000});
      assert.equal(r.status, 0, String(r.stderr));
      return readFileSync(p);
    };
    const up = async (buf, name, mime) => {
      const r = await fetch(b.base + '/api/media', {method: 'POST', headers: {Authorization: 'Bearer ' + tok, 'Content-Type': mime, 'X-File-Name': encodeURIComponent(name)}, body: buf});
      return {s: r.status, j: await r.json()};
    };
    const mov = mk('mov', ['-c:v', 'mpeg4']);
    let r = await up(mov, 'IMG_0001.MOV', 'video/quicktime');
    assert.equal(r.s, 200, JSON.stringify(r.j)); assert.equal(r.j.media.kind, 'video');
    r = await up(mov, 'IMG_0001.MOV', 'application/octet-stream');
    assert.equal(r.s, 200, JSON.stringify(r.j)); assert.equal(r.j.media.kind, 'video');
    const g3 = mk('3gp', ['-c:v', 'mpeg4']);
    r = await up(g3, 'VID_1.3gp', 'video/3gpp');
    assert.equal(r.s, 200, JSON.stringify(r.j)); assert.equal(r.j.media.kind, 'video');
    // 老式 QuickTime：第一个盒子是 wide
    const old = Buffer.concat([Buffer.from([0, 0, 0, 8]), Buffer.from('wide'), Buffer.from([0, 0, 0, 8]), Buffer.from('mdat'), Buffer.alloc(64)]);
    assert.equal(sniffMagic(old).kind, 'video');
    // 发到私聊
    const tok2 = await b.user();
    const me2 = (await b.call('GET', '/api/me', null, tok2)).j.user;
    const dm = await b.call('POST', '/api/conversations', {kind: 'dm', userId: me2.id}, tok);
    if (dm.s === 200) {
      const sent = await b.call('POST', '/api/conversations/' + dm.j.conversation.id + '/messages', {mediaId: r.j.media.id, clientId: 'm1'}, tok);
      assert.ok([200, 403].includes(sent.s), JSON.stringify(sent.j)); // 403 = 非好友私信限制，与视频无关
    }
  } finally { await b.close(); }
});

test('外部帖头像：配置公网地址后返回完整 URL；旧数据里的远程原图改走代理；代理拉不到时回默认人像而不是 404', async () => {
  const fetchFn = async (url) => {
    const u = String(url);
    if (u.includes('cdn.v2ex.com/ok')) return {ok: true, status: 200, headers: {get: () => 'image/png'}, arrayBuffer: async () => PNG};
    return {ok: false, status: 404, headers: {get: () => ''}, json: async () => ({})};
  };
  const b = await boot({importFetch: fetchFn, publicOrigin: 'http://47.239.0.90/'});
  try {
    const p = extAuthorPayload({source: 'v2ex', ext_author_name: 'alice', ext_author_avatar: '/api/import/avatar?u=' + encodeURIComponent('https://cdn.v2ex.com/ok.png')});
    assert.equal(p.avatar.image, 'http://47.239.0.90/api/import/avatar?u=' + encodeURIComponent('https://cdn.v2ex.com/ok.png'));
    assert.match(p.avatar.path, /^\/api\/import\/avatar\?u=/);
    assert.match(p.avatar.fallback, /^data:image\/svg\+xml/);
    const hn = extAuthorPayload({source: 'hn', ext_author_name: 'pg', ext_author_avatar: null});
    assert.match(hn.avatar.image, /^data:image\/svg\+xml/);
    assert.equal(hn.avatar.letter, 'p');
    const ok = await fetch(b.base + '/api/import/avatar?u=' + encodeURIComponent('https://cdn.v2ex.com/ok.png'));
    assert.equal(ok.status, 200); assert.equal(ok.headers.get('content-type'), 'image/png');
    const miss = await fetch(b.base + '/api/import/avatar?u=' + encodeURIComponent('https://cdn.v2ex.com/missing.png'));
    assert.equal(miss.status, 200); assert.equal(miss.headers.get('content-type'), 'image/svg+xml');
    assert.doesNotMatch(await miss.text(), /\?/);
    // 磁盘缓存
    const files = spawnSync('ls', [join(b.dir, 'import-avatars')], {encoding: 'utf8'}).stdout.trim();
    assert.ok(files.length > 0, '头像写进了磁盘缓存');
  } finally { await b.close(); setImportPublicOrigin(''); }
  // 旧数据回填：库里存的远程原图地址在启动时改成代理地址
  const dir = mkdtempSync(join(tmpdir(), 'nova-m39b-'));
  const dbPath = join(dir, 'x.db');
  const s1 = createApp({dbPath, importAuto: false, mediaDir: join(dir, 'media')});
  const uid = s1.importFeed.ensureUser().id;
  s1.db.prepare("INSERT INTO posts(id,author_id,text,created_at,updated_at,audience,source,source_id,source_url,ext_author_name,ext_author_avatar) VALUES('p_old',?,'旧帖',1,1,'public','v2ex','999','https://www.v2ex.com/t/999','bob','https://cdn.v2ex.com/avatar/bob.png')").run(uid);
  s1.db.prepare("INSERT INTO post_comments(id,post_id,author_id,text,created_at,source,source_id,source_url,ext_author_name,ext_author_avatar) VALUES('c_old','p_old',?,'旧评论',1,'v2ex','9991','https://www.v2ex.com/t/999','carol','//cdn.v2ex.com/avatar/carol.png')").run(uid);
  s1.db.close?.();
  const s2 = createApp({dbPath, importAuto: false, mediaDir: join(dir, 'media')});
  try {
    assert.match(s2.db.prepare("SELECT ext_author_avatar a FROM posts WHERE id='p_old'").get().a, /^\/api\/import\/avatar\?u=https%3A%2F%2Fcdn\.v2ex\.com/);
    assert.match(s2.db.prepare("SELECT ext_author_avatar a FROM post_comments WHERE id='c_old'").get().a, /^\/api\/import\/avatar\?u=https%3A%2F%2Fcdn\.v2ex\.com/);
  } finally { s2.db.close?.(); }
});
