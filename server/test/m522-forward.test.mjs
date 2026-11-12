// M5.2.2 消息转发：来源/转发标识，尊重隐私与拉黑，加密私聊须客户端重加密。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';
import {Account} from './vodo.mjs';

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
  return {tok: r.j.token, id: r.j.user.id, u};
}
function befriend(a, b) { srv.friends.setAccepted(a.id, b.id); }
async function dm(a, b) {
  befriend(a, b);
  return (await call('POST', '/api/conversations', {kind: 'dm', userId: b.id}, a.tok)).j.conversation;
}

test('转发带「转发」标识和来源；目标会话能看到', async () => {
  const a = await acc('fa'), b = await acc('fb'), c = await acc('fc');
  const cvAb = await dm(a, b);
  const cvAc = await dm(a, c);
  const src = await call('POST', '/api/conversations/' + cvAb.id + '/messages', {text: '请帮我转告'}, b.tok);
  const fwd = await call('POST', '/api/messages/' + src.j.message.id + '/forward', {conversationId: cvAc.id}, a.tok);
  assert.equal(fwd.s, 200, JSON.stringify(fwd.j));
  assert.equal(fwd.j.message.forwarded, true);
  assert.equal(fwd.j.message.text, '请帮我转告');
  assert.equal(fwd.j.message.forwardFrom.label, '转发');
  assert.ok(fwd.j.message.forwardFrom.displayName);
  assert.equal(fwd.j.message.conversationId, cvAc.id);
  const hist = await call('GET', '/api/conversations/' + cvAc.id + '/messages', null, c.tok);
  const m = hist.j.messages.find(x => x.id === fwd.j.message.id);
  assert.ok(m.forwarded);
  assert.equal(m.forwardFrom.userId, b.id);
});

test('拉黑或非好友不能转发到对方私聊；非成员不能转发源消息', async () => {
  const a = await acc('fd'), b = await acc('fe'), c = await acc('ff');
  const cvAb = await dm(a, b);
  const src = await call('POST', '/api/conversations/' + cvAb.id + '/messages', {text: '内部'}, a.tok);
  // c 不是源会话成员
  const noMem = await call('POST', '/api/messages/' + src.j.message.id + '/forward', {conversationId: 'cv_x'}, c.tok);
  assert.ok(noMem.s === 404 || noMem.s === 400);
  // a 与 c 不是好友，不能开私聊转发
  const cvTry = await call('POST', '/api/conversations', {kind: 'dm', userId: c.id}, a.tok);
  assert.equal(cvTry.s, 403);
  // 成为好友后再拉黑
  befriend(a, c);
  const cvAc = (await call('POST', '/api/conversations', {kind: 'dm', userId: c.id}, a.tok)).j.conversation;
  await call('POST', '/api/blocks', {userId: c.id}, a.tok);
  const blocked = await call('POST', '/api/messages/' + src.j.message.id + '/forward', {conversationId: cvAc.id}, a.tok);
  assert.equal(blocked.s, 403);
  assert.equal(blocked.j.error.code, 'BLOCKED');
});

test('原作者拉黑了目标用户时隐藏来源身份', async () => {
  const a = await acc('fg'), b = await acc('fh'), c = await acc('fi');
  const cvAb = await dm(a, b);
  const cvAc = await dm(a, c);
  const src = await call('POST', '/api/conversations/' + cvAb.id + '/messages', {text: '别让他知道是我说的'}, b.tok);
  await call('POST', '/api/blocks', {userId: c.id}, b.tok);
  const fwd = await call('POST', '/api/messages/' + src.j.message.id + '/forward', {conversationId: cvAc.id}, a.tok);
  assert.equal(fwd.s, 200, JSON.stringify(fwd.j));
  // 转发者自己能看到来源（未与 b 拉黑）
  assert.equal(fwd.j.message.forwardFrom.hidden, false);
  const asC = await call('GET', '/api/conversations/' + cvAc.id + '/messages', null, c.tok);
  const m = asC.j.messages.find(x => x.id === fwd.j.message.id);
  assert.equal(m.forwardFrom.hidden, true);
  assert.equal(m.forwardFrom.displayName, '一位用户');
  assert.equal(m.forwardFrom.userId, null);
  assert.equal(m.forwardFrom.conversationId, null);
  assert.equal(m.text, '别让他知道是我说的'); // 内容由转发者发出，但身份隐藏
});

test('已删除的消息不能转发', async () => {
  const a = await acc('fj'), b = await acc('fk');
  const cv = await dm(a, b);
  const src = await call('POST', '/api/conversations/' + cv.id + '/messages', {text: '即将撤回'}, a.tok);
  assert.equal((await call('POST', '/api/messages/' + src.j.message.id + '/recall', {}, a.tok)).s, 200);
  const fwd = await call('POST', '/api/messages/' + src.j.message.id + '/forward', {conversationId: cv.id}, a.tok);
  assert.equal(fwd.s, 404);
});

