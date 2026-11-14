// AI 审查（2.0 起只用智谱 AI，glm-4-flash）——用假的 fetch 模拟接口：拦截、放行、标记、限速冷却、超时和没配密钥时退回关键词过滤。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';

let srv, base, seq = 0, adm;
const env = {AI_API_KEY: 'test-key-not-real', AI_RPM: '50'};
let mode = 'ok', calls = [];
async function fakeFetch(url, opt) {
  const body = JSON.parse(opt.body);
  calls.push({url, auth: opt.headers.Authorization, body});
  if (mode === '429') return new Response('{}', {status: 429, headers: {'retry-after': '60'}});
  if (mode === 'timeout') return new Promise((_, rej) => opt.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); }));
  if (mode === 'junk') return Response.json({choices: [{message: {content: 'not json'}}]});
  const text = body.messages[1].content;
  const out = /加微信|赌博/.test(text) ? {verdict: 'block', category: '导流广告', reason: '含站外联系方式'} : {verdict: 'allow', category: '', reason: ''};
  return Response.json({choices: [{message: {content: JSON.stringify(out)}}]});
}
test.before(async () => {
  srv = createApp({adminUsername: 'ops_ai', adminPassword: 'OpsAiPass1!', aiEnv: env, aiFetch: fakeFetch});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  adm = (await call('POST', '/api/admin/auth/login', {username: 'ops_ai', password: 'OpsAiPass1!'})).j.token;
});
test.after(() => srv.close());
const call = async (m, p, body, tok) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  let j = null; try { j = await r.json(); } catch {}
  return {s: r.status, j};
};
async function acc(n) {
  const u = n + (++seq);
  const r = await call('POST', '/api/auth/register', {agree: true, username: u, email: u + '@x.test', password: 'Passw0rd123'});
  return {tok: r.j.token, id: r.j.user.id};
}

test('AI 审查：默认关闭；开启后拦截违规、放行正常；设置和状态不泄露密钥', async () => {
  const u = await acc('aiu');
  assert.equal((await call('POST', '/api/posts', {text: '加微信领福利'}, u.tok)).s, 200, '默认关闭不调用');
  assert.equal(calls.length, 0);
  assert.equal((await call('GET', '/api/admin/ai-moderation', null, u.tok)).s, 403);
  const st = await call('POST', '/api/admin/ai-moderation', {enabled: true, rules: '禁止推销保健品'}, adm);
  assert.equal(st.j.settings.enabled, true);
  assert.equal(st.j.settings.model, 'glm-4-flash');
  assert.equal(st.j.status.provider, 'zhipu');
  assert.equal(st.j.status.keyConfigured, true);
  assert.ok(!JSON.stringify(st.j).includes('test-key-not-real'), '不返回密钥');
  const bad = await call('POST', '/api/posts', {text: '加微信 带你赌博'}, u.tok);
  assert.equal(bad.s, 422);
  assert.equal(bad.j.error.code || bad.j.code, 'AI_REJECTED');
  const c = calls.at(-1);
  assert.equal(c.url, 'https://open.bigmodel.cn/api/paas/v4/chat/completions');
  assert.equal(c.auth, 'Bearer test-key-not-real');
  assert.equal(c.body.model, 'glm-4-flash');
  assert.equal(c.body.temperature, 0);
  assert.equal(c.body.reasoning_effort, undefined);
  assert.equal(c.body.response_format.type, 'json_object');
  assert.match(c.body.messages[0].content, /禁止推销保健品/);
  const ok = await call('POST', '/api/posts', {text: '今天天气真好'}, u.tok);
  assert.equal(ok.s, 200);
  // 编辑也审查
  assert.equal((await call('POST', `/api/posts/${ok.j.post.id}/edit`, {text: '改成加微信'}, u.tok)).s, 422);
  const lg = await call('GET', '/api/admin/ai-moderation?verdict=allow', null, adm);
  assert.equal(lg.j.logs[0].postId, ok.j.post.id);
  assert.equal(lg.j.logs[0].source, 'ai');
  // 测试接口
  const t = await call('POST', '/api/admin/ai-moderation/test', {text: '赌博'}, adm);
  assert.equal(t.j.result.verdict, 'block');
  assert.equal(t.j.result.category, '导流广告');
});

test('AI 审查：仅标记模式不拦截；失败、超时、限速都退回关键词过滤并记录', async () => {
  const u = await acc('aif');
  await call('POST', '/api/admin/ai-moderation', {enabled: true, mode: 'flag', timeoutMs: 1500}, adm);
  const f = await call('POST', '/api/posts', {text: '加微信'}, u.tok);
  assert.equal(f.s, 200);
  const flagged = (await call('GET', '/api/admin/ai-moderation?verdict=flag', null, adm)).j.logs[0];
  assert.equal(flagged.postId, f.j.post.id);
  await call('POST', '/api/admin/ai-moderation', {mode: 'block'}, adm);
  mode = 'junk';
  assert.equal((await call('POST', '/api/posts', {text: '加微信'}, u.tok)).s, 200, '返回格式不对就放行');
  mode = 'timeout';
  assert.equal((await call('POST', '/api/posts', {text: '加微信'}, u.tok)).s, 200, '超时放行');
  let fb = (await call('GET', '/api/admin/ai-moderation?verdict=fallback', null, adm)).j;
  assert.equal(fb.logs[0].error, 'timeout');
  assert.equal(fb.logs[1].error, 'bad_json');
  // 关键词过滤仍然生效
  const bw = await call('POST', '/api/admin/blockwords', {word: '违禁词测试'}, adm);
  if (bw.s === 200) assert.notEqual((await call('POST', '/api/posts', {text: '违禁词测试'}, u.tok)).s, 200);
  mode = '429';
  assert.equal((await call('POST', '/api/posts', {text: '加微信'}, u.tok)).s, 200);
  fb = (await call('GET', '/api/admin/ai-moderation', null, adm)).j;
  assert.ok(fb.status.cooldownUntil, '429 后进入冷却');
  const n = calls.length;
  mode = 'ok';
  assert.equal((await call('POST', '/api/posts', {text: '加微信'}, u.tok)).s, 200, '冷却期间不调用，直接兜底');
  assert.equal(calls.length, n);
  assert.equal(fb.logs[0].error, 'rate_limited');
});

