// VEXO 2.0.1：AI 翻译 / 技能交换匹配 / 官方助手（智谱 glm-4-flash，用假接口测）、营销帖新卡片字段
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../index.mjs';
import {detectTarget, faqSections, loadFaq, faqSearch} from '../ai-assist.mjs';

let srv, base, seq = 0, adm;
const AI = {mode: 'ok', calls: [], next: null};
async function fakeFetch(url, opts) {
  const body = JSON.parse(opts.body);
  AI.calls.push({url, model: body.model, auth: opts.headers.Authorization, sys: body.messages[0].content, user: body.messages[body.messages.length - 1].content});
  const reply = c => new Response(JSON.stringify({choices: [{message: {content: c}}]}), {status: 200, headers: {'Content-Type': 'application/json'}});
  if (/内容审核员/.test(body.messages[0].content)) return reply('{"verdict":"allow","category":"","reason":""}');
  if (AI.mode === 'down') return new Response('err', {status: 500});
  if (AI.mode === 'junk') return reply('我不知道你在说什么');
  if (AI.next) { const n = AI.next; AI.next = null; return reply(n); }
  if (/translator/.test(body.messages[0].content)) return reply(/English/.test(body.messages[0].content) ? '"Hello, nice weather today"' : '你好');
  if (/官方助手/.test(body.messages[0].content)) return reply('在「我的」→ 会员中心开通，¥9.9/月。');
  if (/技能交换/.test(body.messages[0].content)) return reply('{"items":[{"n":2,"reason":"TA 会吉他"},{"n":1,"reason":"可以互教"},{"n":99,"reason":"越界"}]}');
  return reply('?');
}
test.before(async () => {
  srv = createApp({adminUsername: 'ops_ai', adminPassword: 'OpsAiPass1!', aiEnv: {ZHIPU_API_KEY: 'test-key', AI_ASSIST_RPM: '1000'}, aiFetch: fakeFetch,
    mediaDir: join(mkdtempSync(join(tmpdir(), 'v21-')), 'media')});
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
  assert.equal(r.s, 200, JSON.stringify(r.j));
  return {tok: r.j.token, id: r.j.user.id, u};
}

test('翻译：自动判断方向、走智谱 glm-4-flash、结果缓存、AI 失败返回 503、需要登录、长度限制', async () => {
  assert.equal(detectTarget('今天天气不错'), 'en');
  assert.equal(detectTarget('Nice weather today'), 'zh');
  const a = await acc('tra');
  assert.equal((await call('POST', '/api/ai/translate', {text: '你好'})).s, 401);
  AI.mode = 'ok'; AI.calls = [];
  const r = await call('POST', '/api/ai/translate', {text: '你好，今天天气不错'}, a.tok);
  assert.equal(r.s, 200, JSON.stringify(r.j));
  assert.equal(r.j.to, 'en');
  assert.equal(r.j.text, 'Hello, nice weather today');           // 去掉了引号
  assert.equal(AI.calls[0].model, 'glm-4-flash');
  assert.match(AI.calls[0].url, /open\.bigmodel\.cn\/api\/paas\/v4\/chat\/completions$/);
  assert.equal(AI.calls[0].auth, 'Bearer test-key');
  const again = await call('POST', '/api/ai/translate', {text: '你好，今天天气不错'}, a.tok);
  assert.equal(again.j.cached, true);
  assert.equal(AI.calls.length, 1);
  const zh = await call('POST', '/api/ai/translate', {text: 'Hi there'}, a.tok);
  assert.equal(zh.j.to, 'zh'); assert.equal(zh.j.text, '你好');
  AI.mode = 'down';
  const bad = await call('POST', '/api/ai/translate', {text: '这一句没缓存'}, a.tok);
  assert.equal(bad.s, 503); assert.equal(bad.j.error.code, 'AI_UNAVAILABLE');
  AI.mode = 'ok';
  assert.equal((await call('POST', '/api/ai/translate', {text: 'x'.repeat(2001)}, a.tok)).s, 400);
  assert.equal((await call('POST', '/api/ai/translate', {text: '  '}, a.tok)).s, 400);
});

test('翻译：每人每小时限额，超过后 429', async () => {
  const a = await acc('trl');
  let last;
  for (let i = 0; i < 61; i++) last = await call('POST', '/api/ai/translate', {text: '第 ' + i + ' 句'}, a.tok);
  assert.equal(last.s, 429); assert.equal(last.j.error.code, 'AI_RATE_LIMITED');
  const b = await acc('trm');
  assert.equal((await call('POST', '/api/ai/translate', {text: '别人不受影响'}, b.tok)).s, 200);
});

test('技能交换匹配：没发布时提示先发布；AI 排序（丢掉越界编号）；AI 失败或乱答时用规则；拉黑的人不出现', async () => {
  const me = await acc('mme'), g = await acc('mgt'), h = await acc('mhx'), z = await acc('mbk');
  const none = await call('GET', '/api/exchange/match', null, me.tok);
  assert.equal(none.s, 200); assert.equal(none.j.need, 'post'); assert.deepEqual(none.j.items, []);
  await call('POST', '/api/exchange', {category: 'music', offers: 'Python 编程入门', wants: '想学吉他弹唱'}, me.tok);
  const pg = await call('POST', '/api/exchange', {category: 'music', offers: '吉他弹唱和乐理', wants: '想学 Python 编程'}, g.tok);
  const ph = await call('POST', '/api/exchange', {category: 'music', offers: '尤克里里和吉他', wants: '想学摄影'}, h.tok);
  await call('POST', '/api/exchange', {category: 'dev', offers: '吉他速成', wants: 'Python 编程'}, z.tok);
  await call('POST', '/api/blocks', {userId: z.id}, me.tok);
  await call('POST', '/api/exchange', {category: 'craft', offers: '编织毛衣', wants: '想学烘焙'}, (await acc('mno')).tok);
  AI.mode = 'ok';
  const r = await call('GET', '/api/exchange/match', null, me.tok);
  assert.equal(r.s, 200, JSON.stringify(r.j));
  assert.equal(r.j.source, 'ai');
  const ids = r.j.items.map(x => x.post.id);
  assert.ok(ids.includes(pg.j.post.id) && ids.includes(ph.j.post.id), JSON.stringify(ids));
  assert.ok(!r.j.items.some(x => x.post.author.id === z.id), '拉黑的人不出现');
  assert.ok(!r.j.items.some(x => /编织/.test(x.post.offers)), '完全不相关的不出现');
  assert.ok(r.j.items.every(x => x.reason && x.reason.length <= 30));
  assert.equal(r.j.items.find(x => x.post.id === pg.j.post.id).mutual, true);
  // 规则兜底：换一条内容让缓存失效
  const me2 = await acc('mm2');
  await call('POST', '/api/exchange', {category: 'music', offers: 'Python 编程', wants: '吉他'}, me2.tok);
  AI.mode = 'junk';
  const j = await call('GET', '/api/exchange/match', null, me2.tok);
  assert.equal(j.s, 200); assert.equal(j.j.source, 'rule'); assert.ok(j.j.items.length >= 2);
  assert.ok(j.j.items.every(x => x.reason));
  AI.mode = 'ok';
});

test('官方助手：按帮助资料回答；AI 不可用时返回最相关的帮助段落；问题长度和登录检查', async () => {
  const s = faqSections(loadFaq());
  assert.ok(s.length >= 8);
  assert.equal(faqSearch(s, '会员怎么开通，多少钱').title, 'VIP 会员');
  const a = await acc('asq');
  assert.equal((await call('POST', '/api/assistant/ask', {question: '怎么开通会员'})).s, 401);
  AI.calls = [];
  const r = await call('POST', '/api/assistant/ask', {question: '怎么开通会员？', history: [{role: 'user', text: '你好'}, {role: 'assistant', text: '你好！'}]}, a.tok);
  assert.equal(r.s, 200); assert.equal(r.j.source, 'ai'); assert.match(r.j.answer, /会员/);
  const sys = AI.calls.find(c => /官方助手/.test(c.sys)).sys;
  assert.match(sys, /帮助资料/); assert.match(sys, /9\.9/);
  AI.mode = 'down';
  const f = await call('POST', '/api/assistant/ask', {question: '私聊是加密的吗'}, a.tok);
  assert.equal(f.s, 200); assert.equal(f.j.source, 'faq'); assert.match(f.j.answer, /加密/);
  const n = await call('POST', '/api/assistant/ask', {question: 'zzqqxx'}, a.tok);
  assert.equal(n.j.source, 'none');
  AI.mode = 'ok';
  assert.equal((await call('POST', '/api/assistant/ask', {question: 'x'.repeat(301)}, a.tok)).s, 400);
  assert.equal((await call('POST', '/api/assistant/ask', {question: ''}, a.tok)).s, 400);
  const faq = await call('GET', '/api/assistant/faq', null, a.tok);
  assert.ok(faq.j.sections.length >= 8);
});

test('营销帖新卡片：头像、域名（不填取链接域名）、副标题；头像地址校验', async () => {
  const r = await call('POST', '/api/admin/marketing/ads', {kind: 'image', advertiser: 'VEXO 官方', text: '新版上线', title: 'VEXO 2.0', subtitle: '共创、投票与活动', cta: '立即下载',
    linkUrl: 'https://www.example.com/download?x=1', media: [{url: 'https://example.com/a.png', kind: 'image'}], avatar: 'https://example.com/logo.png'}, adm);
  assert.equal(r.s, 200, JSON.stringify(r.j));
  assert.equal(r.j.ad.domain, 'example.com'); assert.equal(r.j.ad.subtitle, '共创、投票与活动'); assert.equal(r.j.ad.avatar, 'https://example.com/logo.png');
  const u = await call('POST', '/api/admin/marketing/ads/' + r.j.ad.id, {domain: 'https://vexo.app/x'}, adm);
  assert.equal(u.j.ad.domain, 'vexo.app');
  assert.equal(u.j.ad.subtitle, '共创、投票与活动', '没传的字段保持不变');
  const bad = await call('POST', '/api/admin/marketing/ads', {kind: 'text', text: 'x', avatar: 'javascript:alert(1)'}, adm);
  assert.equal(bad.s, 400);
});

test('全站限速：超过 AI_ASSIST_RPM 后不再调用 AI（翻译返回 503，助手走帮助资料）', async () => {
  const {createAiAssist} = await import('../ai-assist.mjs');
  let n = 0;
  const f = async () => { n++; return new Response(JSON.stringify({choices: [{message: {content: 'ok'}}]}), {status: 200}); };
  const a = createAiAssist(srv.db, {env: {ZHIPU_API_KEY: 'k', AI_ASSIST_RPM: '2'}, fetchImpl: f, exchange: srv.exchange, friends: srv.friends});
  await a.translate({id: 1}, {text: '一'}); await a.translate({id: 1}, {text: '二'});
  await assert.rejects(a.translate({id: 1}, {text: '三'}), e => e.status === 503 || e.code === 'AI_UNAVAILABLE');
  assert.equal(n, 2);
  const r = await a.ask({id: 2}, {question: '怎么开通 VIP 会员'});
  assert.equal(r.source, 'faq'); assert.equal(n, 2);
  const noKey = createAiAssist(srv.db, {env: {}, fetchImpl: f, exchange: srv.exchange, friends: srv.friends});
  await assert.rejects(noKey.translate({id: 3}, {text: '四'}));
  assert.equal(noKey.status().keyOk, false); assert.equal(noKey.status().provider, 'zhipu');
  const deep = createAiAssist(srv.db, {env: {ZHIPU_API_KEY: 'k', AI_API_BASE: 'https://api.deepseek.com'}, fetchImpl: f, exchange: srv.exchange, friends: srv.friends});
  await assert.rejects(deep.translate({id: 4}, {text: '五'}));
  assert.equal(n, 2, '不调用 DeepSeek');
});

test('注册邮箱白名单：常见邮箱可以注册；其他域名「邮箱格式不正确」；打错时给建议；已有账号登录不受影响', async () => {
  const s2 = createApp({allowTestEmails: false, mediaDir: join(mkdtempSync(join(tmpdir(), 'v21e-')), 'media')});
  await new Promise(r => s2.listen(0, '127.0.0.1', r));
  const b2 = 'http://127.0.0.1:' + s2.address().port;
  const reg = async (u, email) => { const r = await fetch(b2 + '/api/auth/register', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({agree: true, username: u, email, password: 'Passw0rd123'})}); return {s: r.status, j: await r.json()}; };
  try {
    assert.equal((await reg('okqq1', 'someone@qq.com')).s, 200);
    assert.equal((await reg('okgm1', 'Some.One@Gmail.com')).s, 200);
    assert.equal((await reg('okedu1', 'stu@mails.tsinghua.edu.cn')).s, 200);
    const t = await reg('bad1', 'a@gamil.com');
    assert.equal(t.s, 400); assert.equal(t.j.error.code, 'BAD_EMAIL'); assert.equal(t.j.error.suggest, 'a@gmail.com'); assert.match(t.j.error.message, /是不是想输入 a@gmail\.com/);
    assert.equal((await reg('bad2', 'a@qq.con')).j.error.suggest, 'a@qq.com');
    assert.equal((await reg('bad3', 'a@163.cm')).j.error.suggest, 'a@163.com');
    const o = await reg('bad4', 'a@randomcorp.io');
    assert.equal(o.s, 400); assert.equal(o.j.error.message, '邮箱格式不正确'); assert.equal(o.j.error.suggest, undefined);
    assert.equal((await reg('bad5', 'a@x.test')).s, 400, '正式环境不放行测试域名');
    // 已有账号（白名单之前注册的其他域名）照常登录
    s2.db.prepare("UPDATE users SET email='old@company-mail.com' WHERE username='okqq1'").run();
    const li = await fetch(b2 + '/api/auth/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({account: 'old@company-mail.com', password: 'Passw0rd123'})});
    assert.equal(li.status, 200);
    const st = await (await fetch(b2 + '/api/app/status')).json().catch(() => ({}));
    assert.ok(!st.testEmails);
  } finally { s2.close(); }
});

test('公开分享页 /p /x /e：不登录可看、只含公开信息、HTML 转义、被移除返回 404；项目群聊带 projectId', async () => {
  const o = await acc('shp');
  const pj = await call('POST', '/api/projects', {title: '<b>书</b>小程序', goal: '4 周上线', skills: ['前端', 'UI'], capacity: 4, description: '每周同步'}, o.tok);
  assert.equal(pj.s, 200, JSON.stringify(pj.j));
  const pid = pj.j.project.id;
  await call('POST', '/api/projects/' + pid + '/tasks', {title: '机密任务XYZ'}, o.tok);
  const r = await fetch(base + '/p/' + pid);
  assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/html/);
  const h = await r.text();
  assert.match(h, /&lt;b&gt;书&lt;\/b&gt;小程序/); assert.ok(!/<b>书<\/b>/.test(h));
  assert.match(h, /前端/); assert.match(h, /下载 VEXO/); assert.match(h, /og:title/);
  assert.ok(!h.includes('机密任务XYZ'), '不含任务'); assert.ok(!h.includes(o.u), '不含成员账号');
  assert.equal((await fetch(base + '/p/pj_nope')).status, 404);
  const ex = await call('POST', '/api/exchange', {category: 'music', offers: '吉他', wants: '摄影'}, o.tok);
  const xh = await fetch(base + '/x/' + ex.j.post.id);
  assert.equal(xh.status, 200); const xt = await xh.text(); assert.match(xt, /吉他/); assert.match(xt, /摄影/); assert.ok(!xt.includes(o.u));
  assert.equal((await fetch(base + '/x/nope')).status, 404);
  assert.equal((await fetch(base + '/e/nope')).status, 404);
  assert.equal((await fetch(base + '/p/../etc')).status !== 200, true);
  // 项目群聊：会话里带 projectId，普通群聊没有
  const cv = await call('GET', '/api/conversations', null, o.tok);
  const pc = cv.j.conversations.find(c => c.projectId === pid);
  assert.ok(pc, '项目群聊带 projectId'); assert.equal(pc.kind, 'group');
});

