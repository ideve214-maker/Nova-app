// M4.11.3：设备公钥上传、一次性密钥领取与撤销。私钥不得入库。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {createApp} from '../index.mjs';
import {Account} from './vodo.mjs';
import {safetyNumber} from '../e2ee.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const doc = readFileSync(join(root, 'docs/research/M4.11.3_设备密钥待办.md'), 'utf8');

function keysOf(account, nOtk = 8) {
  account.generateOneTimeKeys(nOtk);
  account.generateFallbackKey();
  const idk = JSON.parse(account.identityKeys());
  const otks = JSON.parse(account.oneTimeKeys());
  const fb = JSON.parse(account.fallbackKey());
  const fbEnt = Object.entries(fb.curve25519 || fb || {})[0];
  return {
    identityKey: idk,
    oneTimeKeys: otks,
    fallbackKey: fbEnt ? {keyId: fbEnt[0], key: fbEnt[1]} : undefined,
  };
}

test('文档：私钥只留客户端、已实现上传领取撤销与安全号码、使用 vodozemac', () => {
  assert.match(doc, /已实现|不再待办|状态：已实现/);
  assert.match(doc, /私钥只留在客户端/);
  assert.match(doc, /不得.*上传到 NOVA 服务器|不得.*上传/);
  assert.match(doc, /vodozemac/);
  assert.match(doc, /安全号码|身份指纹/);
  assert.match(doc, /设备撤销/);
  assert.match(doc, /不自写 ratchet|不自写/);
});

test('上传公钥与一次性密钥；领取后密钥被消耗；服务端无私钥', async () => {
  const srv = createApp();
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const call = async (m, p, body, tok) => {
    const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body != null ? JSON.stringify(body) : undefined});
    return {s: r.status, j: await r.json()};
  };
  try {
    const a = (await call('POST', '/api/auth/register', {username: 'ek4113a', email: 'ek4113a@x.test', password: 'Passw0rd123'})).j;
    const b = (await call('POST', '/api/auth/register', {username: 'ek4113b', email: 'ek4113b@x.test', password: 'Passw0rd123'})).j;
    srv.friends.setAccepted(a.user.id, b.user.id);
    const accA = new Account();
    const bodyA = {deviceId: 'dv_alice11111111', ...keysOf(accA, 5)};
    const up = await call('POST', '/api/e2ee/keys', bodyA, a.token);
    assert.equal(up.s, 200, JSON.stringify(up.j));
    assert.equal(up.j.device.identityKey.curve25519, bodyA.identityKey.curve25519);
    assert.equal(up.j.device.oneTimeKeyCount, 5);
    // 私钥/pickle 被拒绝
    const bad = await call('POST', '/api/e2ee/keys', {deviceId: 'dv_alice11111111', identityKey: bodyA.identityKey, pickle: accA.pickle(), privateKey: 'secret'}, a.token);
    assert.equal(bad.s, 400);
    assert.equal(bad.j.error.code, 'PRIVATE_KEY_REJECTED');
    // 非好友看不到
    const stranger = (await call('POST', '/api/auth/register', {username: 'ek4113c', email: 'ek4113c@x.test', password: 'Passw0rd123'})).j;
    assert.equal((await call('GET', '/api/e2ee/keys/' + a.user.id, null, stranger.token)).s, 403);
    const listed = await call('GET', '/api/e2ee/keys/' + a.user.id, null, b.token);
    assert.equal(listed.s, 200);
    assert.equal(listed.j.devices.length, 1);
    // 领取消耗 OTK
    const claim = await call('POST', '/api/e2ee/keys/claim', {userId: a.user.id, myDeviceId: 'dv_bob2222222222'}, b.token);
    assert.equal(claim.s, 200, JSON.stringify(claim.j));
    assert.equal(claim.j.keys.length, 1);
    assert.ok(claim.j.keys[0].oneTimeKey && claim.j.keys[0].oneTimeKey.key);
    const after = (await call('GET', '/api/e2ee/keys/' + a.user.id, null, b.token)).j.devices[0];
    assert.equal(after.oneTimeKeyCount, 4);
    // 同一设备换身份密钥被拒绝
    const acc2 = new Account();
    const ch = await call('POST', '/api/e2ee/keys', {deviceId: 'dv_alice11111111', ...keysOf(acc2)}, a.token);
    assert.equal(ch.s, 409);
    assert.equal(ch.j.error.code, 'IDENTITY_CHANGED');
    // 撤销
    const rev = await call('POST', '/api/e2ee/devices/dv_alice11111111/revoke', {}, a.token);
    assert.equal(rev.s, 200);
    assert.equal(rev.j.device.revoked, true);
    const claim2 = await call('POST', '/api/e2ee/keys/claim', {userId: a.user.id}, b.token);
    assert.equal(claim2.s, 404);
    // 库中无 pickle / 私钥列
    const cols = srv.db.prepare("PRAGMA table_info(e2ee_devices)").all().map(c => c.name);
    assert.ok(cols.includes('curve25519') && cols.includes('ed25519'));
    assert.ok(!cols.some(n => /pickle|private|secret/i.test(n)));
    const row = srv.db.prepare('SELECT * FROM e2ee_devices WHERE id=?').get('dv_alice11111111');
    assert.ok(!JSON.stringify(row).includes(accA.pickle().slice(0, 20)));
  } finally { try { srv.events.closeAll(); } catch {} srv.close(); }
});

test('双方安全号码一致，与顺序无关', () => {
  const a = 'AAAAed25519key++++++++++++++++++++', b = 'BBBBed25519key++++++++++++++++++++';
  assert.equal(safetyNumber(a, b), safetyNumber(b, a));
  assert.notEqual(safetyNumber(a, b), safetyNumber(a, a));
  assert.match(safetyNumber(a, b), /^(\d{5} ){11}\d{5}$/);
});
