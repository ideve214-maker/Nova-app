// 2.0.6 AI 自动找广告并发布营销帖：联网搜索工具、发布工具、屏蔽词、每日上限、原网址必填、紧急停止、默认关闭、定时任务、审计、一键下架。
// 智谱接口全部是本地假实现（fetchImpl），不会访问外网，也不需要真实密钥。
import test, {mock} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';
import {TOOLS, MONEY_TOOL, MONEY_PATH} from '../admin-ai.mjs';
import {parseSearchResults, cleanSourceUrl} from '../ai-web-search.mjs';
import {scrubCopy, DEFAULT_BLOCKWORDS} from '../ai-auto-ads.mjs';

const at = s => Date.parse(s + '+08:00');
let T = at('2026-11-19T11:00:00');
const env = {AI_API_KEY: 'test-key-not-real', AI_API_BASE: 'http://zhipu.mock/api/paas/v4'};
let SEARCH = [];
const calls = {search: 0, gen: 0, chat: 0};
const chatScript = [];
let genHook = null;
const copyFor = (r) => ({suitable: true, reason: '正规商家', advertiser: r.title.slice(0, 8), title: r.title.slice(0, 20) + ' 开业啦', text: '欢迎到店 详见 http://evil.example/x 电话 13800138000', cta: '去看看'});
const llm = async (url, init) => {
  if (!String(url).endsWith('/chat/completions')) return new Response('{}', {status: 404});
  const body = JSON.parse(init.body);
  const ok = (o) => new Response(JSON.stringify(o), {status: 200, headers: {'content-type': 'application/json'}});
  if (body.tools && body.tools[0] && body.tools[0].type === 'web_search') {
    calls.search++;
    assert.equal(body.tools[0].web_search.search_result, true);
    return ok({choices: [{message: {role: 'assistant', content: ''}}], web_search: SEARCH});
  }
  if (body.response_format) {
    calls.gen++;
    const r = JSON.parse(body.messages[1].content);
    if (genHook) genHook(r);
    return ok({choices: [{message: {role: 'assistant', content: JSON.stringify(r.title.includes('不适合') ? {suitable: false, reason: '新闻'} : copyFor(r))}}]});
  }
  calls.chat++;
  const f = chatScript.shift();
  return ok({choices: [{message: f ? f(body) : {role: 'assistant', content: '好的'}}]});
};
const tc = (name, args) => () => ({role: 'assistant', content: '', tool_calls: [{id: 'c' + Math.random(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]});
const R = (n, extra = {}) => ({title: '济南小吃店' + n, link: `https://shop${n}.example.com/`, content: '老字号，手工现做', media: '大众点评', ...extra});

let srv, base, tok;
async function call(m, p, body, t = tok) {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(t ? {Authorization: 'Bearer ' + t} : {})}, body: body ? JSON.stringify(body) : undefined});
  let j = null; try { j = await r.json(); } catch {}
  return {s: r.status, j};
}
const audits = (action) => srv.db.prepare('SELECT * FROM audit_log WHERE action=? ORDER BY id').all(action);
const aiAds = () => srv.db.prepare("SELECT * FROM marketing_ads WHERE source='ai' ORDER BY created_at").all();
const reset = () => { srv.db.exec("DELETE FROM marketing_ads WHERE source='ai'"); calls.search = calls.gen = calls.chat = 0; genHook = null; };

test.before(async () => {
  srv = createApp({adminUsername: 'ops_auto', adminPassword: 'OpsUsrPass1', clock: () => T, aiEnv: env,
    aiFetch: async () => { throw new Error('offline'); }, adminAiOpts: {fetchImpl: llm}});
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  tok = (await call('POST', '/api/admin/auth/login', {username: 'ops_auto', password: 'OpsUsrPass1'}, null)).j.token;
});
test.after(() => srv.close());

test('工具登记：有联网搜索（只读）和发布营销帖（写，需确认），没有任何钱相关工具', () => {
  assert.equal(TOOLS.get('web_search').kind, 'read');
  assert.equal(TOOLS.get('list_ai_ads').kind, 'read');
  assert.equal(TOOLS.get('publish_marketing_ad').kind, 'write');
  for (const [n] of TOOLS) assert.ok(!MONEY_TOOL.test(n), n);
  for (const p of ['/api/admin/ai/auto-ads/publish', '/api/admin/ai/auto-ads/run', '/api/admin/ai/web-search']) assert.ok(!MONEY_PATH.test(p));
  assert.ok(DEFAULT_BLOCKWORDS.includes('贷款'));
});

