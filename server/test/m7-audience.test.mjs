// M7 帖子受众：公开/关注者/好友/仅自己；列表与详情按权限过滤，不泄露私密帖。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';

let srv, base, seq = 0;
test.before(async () => { srv = createApp(); await new Promise(r => srv.listen(0, '127.0.0.1', r)); base = 'http://127.0.0.1:' + srv.address().port; });
test.after(() => srv.close());
const call = async (m, p, body, tok) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  return {s: r.status, j: await r.json()};
};
async function acc(n) {
  const u = n + (++seq);
  const r = await call('POST', '/api/auth/register', {agree:true, username: u, email: u + '@x.test', password: 'Passw0rd123'});
  return {tok: r.j.token, id: r.j.user.id, username: r.j.user.username};
}
function ids(feed){return (feed.j.posts||[]).map(p=>p.id)}

test('默认受众为公开；非法值回退为 public', async () => {
  const a = await acc('aa'), b = await acc('ab');
  const p = await call('POST', '/api/posts', {text: '公开默认'}, a.tok);
  assert.equal(p.s, 200, JSON.stringify(p.j));
  assert.equal(p.j.post.audience, 'public');
  const bad = await call('POST', '/api/posts', {text: '坏受众', audience: 'everyone'}, a.tok);
  assert.equal(bad.s, 200);
  assert.equal(bad.j.post.audience, 'public');
  const rec = await call('GET', '/api/posts?feed=rec', null, b.tok);
  assert.ok(ids(rec).includes(p.j.post.id));
  assert.equal((await call('GET', '/api/posts/' + p.j.post.id, null, b.tok)).s, 200);
});

test('关注者可见：未关注看不到，关注后可见；作者自己始终可见', async () => {
  const a = await acc('ba'), b = await acc('bb');
  const p = await call('POST', '/api/posts', {text: '只给关注者', audience: 'followers', mood: '开心', location: '上海'}, a.tok);
  assert.equal(p.s, 200);
  assert.equal(p.j.post.audience, 'followers');
  assert.equal(p.j.post.mood, '开心');
  assert.equal(p.j.post.location, '上海');
  const rec0 = await call('GET', '/api/posts?feed=rec', null, b.tok);
  assert.ok(!ids(rec0).includes(p.j.post.id), '未关注不应看到');
  assert.equal((await call('GET', '/api/posts/' + p.j.post.id, null, b.tok)).s, 404);
  const self = await call('GET', '/api/posts?author=me', null, a.tok);
  assert.ok(ids(self).includes(p.j.post.id));
  const fol = await call('POST', '/api/follows', {userId: a.id}, b.tok);
  assert.equal(fol.s, 200, JSON.stringify(fol.j));
  const rec1 = await call('GET', '/api/posts?feed=rec', null, b.tok);
  assert.ok(ids(rec1).includes(p.j.post.id), '关注后应看到');
  assert.equal((await call('GET', '/api/posts/' + p.j.post.id, null, b.tok)).s, 200);
});

test('好友可见：非好友看不到；双向确认后可见。仅自己只有作者可见', async () => {
  const a = await acc('ca'), b = await acc('cb');
  const fr = await call('POST', '/api/posts', {text: '好友贴', audience: 'friends'}, a.tok);
  const sl = await call('POST', '/api/posts', {text: '私密日记', audience: 'self'}, a.tok);
  assert.equal(fr.s, 200); assert.equal(sl.s, 200);
  assert.ok(!ids(await call('GET', '/api/posts', null, b.tok)).includes(fr.j.post.id));
  assert.ok(!ids(await call('GET', '/api/posts', null, b.tok)).includes(sl.j.post.id));
  assert.equal((await call('GET', '/api/posts/' + sl.j.post.id, null, b.tok)).s, 404);
  assert.ok(ids(await call('GET', '/api/posts', null, a.tok)).includes(sl.j.post.id));
  const rq = await call('POST', '/api/friends/request', {userId: b.id}, a.tok);
  assert.equal(rq.s, 200, JSON.stringify(rq.j));
  const ac = await call('POST', '/api/friends/accept', {userId: a.id}, b.tok);
  assert.equal(ac.s, 200, JSON.stringify(ac.j));
  const rec = await call('GET', '/api/posts', null, b.tok);
  assert.ok(ids(rec).includes(fr.j.post.id), '成为好友后应看到好友贴');
  assert.ok(!ids(rec).includes(sl.j.post.id), '仅自己仍不可见');
});

test('话题流 feed=topic 只含带标签的可见帖', async () => {
  const a = await acc('da'), b = await acc('db');
  const t = await call('POST', '/api/posts', {text: '今天 #摄影 出片了'}, a.tok);
  const n = await call('POST', '/api/posts', {text: '没有标签的普通帖'}, a.tok);
  const hid = await call('POST', '/api/posts', {text: '私密 #秘密', audience: 'self'}, a.tok);
  assert.equal(t.s, 200); assert.equal(n.s, 200);
  const topic = await call('GET', '/api/posts?feed=topic', null, b.tok);
  assert.equal(topic.s, 200, JSON.stringify(topic.j));
  const idset = ids(topic);
  assert.ok(idset.includes(t.j.post.id));
  assert.ok(!idset.includes(n.j.post.id));
  assert.ok(!idset.includes(hid.j.post.id));
});
