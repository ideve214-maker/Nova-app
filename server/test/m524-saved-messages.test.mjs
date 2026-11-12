// M5.2.4 消息个人收藏：与群聊公共置顶完全分开。
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
  return {tok: r.j.token, id: r.j.user.id};
}

test('收藏消息只对自己可见，不会进入群公共置顶', async () => {
  const a = await acc('sva'), b = await acc('svb');
  srv.friends.setAccepted(a.id, b.id);
  const g = (await call('POST', '/api/conversations', {kind: 'group', name: '收藏测试群', userIds: [b.id]}, a.tok)).j.conversation;
  const msg = (await call('POST', '/api/conversations/' + g.id + '/messages', {text: '请收藏但不置顶'}, a.tok)).j.message;
  const sv = await call('POST', '/api/messages/' + msg.id + '/save', {excerpt: '请收藏但不置顶'}, a.tok);
  assert.equal(sv.s, 200, JSON.stringify(sv.j));
  assert.equal(sv.j.saved, true);
  assert.equal(sv.j.item.kind, 'message');
  const list = await call('GET', '/api/saved-messages', null, a.tok);
  assert.equal(list.s, 200);
  assert.equal(list.j.separateFromPublicPins, true);
  assert.ok(list.j.items.some(i => i.target.endsWith(':' + msg.id)));
  const asB = await call('GET', '/api/saved-messages', null, b.tok);
  assert.equal((asB.j.items || []).length, 0);
  const conv = await call('GET', '/api/conversations/' + g.id, null, b.tok);
  const pins = conv.j.conversation.publicPins || conv.j.publicPins || [];
  assert.ok(!pins.includes(msg.id), '收藏不得出现在公共置顶');
  // 公共置顶不进入个人收藏
  const pin = await call('POST', '/api/messages/' + msg.id + '/pin', {kind: 'public'}, a.tok);
  assert.equal(pin.s, 200, JSON.stringify(pin.j));
  assert.ok((pin.j.publicPins || []).includes(msg.id));
  const list2 = await call('GET', '/api/saved-messages', null, b.tok);
  assert.equal((list2.j.items || []).length, 0, '别人的公共置顶不是我的收藏');
  const un = await call('POST', '/api/messages/' + msg.id + '/unsave', {}, a.tok);
  assert.equal(un.s, 200);
  assert.equal((await call('GET', '/api/saved-messages', null, a.tok)).j.items.length, 0);
  const stillPin = await call('GET', '/api/conversations/' + g.id, null, a.tok);
  const pins2 = stillPin.j.conversation.publicPins || stillPin.j.publicPins || [];
  assert.ok(pins2.includes(msg.id), '取消收藏不影响公共置顶');
});
