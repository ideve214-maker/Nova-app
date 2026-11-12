// M4.11.4：密文传输为待办；消息仍明文；审计只记 messageId；没有自制密文包装。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {createApp} from '../index.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const doc = readFileSync(join(root, 'docs/research/M4.11.4_密文传输待办.md'), 'utf8');

test('待办文档写明：服务端只路由密文、不自制、当前仍明文、审计不记正文', () => {
  assert.match(doc, /待办/);
  assert.match(doc, /不实现/);
  assert.match(doc, /只路由密文/);
  assert.match(doc, /禁止/);
  assert.match(doc, /messageId/);
  assert.match(doc, /搜索/);
  assert.match(doc, /媒体|附件/);
});

test('发送的正文以明文入库、原样返回；chat.message 审计不含正文', async () => {
  const srv = createApp();
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const call = async (m, p, body, tok) => {
    const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
    return {s: r.status, j: await r.json()};
  };
  try {
    const a = (await call('POST', '/api/auth/register', {username: 'ct4114a', email: 'ct4114a@x.test', password: 'Passw0rd123'})).j;
    const b = (await call('POST', '/api/auth/register', {username: 'ct4114b', email: 'ct4114b@x.test', password: 'Passw0rd123'})).j;
    srv.friends.setAccepted(a.user.id, b.user.id);
    const cv = (await call('POST', '/api/conversations', {kind: 'dm', userId: b.user.id}, a.token)).j.conversation;
    const marker = 'SECRET_BODY_SHOULD_STAY_PLAIN_4114';
    const sent = await call('POST', '/api/conversations/' + cv.id + '/messages', {text: marker}, a.token);
    assert.equal(sent.s, 200);
    assert.equal(sent.j.message.text, marker);
    assert.ok(!sent.j.message.ciphertext && !sent.j.message.encrypted, '不得用自制密文字段冒充已加密');
    const row = srv.db.prepare('SELECT text FROM messages WHERE id=?').get(sent.j.message.id);
    assert.equal(row.text, marker);
    const hist = await call('GET', '/api/conversations/' + cv.id + '/messages', null, a.token);
    assert.ok(hist.j.messages.some(m => m.text === marker));
    const audits = srv.db.prepare("SELECT action,target,detail FROM audit_log WHERE action='chat.message'").all();
    assert.ok(audits.length >= 1);
    for (const arow of audits) {
      assert.doesNotMatch(String(arow.detail || ''), new RegExp(marker));
      assert.match(String(arow.detail || ''), /messageId/);
    }
  } finally { try { srv.events.closeAll(); } catch {} srv.close(); }
});

test('源码没有把消息 AES 包装成伪 E2EE 的实现', () => {
  const files = [
    ...readdirSync(join(root, 'src')).filter(f => f.endsWith('.js')).map(f => join(root, 'src', f)),
    ...readdirSync(join(root, 'server')).filter(f => f.endsWith('.mjs')).map(f => join(root, 'server', f)),
  ];
  for (const f of files) {
    const t = readFileSync(f, 'utf8');
    assert.doesNotMatch(t, /AES-GCM[\s\S]{0,80}(message\.text|encryptMessage|e2eeEncrypt)/);
    assert.doesNotMatch(t, /function\s+(encryptMessage|e2eeEncrypt|wrapPlaintext)/);
  }
});
