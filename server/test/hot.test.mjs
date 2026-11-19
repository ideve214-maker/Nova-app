// 热榜 API：不访问外网。覆盖解析（丢弃正文）、去重、限频和失败保留上次结果。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';
import {parseV2ex, parseHn, cleanTitle, attribution} from '../hot.mjs';

const V2EX = [
  {id: 1001, title: 'V2EX 热议一', url: 'https://www.v2ex.com/t/1001', replies: 42, member: {username: 'alice'}, created: 1700000000, content: 'SECRET_BODY_V2EX', content_rendered: '<p>SECRET_BODY_V2EX</p>'},
  {id: 1002, title: 'V2EX 热议二', url: 'https://www.v2ex.com/t/1002', replies: 10, member: {username: 'bob'}, created: 1700001000, content: 'should-not-store'},
  {id: 1001, title: 'V2EX 热议一（重复）', url: 'https://www.v2ex.com/t/1001', replies: 43, member: {username: 'alice'}, created: 1700000000, content: 'dup'},
];
const HN_TOP = [9001, 9002, 9003];
const HN_ITEMS = {
  9001: {id: 9001, title: 'An interesting HN story', url: 'https://example.com/hn1', by: 'pg', score: 256, time: 1700002000, text: 'SECRET_BODY_HN'},
  9002: {id: 9002, title: 'Ask HN: Something', by: 'dang', score: 80, time: 1700003000},
  9003: {id: 9003, title: 'Deleted', deleted: true, by: 'x', score: 1, time: 1700004000, text: 'nope'},
};

function mockFetch(calls, {failV2ex = false, failHn = false, v2ex = V2EX} = {}) {
  return async (url) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('/api/topics/hot.json')) {
      if (failV2ex) throw new Error('network down');
      return {ok: true, status: 200, json: async () => v2ex};
    }
    if (u.includes('/v0/topstories.json')) {
      if (failHn) throw new Error('network down');
      return {ok: true, status: 200, json: async () => HN_TOP};
    }
    const m = u.match(/\/v0\/item\/(\d+)\.json/);
    if (m) {
      const it = HN_ITEMS[m[1]];
      if (!it) return {ok: false, status: 404, json: async () => ({})};
      return {ok: true, status: 200, json: async () => it};
    }
    return {ok: false, status: 404, json: async () => ({})};
  };
}

