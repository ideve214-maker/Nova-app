// M4.7 搜索：用户/帖子/社区/消息，范围受权限约束；不为越权或私密内容提供结果。
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
  const r = await call('POST', '/api/auth/register', {username: u, email: u + '@x.test', password: 'Passw0rd123'});
  return {tok: r.j.token, id: r.j.user.id, name: u};
}

test('能搜到可见的用户、帖子、公开社区和自己会话里的消息；搜不到关掉可搜索、私密社区和非成员消息', async () => {
  const a = await acc('sea'), b = await acc('seb'), c = await acc('sec');
  await call('POST', '/api/me/profile', {displayName: '林可搜'}, a.tok);
  await call('POST', '/api/me/profile', {displayName: '隐身人'}, b.tok);
  await call('POST', '/api/me/privacy', {searchable: false}, b.tok);
  const pa = (await call('POST', '/api/posts', {text: '今天去了独特河岸看灯', clientId: 's1'}, a.tok)).j.post;
  await call('POST', '/api/posts', {text: '无关内容', clientId: 's2'}, b.tok);
  const pub = (await call('POST', '/api/communities', {name: '独特灯社', visibility: 'public'}, a.tok)).j.community;
  const priv = (await call('POST', '/api/communities', {name: '独特密室', visibility: 'private'}, a.tok)).j.community;
  srv.friends.setAccepted(a.id, c.id);
  const cv = (await call('POST', '/api/conversations', {kind: 'dm', userId: c.id}, a.tok)).j.conversation;
  await call('POST', '/api/conversations/' + cv.id + '/messages', {text: '独特密语只给好友', clientId: 'sm1'}, a.tok);

  const r = await call('GET', '/api/search?q=' + encodeURIComponent('独特'), null, c.tok);
  assert.equal(r.s, 200, JSON.stringify(r.j));
  assert.ok(r.j.posts.some(p => p.id === pa.id));
  assert.ok(r.j.communities.some(x => x.id === pub.id));
  assert.ok(!r.j.communities.some(x => x.id === priv.id), '私密社区对非成员不可见');
  assert.ok(r.j.messages.some(m => m.text.includes('独特密语')));

  const asB = await call('GET', '/api/search?q=' + encodeURIComponent('独特密语'), null, b.tok);
  assert.ok(!asB.j.messages.some(m => m.text.includes('独特密语')), '非成员不能搜到私聊');

  const users = await call('GET', '/api/search?q=' + encodeURIComponent('林可搜') + '&type=user', null, c.tok);
  assert.ok(users.j.users.some(u => u.id === a.id));
  const hidden = await call('GET', '/api/search?q=' + encodeURIComponent('隐身人') + '&type=user', null, c.tok);
  assert.ok(!hidden.j.users.some(u => u.id === b.id), '关闭可被搜索后不出现');
});
