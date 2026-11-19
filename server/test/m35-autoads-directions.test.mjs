// 2.0.6 线上问题修复：搜索方向拆开单独搜。生产上 query 是 5 个不相关方向用空格拼成一条，
// 智谱 web_search 返回 200 但 0 条；单独一个方向有结果。这里用文档里的响应格式模拟（不访问外网）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';
import {splitDirections} from '../ai-auto-ads.mjs';

let T = Date.parse('2026-11-19T16:10:00+08:00');
const env = {AI_API_KEY: 'zhipu-key-NOT-REAL-9999', AI_API_BASE: 'http://zhipu.mock/api/paas/v4', ADMIN_AI_AUTO_ADS: '1', ADMIN_AI_SEARCH_RPD: '100'};
const json = (o, status = 200) => new Response(JSON.stringify(o), {status, headers: {'content-type': 'application/json'}});
const PROD_QUERY = '本地商家 新店开业 优惠活动 科研教育 知识培训';
// 和对话补全文档一致的 web_search 结果项
const item = (n, dir) => ({icon: 'https://x.example/i.png', title: `${dir} 小店${n}`, link: `https://shop-${encodeURIComponent(dir)}-${n}.example.com/`, media: '大众点评', publish_date: '2026-11-18', content: '老字号，手工现做', refer: 'ref_' + n});
let searchFor = q => q.includes(' ') && q.split(' ').length > 3 ? [] : [item(1, q), item(2, q), {...item(9, 'shared'), link: 'https://shared.example.com/'}];
const sent = [];
let total = 0; // 今天一共发出的联网搜索次数
async function llm(url, init) {
  const body = JSON.parse(init.body);
  if (!String(url).endsWith('/chat/completions')) return json({}, 404);
  if (body.tools && body.tools[0] && body.tools[0].type === 'web_search') {
    const q = body.tools[0].web_search.search_query;
    sent.push(q); total++;
    const r = searchFor(q);
    if (r instanceof Response) return r;
    // 0 条时智谱也是 200，只是没有 web_search 字段（文档示例里就没有）
    return json({id: 'x', model: 'glm-4-flash', choices: [{index: 0, finish_reason: 'stop', message: {role: 'assistant', content: '好的'}}], ...(r.length ? {web_search: r} : {}), usage: {prompt_tokens: 10, completion_tokens: 2, total_tokens: 12}});
  }
  if (body.response_format) {
    const r = JSON.parse(body.messages[1].content);
    return json({choices: [{message: {role: 'assistant', content: JSON.stringify({suitable: true, reason: 'ok', advertiser: r.title.slice(0, 10), title: r.title.slice(0, 20), text: '欢迎到店', cta: '去看看'})}}]});
  }
  return json({choices: [{message: {role: 'assistant', content: '好的'}}]});
}

let srv, base, tok;
async function call(m, p, body) {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + tok}, body: body ? JSON.stringify(body) : undefined});
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch {}
  return {s: r.status, j, text};
}
const audits = a => srv.db.prepare('SELECT * FROM audit_log WHERE action=? ORDER BY id').all(a).map(r => ({...r, d: JSON.parse(r.detail || '{}')}));
const reset = () => { srv.db.exec("DELETE FROM marketing_ads WHERE source='ai'"); srv.db.exec("DELETE FROM audit_log WHERE action LIKE 'ai.autoads.%'"); srv.db.exec("DELETE FROM admin_ai_settings WHERE key='autoads.dirCursor'"); sent.length = 0; };

