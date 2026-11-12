// M4.11.3：设备密钥为待办；未提供密钥 API，服务端无私钥表，源码未自制 E2EE 密钥。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {createApp} from '../index.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const doc = readFileSync(join(root, 'docs/research/M4.11.3_设备密钥待办.md'), 'utf8');

test('待办文档写明：私钥只留客户端、新设备验证、撤销、不自制、状态为待办', () => {
  assert.match(doc, /待办/);
  assert.match(doc, /不实现/);
  assert.match(doc, /私钥只留在客户端/);
  assert.match(doc, /不得.*上传到 NOVA 服务器|不得.*上传/);
  assert.match(doc, /新设备加入/);
  assert.match(doc, /设备撤销/);
  assert.match(doc, /安全号码|身份指纹/);
  assert.match(doc, /不得用自写密钥|不自写/);
});

test('没有密钥或预密钥 HTTP 接口；数据库没有 identity_keys / device_keys 表', async () => {
  const srv = createApp();
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  try {
    const acc = await fetch(base + '/api/auth/register', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({username: 'dk4113', email: 'dk4113@x.test', password: 'Passw0rd123'}),
    });
    const j = await acc.json();
    const tok = j.token;
    for (const p of ['/api/keys', '/api/e2ee/keys', '/api/devices/keys', '/api/prekeys']) {
      const r = await fetch(base + p, {headers: {Authorization: 'Bearer ' + tok}});
      assert.equal(r.status, 404, p + ' should not exist, got ' + r.status);
    }
    const tables = srv.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
    assert.equal(tables.some(n => /identity_key|device_key|prekey|pre_key|signed_prekey|e2ee/i.test(n)), false, 'unexpected table ' + tables.join(','));
  } finally { try { srv.events.closeAll(); } catch {} srv.close(); }
});

test('前端与服务端源码没有自制 E2EE 密钥模块', () => {
  const files = [
    ...readdirSync(join(root, 'src')).filter(f => f.endsWith('.js')).map(f => join(root, 'src', f)),
    ...readdirSync(join(root, 'server')).filter(f => f.endsWith('.mjs')).map(f => join(root, 'server', f)),
  ];
  for (const f of files) {
    const t = readFileSync(f, 'utf8');
    assert.doesNotMatch(t, /generateKeyPair|importKey|deriveBits/, 'unexpected webcrypto keygen in ' + f);
    // SubtleCrypto 用于非 E2EE 也可以，这里只禁止明显的身份密钥命名
    assert.doesNotMatch(t, /identityKeyPair|signedPreKey|signalProtocol|DoubleRatchet|sessionCipher/);
  }
});
