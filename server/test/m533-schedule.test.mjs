// M5.3.3 帖子草稿与定时发布：服务端执行；取消与失败可见。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';

let srv, base, seq = 0, t0;
test.before(async () => {
  t0 = Date.now();
  srv = createApp({clock: () => t0, scheduleAuto: false});
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

test('服务端到点发布；取消后不会发布；失败原因可见', async () => {
  const a = await acc('sca'), b = await acc('scb');
  const at = t0 + 60_000;
  const cr = await call('POST', '/api/post-drafts', {text: '到点见 #定时', scheduledAt: at}, a.tok);
  assert.equal(cr.s, 200, JSON.stringify(cr.j));
  assert.equal(cr.j.draft.status, 'scheduled');
  assert.equal(cr.j.draft.scheduledAt, at);
  // 尚未到点
  const early = srv.schedule.tick();
  assert.equal(early.ran, 0);
  assert.equal((await call('GET', '/api/posts?author=me', null, a.tok)).j.posts.length, 0);
  t0 = at;
  const ran = srv.schedule.tick();
  assert.equal(ran.ran, 1, JSON.stringify(ran));
  assert.equal(ran.results[0].status, 'published');
  const got = await call('GET', '/api/post-drafts/' + cr.j.draft.id, null, a.tok);
  assert.equal(got.j.draft.status, 'published');
  assert.ok(got.j.draft.publishedPostId);
  const feed = await call('GET', '/api/posts/' + got.j.draft.publishedPostId, null, a.tok);
  assert.equal(feed.j.post.text, '到点见 #定时');
  assert.ok((feed.j.post.hashtags || []).includes('定时'));

  // 取消
  const c2 = await call('POST', '/api/post-drafts', {text: '会取消的', scheduledAt: t0 + 30_000}, a.tok);
  const can = await call('POST', '/api/post-drafts/' + c2.j.draft.id + '/cancel', {}, a.tok);
  assert.equal(can.s, 200);
  assert.equal(can.j.draft.status, 'cancelled');
  assert.ok(can.j.draft.cancelledAt);
  t0 = t0 + 30_000;
  const after = srv.schedule.tick();
  assert.ok(!after.results.some(r => r.id === c2.j.draft.id));
  const still = await call('GET', '/api/post-drafts/' + c2.j.draft.id, null, a.tok);
  assert.equal(still.j.draft.status, 'cancelled');
  // 别人看不到
  const asB = await call('GET', '/api/post-drafts/' + c2.j.draft.id, null, b.tok);
  assert.equal(asB.s, 404);

  // 失败可见
  const f = await call('POST', '/api/post-drafts', {text: '会失败的稿', scheduledAt: t0 + 10_000}, a.tok);
  srv.schedule.setFailNext('模拟发布失败');
  t0 = t0 + 10_000;
  const fr = srv.schedule.tick();
  const fail = fr.results.find(r => r.id === f.j.draft.id);
  assert.equal(fail.status, 'failed');
  const vis = await call('GET', '/api/post-drafts/' + f.j.draft.id, null, a.tok);
  assert.equal(vis.j.draft.status, 'failed');
  assert.equal(vis.j.draft.failReason, '模拟发布失败');
  assert.ok(vis.j.draft.failedAt);
  const list = await call('GET', '/api/post-drafts', null, a.tok);
  assert.ok(list.j.drafts.some(d => d.id === f.j.draft.id && d.status === 'failed' && d.failReason));
});
