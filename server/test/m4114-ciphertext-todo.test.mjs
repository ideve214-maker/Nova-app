// M4.11.4：1:1 私聊密文入库；服务端看不到明文；群聊仍明文；审计不记正文。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {createApp} from '../index.mjs';
import {Account} from './vodo.mjs';
import {parseCiphertext} from '../e2ee.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const doc = readFileSync(join(root, 'docs/research/M4.11.4_密文传输待办.md'), 'utf8');

test('文档：服务端只路由密文、使用 vodozemac、不自制、审计不记正文', () => {
  assert.match(doc, /已实现|不再待办|状态：已实现/);
  assert.match(doc, /只路由密文|只保存密文|只存密文/);
  assert.match(doc, /vodozemac/);
  assert.match(doc, /messageId/);
  assert.match(doc, /搜索/);
  assert.match(doc, /群聊/);
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

test('加密私聊：服务端只存密文，对端用 Olm 可解密；夹带明文被拒；群聊不能加密', async () => {
  const srv = createApp();
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const call = async (m, p, body, tok) => {
    const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body != null ? JSON.stringify(body) : undefined});
    return {s: r.status, j: await r.json()};
  };
  try {
    const a = (await call('POST', '/api/auth/register', {username: 'ct4114x', email: 'ct4114x@x.test', password: 'Passw0rd123'})).j;
    const b = (await call('POST', '/api/auth/register', {username: 'ct4114y', email: 'ct4114y@x.test', password: 'Passw0rd123'})).j;
    srv.friends.setAccepted(a.user.id, b.user.id);
    const accA = new Account(), accB = new Account();
    const upA = upload(accA, 'dv_ctxaaaaaaa1');
    const upB = upload(accB, 'dv_ctybbbbbbb2');
    assert.equal((await call('POST', '/api/e2ee/keys', upA, a.token)).s, 200);
    accA.markKeysAsPublished();
    assert.equal((await call('POST', '/api/e2ee/keys', upB, b.token)).s, 200);
    accB.markKeysAsPublished();
    const cv = (await call('POST', '/api/conversations', {kind: 'dm', userId: b.user.id}, a.token)).j.conversation;
    // 领取 B 的 OTK，A 建 outbound session
    const claimed = (await call('POST', '/api/e2ee/keys/claim', {userId: b.user.id, myDeviceId: 'dv_ctxaaaaaaa1'}, a.token)).j;
    const k = claimed.keys[0];
    const otk = (k.oneTimeKey && k.oneTimeKey.key) || (k.fallbackKey && k.fallbackKey.key);
    const sessA = accA.createOutboundSession(k.identityKey.curve25519, otk);
    const secret = 'SECRET_BODY_MUST_NOT_REACH_SERVER_4114';
    const enc = JSON.parse(sessA.encrypt(JSON.stringify({v: 1, t: 'text', text: secret})));
    const ciphertext = JSON.stringify({v: 1, envelopes: [{deviceId: k.deviceId, type: enc.type, body: enc.body, sessionId: sessA.sessionId()}]});
    // 夹带明文被拒
    const mixed = await call('POST', '/api/conversations/' + cv.id + '/messages', {encrypted: true, ciphertext, text: secret}, a.token);
    assert.equal(mixed.s, 400);
    const sent = await call('POST', '/api/conversations/' + cv.id + '/messages', {
      encrypted: true, ciphertext, senderDeviceId: 'dv_ctxaaaaaaa1', clientId: 'e2ee-1',
    }, a.token);
    assert.equal(sent.s, 200, JSON.stringify(sent.j));
    assert.equal(sent.j.message.encrypted, true);
    assert.equal(sent.j.message.text, '');
    assert.ok(sent.j.message.ciphertext);
    assert.ok(!JSON.stringify(sent.j).includes(secret));
    const row = srv.db.prepare('SELECT text, encrypted, ciphertext FROM messages WHERE id=?').get(sent.j.message.id);
    assert.equal(row.text, '');
    assert.equal(row.encrypted, 1);
    assert.ok(!row.ciphertext.includes(secret));
    // B 用 inbound session 解密
    const hist = await call('GET', '/api/conversations/' + cv.id + '/messages', null, b.token);
    const m = hist.j.messages.find(x => x.id === sent.j.message.id);
    assert.equal(m.text, '');
    assert.equal(m.encrypted, true);
    const wrap = JSON.parse(m.ciphertext);
    const env = wrap.envelopes[0];
    const inbound = accB.createInboundSession(env.body);
    const plain = inbound.plaintext;
    const decoded = JSON.parse(plain);
    assert.equal(decoded.text, secret);
    // 搜索不得命中密文或明文
    const q = await call('GET', '/api/search?q=' + encodeURIComponent('SECRET_BODY_MUST') + '&type=message', null, a.token);
    assert.equal(q.s, 200);
    assert.equal((q.j.messages || []).length, 0);
    // 审计不含正文
    const audits = srv.db.prepare("SELECT action,detail FROM audit_log WHERE action='chat.message'").all();
    assert.ok(audits.length >= 1);
    for (const ar of audits) {
      assert.doesNotMatch(String(ar.detail || ''), /SECRET_BODY/);
      assert.match(String(ar.detail || ''), /messageId/);
    }
    // 群聊拒绝加密
    const c3 = (await call('POST', '/api/auth/register', {username: 'ct4114z', email: 'ct4114z@x.test', password: 'Passw0rd123'})).j;
    srv.friends.setAccepted(a.user.id, c3.user.id);
    const g = (await call('POST', '/api/conversations', {kind: 'group', name: '组', userIds: [b.user.id]}, a.token)).j.conversation;
    const ge = await call('POST', '/api/conversations/' + g.id + '/messages', {encrypted: true, ciphertext}, a.token);
    assert.equal(ge.s, 400);
    // 明文路径仍可用于群聊和兼容旧客户端（服务端测试）
    const plainMsg = await call('POST', '/api/conversations/' + g.id + '/messages', {text: '群里还是明文'}, a.token);
    assert.equal(plainMsg.s, 200);
    assert.equal(plainMsg.j.message.text, '群里还是明文');
    assert.ok(!plainMsg.j.message.encrypted);
  } finally { try { srv.events.closeAll(); } catch {} srv.close(); }
});

test('密文解析拒绝夹带明文，接受合法信封', () => {
  assert.throws(() => parseCiphertext('{"v":1,"envelopes":[{"deviceId":"dv_abcdefghij","type":0,"body":"AAAA","text":"hi"}]}'));
  const ok = parseCiphertext(JSON.stringify({v: 1, envelopes: [{deviceId: 'dv_abcdefghij', type: 0, body: 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo='}]}));
  assert.equal(ok.envelopes[0].type, 0);
});
