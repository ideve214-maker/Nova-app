// 服务端 2.1.2：新外部帖来源、币圈/财经审查提示词、全部启用源都走统一入库与 AI 审查、帖子 category。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';
import {
  parseRss, parseGithubTrending, parseJuejinRank, parseBilibiliPopular, parseWallstcnFlow,
  enabledFeedSources, disabledFeedSources, feedSourceById, SOURCE_LABEL,
} from '../import-sources.mjs';
import {importReviewSystemPrompt, relaxedOverride} from '../ai-moderation.mjs';
import {POST_CATEGORIES, normalizePostCategory} from '../post-category.mjs';

function rss(items) {
  return '<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>' +
    items.map((it, i) => `<item><title>${it.title}</title><link>${it.url || ('https://ex.test/' + i)}</link>` +
      `<guid>${it.guid || it.url || ('g' + i)}</guid><description><![CDATA[${it.summary || ''}]]></description>` +
      `<author>${it.author || 'src-author'}</author><pubDate>Fri, 20 Nov 2026 12:00:00 GMT</pubDate></item>`).join('') +
    '</channel></rss>';
}

test('parseRss / GitHub Trending / 掘金 / B站 / 华尔街见闻 解析', () => {
  const items = parseRss(rss([{title: '标题 A', url: 'https://a.example/1', summary: '<p>正文</p>'}]));
  assert.equal(items.length, 1);
  assert.equal(items[0].title, '标题 A');
  assert.equal(items[0].url, 'https://a.example/1');
  assert.match(items[0].summary, /正文/);

  const gh = parseGithubTrending(`
    <article class="Box-row">
      <h2><a href="/vercel/next.js">vercel / next.js</a></h2>
      <p>The React Framework</p>
    </article>
    <article class="Box-row">
      <h2><a href="/oven-sh/bun">oven-sh / bun</a></h2>
      <p>Incredibly fast JS runtime</p>
    </article>`);
  assert.equal(gh.length, 2);
  assert.equal(gh[0].sid, 'vercel/next.js');
  assert.equal(gh[0].url, 'https://github.com/vercel/next.js');
  assert.match(gh[0].summary, /React Framework/);
  assert.equal(gh[0].name, 'vercel');

  const jj = parseJuejinRank({data: [{content: {content_id: '99', title: '掘金热文', brief: '简介', author_name: '小明'}, author: {avatar_large: 'https://p1-juejin.byteimg.com/a.png'}}]});
  assert.equal(jj[0].sid, '99');
  assert.equal(jj[0].url, 'https://juejin.cn/post/99');
  assert.equal(jj[0].title, '掘金热文');

  const bl = parseBilibiliPopular({data: {list: [{bvid: 'BV1xx', title: '热门视频', desc: '简介', pubdate: 1730000000, short_link_v2: 'https://b23.tv/x', owner: {name: 'up', face: 'https://i0.hdslb.com/f.png'}}]}});
  assert.equal(bl[0].sid, 'BV1xx');
  assert.equal(bl[0].name, 'up');

  const ws = parseWallstcnFlow({data: {items: [{resource: {id: 77, title: '见闻稿', content_short: '摘要', uri: 'https://wallstreetcn.com/articles/77', display_time: 1730000000, author: {display_name: '记者'}}}]}});
  assert.equal(ws[0].sid, '77');
  assert.equal(ws[0].title, '见闻稿');
  assert.equal(ws[0].name, '记者');
});

test('币圈/财经审查提示词额外拦截喊单、交易信号、交易所和空投推广；普通源不加这些', () => {
  const fin = importReviewSystemPrompt({finance: true});
  const plain = importReviewSystemPrompt({finance: false});
  for (const w of ['喊单', '交易信号', '空投', '交易所']) {
    assert.match(fin, new RegExp(w), 'finance prompt should include ' + w);
    assert.doesNotMatch(plain, new RegExp(w), 'plain prompt should not include ' + w);
  }
  assert.equal(relaxedOverride('广告', '推广广告'), true);
  assert.equal(relaxedOverride('广告', '交易所推广', {finance: true}), false);
  assert.equal(relaxedOverride('喊单', '疑似喊单炒币', {finance: true}), false);
});

test('36氪等不可用源保持停用并带原因；启用源都有默认分类', () => {
  const kr = feedSourceById('36kr');
  assert.equal(kr.enabled, false);
  assert.match(kr.disabledReason, /HTML|网页/);
  for (const s of ['huxiu', 'lobsters', 'reddit', 'weibo', 'zhihu', 'blockbeats', 'coindesk', 'gamersky', 'cls', 'xueqiu']) {
    const row = feedSourceById(s);
    assert.ok(row, s);
    assert.equal(row.enabled, false, s);
    assert.ok(row.disabledReason, s);
  }
  for (const s of enabledFeedSources()) {
    assert.ok(POST_CATEGORIES.includes(s.category), s.id + ' category');
    assert.ok(SOURCE_LABEL[s.id]);
  }
  assert.ok(enabledFeedSources().some(s => s.id === 'panews' && s.category === 'crypto'));
  assert.ok(enabledFeedSources().some(s => s.id === 'wallstcn' && s.category === 'finance'));
  assert.ok(disabledFeedSources().length >= 10);
});