test('搜索结果解析：保留原网址，丢掉没有网址 / 非 http 的结果，去重', () => {
  const r = parseSearchResults({web_search: [R(1), {title: '无链接', content: 'x'}, {title: 'js', link: 'javascript:alert(1)'}, R(1), {title: 'ftp', link: 'ftp://a.example/'}]});
  assert.equal(r.length, 1);
  assert.equal(r[0].url, 'https://shop1.example.com/');
  assert.equal(r[0].site, '大众点评');
  assert.equal(cleanSourceUrl('https://u:p@a.example/'), null);
  assert.equal(scrubCopy('来 http://x.example/a 电话13800138000 微信: abcdefg 好'), '来 电话 好');
});

test('默认关闭：环境变量没开时不启动定时器、不调用智谱、不发布', async () => {
  reset();
  const r = await call('GET', '/api/admin/ai/auto-ads');
  assert.equal(r.s, 200);
  assert.equal(r.j.settings.enabled, false);
  assert.equal(r.j.status.envEnabled, false);
  assert.equal(r.j.status.active, false);
  assert.equal(r.j.settings.perRun, 10); // 2.1.1：每轮默认 10 条
  assert.equal(r.j.settings.dailyCap, 10); // 兼容别名，等于 perRun
  assert.equal(r.j.status.todayPublished, 0);
  assert.equal(r.j.status.scheduledToday, 0);
  assert.equal(r.j.status.manualToday, 0);
  assert.equal(srv.adminAi.autoAds.start(1000), false);
  assert.equal(srv.adminAi.autoAds.scheduled, false);
  const run = await call('POST', '/api/admin/ai/auto-ads/run');
  assert.equal(run.j.result.skipped, 'env_off');
  // 只打开管理端开关也不行
  await call('POST', '/api/admin/ai/auto-ads/settings', {enabled: true});
  assert.equal((await call('POST', '/api/admin/ai/auto-ads/run')).j.result.skipped, 'env_off');
  assert.equal(calls.search + calls.gen, 0);
  assert.equal(aiAds().length, 0);
  await call('POST', '/api/admin/ai/auto-ads/settings', {enabled: false});
});

test('环境变量开了但管理端开关（紧急停止）关着：不搜索', async () => {
  reset(); env.ADMIN_AI_AUTO_ADS = '1';
  const r = await call('POST', '/api/admin/ai/auto-ads/run');
  assert.equal(r.j.result.skipped, 'switch_off');
  assert.equal(calls.search, 0);
  assert.ok(audits('ai.autoads.skipped').length >= 1);
  delete env.ADMIN_AI_AUTO_ADS;
});

