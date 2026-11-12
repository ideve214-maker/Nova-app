// M4.11.1：威胁模型文档完整；实现仍为明文，未伪装已加密。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {createApp} from '../index.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const doc = readFileSync(join(root, 'docs/research/M4.11.1_威胁模型与功能边界.md'), 'utf8');

test('威胁模型写明范围、当前明文威胁、设备/恢复留给负责人、举报边界', () => {
  assert.match(doc, /双向已接受好友|1:1/);
  assert.match(doc, /群聊/);
  assert.match(doc, /暂不承诺/);
  assert.match(doc, /明文/);
  assert.match(doc, /恶意或被攻破的服务器/);
  assert.match(doc, /messageIds|用户主动举报/);
  assert.match(doc, /留给负责人/);
  assert.match(doc, /密钥恢复/);
  assert.match(doc, /设备数量/);
  assert.match(doc, /客户端完整性|被篡改的 Web/);
  assert.match(doc, /不实现加密/);
  assert.match(doc, /不把「威胁模型已写」说成/);
});

test('当前实现仍把私聊以明文存取（与威胁模型一致，未伪装）', async () => {
  const srv = createApp();
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const call = async (m, p, body, tok) => {
    const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
    return {s: r.status, j: await r.json()};
  };
  try {
    const a = (await call('POST', '/api/auth/register', {username: 'tm4111a', email: 'tm4111a@x.test', password: 'Passw0rd123'})).j;
    const b = (await call('POST', '/api/auth/register', {username: 'tm4111b', email: 'tm4111b@x.test', password: 'Passw0rd123'})).j;
    srv.friends.setAccepted(a.user.id, b.user.id);
    const cv = (await call('POST', '/api/conversations', {kind: 'dm', userId: b.user.id}, a.token)).j.conversation;
    const marker = 'PLAINTEXT_MARKER_4111';
    const sent = await call('POST', '/api/conversations/' + cv.id + '/messages', {text: marker}, a.token);
    assert.equal(sent.s, 200);
    assert.equal(sent.j.message.text, marker);
    const row = srv.db.prepare('SELECT text FROM messages WHERE id=?').get(sent.j.message.id);
    assert.equal(row.text, marker, '数据库里应仍是明文，不得用自制密文冒充');
  } finally { try { srv.events.closeAll(); } catch {} srv.close(); }
});
