// M5.4.4 数据导出：资料、动态、消息；E2EE 内容由客户端解密。
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
  const r = await call('POST', '/api/auth/register', {agree:true, username: u, email: u + '@x.test', password: 'Passw0rd123'});
  return {tok: r.j.token, id: r.j.user.id, u};
}
function upload(account, deviceId) {
  account.generateOneTimeKeys(8);
  account.generateFallbackKey();
  const idk = JSON.parse(account.identityKeys());
  const otks = JSON.parse(account.oneTimeKeys());
  const fb = JSON.parse(account.fallbackKey());
  const fbEnt = Object.entries(fb.curve25519 || {})[0];
  return {deviceId, identityKey: idk, oneTimeKeys: otks, fallbackKey: fbEnt ? {keyId: fbEnt[0], key: fbEnt[1]} : undefined};
}

test('导出含自己的资料和动态；加密消息只有密文，客户端可解密', async () => {
  const a = await acc('exa'), b = await acc('exb');
  srv.friends.setAccepted(a.id, b.id);
  const mine = await call('POST', '/api/posts', {text: '这是我要导出的动态 #导出'}, a.tok);
  assert.equal(mine.s, 200);
  const other = await call('POST', '/api/posts', {text: '别人的动态不应出现'}, b.tok);
  assert.equal(other.s, 200);
  const cv = (await call('POST', '/api/conversations', {kind: 'dm', userId: b.id}, a.tok)).j.conversation;
  await call('POST', '/api/conversations/' + cv.id + '/messages', {text: '明文问候'}, a.tok);
  const accA = new Account(), accB = new Account();
  const upA = upload(accA, 'dv_expaaaa1'), upB = upload(accB, 'dv_expbbbb2');
  assert.equal((await call('POST', '/api/e2ee/keys', upA, a.tok)).s, 200); accA.markKeysAsPublished();
  assert.equal((await call('POST', '/api/e2ee/keys', upB, b.tok)).s, 200); accB.markKeysAsPublished();
  const claimed = (await call('POST', '/api/e2ee/keys/claim', {userId: b.id, myDeviceId: 'dv_expaaaa1'}, a.tok)).j;
  const kB = claimed.keys[0];
  const otkB = (kB.oneTimeKey && kB.oneTimeKey.key) || (kB.fallbackKey && kB.fallbackKey.key);
  const sess = accA.createOutboundSession(kB.identityKey.curve25519, otkB);
  const secret = 'EXPORT_E2EE_SECRET';
  const enc = JSON.parse(sess.encrypt(JSON.stringify({v: 1, t: 'text', text: secret})));
  const ct = JSON.stringify({v: 1, envelopes: [{deviceId: kB.deviceId, type: enc.type, body: enc.body, sessionId: sess.sessionId()}]});
  const encMsg = await call('POST', '/api/conversations/' + cv.id + '/messages', {encrypted: true, ciphertext: ct, senderDeviceId: 'dv_expaaaa1'}, a.tok);
  assert.equal(encMsg.s, 200, JSON.stringify(encMsg.j));

  const ex = await call('POST', '/api/me/export', {}, a.tok);
  assert.equal(ex.s, 200, JSON.stringify(ex.j).slice(0, 400));
  const data = ex.j.export;
  assert.equal(data.profile.username, a.u);
  assert.ok(data.e2eeNote);
  assert.ok(data.posts.some(p => p.text && p.text.includes('这是我要导出的动态')));
  assert.ok(!data.posts.some(p => (p.text || '').includes('别人的动态不应出现')));
  const raw = JSON.stringify(data);
  assert.ok(!raw.includes(secret), '导出 JSON 不得含加密明文');
  const conv = data.conversations.find(c => c.id === cv.id);
  assert.ok(conv);
  const plain = conv.messages.find(m => m.text === '明文问候');
  assert.ok(plain);
  const em = conv.messages.find(m => m.encrypted);
  assert.ok(em);
  assert.equal(em.text, '');
  assert.ok(em.ciphertext);
  assert.equal(em.e2eeExport, 'ciphertext-only');
  // 客户端解密（此处用同一套 vodozemac，模拟本机导出）
  const env = JSON.parse(em.ciphertext).envelopes[0];
  const inbound = accB.createInboundSession(env.body);
  const decoded = JSON.parse(inbound.plaintext);
  assert.equal(decoded.text, secret);
  // B 的导出不含 A 的动态
  const exB = await call('GET', '/api/me/export', null, b.tok);
  assert.ok(!exB.j.export.posts.some(p => (p.text || '').includes('这是我要导出的动态')));
});
