// r9：社区封面持久化、下架申诉、屏蔽词拦截、维护模式。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';

let srv, base, seq = 0, adminTok;
test.before(async () => {
  srv = createApp({adminUsername: 'ops_r9', adminPassword: 'OpsR9Pass1!'});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  const login = await call('POST', '/api/admin/auth/login', {username: 'ops_r9', password: 'OpsR9Pass1!'});
  assert.equal(login.s, 200, JSON.stringify(login.j));
  adminTok = login.j.token;
});
test.after(() => srv.close());

const call = async (m, p, body, tok) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  let j = null;
  try { j = await r.json(); } catch { j = null; }
  return {s: r.status, j};
};
async function acc(n) {
  const u = n + (++seq);
  const r = await call('POST', '/api/auth/register', {agree: true, username: u, email: u + '@x.test', password: 'Passw0rd123'});
  assert.equal(r.s, 200, JSON.stringify(r.j));
  return {tok: r.j.token, id: r.j.user.id, username: u};
}

test('社区封面写入服务器，刷新后仍在', async () => {
  const a = await acc('cov');
  const made = await call('POST', '/api/communities', {name: '封面社', description: '保持封面'}, a.tok);
  assert.equal(made.s, 200, JSON.stringify(made.j));
  const id = made.j.community.id;
  const preset = await call('POST', '/api/communities/' + id + '/edit', {cover: 'assets/bg-river.jpg'}, a.tok);
  assert.equal(preset.s, 200, JSON.stringify(preset.j));
  assert.equal(preset.j.community.cover, 'assets/bg-river.jpg');
  const again = await call('GET', '/api/communities/' + id, null, a.tok);
  assert.equal(again.j.community.cover, 'assets/bg-river.jpg');
  const jpeg = 'data:image/jpeg;base64,' + 'AAAA';
  const custom = await call('POST', '/api/communities/' + id + '/edit', {cover: jpeg}, a.tok);
  assert.equal(custom.s, 200, JSON.stringify(custom.j));
  assert.equal((await call('GET', '/api/communities/' + id, null, a.tok)).j.community.cover, jpeg);
  const bad = await call('POST', '/api/communities/' + id + '/edit', {cover: 'https://evil.example/a.jpg'}, a.tok);
  assert.equal(bad.s, 400);
  assert.equal(bad.j.error.code, 'BAD_COVER');
  const cleared = await call('POST', '/api/communities/' + id + '/edit', {cover: ''}, a.tok);
  assert.equal(cleared.s, 200);
  assert.equal(cleared.j.community.cover, null);
});

test('下架后成员能申诉且不必先打开社区，通过后恢复', async () => {
  const owner = await acc('own'), other = await acc('out');
  const made = await call('POST', '/api/communities', {name: '下架社', description: '申诉'}, owner.tok);
  const id = made.j.community.id;
  const down = await call('POST', '/api/admin/communities/' + id + '/takedown', {reason: '违规内容'}, adminTok);
  assert.equal(down.s, 200, JSON.stringify(down.j));
  assert.equal(down.j.community.status, 'taken_down');
  assert.equal(down.j.community.takedownReason, '违规内容');
  const pub = await call('GET', '/api/communities', null, other.tok);
  assert.ok(!(pub.j.communities || []).some(c => c.id === id));
  assert.equal((await call('GET', '/api/communities/' + id, null, other.tok)).s, 404);
  // 下架后所有者打开社区得到 COMMUNITY_TAKEN_DOWN，附带申诉入口（与线上 fix/community-moderation 一致）。
  const summary = await call('GET', '/api/communities/' + id, null, owner.tok);
  assert.equal(summary.s, 404);
  assert.equal(summary.j.error.code, 'COMMUNITY_TAKEN_DOWN');
  assert.equal(summary.j.error.appealable, true);
  const stranger = await call('POST', '/api/appeals', {kind: 'community', body: '我要申诉这个社区', related: id}, other.tok);
  assert.equal(stranger.s, 403);
  const appeal = await call('POST', '/api/appeals', {kind: 'community', body: '内容已经清理，请恢复社区', related: id}, owner.tok);
  assert.equal(appeal.s, 200, JSON.stringify(appeal.j));
  assert.equal(appeal.j.appeal.kind, 'community');
  assert.equal(appeal.j.appeal.community.status, 'taken_down');
  const notes = await call('GET', '/api/notifications', null, owner.tok);
  const note = (notes.j.notifications || []).find(n => n.kind === 'community_takedown' && n.refId === id);
  assert.ok(note, JSON.stringify(notes.j));
  const decided = await call('POST', '/api/admin/appeals/' + appeal.j.appeal.id + '/decision', {action: 'accept', note: '已复核'}, adminTok);
  assert.equal(decided.s, 200, JSON.stringify(decided.j));
  assert.equal(decided.j.appeal.community.status, 'active');
  const back = await call('GET', '/api/communities/' + id, null, owner.tok);
  assert.equal(back.j.community.status, 'active');
  assert.ok((back.j.community.channels || []).length >= 1);
  const listed = await call('GET', '/api/communities', null, other.tok);
  assert.ok((listed.j.communities || []).some(c => c.id === id));
});

