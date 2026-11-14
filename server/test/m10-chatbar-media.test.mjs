// r10 聊天输入栏：语音识别为 audio、私聊/群聊发语音、Range 播放、中文文件名、频道媒体权限、麦克风权限策略。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../index.mjs';

let srv, base, seq = 0;
test.before(async () => {
  srv = createApp({mediaDir: mkdtempSync(join(tmpdir(), 'nova-cb-'))});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
});
test.after(() => srv.close());
const call = async (m, p, body, tok) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  let j = null; try { j = await r.json(); } catch {}
  return {s: r.status, j};
};
async function acc(n) {
  const u = n + (++seq);
  const r = await call('POST', '/api/auth/register', {agree: true, username: u, email: u + '@x.test', password: 'Passw0rd123'});
  return {tok: r.j.token, id: r.j.user.id};
}
// 最小的 WebM（EBML 头 + 填充），够服务器按 MIME 识别
const webm = () => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d]), Buffer.alloc(4000, 7)]);
async function upload(tok, type, name, body) {
  const r = await fetch(base + '/api/media', {method: 'POST', headers: {Authorization: 'Bearer ' + tok, 'Content-Type': type, 'X-File-Name': encodeURIComponent(name)}, body});
  return {s: r.status, j: await r.json()};
}

test('audio/webm 的 voice.webm 识别为语音（不是视频），群聊可发，Range 返回 206', async () => {
  const a = await acc('va'), b = await acc('vb');
  await call('POST', '/api/friends/request', {userId: b.id}, a.tok);
  await call('POST', '/api/friends/accept', {userId: a.id}, b.tok);
  const cv = (await call('POST', '/api/conversations', {kind: 'group', name: '语音群', userIds: [b.id]}, a.tok)).j.conversation;
  const up = await upload(a.tok, 'audio/webm', 'voice.webm', webm());
  assert.equal(up.s, 200, JSON.stringify(up.j));
  assert.equal(up.j.media.kind, 'audio');
  const m = await call('POST', '/api/conversations/' + cv.id + '/messages', {mediaId: up.j.media.id, clientId: 'v1'}, a.tok);
  assert.equal(m.s, 200, JSON.stringify(m.j));
  assert.equal(m.j.message.media.kind, 'audio');
  const tk = await call('POST', '/api/media/' + up.j.media.id + '/ticket', {}, b.tok);
  assert.equal(tk.s, 200);
  const url = base + '/api/media/' + up.j.media.id + '/file?ticket=' + encodeURIComponent(tk.j.ticket);
  const full = await fetch(url);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  const part = await fetch(url, {headers: {Range: 'bytes=0-99'}});
  assert.equal(part.status, 206);
  assert.match(part.headers.get('content-range'), /^bytes 0-99\/\d+$/);
  assert.equal((await part.arrayBuffer()).byteLength, 100);
  const bad = await fetch(url, {headers: {Range: 'bytes=999999-'}});
  assert.equal(bad.status, 416);
});

test('中文文件名下载头不出错', async () => {
  const a = await acc('fn');
  const up = await upload(a.tok, 'text/plain', '会议纪要.txt', Buffer.from('hello'));
  assert.equal(up.s, 200, JSON.stringify(up.j));
  const tk = await call('POST', '/api/media/' + up.j.media.id + '/ticket', {}, a.tok);
  const r = await fetch(base + '/api/media/' + up.j.media.id + '/file?ticket=' + encodeURIComponent(tk.j.ticket));
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /filename\*=UTF-8''%E4%BC%9A/);
});

test('频道语音：成员能看能取，非成员 404，同一媒体不能重复发', async () => {
  const a = await acc('ca'), b = await acc('cb'), c = await acc('cc');
  const cm = (await call('POST', '/api/communities', {name: '语音小组' + seq, description: 'd', visibility: 'public'}, a.tok)).j.community;
  const ch = cm.channels[0].id;
  assert.equal((await call('POST', '/api/communities/' + cm.id + '/join', {}, b.tok)).s, 200);
  const up = await upload(a.tok, 'audio/webm', 'voice.webm', webm());
  const m = await call('POST', '/api/channels/' + ch + '/messages', {mediaId: up.j.media.id}, a.tok);
  assert.equal(m.s, 200, JSON.stringify(m.j));
  assert.equal(m.j.message.media.kind, 'audio');
  assert.equal((await call('POST', '/api/channels/' + ch + '/messages', {mediaId: up.j.media.id}, a.tok)).s, 400);
  const l = await call('GET', '/api/channels/' + ch + '/messages', null, b.tok);
  assert.equal(l.j.messages.at(-1).media.kind, 'audio');
  assert.equal((await call('POST', '/api/media/' + up.j.media.id + '/ticket', {}, b.tok)).s, 200);
  assert.equal((await call('POST', '/api/media/' + up.j.media.id + '/ticket', {}, c.tok)).s, 404);
  assert.equal((await call('POST', '/api/channels/' + ch + '/messages', {}, b.tok)).s, 400);
});

test('网页版允许本站使用麦克风和相机', async () => {
  const r = await fetch(base + '/');
  assert.match(r.headers.get('permissions-policy') || '', /microphone=\(self\)/);
  assert.match(r.headers.get('permissions-policy') || '', /camera=\(self\)/);
});