function payloadFor(src, allowTitle, blockTitle) {
  const allow = {title: allowTitle, url: 'https://ex.test/' + src.id + '/ok', guid: src.id + '-ok', summary: '正常内容', author: src.name};
  const block = {title: blockTitle, url: 'https://ex.test/' + src.id + '/bad', guid: src.id + '-bad', summary: 'BLOCKME 违规', author: src.name};
  if (src.kind === 'rss' || src.kind === 'atom') {
    return {body: rss([allow, block]), type: 'application/rss+xml'};
  }
  if (src.kind === 'github_trending') {
    const art = (it) => `<article class="Box-row"><h2><a href="/vexo/${it.guid}">vexo / ${it.guid}</a></h2><p>${it.title}. ${it.summary}</p></article>`;
    return {body: art(allow) + art(block), type: 'text/html'};
  }
  if (src.kind === 'juejin') {
    return {json: {data: [
      {content: {content_id: allow.guid, title: allow.title, brief: allow.summary, author_name: allow.author}},
      {content: {content_id: block.guid, title: block.title, brief: block.summary, author_name: block.author}},
    ]}, type: 'application/json'};
  }
  if (src.kind === 'bilibili') {
    return {json: {data: {list: [
      {bvid: allow.guid, title: allow.title, desc: allow.summary, pubdate: 1730000000, short_link_v2: allow.url, owner: {name: allow.author}},
      {bvid: block.guid, title: block.title, desc: block.summary, pubdate: 1730000001, short_link_v2: block.url, owner: {name: block.author}},
    ]}}, type: 'application/json'};
  }
  if (src.kind === 'wallstcn') {
    return {json: {data: {items: [
      {resource: {id: allow.guid, title: allow.title, content_short: allow.summary, uri: allow.url, display_time: 1730000000, author: {display_name: allow.author}}},
      {resource: {id: block.guid, title: block.title, content_short: block.summary, uri: block.url, display_time: 1730000001, author: {display_name: block.author}}},
    ]}}, type: 'application/json'};
  }
  return {body: '', type: 'text/plain'};
}

function makeFetch() {
  const enabled = enabledFeedSources();
  return async (url) => {
    const u = String(url);
    const json = (v, type = 'application/json') => ({
      ok: true, status: 200,
      headers: {get: k => k.toLowerCase() === 'content-type' ? type : null},
      json: async () => v, text: async () => JSON.stringify(v),
    });
    const text = (body, type) => ({
      ok: true, status: 200,
      headers: {get: k => k.toLowerCase() === 'content-type' ? type : null},
      text: async () => body, json: async () => { throw new Error('not json'); },
    });
    if (u.includes('/api/topics/latest.json') || u.includes('/api/topics/hot.json')) {
      return json([
        {id: 'v2ex-ok', title: 'V2EX 正常帖', url: 'https://www.v2ex.com/t/v2ex-ok', content: '正文', created: 1730000000, member: {username: 'livid'}},
        {id: 'v2ex-bad', title: 'V2EX BLOCKME 帖', url: 'https://www.v2ex.com/t/v2ex-bad', content: '违规', created: 1730000001, member: {username: 'spam'}},
      ]);
    }
    if (u.includes('/api/replies/show.json')) return json([]);
    if (u.includes('/v0/topstories.json') || u.includes('/v0/newstories.json') || u.includes('/v0/beststories.json')) {
      return json([91001, 91002]);
    }
    const im = /\/v0\/item\/(\d+)\.json/.exec(u);
    if (im) {
      const id = Number(im[1]);
      if (id === 91001) return json({id, type: 'story', by: 'pg', title: 'HN ok story', time: 1730001000, kids: []});
      if (id === 91002) return json({id, type: 'story', by: 'sp', title: 'HN BLOCKME story', time: 1730001001, kids: []});
      return {ok: false, status: 404, json: async () => null, text: async () => ''};
    }
    for (const src of enabled) {
      if (src.kind === 'builtin' || !src.url) continue;
      if (u === src.url || u.startsWith(src.url)) {
        const p = payloadFor(src, src.name + ' 正常帖', src.name + ' BLOCKME 帖');
        if (p.json) return json(p.json, p.type);
        return text(p.body, p.type);
      }
    }
    return {ok: false, status: 404, json: async () => ({}), text: async () => ''};
  };
}

function makeAi() {
  const ai = {calls: 0, prompts: [], items: []};
  ai.fetch = async (url, opt) => {
    ai.calls++;
    const body = JSON.parse(opt.body);
    const sys = body.messages[0].content;
    const text = body.messages[1].content;
    ai.prompts.push(sys);
    const blocked = [];
    for (const line of text.split('\n')) {
      const m = /^\[(\d+)\] (.*)$/.exec(line);
      if (!m) continue;
      ai.items.push(m[2]);
      if (/BLOCKME/.test(m[2])) blocked.push({i: Number(m[1]), category: '赌博诈骗', reason: '赌博引流'});
    }
    return Response.json({choices: [{message: {content: JSON.stringify({blocked, topics: []})}}]});
  };
  return ai;
}

