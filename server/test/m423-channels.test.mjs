// M4.2.3 频道创建、改名、删除、公告：默认频道受保护；公告频道权限正确。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';

let srv, base, seq = 0;
test.before(async () => { srv = createApp(); await new Promise(r => srv.listen(0, '127.0.0.1', r)); base = 'http://127.0.0.1:' + srv.address().port; });
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

test('所有者/管理员可创建、改名频道；默认频道不能删除；至少保留一个频道', async () => {
  const o = await acc('co'), mem = await acc('cm');
  const c = (await call('POST', '/api/communities', {name: '频道社区'}, o.tok)).j.community;
  await call('POST', '/api/communities/' + c.id + '/join', {}, mem.tok);
  const def = c.channels;
  assert.ok(def.every(ch => ch.isDefault));
  const add = await call('POST', '/api/communities/' + c.id + '/channels', {name: '摘抄', kind: 'text'}, o.tok);
  assert.equal(add.s, 200, JSON.stringify(add.j));
  assert.equal(add.j.channel.isDefault, false);
  const ren = await call('POST', '/api/channels/' + add.j.channel.id + '/rename', {name: '摘句'}, o.tok);
  assert.equal(ren.j.channel.name, '摘句');
  assert.equal((await call('POST', '/api/communities/' + c.id + '/channels', {name: '秘密'}, mem.tok)).s, 403);
  const hall = def.find(ch => ch.name === '大厅');
  const bad = await call('POST', '/api/channels/' + hall.id + '/delete', {}, o.tok);
  assert.equal(bad.s, 400); assert.equal(bad.j.error.code, 'DEFAULT_CHANNEL');
  const rm = await call('POST', '/api/channels/' + add.j.channel.id + '/delete', {}, o.tok);
  assert.equal(rm.s, 200);
  const after = await call('GET', '/api/communities/' + c.id, null, o.tok);
  assert.ok(!after.j.community.channels.some(ch => ch.id === add.j.channel.id));
  assert.ok(after.j.community.channels.some(ch => ch.isDefault && ch.name === '大厅'));
});

test('公告频道：成员不能发，版主及以上可以；普通频道成员可以发', async () => {
  const o = await acc('ao'), mem = await acc('am'), mo = await acc('az');
  const c = (await call('POST', '/api/communities', {name: '公告社区'}, o.tok)).j.community;
  await call('POST', '/api/communities/' + c.id + '/join', {}, mem.tok);
  await call('POST', '/api/communities/' + c.id + '/join', {}, mo.tok);
  await call('POST', '/api/communities/' + c.id + '/role', {userId: mo.id, role: 'mod'}, o.tok);
  const hall = c.channels.find(ch => ch.kindKey === 'text' || ch.kind === '文字');
  const ann = c.channels.find(ch => ch.kindKey === 'announce' || ch.kind === '公告');
  const okH = await call('POST', '/api/channels/' + hall.id + '/messages', {text: '大厅问候'}, mem.tok);
  assert.equal(okH.s, 200, JSON.stringify(okH.j));
  const noA = await call('POST', '/api/channels/' + ann.id + '/messages', {text: '成员发公告'}, mem.tok);
  assert.equal(noA.s, 403);
  const yes = await call('POST', '/api/channels/' + ann.id + '/messages', {text: '版主公告'}, mo.tok);
  assert.equal(yes.s, 200);
  const ownerA = await call('POST', '/api/channels/' + ann.id + '/messages', {text: '所有者公告'}, o.tok);
  assert.equal(ownerA.s, 200);
  const list = await call('GET', '/api/channels/' + ann.id + '/messages', null, mem.tok);
  assert.ok(list.j.messages.some(m => m.text === '版主公告'));
  assert.ok(!list.j.messages.some(m => m.text === '成员发公告'));
  const long = await call('POST', '/api/channels/' + hall.id + '/messages', {text: '哈'.repeat(281)}, mem.tok);
  assert.equal(long.j.error.code, 'TEXT_TOO_LONG');
});