test.before(async () => {
  srv = createApp({adminUsername: 'ops_dir', adminPassword: 'OpsUsrPass1', clock: () => T, aiEnv: env, aiFetch: async () => { throw new Error('offline'); }, adminAiOpts: {fetchImpl: llm}});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  tok = (await fetch(base + '/api/admin/auth/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({username: 'ops_dir', password: 'OpsUsrPass1'})}).then(r => r.json())).token;
  await call('POST', '/api/admin/ai/auto-ads/settings', {enabled: true, dailyCap: 10});
});
test.after(() => srv.close());

test('拆分方向：每行一个；逗号/顿号也行；旧的空格串超过 3 个词时每个词一个方向', () => {
  assert.deepEqual(splitDirections(PROD_QUERY), ['本地商家', '新店开业', '优惠活动', '科研教育', '知识培训']);
  assert.deepEqual(splitDirections('本地商家 新店开业 优惠活动'), ['本地商家 新店开业 优惠活动']);
  assert.deepEqual(splitDirections('济南 新店开业\n科研教育、知识培训\n\n济南 新店开业'), ['济南 新店开业', '科研教育', '知识培训']);
  assert.equal([...splitDirections('长'.repeat(100))[0]].length, 70, '单个方向不超过 70 字（智谱建议）');
  assert.deepEqual(splitDirections(''), []);
});

test('生产上的 5 个方向：每个方向单独搜，合并并按网址去重，日志写每个方向的条数，能发帖', async () => {
  reset();
  await call('POST', '/api/admin/ai/auto-ads/settings', {query: PROD_QUERY});
  const r = await call('POST', '/api/admin/ai/auto-ads/run');
  assert.equal(r.s, 200, r.text);
  assert.deepEqual(sent, ['本地商家', '新店开业', '优惠活动', '科研教育', '知识培训'], '不再把 5 个方向拼成一条');
  const res = r.j.result;
  assert.equal(res.found, 11, '5×2 + 1 条共享网址（去重）');
  assert.equal(res.directions.length, 5);
  assert.ok(res.directions.every(d => d.count === 3));
  assert.equal(res.published.length, 10, '每日上限 10');
  const rows = audits('ai.autoads.searched');
  assert.deepEqual(rows.map(x => [x.d.query, x.d.count]), [['本地商家', 3], ['新店开业', 3], ['优惠活动', 3], ['科研教育', 3], ['知识培训', 3]]);
  assert.equal(audits('ai.autoads.run').at(-1).d.found, 11);
  // 保存时转成每行一个
  assert.equal(r.j.settings.query, '本地商家\n新店开业\n优惠活动\n科研教育\n知识培训');
});

test('全部 0 条：日志写原因，运行结果带原因（管理端显示）', async () => {
  reset();
  searchFor = () => [];
  await call('POST', '/api/admin/ai/auto-ads/settings', {query: '方向一\n方向二'});
  const r = await call('POST', '/api/admin/ai/auto-ads/run');
  assert.equal(r.j.result.found, 0);
  assert.match(r.j.result.reason, /2 个方向都没有搜到结果/);
  const err = audits('ai.autoads.error').at(-1);
  assert.match(err.d.reason, /都没有搜到结果/);
  assert.deepEqual(err.d.directions.map(d => d.count), [0, 0]);
  assert.match(audits('ai.autoads.run').at(-1).d.reason, /都没有搜到结果/);
});

test('真实错误不再显示成“0 条”：HTTP 错误码、HTTP 200 带错误都写进日志和结果；不泄露密钥', async () => {
  reset();
  searchFor = q => q === '方向一' ? json({error: {code: '1214', message: 'search_engine 参数非法 key=zhipu-key-NOT-REAL-9999'}}, 400)
    : json({error: {code: '1703', message: '搜索引擎未返回有效数据，请调整查询条件'}}, 200);
  const r = await call('POST', '/api/admin/ai/auto-ads/run');
  assert.match(r.j.result.error, /^搜索失败：/);
  const rows = audits('ai.autoads.searched');
  assert.match(rows[0].d.error, /错误码 1214/);
  assert.match(rows[1].d.error, /错误码 1703/);
  assert.ok(!r.text.includes('zhipu-key-NOT-REAL-9999'));
  assert.ok(!JSON.stringify(rows).includes('zhipu-key-NOT-REAL-9999'));
  // 部分失败：其余方向照常
  reset();
  searchFor = q => q === '方向一' ? json({error: {code: '1302', message: '并发过高'}}, 429) : [item(1, q)];
  const r2 = await call('POST', '/api/admin/ai/auto-ads/run');
  assert.equal(r2.j.result.found, 1);
  assert.equal(r2.j.result.published.length, 1);
  assert.match(audits('ai.autoads.searched')[0].d.error, /1302/);
});

test('每轮最多搜 N 个方向并轮流；不超过今天剩下的联网搜索次数', async () => {
  reset();
  searchFor = q => [item(1, q)];
  env.ADMIN_AI_AUTO_ADS_QUERIES = '2';
  await call('POST', '/api/admin/ai/auto-ads/settings', {query: 'A方向\nB方向\nC方向'});
  await call('POST', '/api/admin/ai/auto-ads/run');
  assert.deepEqual(sent, ['A方向', 'B方向']);
  sent.length = 0;
  await call('POST', '/api/admin/ai/auto-ads/run');
  assert.deepEqual(sent, ['C方向', 'A方向'], '接着上次轮流');
  delete env.ADMIN_AI_AUTO_ADS_QUERIES;
  // 今天的联网搜索次数快用完：只搜剩下的次数
  sent.length = 0;
  env.ADMIN_AI_SEARCH_RPD = String(total + 1); // 只剩 1 次
  const r = await call('POST', '/api/admin/ai/auto-ads/run');
  assert.deepEqual(sent, ['B方向']);
  sent.length = 0;
  const r2 = await call('POST', '/api/admin/ai/auto-ads/run');
  assert.deepEqual(sent, []);
  assert.match(r2.j.result.reason, /联网搜索次数已用完/);
  void r;
  env.ADMIN_AI_SEARCH_RPD = '100';
});