test('AI 审查：没配置 AI_API_KEY / ZHIPU_API_KEY 时不调用，退回关键词过滤', async () => {
  const s2 = createApp({adminUsername: 'ops_ai2', adminPassword: 'OpsAiPass1!', aiEnv: {}, aiFetch: () => { throw new Error('should not call'); }});
  await new Promise(r => s2.listen(0, '127.0.0.1', r));
  const b2 = 'http://127.0.0.1:' + s2.address().port;
  const c2 = async (m, p, body, tok) => { const r = await fetch(b2 + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined}); return {s: r.status, j: await r.json()}; };
  const a = (await c2('POST', '/api/admin/auth/login', {username: 'ops_ai2', password: 'OpsAiPass1!'})).j.token;
  const st = await c2('POST', '/api/admin/ai-moderation', {enabled: true}, a);
  assert.equal(st.j.status.keyConfigured, false);
  const u = (await c2('POST', '/api/auth/register', {agree: true, username: 'nokey1', email: 'nokey1@x.test', password: 'Passw0rd123'})).j.token;
  assert.equal((await c2('POST', '/api/posts', {text: '加微信'}, u)).s, 200);
  const lg = (await c2('GET', '/api/admin/ai-moderation', null, a)).j.logs[0];
  assert.equal(lg.error, 'no_key');
  s2.close();
});

async function mini(aiEnv, fetchImpl, name) {
  const sv = createApp({adminUsername: name, adminPassword: 'OpsAiPass1!', aiEnv, aiFetch: fetchImpl});
  await new Promise(r => sv.listen(0, '127.0.0.1', r));
  const b = 'http://127.0.0.1:' + sv.address().port;
  const c = async (m, p, body, tok) => { const r = await fetch(b + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined}); return {s: r.status, j: await r.json()}; };
  const a = (await c('POST', '/api/admin/auth/login', {username: name, password: 'OpsAiPass1!'})).j.token;
  return {sv, c, a};
}

test('AI 审查：只填 ZHIPU_API_KEY 也能用；AI_API_BASE / AI_MODEL 可在 .env 里换', async () => {
  const seen = [];
  const f = async (url, opt) => { seen.push({url, auth: opt.headers.Authorization, model: JSON.parse(opt.body).model}); return Response.json({choices: [{message: {content: '{"verdict":"allow"}'}}]}); };
  const {sv, c, a} = await mini({ZHIPU_API_KEY: 'zp-test', AI_API_BASE: 'https://example.test/v1/', AI_MODEL: 'glm-4-flash-250414'}, f, 'ops_ai3');
  const st = await c('POST', '/api/admin/ai-moderation', {enabled: true}, a);
  assert.equal(st.j.status.keyConfigured, true);
  assert.equal(st.j.status.provider, 'openai-compatible');
  assert.equal(st.j.settings.model, 'glm-4-flash-250414');
  const t = await c('POST', '/api/admin/ai-moderation/test', {text: '你好'}, a);
  assert.equal(t.s, 200, JSON.stringify(t.j));
  assert.equal(seen[0].url, 'https://example.test/v1/chat/completions');
  assert.equal(seen[0].auth, 'Bearer zp-test');
  assert.equal(seen[0].model, 'glm-4-flash-250414');
  sv.close();
});

test('AI 审查：不使用 DeepSeek——地址或模型带 deepseek 都不调用，退回关键词过滤', async () => {
  const f = () => { throw new Error('不应调用 DeepSeek'); };
  const {sv, c, a} = await mini({AI_API_KEY: 'k', AI_API_BASE: 'https://api.deepseek.com/v1'}, f, 'ops_ai4');
  const st = await c('POST', '/api/admin/ai-moderation', {enabled: true}, a);
  assert.equal(st.j.status.providerAllowed, false);
  assert.equal((await c('POST', '/api/admin/ai-moderation', {model: 'deepseek-chat'}, a)).s, 400);
  const u = (await c('POST', '/api/auth/register', {agree: true, username: 'dsk1', email: 'dsk1@x.test', password: 'Passw0rd123'})).j.token;
  assert.equal((await c('POST', '/api/posts', {text: '普通内容'}, u)).s, 200);
  const lg = (await c('GET', '/api/admin/ai-moderation', null, a)).j.logs[0];
  assert.equal(lg.error, 'provider_not_allowed');
  sv.close();
});

test('AI 审查：以前存过的 Groq 模型自动换回 glm-4-flash', async () => {
  const {sv, c, a} = await mini({AI_API_KEY: 'k'}, async () => Response.json({choices: [{message: {content: '{"verdict":"allow"}'}}]}), 'ops_ai5');
  sv.db.prepare("INSERT INTO app_flags(key,value,updated_at) VALUES('ai.moderation',?,0) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify({enabled: true, model: 'openai/gpt-oss-20b'}));
  const st = await c('GET', '/api/admin/ai-moderation', null, a);
  assert.equal(st.j.settings.model, 'glm-4-flash');
  assert.ok(!st.j.status.models.some(m => /gpt-oss|deepseek/.test(m)));
  sv.close();
});
