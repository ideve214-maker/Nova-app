// M4.5.1 媒体存储方案与元数据表：本地磁盘；文件记录与消息记录分离。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, existsSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../index.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
let srv, base, seq = 0, dir;
test.before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'nova-m451-'));
  srv = createApp({mediaDir: dir});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
});
test.after(() => srv.close());
const call = async (m, p, body, tok) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  return {s: r.status, j: await r.json()};
};
async function acc(n) {
  const u = n + (++seq);
  const r = await call('POST', '/api/auth/register', {agree:true, username: u, email: u + '@x.test', password: 'Passw0rd123'});
  return {tok: r.j.token, id: r.j.user.id};
}

test('上传后元数据入库、文件落在本地目录；响应不含磁盘路径；可独立于消息存在', async () => {
  const a = await acc('md');
  const up = await call('POST', '/api/media', {name: 'dot.png', mime: 'image/png', data: PNG.toString('base64')}, a.tok);
  assert.equal(up.s, 200, JSON.stringify(up.j));
  const media = up.j.media;
  assert.ok(media.id.startsWith('md_'));
  assert.equal(media.kind, 'image');
  assert.ok(media.size > 0);
  assert.ok(!media.path && !media.filePath && !JSON.stringify(media).includes(dir), '对外不暴露磁盘路径');
  const row = srv.db.prepare('SELECT * FROM media WHERE id=?').get(media.id);
  assert.ok(row);
  assert.equal(Number(row.owner_id), Number(a.id));
  assert.ok(row.path && !row.path.includes('..'));
  assert.ok(existsSync(join(dir, row.path)), '文件在本地存储目录');
  assert.equal(row.message_id, null, '媒体记录独立于消息');
  // 消息表无此行
  const msgN = srv.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n;
  assert.equal(msgN, 0);
  const meta = await call('GET', '/api/media/' + media.id, null, a.tok);
  assert.equal(meta.s, 200);
  assert.equal(meta.j.media.id, media.id);
  assert.ok(!JSON.stringify(meta.j).includes(dir));
});