test('立即运行：屏蔽词过滤、原网址必填、每轮条数、来源标记、审计', async () => {
  reset(); env.ADMIN_AI_AUTO_ADS = '1';
  SEARCH = [R(1, {title: '济南小额贷款公司'}), {title: '没有链接的商家', content: '...'}, R(2), R(3, {title: '某某新闻不适合'}), R(4), R(5)];
  const s = await call('POST', '/api/admin/ai/auto-ads/settings', {enabled: true, dailyCap: 2});
  assert.equal(s.j.settings.enabled, true);
  assert.equal(s.j.settings.perRun, 2);
  assert.equal(s.j.settings.dailyCap, 2);
  assert.equal(s.j.status.active, true);
  assert.ok(audits('admin.ai.autoads.switch_on').length >= 1);
  const r = await call('POST', '/api/admin/ai/auto-ads/run');
  assert.equal(r.s, 200, JSON.stringify(r.j));
  assert.equal(r.j.result.published.length, 2);
  assert.equal(r.j.result.perRun, 2);
  assert.equal(calls.search, 1);
  const rows = aiAds();
  assert.deepEqual(rows.map(x => x.source_url), ['https://shop2.example.com/', 'https://shop4.example.com/']);
  for (const x of rows) {
    assert.equal(x.source, 'ai'); assert.equal(x.ai_trigger, 'manual');
    assert.equal(x.link_url, x.source_url, '用户点开的就是原网址');
    assert.ok(!/evil\.example|13800138000/.test(x.text), '模型写的网址和电话被去掉');
    assert.ok(x.ends_at > T, '默认 7 天后到期');
  }
  assert.equal(audits('ai.autoads.published').length, 2);
  const rej = audits('ai.autoads.rejected').map(a => JSON.parse(a.detail).code);
  assert.ok(rej.includes('BLOCKED') && rej.includes('NOT_SUITABLE'), rej.join());
  assert.equal(audits('ai.autoads.run').length, 1);
  const feed = srv.marketing.pickFor({id: 987654});
  assert.ok(feed.ads.some(a => a.linkUrl === 'https://shop2.example.com/'));
  assert.equal(r.j.status.manualToday, 2);
  assert.equal(r.j.status.scheduledToday, 0);
  // 同一天再跑：再发一轮，不看今天已经发了多少；已发过的原网址不会重复
  const r2 = await call('POST', '/api/admin/ai/auto-ads/run');
  assert.deepEqual(r2.j.result.published.map(a => a.sourceUrl), ['https://shop5.example.com/']);
  assert.equal(r2.j.result.stopped, 'no_more_results');
  assert.ok(audits('ai.autoads.rejected').some(a => JSON.parse(a.detail).code === 'DUPLICATE'));
  assert.equal(r2.j.status.manualToday, 3);
  assert.equal(r2.j.status.todayPublished, 3);
  // perRun 1–runMax；dailyCap 是别名；0 当作默认 10；负数和超上限拒绝
  const a99 = await call('POST', '/api/admin/ai/auto-ads/settings', {dailyCap: 99});
  assert.equal(a99.s, 200);
  assert.equal(a99.j.settings.perRun, 99);
  const a15 = await call('POST', '/api/admin/ai/auto-ads/settings', {perRun: 15});
  assert.equal(a15.s, 200);
  assert.equal(a15.j.settings.perRun, 15);
  assert.equal(a15.j.settings.dailyCap, 15);
  assert.equal((await call('POST', '/api/admin/ai/auto-ads/settings', {dailyCap: 0})).j.settings.perRun, 10);
  assert.equal((await call('POST', '/api/admin/ai/auto-ads/settings', {perRun: 0})).s, 400);
  assert.equal((await call('POST', '/api/admin/ai/auto-ads/settings', {dailyCap: -1})).s, 400);
  assert.equal((await call('POST', '/api/admin/ai/auto-ads/settings', {perRun: 101})).s, 400);
  await call('POST', '/api/admin/ai/auto-ads/settings', {enabled: false, perRun: 3});
  delete env.ADMIN_AI_AUTO_ADS;
});