test('屏蔽词拦截发帖、频道发言和定时发布，并忽略零宽与全角绕过', async () => {
  const a = await acc('blk');
  const add = await call('POST', '/api/admin/blockwords', {word: '违禁词乙'}, adminTok);
  assert.equal(add.s, 200, JSON.stringify(add.j));
  const post = await call('POST', '/api/posts', {text: '这里有违\u200b禁词乙'}, a.tok);
  assert.equal(post.s, 400);
  assert.equal(post.j.error.code, 'BLOCKED_WORD');
  const wide = await call('POST', '/api/admin/blockwords', {word: 'ＡＢＣ禁'}, adminTok);
  assert.equal(wide.s, 200);
  const folded = await call('POST', '/api/posts', {text: 'abc禁出现了'}, a.tok);
  assert.equal(folded.s, 400);
  assert.equal(folded.j.error.code, 'BLOCKED_WORD');
  const check = await call('POST', '/api/content/check', {scope: 'post', text: '违禁词乙'}, a.tok);
  assert.equal(check.s, 400);
  assert.equal(check.j.error.code, 'BLOCKED_WORD');
  const made = await call('POST', '/api/communities', {name: '屏蔽社', description: ''}, a.tok);
  const ch = made.j.community.channels.find(c => c.kindKey === 'text' || c.kind === '文字') || made.j.community.channels[0];
  const msg = await call('POST', '/api/channels/' + ch.id + '/messages', {text: '频道里写违禁词乙'}, a.tok);
  assert.equal(msg.s, 400);
  assert.equal(msg.j.error.code, 'BLOCKED_WORD');
  const poll = await call('POST', '/api/posts', {text: '正常问题', poll: {question: '选一个', options: ['好', '违禁词乙']}}, a.tok);
  assert.equal(poll.s, 400);
  assert.equal(poll.j.error.code, 'BLOCKED_WORD');
  const draft = await call('POST', '/api/post-drafts', {text: '定时违禁词乙'}, a.tok);
  assert.equal(draft.s, 400);
  const ok = await call('POST', '/api/posts', {text: '这条没有问题'}, a.tok);
  assert.equal(ok.s, 200, JSON.stringify(ok.j));
});

test('维护模式拦住用户写操作，并同步注册开关', async () => {
  const a = await acc('mnt');
  const on = await call('POST', '/api/admin/flags', {maintenance: true, maintenanceMessage: '凌晨维护，请稍后再来'}, adminTok);
  assert.equal(on.s, 200, JSON.stringify(on.j));
  assert.equal(on.j.flags.maintenance, true);
  const pub = await call('GET', '/api/app/status');
  assert.equal(pub.s, 200);
  assert.equal(pub.j.maintenance, true);
  assert.match(pub.j.maintenanceMessage, /凌晨维护/);
  const denied = await call('POST', '/api/posts', {text: '维护中不能发'}, a.tok);
  assert.equal(denied.s, 503);
  assert.equal(denied.j.error.code, 'MAINTENANCE');
  const read = await call('GET', '/api/posts', null, a.tok);
  assert.equal(read.s, 200);
  const appeal = await call('POST', '/api/appeals', {kind: 'other', body: '维护期间我仍要申诉说明'}, a.tok);
  assert.equal(appeal.s, 200, JSON.stringify(appeal.j));
  const closed = await call('POST', '/api/admin/flags', {maintenance: false, registrationOpen: false}, adminTok);
  assert.equal(closed.s, 200);
  assert.equal(closed.j.flags.maintenance, false);
  assert.equal(closed.j.flags.registrationOpen, false);
  const reg = await call('POST', '/api/auth/register', {agree: true, username: 'closed' + (++seq), email: 'closed' + seq + '@x.test', password: 'Passw0rd123'});
  assert.equal(reg.s, 403);
  assert.equal(reg.j.error.code, 'REGISTRATION_CLOSED');
  await call('POST', '/api/admin/flags', {registrationOpen: true}, adminTok);
});
