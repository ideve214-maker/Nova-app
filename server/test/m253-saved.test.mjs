// M2.5.3 个人收藏额度：VIP 只增加私有收藏上限；公共置顶权限与名额不变；到期保留已有、不能超额新增。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';
import {PUBLIC_PIN_MAX} from '../saved.mjs';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const DAY = 864e5, T0 = Date.UTC(2026, 10, 12, 10, 0, 0);
let T = T0, srv, base;
test.before(async () => { srv = createApp({clock: () => T}); await new Promise(r => srv.listen(0, r)); base = 'http://127.0.0.1:' + srv.address().port; });
test.after(() => srv.close());
const call = async (m, p, body, tok) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  return {s: r.status, j: await r.json()};
};
let n = 0;
const mk = async () => { const u = 'sv_' + (++n); const r = await call('POST', '/api/auth/register', {agree:true, username: u, email: u + '@x.com', password: 'Passw0rd123'}); return {id: r.j.user.id, tok: r.j.token, u}; };
const setVip = (id, until) => srv.db.prepare('UPDATE users SET vip_until=?, vip_since=?, vip_source=? WHERE id=?').run(until, T0, 'admin', id);
const fill = async (tok, from, to) => { for (let i = from; i < to; i++) { const r = await call('POST', '/api/me/saved', {kind: 'post', target: 'p' + i, title: 't' + i, excerpt: 'x'.repeat(10)}, tok); assert.equal(r.s, 200, 'fill ' + i); } };

test('未登录不能读写收藏；空列表返回 Basic 额度 20', async () => {
  assert.equal((await call('GET', '/api/me/saved')).s, 401);
  assert.equal((await call('POST', '/api/me/saved', {kind: 'post', target: 'p1'})).s, 401);
  const {tok} = await mk();
  const r = await call('GET', '/api/me/saved', null, tok);
  assert.equal(r.s, 200); assert.deepEqual(r.j.items, []); assert.equal(r.j.count, 0); assert.equal(r.j.limit, 20); assert.equal(r.j.plan, 'basic');
});

test('Basic 可收藏 20 条；第 21 条 403 QUOTA_EXCEEDED 并提示升级；重复收藏幂等不计额度', async () => {
  const {tok} = await mk();
  const a = await call('POST', '/api/me/saved', {kind: 'post', target: 'pA', title: '第一篇', excerpt: '摘要'}, tok);
  assert.equal(a.s, 200); assert.equal(a.j.count, 1); assert.equal(a.j.existed, false); assert.equal(a.j.item.target, 'pA');
  const again = await call('POST', '/api/me/saved', {kind: 'post', target: 'pA', title: '改'}, tok);
  assert.equal(again.s, 200); assert.equal(again.j.existed, true); assert.equal(again.j.count, 1, '重复收藏不占新名额');
  await fill(tok, 1, 20); // 19 more, total 20
  const full = await call('GET', '/api/me/saved', null, tok);
  assert.equal(full.j.count, 20); assert.equal(full.j.limit, 20);
  const over = await call('POST', '/api/me/saved', {kind: 'post', target: 'pOVER'}, tok);
  assert.equal(over.s, 403); assert.equal(over.j.error.code, 'QUOTA_EXCEEDED');
  assert.equal(over.j.error.limit, 20); assert.equal(over.j.error.upgrade, true);
  assert.match(over.j.error.message, /VIP/); assert.match(over.j.error.message, /100/);
  assert.equal((await call('GET', '/api/me/saved', null, tok)).j.count, 20);
});

