// M5.3.2 话题标签：创建、搜索、热门与滥用限制。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';

let srv, base, seq = 0, t0;
test.before(async () => {
  t0 = Date.now();
  srv = createApp({clock: () => t0});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
});
test.after(() => srv.close());
const call = async (m, p, body, tok) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  return {s: r.status, j: await r.json()};
};
async function acc(n) {
  const u = n + (++seq);
  const r = await call('POST', '/api/auth/register', {agree:true, username: u, email: u + '@x.test', password: 'Passw0rd123'});
  return {tok: r.j.token, id: r.j.user.id};
}

test('发帖自动创建标签；可搜索；热门按最近使用排序', async () => {
  const a = await acc('hta');
  const p1 = await call('POST', '/api/posts', {text: '今天去了 #上海 看 #展览'}, a.tok);
  assert.equal(p1.s, 200, JSON.stringify(p1.j));
  assert.deepEqual(p1.j.post.hashtags.sort(), ['上海', '展览']);
  await call('POST', '/api/posts', {text: '还是 #上海 好'}, a.tok);
  const cr = await call('POST', '/api/hashtags', {name: '独立标签'}, a.tok);
  assert.equal(cr.s, 200, JSON.stringify(cr.j));
  assert.equal(cr.j.tag.name, '独立标签');
  const sr = await call('GET', '/api/hashtags/search?q=上', null, a.tok);
  assert.equal(sr.s, 200);
  assert.ok(sr.j.tags.some(t => t.name === '上海' && t.uses >= 2), JSON.stringify(sr.j));
  const tr = await call('GET', '/api/hashtags/trending', null, a.tok);
  assert.ok(tr.j.tags[0].name === '上海', JSON.stringify(tr.j));
  const one = await call('GET', '/api/hashtags/' + encodeURIComponent('上海'), null, a.tok);
  assert.equal(one.s, 200);
  assert.ok(one.j.posts.length >= 2);
});

test('每帖最多 5 个标签；每小时新建标签有上限', async () => {
  const a = await acc('htb');
  const too = await call('POST', '/api/posts', {text: '#aa #bb #cc #dd #ee #ff'}, a.tok);
  assert.equal(too.s, 400);
  assert.equal(too.j.error.code, 'TOO_MANY_TAGS');
  const bad = await call('POST', '/api/hashtags', {name: 'x'}, a.tok);
  assert.equal(bad.s, 400);
  // 20 new + already used ones from extract; 21st new should 429
  for (let i = 0; i < 20; i++) {
    const name = 'tag' + String(i).padStart(2, '0') + 'x';
    const r = await call('POST', '/api/hashtags', {name}, a.tok);
    assert.equal(r.s, 200, name + ' ' + JSON.stringify(r.j));
  }
  const over = await call('POST', '/api/hashtags', {name: 'tag99x'}, a.tok);
  assert.equal(over.s, 429);
  assert.equal(over.j.error.code, 'TAG_RATE');
  // 同一已存在标签不占新名额
  const again = await call('POST', '/api/hashtags', {name: 'tag00x'}, a.tok);
  assert.equal(again.s, 200);
  assert.equal(again.j.created, false);
});