test('项目角色：发起人 = 群主；负责人 = 项目群聊管理员，项目页和群聊双向同步；退出 / 移出后取消；不能转让项目群主；回填', async () => {
  const o = await acc('rlo'), b = await acc('rlb'), c = await acc('rlc');
  const pj = await call('POST', '/api/projects', {title: '角色测试项目', goal: '验证负责人同步', capacity: 5}, o.tok);
  const pid = pj.j.project.id;
  for (const u of [b, c]) { await call('POST', '/api/projects/' + pid + '/apply', {message: 'hi'}, u.tok); await call('POST', '/api/projects/' + pid + '/requests/' + u.id + '/approve', {}, o.tok); }
  const cvId = (await call('GET', '/api/projects/' + pid, null, o.tok)).j.project.conversationId;
  const roleIn = async uid => (await call('GET', '/api/conversations/' + cvId, null, o.tok)).j.conversation.members.find(m => Number(m.id) === Number(uid)).roleKey;
  const pRole = async uid => (await call('GET', '/api/projects/' + pid, null, o.tok)).j.project.members.find(m => Number(m.id) === Number(uid)).role;
  assert.equal(await roleIn(o.id), 'owner');
  assert.equal(await pRole(o.id), 'owner');
  // 项目页设负责人 → 群管理员
  assert.equal((await call('POST', '/api/projects/' + pid + '/members/' + b.id + '/lead', {on: true}, b.tok)).s, 403, '只有发起人能设');
  const set = await call('POST', '/api/projects/' + pid + '/members/' + b.id + '/lead', {on: true}, o.tok);
  assert.equal(set.s, 200, JSON.stringify(set.j));
  assert.equal(await pRole(b.id), 'lead'); assert.equal(await roleIn(b.id), 'admin');
  assert.equal(set.j.project.members[1].role, 'lead', '负责人排在发起人后面');
  // 群聊里取消管理员 → 项目里取消负责人
  assert.equal((await call('POST', '/api/conversations/' + cvId + '/role', {userId: b.id, role: 'member'}, o.tok)).s, 200);
  assert.equal(await pRole(b.id), 'member');
  // 群聊里设管理员 → 项目负责人
  assert.equal((await call('POST', '/api/conversations/' + cvId + '/role', {userId: c.id, role: 'admin'}, o.tok)).s, 200);
  assert.equal(await pRole(c.id), 'lead');
  // 项目页取消
  await call('POST', '/api/projects/' + pid + '/members/' + c.id + '/lead', {on: false}, o.tok);
  assert.equal(await roleIn(c.id), 'member'); assert.equal(await pRole(c.id), 'member');
  // 项目群主不能转让
  const tr = await call('POST', '/api/conversations/' + cvId + '/role', {userId: b.id, role: 'owner'}, o.tok);
  assert.equal(tr.s, 400); assert.equal(tr.j.error.code, 'PROJECT_OWNER');
  // 发起人本身不能设为负责人
  assert.equal((await call('POST', '/api/projects/' + pid + '/members/' + o.id + '/lead', {on: true}, o.tok)).s, 400);
  // 退出后负责人身份取消，重新加入是普通成员
  await call('POST', '/api/projects/' + pid + '/members/' + b.id + '/lead', {on: true}, o.tok);
  await call('POST', '/api/projects/' + pid + '/leave', {}, b.tok);
  await call('POST', '/api/projects/' + pid + '/apply', {message: 'again'}, b.tok); await call('POST', '/api/projects/' + pid + '/requests/' + b.id + '/approve', {}, o.tok);
  assert.equal(await pRole(b.id), 'member'); assert.equal(await roleIn(b.id), 'member');
  // 普通群聊不受影响
  const g = await call('POST', '/api/conversations', {kind: 'group', name: '普通群', memberIds: []}, o.tok);
  if (g.s === 200 && g.j.conversation) assert.ok(!g.j.conversation.projectId);
  // 回填：老数据里群管理员 → 负责人
  srv.db.prepare("UPDATE conversation_members SET role='admin' WHERE conversation_id=? AND user_id=?").run(cvId, c.id);
  srv.db.exec(readFileSync(new URL('../migrations/053_project_leads.sql', import.meta.url), 'utf8'));
  assert.equal(await pRole(c.id), 'lead');
});