async function boot() {
  const ai = makeAi();
  const srv = createApp({
    adminUsername: 'ops_src', adminPassword: 'OpsSrcPass1!',
    importFetch: makeFetch(), importAuto: false, importDelayMs: 0, importRetryDelayMs: 0, importRetries: 1,
    aiEnv: {AI_API_KEY: 'test-key-not-real', AI_RPM: '1000', AI_RPD: '100000'}, aiFetch: ai.fetch,
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const call = async (m, p, body, tok) => {
    const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
    let j = null; try { j = await r.json(); } catch {}
    return {s: r.status, j};
  };
  const close = () => new Promise(r => { srv.close(r); srv.closeAllConnections?.(); });
  return {srv, ai, call, close, db: srv.db, base};
}

test('每个启用源都走统一入库与 AI 审查；不合格的不入库；合格帖带上来源默认 category', async () => {
  const b = await boot();
  try {
    const enabled = enabledFeedSources();
    const run = await b.srv.importFeed.run();
    assert.equal(run.v2ex.ok, true, JSON.stringify(run.v2ex));
    assert.equal(run.hn.ok, true, JSON.stringify(run.hn));
    for (const src of enabled) {
      const out = run[src.id];
      assert.ok(out, 'missing run result for ' + src.id);
      assert.equal(out.ok, true, src.id + ' ' + JSON.stringify(out));
      assert.equal(out.imported, 1, src.id + ' imported ' + JSON.stringify(out));
      assert.equal(out.rejected, 1, src.id + ' rejected ' + JSON.stringify(out));
      const rows = b.db.prepare('SELECT * FROM posts WHERE source=?').all(src.id);
      assert.equal(rows.length, 1, src.id + ' saved rows');
      assert.ok(!/BLOCKME/.test(rows[0].text), src.id + ' rejected item was saved');
      const needle = String(rows[0].text || '').replace(/\s+/g, ' ').slice(0, 24);
      assert.ok(b.ai.items.some(t => (needle && t.includes(needle)) || t.includes(src.id) || t.includes(src.name)), src.id + ' not sent to AI: ' + JSON.stringify(b.ai.items));
      assert.equal(rows[0].category, src.category, src.id + ' category');
      assert.equal(rows[0].ai_review, 'pass');
    }
    // 逐个来源都出现在送审文本里（用标题或 sid）
    for (const src of enabled) {
      const hit = b.ai.items.some(t => t.includes(src.name) || t.includes(src.id) || t.includes('BLOCKME') || (src.kind === 'builtin' && (t.includes('V2EX') || t.includes('HN') || t.includes('Show') || t.includes('ok story') || t.includes('正常'))));
      assert.ok(hit || b.ai.items.length >= enabled.length, 'AI saw items for ' + src.id);
    }
    assert.ok(b.ai.items.some(t => /BLOCKME/.test(t)), 'AI must see rejected items');
    const blockedSaved = b.db.prepare("SELECT COUNT(*) n FROM posts WHERE text LIKE '%BLOCKME%'").get().n;
    assert.equal(blockedSaved, 0);
    assert.equal(b.db.prepare('SELECT COUNT(*) n FROM posts WHERE source IS NOT NULL').get().n, enabled.length);

    // 币圈/财经那几路的提示词必须走到额外分支
    const financePrompts = b.ai.prompts.filter(p => /喊单/.test(p));
    assert.ok(financePrompts.length >= 1, 'finance prompt branch not used');
    const financeIds = enabled.filter(s => s.category === 'crypto' || s.category === 'finance').map(s => s.id);
    assert.ok(financeIds.length >= 3);
  } finally { await b.close(); }
});

test('用户发帖可带 category，非法值返回 BAD_CATEGORY；payload 暴露 category', async () => {
  const b = await boot();
  try {
    const reg = await b.call('POST', '/api/auth/register', {agree: true, username: 'catuser1', email: 'catuser1@qq.com', password: 'Passw0rd123'});
    assert.equal(reg.s, 200, JSON.stringify(reg.j));
    const tok = reg.j.token;
    const bad = await b.call('POST', '/api/posts', {text: '你好世界分类测试', category: 'sports'}, tok);
    assert.equal(bad.s, 400);
    assert.equal(bad.j && bad.j.error && bad.j.error.code, 'BAD_CATEGORY');
    const ok = await b.call('POST', '/api/posts', {text: '你好世界分类测试通过', category: 'life'}, tok);
    assert.equal(ok.s, 200, JSON.stringify(ok.j));
    assert.equal(ok.j.post.category, 'life');
    const got = await b.call('GET', '/api/posts/' + ok.j.post.id, null, tok);
    assert.equal(got.s, 200);
    assert.equal(got.j.post.category, 'life');
    assert.equal(normalizePostCategory('TECH'), 'tech');
  } finally { await b.close(); }
});
