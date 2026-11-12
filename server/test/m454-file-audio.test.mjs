// M4.5.4 语音和普通文件：类型白名单、大小限制、下载权限。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createApp} from '../index.mjs';

let srv, base, seq = 0, dir;
test.before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'nova-m454-'));
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

test('语音和文本文件可上传；可下载；非授权者 404；不在白名单的类型拒绝', async () => {
  const a = await acc('fa'), b = await acc('fb');
  const mp3p = join(dir, 'beep.mp3');
  const rr = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-q:a', '6', mp3p], {timeout: 15000});
  assert.equal(rr.status, 0, rr.stderr && rr.stderr.toString());
  const mp3 = readFileSync(mp3p);
  const audio = await call('POST', '/api/media', {name: 'beep.mp3', mime: 'audio/mpeg', data: mp3.toString('base64')}, a.tok);
  assert.equal(audio.s, 200, JSON.stringify(audio.j));
  assert.equal(audio.j.media.kind, 'audio');
  const txt = await call('POST', '/api/media', {name: 'note.txt', mime: 'text/plain', data: Buffer.from('hello nova').toString('base64')}, a.tok);
  assert.equal(txt.s, 200, JSON.stringify(txt.j));
  assert.equal(txt.j.media.kind, 'file');
  const dl = await fetch(base + '/api/media/' + txt.j.media.id + '/file', {headers: {Authorization: 'Bearer ' + a.tok}});
  assert.equal(dl.status, 200);
  assert.equal(Buffer.from(await dl.arrayBuffer()).toString(), 'hello nova');
  const no = await fetch(base + '/api/media/' + txt.j.media.id + '/file', {headers: {Authorization: 'Bearer ' + b.tok}});
  assert.equal(no.status, 404);
  const exe = await call('POST', '/api/media', {name: 'a.exe', mime: 'application/x-dosexec', data: Buffer.from('MZ').toString('base64')}, a.tok);
  assert.equal(exe.s, 400); assert.equal(exe.j.error.code, 'BAD_TYPE');
});
