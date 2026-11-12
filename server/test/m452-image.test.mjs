// M4.5.2 图片上传、压缩与预览：类型/大小校验、访问鉴权、失败清理。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, existsSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createApp} from '../index.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
let srv, base, seq = 0, dir;
test.before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'nova-m452-'));
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

test('拒绝错误类型和超限大小；成功的图片可取预览；失败不留下垃圾文件', async () => {
  const a = await acc('im'), b = await acc('in');
  const bad = await call('POST', '/api/media', {name: 'x.exe', mime: 'application/x-msdownload', data: Buffer.from('MZ').toString('base64')}, a.tok);
  assert.equal(bad.s, 400); assert.equal(bad.j.error.code, 'BAD_TYPE');
  const user = srv.db.prepare('SELECT * FROM users WHERE id=?').get(a.id);
  try { srv.media.upload(user, {buffer: Buffer.alloc(11 * 1024 * 1024, 1), mime: 'image/png', name: 'big.png'}); assert.fail('应拒绝超限'); }
  catch (e) { assert.equal(e.code, 'TOO_LARGE'); }
  const up = await call('POST', '/api/media', {name: 'dot.png', mime: 'image/png', data: PNG.toString('base64')}, a.tok);
  assert.equal(up.s, 200, JSON.stringify(up.j));
  assert.equal(up.j.media.kind, 'image');
  // 预览（ffmpeg 可用时）
  if (up.j.media.hasPreview) {
    const pv = await fetch(base + '/api/media/' + up.j.media.id + '/preview', {headers: {Authorization: 'Bearer ' + a.tok}});
    assert.equal(pv.status, 200);
    assert.match(pv.headers.get('content-type') || '', /image\//);
    const buf = Buffer.from(await pv.arrayBuffer());
    assert.ok(buf.length > 0);
  }
  // 他人不能看
  assert.equal((await call('GET', '/api/media/' + up.j.media.id, null, b.tok)).s, 404);
  const pvB = await fetch(base + '/api/media/' + up.j.media.id + '/file', {headers: {Authorization: 'Bearer ' + b.tok}});
  assert.equal(pvB.status, 404);
  // 失败清理：超限后目录不应留下未登记文件
  const rows = srv.db.prepare('SELECT path, preview_path FROM media').all().flatMap(r => [r.path, r.preview_path]).filter(Boolean);
  const files = readdirSync(dir);
  for (const f of files) assert.ok(rows.includes(f), '无主文件 ' + f);
});