function upload(account, deviceId) {
  account.generateOneTimeKeys(8);
  account.generateFallbackKey();
  const idk = JSON.parse(account.identityKeys());
  const otks = JSON.parse(account.oneTimeKeys());
  const fb = JSON.parse(account.fallbackKey());
  const fbEnt = Object.entries(fb.curve25519 || {})[0];
  return {deviceId, identityKey: idk, oneTimeKeys: otks, fallbackKey: fbEnt ? {keyId: fbEnt[0], key: fbEnt[1]} : undefined};
}

test('加密 1:1 转发必须由客户端重加密，服务端不出现明文', async () => {
  const a = await acc('fl'), b = await acc('fm'), c = await acc('fn');
  befriend(a, b); befriend(a, c);
  const accA = new Account(), accB = new Account(), accC = new Account();
  const upA = upload(accA, 'dv_fwdaaaa1'), upB = upload(accB, 'dv_fwdbbbb2'), upC = upload(accC, 'dv_fwdcccc3');
  assert.equal((await call('POST', '/api/e2ee/keys', upA, a.tok)).s, 200); accA.markKeysAsPublished();
  assert.equal((await call('POST', '/api/e2ee/keys', upB, b.tok)).s, 200); accB.markKeysAsPublished();
  assert.equal((await call('POST', '/api/e2ee/keys', upC, c.tok)).s, 200); accC.markKeysAsPublished();
  const cvAb = (await call('POST', '/api/conversations', {kind: 'dm', userId: b.id}, a.tok)).j.conversation;
  const cvAc = (await call('POST', '/api/conversations', {kind: 'dm', userId: c.id}, a.tok)).j.conversation;
  const claimedB = (await call('POST', '/api/e2ee/keys/claim', {userId: b.id, myDeviceId: 'dv_fwdaaaa1'}, a.tok)).j;
  const kB = claimedB.keys[0];
  const otkB = (kB.oneTimeKey && kB.oneTimeKey.key) || (kB.fallbackKey && kB.fallbackKey.key);
  const sessAB = accA.createOutboundSession(kB.identityKey.curve25519, otkB);
  const secret = 'FWD_SECRET_MUST_NOT_LEAK';
  const enc = JSON.parse(sessAB.encrypt(JSON.stringify({v: 1, t: 'text', text: secret})));
  const ct = JSON.stringify({v: 1, envelopes: [{deviceId: kB.deviceId, type: enc.type, body: enc.body, sessionId: sessAB.sessionId()}]});
  const src = await call('POST', '/api/conversations/' + cvAb.id + '/messages', {encrypted: true, ciphertext: ct, senderDeviceId: 'dv_fwdaaaa1'}, a.tok);
  assert.equal(src.s, 200, JSON.stringify(src.j));
  // 不带重加密密文：拒绝，且不应把明文交给服务端
  const raw = await call('POST', '/api/messages/' + src.j.message.id + '/forward', {conversationId: cvAc.id, text: secret}, a.tok);
  assert.equal(raw.s, 400, JSON.stringify(raw.j));
  assert.equal(raw.j.error.code, 'E2EE_REENCRYPT');
  // 客户端为 C 重加密
  const claimedC = (await call('POST', '/api/e2ee/keys/claim', {userId: c.id, myDeviceId: 'dv_fwdaaaa1'}, a.tok)).j;
  const kC = claimedC.keys[0];
  const otkC = (kC.oneTimeKey && kC.oneTimeKey.key) || (kC.fallbackKey && kC.fallbackKey.key);
  const sessAC = accA.createOutboundSession(kC.identityKey.curve25519, otkC);
  const enc2 = JSON.parse(sessAC.encrypt(JSON.stringify({v: 1, t: 'text', text: secret})));
  const ct2 = JSON.stringify({v: 1, envelopes: [{deviceId: kC.deviceId, type: enc2.type, body: enc2.body, sessionId: sessAC.sessionId()}]});
  const fwd = await call('POST', '/api/messages/' + src.j.message.id + '/forward', {
    conversationId: cvAc.id, encrypted: true, ciphertext: ct2, senderDeviceId: 'dv_fwdaaaa1',
  }, a.tok);
  assert.equal(fwd.s, 200, JSON.stringify(fwd.j));
  assert.equal(fwd.j.message.encrypted, true);
  assert.equal(fwd.j.message.text, '');
  assert.equal(fwd.j.message.forwarded, true);
  assert.ok(!JSON.stringify(fwd.j).includes(secret));
  const row = srv.db.prepare('SELECT text, ciphertext FROM messages WHERE id=?').get(fwd.j.message.id);
  assert.equal(row.text, '');
  assert.ok(!row.ciphertext.includes(secret));
  // C 可解密
  const hist = await call('GET', '/api/conversations/' + cvAc.id + '/messages', null, c.tok);
  const m = hist.j.messages.find(x => x.id === fwd.j.message.id);
  const env = JSON.parse(m.ciphertext).envelopes[0];
  const inbound = accC.createInboundSession(env.body);
  const decoded = JSON.parse(inbound.plaintext);
  assert.equal(decoded.text, secret);
});