let seq = 0;
async function boot(opts = {}) {
  const calls = opts.calls || [];
  const srv = createApp({
    hotFetch: opts.hotFetch || mockFetch(calls, opts),
    hotInterval: opts.hotInterval != null ? opts.hotInterval : 60 * 60 * 1000,
    hotLimit: opts.hotLimit || 20,
    hotItemDelay: 0,
    scheduleAuto: false,
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const call = async (m, p, body, tok) => {
    const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
    return {s: r.status, j: await r.json()};
  };
  const acc = async () => {
    const u = 'hot' + (++seq);
    const r = await call('POST', '/api/auth/register', {agree: true, username: u, email: u + '@x.test', password: 'Passw0rd123'});
    assert.equal(r.s, 200, JSON.stringify(r.j));
    return r.j.token;
  };
  return {srv, call, acc, calls, close: () => new Promise(r => { srv.close(r); srv.closeAllConnections?.(); })};
}

test('parseV2ex / parseHn 丢掉正文，只留标题热度作者链接', () => {
  const v = parseV2ex(V2EX[0]);
  assert.equal(v.source_id, '1001');
  assert.equal(v.title, 'V2EX 热议一');
  assert.equal(v.heat, 42);
  assert.equal(v.author, 'alice');
  assert.equal(v.url, 'https://www.v2ex.com/t/1001');
  assert.ok(!JSON.stringify(v).includes('SECRET_BODY'));
  const h = parseHn(HN_ITEMS[9001]);
  assert.equal(h.title, 'An interesting HN story');
  assert.equal(h.heat, 256);
  assert.ok(!JSON.stringify(h).includes('SECRET_BODY_HN'));
  const ask = parseHn(HN_ITEMS[9002]);
  assert.equal(ask.url, 'https://news.ycombinator.com/item?id=9002');
  assert.equal(parseHn(HN_ITEMS[9003]), null);
  assert.equal(cleanTitle('  a   b  '), 'a b');
  assert.match(attribution().mofish, /mofish/);
});

test('未登录不能看热榜', async () => {
  const b = await boot();
  try { assert.equal((await b.call('GET', '/api/hot?source=v2ex')).s, 401); }
  finally { await b.close(); }
});

test('刷新后按 source+id 去重，不返回正文，带出处', async () => {
  const calls = [];
  const b = await boot({calls});
  try {
    const tok = await b.acc();
    const r = await b.call('GET', '/api/hot?source=v2ex', null, tok);
    assert.equal(r.s, 200, JSON.stringify(r.j));
    assert.equal(r.j.source, 'v2ex');
    assert.equal(r.j.items.length, 2, '重复 id 应合并');
    assert.equal(r.j.items[0].title, 'V2EX 热议一（重复）'); // upsert 用后出现的标题
    assert.equal(r.j.items[0].heat, 43);
    const dump = JSON.stringify(r.j);
    assert.ok(!dump.includes('SECRET_BODY') && !dump.includes('should-not-store') && !dump.includes('content_rendered'));
    assert.match(r.j.attribution.text, /V2EX/);
    assert.equal(r.j.sourceHome, 'https://www.v2ex.com');
    const hn = await b.call('GET', '/api/hot?source=hn', null, tok);
    assert.equal(hn.s, 200, JSON.stringify(hn.j));
    assert.equal(hn.j.items.length, 2);
    assert.equal(hn.j.items[0].title, 'An interesting HN story');
    assert.ok(hn.j.items.some(i => i.title.startsWith('Ask HN')));
    assert.ok(!hn.j.items.some(i => i.title === 'Deleted'));
    assert.ok(!JSON.stringify(hn.j).includes('SECRET_BODY_HN'));
  } finally { await b.close(); }
});

test('间隔内再次刷新不打官方接口（礼貌限频）', async () => {
  const calls = [];
  const b = await boot({calls, hotInterval: 60 * 60 * 1000});
  try {
    const tok = await b.acc();
    await b.call('GET', '/api/hot?source=v2ex', null, tok);
    const n1 = calls.filter(u => u.includes('hot.json')).length;
    await b.srv.hot.refresh('v2ex');
    const n2 = calls.filter(u => u.includes('hot.json')).length;
    assert.equal(n2, n1, '限频窗口内不应再请求: ' + n2);
    const r = await b.call('GET', '/api/hot?source=v2ex', null, tok);
    assert.equal(r.j.items.length, 2);
  } finally { await b.close(); }
});

test('拉取失败时保留上次结果', async () => {
  const calls = [];
  let failV2ex = false;
  const fetchFn = mockFetch(calls, {});
  const wrapped = async (url) => {
    if (failV2ex && String(url).includes('hot.json')) throw new Error('down');
    return fetchFn(url);
  };
  const b = await boot({hotFetch: wrapped, hotInterval: 0});
  try {
    const tok = await b.acc();
    const first = await b.call('GET', '/api/hot?source=v2ex', null, tok);
    assert.equal(first.j.items.length, 2);
    failV2ex = true;
    const again = await b.srv.hot.refresh('v2ex', {force: true});
    assert.equal(again.items.length, 2);
    assert.equal(again.items[0].title.includes('V2EX'), true);
  } finally { await b.close(); }
});

test('迁移 059 建立了 hot_items 唯一约束', async () => {
  const b = await boot();
  try {
    const db = b.srv.db;
    const cols = db.prepare('PRAGMA table_info(hot_items)').all().map(c => c.name);
    assert.ok(cols.includes('source') && cols.includes('source_id') && cols.includes('title') && cols.includes('url'));
    assert.ok(!cols.includes('body') && !cols.includes('content'));
    const idx = db.prepare('PRAGMA index_list(hot_items)').all();
    assert.ok(idx.length >= 1);
  } finally { await b.close(); }
});
