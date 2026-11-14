// r10：频道消息删除/置顶、社区封面和头像（媒体 id）、个人图片头像/背景、群头像；他人可见。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {createApp} from '../index.mjs';

let srv, base, seq = 0, dir;
test.before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'r10-'));
  srv = createApp({mediaDir: join(dir, 'media'), mediaScan: async () => ({status: 'clean'})});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
});
test.after(() => { srv.close(); try { rmSync(dir, {recursive: true, force: true}); } catch {} });

const call = async (m, p, body, tok) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  let j = null; try { j = await r.json(); } catch {}
  return {s: r.status, j};
};
async function acc(n) {
  const u = n + (++seq);
  const r = await call('POST', '/api/auth/register', {agree: true, username: u, email: u + '@x.test', password: 'Passw0rd123'});
  assert.equal(r.s, 200, JSON.stringify(r.j));
  return {tok: r.j.token, id: r.j.user.id};
}
async function upload(tok) {
  const buf = await sharp({create: {width: 64, height: 64, channels: 3, background: '#3366aa'}}).jpeg().toBuffer();
  const r = await fetch(base + '/api/media', {method: 'POST', headers: {Authorization: 'Bearer ' + tok, 'Content-Type': 'image/jpeg', 'X-File-Name': 'a.jpg'}, body: buf});
  const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  return j.media.id;
}

test('频道消息：作者可删，版主以上可删他人和置顶；普通成员不能置顶', async () => {
  const own = await acc('cmo'), mem = await acc('cmm');
  const cm = (await call('POST', '/api/communities', {name: '置顶社', description: ''}, own.tok)).j.community;
  const ch = cm.channels.find(c => c.kindKey === 'text');
  assert.equal((await call('POST', '/api/communities/' + cm.id + '/join', {}, mem.tok)).s, 200);
  const m1 = (await call('POST', '/api/channels/' + ch.id + '/messages', {text: '第一条'}, mem.tok)).j.message;
  const m2 = (await call('POST', '/api/channels/' + ch.id + '/messages', {text: '第二条'}, own.tok)).j.message;
  assert.equal((await call('POST', '/api/channel-messages/' + m1.id + '/pin', {}, mem.tok)).s, 403);
  const pin = await call('POST', '/api/channel-messages/' + m1.id + '/pin', {}, own.tok);
  assert.equal(pin.s, 200, JSON.stringify(pin.j));
  assert.deepEqual(pin.j.pins, [m1.id]);
  const list = await call('GET', '/api/channels/' + ch.id + '/messages', null, mem.tok);
  assert.deepEqual(list.j.pins, [m1.id]);
  assert.equal((await call('POST', '/api/channel-messages/' + m2.id + '/delete', {}, mem.tok)).s, 403);
  assert.equal((await call('POST', '/api/channel-messages/' + m1.id + '/delete', {}, mem.tok)).s, 200);
  const after = await call('GET', '/api/channels/' + ch.id + '/messages', null, own.tok);
  assert.ok(!after.j.messages.some(m => m.id === m1.id));
  assert.deepEqual(after.j.pins, []);
  assert.equal((await call('POST', '/api/channel-messages/' + m2.id + '/delete', {}, own.tok)).s, 200);
});

test('社区封面/头像可用媒体 id 保存，其他成员能取到图片', async () => {
  const own = await acc('cvo'), other = await acc('cvx');
  const cm = (await call('POST', '/api/communities', {name: '封面社二', description: ''}, own.tok)).j.community;
  const mid = await upload(own.tok);
  assert.equal((await call('POST', '/api/media/' + mid + '/ticket', {}, other.tok)).s, 404);
  const e = await call('POST', '/api/communities/' + cm.id + '/edit', {cover: mid, avatar: 'assets/av-me.jpg'}, own.tok);
  assert.equal(e.s, 200, JSON.stringify(e.j));
  const g = await call('GET', '/api/communities/' + cm.id, null, other.tok);
  assert.equal(g.j.community.cover, mid);
  assert.equal(g.j.community.avatar, 'assets/av-me.jpg');
  assert.equal((await call('POST', '/api/media/' + mid + '/ticket', {}, other.tok)).s, 200);
  const otherMid = await upload(other.tok);
  assert.equal((await call('POST', '/api/communities/' + cm.id + '/edit', {cover: otherMid}, own.tok)).s, 403);
});

test('个人图片头像和背景存服务器，别人看到的作者信息带图片', async () => {
  const a = await acc('pfa'), b = await acc('pfb');
  const mid = await upload(a.tok);
  const r = await call('POST', '/api/me/look', {avatarImage: mid, cover: 'assets/bg-river.jpg'}, a.tok);
  assert.equal(r.s, 200, JSON.stringify(r.j));
  assert.equal(r.j.profile.avatar.kind, 'image');
  assert.equal(r.j.profile.avatar.image, mid);
  const post = (await call('POST', '/api/posts', {text: '看我的新头像'}, a.tok)).j.post;
  const seen = await call('GET', '/api/posts/' + post.id, null, b.tok);
  assert.equal(seen.j.post.author.avatar.image, mid);
  const view = await call('GET', '/api/users/' + a.id, null, b.tok);
  assert.equal(view.s, 200, JSON.stringify(view.j));
  assert.equal(view.j.user.cover, 'assets/bg-river.jpg');
  assert.equal((await call('POST', '/api/media/' + mid + '/ticket', {}, b.tok)).s, 200);
  const clr = await call('POST', '/api/me/look', {avatarImage: ''}, a.tok);
  assert.equal(clr.j.profile.avatar.kind, 'default');
  assert.equal(clr.j.profile.avatar.image, null);
});

test('群头像存服务器，退出再进仍在', async () => {
  const a = await acc('gpa'), b = await acc('gpb');
  const cv = await call('POST', '/api/conversations', {kind: 'group', name: '测试群', userIds: [b.id]}, a.tok);
  assert.equal(cv.s, 200, JSON.stringify(cv.j));
  const id = cv.j.conversation.id;
  const set = await call('POST', '/api/conversations/' + id + '/avatar', {avatar: 'assets/av-group.jpg'}, a.tok);
  assert.equal(set.s, 200, JSON.stringify(set.j));
  const again = await call('GET', '/api/conversations/' + id, null, a.tok);
  assert.equal(again.j.conversation.avatar, 'assets/av-group.jpg');
  assert.equal((await call('POST', '/api/conversations/' + id + '/avatar', {avatar: 'assets/av-me.jpg'}, b.tok)).s, 403);
  const seenB = await call('GET', '/api/conversations/' + id, null, b.tok);
  assert.equal(seenB.j.conversation.avatar, 'assets/av-group.jpg');
});