test('项目群聊人数 = 招募人数；不能拉人；满员后不在列表 / 搜索里、不能申请或通过；有人退出后自动回来', async () => {
  const o = await acc('cpo'), b = await acc('cpb'), c = await acc('cpc'), d = await acc('cpd');
  const pj = await call('POST', '/api/projects', {title: '满员测试独特标题QZ', goal: '验证满员', capacity: 2}, o.tok);
  const pid = pj.j.project.id;
  const inList = async tok => (await call('GET', '/api/projects?q=' + encodeURIComponent('满员测试独特标题QZ'), null, tok)).j.projects.some(p => p.id === pid);
  assert.equal(await inList(d.tok), true);
  await call('POST', '/api/projects/' + pid + '/apply', {message: '1'}, b.tok);
  await call('POST', '/api/projects/' + pid + '/apply', {message: '2'}, c.tok);
  assert.equal((await call('POST', '/api/projects/' + pid + '/requests/' + b.id + '/approve', {}, o.tok)).s, 200);
  // 满员：待处理的申请不能通过；新申请被拒；列表和搜索里看不到；成员自己的列表和直接打开仍可见
  const full = await call('POST', '/api/projects/' + pid + '/requests/' + c.id + '/approve', {}, o.tok);
  assert.equal(full.s, 409); assert.equal(full.j.error.code, 'FULL');
  assert.equal((await call('POST', '/api/projects/' + pid + '/apply', {message: '3'}, d.tok)).s, 409);
  assert.equal(await inList(d.tok), false);
  assert.equal((await call('GET', '/api/projects', null, d.tok)).j.projects.some(p => p.id === pid), false);
  assert.ok((await call('GET', '/api/projects?mine=1', null, b.tok)).j.projects.some(p => p.id === pid));
  const direct = await call('GET', '/api/projects/' + pid, null, d.tok);
  assert.equal(direct.s, 200); assert.equal(direct.j.project.full, true);
  // 项目群聊：不能拉人；人数上限 = 招募人数
  const cvId = (await call('GET', '/api/projects/' + pid, null, o.tok)).j.project.conversationId;
  const add = await call('POST', '/api/conversations/' + cvId + '/members', {userIds: [d.id], userId: d.id}, o.tok);
  assert.equal(add.s, 403, JSON.stringify(add.j)); assert.equal(add.j.error.code, 'PROJECT_CHAT');
  assert.throws(() => srv.chats.systemAdd(cvId, d.id), e => e.code === 'FULL');
  // 招募人数不能改得比现有成员少；改大后可以继续通过
  assert.equal((await call('POST', '/api/projects/' + pid, {capacity: 1}, o.tok)).s, 400);
  // 有人退出 → 回到列表，计数更新
  await call('POST', '/api/projects/' + pid + '/leave', {}, b.tok);
  assert.equal(await inList(d.tok), true);
  const back = (await call('GET', '/api/projects/' + pid, null, d.tok)).j.project;
  assert.equal(back.memberCount, 1); assert.equal(back.full, false);
  assert.equal((await call('POST', '/api/projects/' + pid + '/requests/' + c.id + '/approve', {}, o.tok)).s, 200);
  assert.equal(await inList(d.tok), false);
  await call('POST', '/api/projects/' + pid, {capacity: 3}, o.tok);
  assert.equal(await inList(d.tok), true);
});