test('定时一轮和手动一轮互不影响：各发 perRun 条，状态分开计数', async () => {
  reset(); env.ADMIN_AI_AUTO_ADS = '1';
  SEARCH = [R(61), R(62), R(63), R(64), R(65)];
  await call('POST', '/api/admin/ai/auto-ads/settings', {enabled: true, perRun: 2});
  const sched = await srv.adminAi.autoAds.run({trigger: 'schedule'});
  assert.equal(sched.published.length, 2);
  let st = (await call('GET', '/api/admin/ai/auto-ads')).j.status;
  assert.equal(st.scheduledToday, 2);
  assert.equal(st.manualToday, 0);
  assert.equal(st.todayPublished, 2);
  const man = await call('POST', '/api/admin/ai/auto-ads/run');
  assert.equal(man.j.result.published.length, 2);
  st = man.j.status;
  assert.equal(st.scheduledToday, 2);
  assert.equal(st.manualToday, 2);
  assert.equal(st.todayPublished, 4);
  const pub = await call('POST', '/api/admin/ai/auto-ads/publish', {title: '丙店', text: '欢迎光临', sourceUrl: 'https://manual-today.example.com/'});
  assert.equal(pub.s, 200, JSON.stringify(pub.j));
  st = (await call('GET', '/api/admin/ai/auto-ads')).j.status;
  assert.equal(st.scheduledToday, 2);
  assert.equal(st.manualToday, 3);
  assert.equal(st.todayPublished, 5);
  // 未设 perRun 时沿用已存的 dailyCap
  srv.db.prepare("DELETE FROM admin_ai_settings WHERE key='autoads.perRun'").run();
  srv.db.prepare("INSERT INTO admin_ai_settings(key,value,updated_at) VALUES('autoads.dailyCap','7',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(T);
  assert.equal((await call('GET', '/api/admin/ai/auto-ads')).j.settings.perRun, 7);
  await call('POST', '/api/admin/ai/auto-ads/settings', {enabled: false, perRun: 3});
  delete env.ADMIN_AI_AUTO_ADS;
});

test('自定义屏蔽词生效', async () => {
  reset(); env.ADMIN_AI_AUTO_ADS = '1';
  SEARCH = [R(11, {content: '本店主营火锅'}), R(12)];
  await call('POST', '/api/admin/ai/auto-ads/settings', {enabled: true, dailyCap: 5, blockwords: '火锅\n烧烤'});
  const r = await call('POST', '/api/admin/ai/auto-ads/run');
  assert.deepEqual(r.j.result.published.map(a => a.sourceUrl), ['https://shop12.example.com/']);
  await call('POST', '/api/admin/ai/auto-ads/settings', {enabled: false, blockwords: ''});
  delete env.ADMIN_AI_AUTO_ADS;
});

test('紧急停止：运行中关掉开关，下一条之前停下', async () => {
  reset(); env.ADMIN_AI_AUTO_ADS = '1';
  SEARCH = [R(21), R(22), R(23)];
  await call('POST', '/api/admin/ai/auto-ads/settings', {enabled: true, dailyCap: 5});
  let n = 0;
  genHook = () => { if (++n === 1) srv.adminAi.autoAds.saveSettings({id: 1}, {enabled: false}); };
  const r = await call('POST', '/api/admin/ai/auto-ads/run');
  assert.equal(r.j.result.published.length, 1);
  assert.equal(r.j.result.stopped, 'switch_off');
  assert.equal(calls.gen, 1);
  assert.equal(audits('ai.autoads.stopped').length, 1);
  delete env.ADMIN_AI_AUTO_ADS;
});

test('发布接口：没有原网址 / 非法网址一律拒绝并记审计', async () => {
  reset();
  const a = await call('POST', '/api/admin/ai/auto-ads/publish', {title: '好店', text: '欢迎光临'});
  assert.equal(a.s, 400); assert.equal(a.j.error.code, 'AUTOADS_NO_SOURCE');
  const b = await call('POST', '/api/admin/ai/auto-ads/publish', {title: '好店', text: '欢迎光临', sourceUrl: 'javascript:alert(1)'});
  assert.equal(b.s, 400);
  const c = await call('POST', '/api/admin/ai/auto-ads/publish', {title: '网贷秒批', text: '欢迎', sourceUrl: 'https://x.example.com/'});
  assert.equal(c.j.error.code, 'AUTOADS_BLOCKED');
  assert.ok(audits('ai.autoads.rejected').length >= 3);
  assert.equal(aiAds().length, 0);
});

test('一键下架：单条和全部，下架后用户信息流不再出现', async () => {
  reset();
  const a = (await call('POST', '/api/admin/ai/auto-ads/publish', {title: '甲店', text: '欢迎光临', sourceUrl: 'https://a1.example.com/'})).j.ad;
  const b = (await call('POST', '/api/admin/ai/auto-ads/publish', {title: '乙店', text: '欢迎光临', sourceUrl: 'https://a2.example.com/'})).j.ad;
  assert.equal(a.source, 'ai'); assert.equal(a.live, true);
  const d = await call('POST', `/api/admin/ai/auto-ads/${a.id}/takedown`);
  assert.equal(d.s, 200); assert.equal(d.j.ad.live, false);
  assert.ok(!srv.marketing.pickFor({id: 555}).ads.some(x => x.id === a.id));
  assert.equal((await call('GET', '/api/admin/ai/auto-ads?status=down')).j.ads.length, 1);
  const all = await call('POST', '/api/admin/ai/auto-ads/takedown-all');
  assert.equal(all.j.count, 1);
  assert.equal((await call('GET', '/api/admin/ai/auto-ads?status=live')).j.ads.length, 0);
  assert.ok(!srv.marketing.pickFor({id: 556}).ads.some(x => x.id === b.id));
  assert.equal(audits('admin.ai.autoads.takedown').length, 1);
  assert.equal(audits('admin.ai.autoads.takedown_all').length, 1);
  // 手动广告不能用 AI 下架接口
  const m = srv.marketing.create({kind: 'text', title: '手动', text: 'x'}).ad;
  assert.equal((await call('POST', `/api/admin/ai/auto-ads/${m.id}/takedown`)).s, 404);
  // 管理端营销帖列表能看到来源
  const list = (await call('GET', '/api/admin/marketing/ads')).j.ads;
  assert.equal(list.find(x => x.id === a.id).source, 'ai');
  assert.equal(list.find(x => x.id === m.id).source, 'manual');
});

test('审计日志接口', async () => {
  const r = await call('GET', '/api/admin/ai/auto-ads/log?limit=50');
  assert.equal(r.s, 200);
  assert.ok(r.j.log.length > 5);
  assert.ok(r.j.log.every(x => /autoads|web_search/.test(x.action)));
  assert.equal((await call('GET', '/api/admin/ai/auto-ads/log', null, null)).s, 401);
});

test('联网搜索接口：结果带原网址、记审计、每天有上限', async () => {
  reset(); SEARCH = [R(31), R(32)];
  const r = await call('GET', '/api/admin/ai/web-search?q=' + encodeURIComponent('济南 小吃'));
  assert.equal(r.s, 200);
  assert.deepEqual(r.j.results.map(x => x.url), ['https://shop31.example.com/', 'https://shop32.example.com/']);
  assert.ok(audits('admin.ai.web_search').length >= 1);
  env.ADMIN_AI_SEARCH_RPD = '0';
  assert.equal((await call('GET', '/api/admin/ai/web-search?q=x')).s, 429);
  delete env.ADMIN_AI_SEARCH_RPD;
});

test('AI 助手：先联网搜索，再提出发布，管理员确认后才写入广告位', async () => {
  reset(); SEARCH = [R(41)];
  chatScript.push(tc('web_search', {query: '济南小吃'}), tc('publish_marketing_ad', {sourceUrl: 'https://shop41.example.com/', sourceTitle: '济南小吃店41', advertiser: '小吃店', title: '济南小吃店开业', text: '老字号手工现做'}));
  const c = await call('POST', '/api/admin/ai/chat', {text: '帮我找个济南小吃的广告发了'});
  assert.equal(c.s, 200, JSON.stringify(c.j));
  assert.ok(c.j.pending, '写操作必须先确认');
  assert.match(c.j.reply, /原网址：https:\/\/shop41\.example\.com\//);
  assert.equal(aiAds().length, 0, '确认前不写入');
  const ok = await call('POST', '/api/admin/ai/confirm', {id: c.j.pending.id});
  assert.equal(ok.s, 200, JSON.stringify(ok.j));
  const rows = aiAds();
  assert.equal(rows.length, 1); assert.equal(rows[0].ai_trigger, 'assistant'); assert.equal(rows[0].source_url, 'https://shop41.example.com/');
  // 没有原网址的发布提议直接被拒，不生成待确认
  chatScript.push(tc('publish_marketing_ad', {sourceUrl: '', title: '无网址', text: '内容'}));
  const c2 = await call('POST', '/api/admin/ai/chat', {text: '再发一条'});
  assert.equal(c2.j.pending, null);
});

test('定时任务（假时钟）：到点前不跑，上海时间到点后每天只跑一轮', async () => {
  reset(); env.ADMIN_AI_AUTO_ADS = '1'; env.ADMIN_AI_AUTO_ADS_HOUR = '10';
  SEARCH = [R(51), R(52)];
  await call('POST', '/api/admin/ai/auto-ads/settings', {enabled: true, dailyCap: 1});
  srv.db.prepare("DELETE FROM admin_ai_settings WHERE key='autoads.lastRunDay'").run();
  mock.timers.enable({apis: ['setInterval']});
  try {
    const A = srv.adminAi.autoAds;
    T = at('2026-11-20T09:30:00');
    assert.equal(A.start(60e3), true);
    mock.timers.tick(60e3); assert.deepEqual(await A.lastTick, {skipped: 'not_due'});
    T = at('2026-11-20T10:05:00');
    mock.timers.tick(60e3); const r = await A.lastTick;
    assert.equal(r.trigger, 'schedule'); assert.equal(r.published.length, 1);
    mock.timers.tick(60e3); assert.deepEqual(await A.lastTick, {skipped: 'not_due'});
    // 第二天又可以跑；关掉开关后不再搜索
    T = at('2026-11-21T10:01:00');
    A.saveSettings({id: 1}, {enabled: false});
    const before = calls.search;
    mock.timers.tick(60e3); assert.deepEqual(await A.lastTick, {skipped: 'switch_off'});
    assert.equal(calls.search, before);
    A.stop(); assert.equal(A.scheduled, false);
  } finally {
    mock.timers.reset();
    delete env.ADMIN_AI_AUTO_ADS; delete env.ADMIN_AI_AUTO_ADS_HOUR;
    T = at('2026-11-19T11:00:00');
  }
});