test('VIP 额度 100；到期后已有收藏保留，超出 Basic 后不能新增，取消收藏可腾出名额', async () => {
  T = T0;
  const {id, tok} = await mk();
  setVip(id, T0 + 10 * DAY);
  const q = (await call('GET', '/api/me/saved', null, tok)).j;
  assert.equal(q.limit, 100); assert.equal(q.plan, 'vip');
  await fill(tok, 0, 25);
  assert.equal((await call('GET', '/api/me/saved', null, tok)).j.count, 25);
  // 到期
  T = T0 + 11 * DAY;
  const after = await call('GET', '/api/me/saved', null, tok);
  assert.equal(after.s, 200); assert.equal(after.j.count, 25, '已收藏保留'); assert.equal(after.j.limit, 20); assert.equal(after.j.plan, 'basic');
  const blocked = await call('POST', '/api/me/saved', {kind: 'post', target: 'pNEW'}, tok);
  assert.equal(blocked.s, 403); assert.equal(blocked.j.error.code, 'QUOTA_EXCEEDED'); assert.equal(blocked.j.error.limit, 20);
  // 取消一条后仍是 24>=20，还是不能新增
  const one = after.j.items[0];
  const rm = await call('POST', '/api/me/saved/remove', {id: one.id}, tok);
  assert.equal(rm.s, 200); assert.equal(rm.j.count, 24);
  assert.equal((await call('POST', '/api/me/saved', {kind: 'post', target: 'pNEW'}, tok)).s, 403);
  // 一直取消到 19，才能再新增
  const left = (await call('GET', '/api/me/saved', null, tok)).j.items;
  for (const it of left.slice(0, 5)) await call('POST', '/api/me/saved/remove', {id: it.id}, tok);
  const now = await call('GET', '/api/me/saved', null, tok);
  assert.equal(now.j.count, 19);
  const ok = await call('POST', '/api/me/saved', {kind: 'message', target: 'm1', excerpt: '一条消息'}, tok);
  assert.equal(ok.s, 200); assert.equal(ok.j.count, 20);
  T = T0;
});

test('收藏只属于自己：看不到也删不掉别人的；非法输入被拒', async () => {
  const a = await mk(), b = await mk();
  const add = await call('POST', '/api/me/saved', {kind: 'post', target: 'pSecret', title: '私密'}, a.tok);
  assert.equal(add.s, 200);
  const listB = await call('GET', '/api/me/saved', null, b.tok);
  assert.equal(listB.j.count, 0);
  assert.ok(!listB.j.items.some(i => i.target === 'pSecret'));
  const rm = await call('POST', '/api/me/saved/remove', {id: add.j.item.id}, b.tok);
  assert.equal(rm.s, 404);
  assert.equal((await call('GET', '/api/me/saved', null, a.tok)).j.count, 1, '别人删不掉');
  // 夹带别人的 userId 无效
  await call('POST', '/api/me/saved', {kind: 'post', target: 'pX', userId: a.id}, b.tok);
  assert.equal((await call('GET', '/api/me/saved', null, a.tok)).j.count, 1);
  assert.equal((await call('POST', '/api/me/saved', {kind: 'nope', target: 'p1'}, a.tok)).j.error.code, 'BAD_KIND');
  assert.equal((await call('POST', '/api/me/saved', {kind: 'post', target: '../etc'}, a.tok)).j.error.code, 'BAD_TARGET');
  assert.equal((await call('POST', '/api/me/saved', {kind: 'post', target: ''}, a.tok)).j.error.code, 'BAD_TARGET');
});

test('公共置顶名额与权限不因 VIP 扩大：固定 5 条，仍按角色，权益表不含公共置顶', () => {
  assert.equal(PUBLIC_PIN_MAX, 5);
  const perm = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../src/15_perm.js'), 'utf8');
  const actions = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../src/70_actions.js'), 'utf8');
  assert.match(perm, /pinMsg:2/, '社区置顶仍需版主及以上，VIP 不降低门槛');
  assert.match(perm, /GRP=\{pinMsg:2/, '群聊置顶仍需管理员及以上');
  assert.match(actions, /a\.length>5\)a\.shift/, '公共置顶仍最多 5 条');
  assert.equal(actions.includes('a.length>5') || /length\s*>\s*5/.test(actions), true);
  const cfg = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../vip-config.mjs'), 'utf8');
  assert.ok(!/public_pin|community_pin|group_pin/.test(cfg), '权益表不得包含公共置顶');
  assert.ok(cfg.includes('公共置顶') && cfg.includes('neverSold'));
});
