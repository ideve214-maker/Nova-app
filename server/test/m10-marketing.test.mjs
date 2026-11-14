// r10 营销管理：营销帖（广告）下发、频率、不感兴趣、每日上限、素材上传。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../index.mjs';

let srv, base, seq = 0, adm;
test.before(async () => {
  srv = createApp({adminUsername: 'ops_mk', adminPassword: 'OpsMkPass1!', mediaDir: join(mkdtempSync(join(tmpdir(), 'mk-')), 'media')});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  adm = (await call('POST', '/api/admin/auth/login', {username: 'ops_mk', password: 'OpsMkPass1!'})).j.token;
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

test('营销帖：只有一条时按每人数量重复下发；不感兴趣后不再出现；每日上限生效', async () => {
  const a = await acc('mka');
  const c = await call('POST', '/api/admin/marketing/ads', {kind: 'text', title: '春季上新', text: '全场八折', linkUrl: 'https://example.com', cta: '去看看'}, adm);
  assert.equal(c.s, 200, JSON.stringify(c.j));
  const id = c.j.ad.id;
  assert.equal((await call('POST', '/api/admin/marketing/settings', {every: 4, perFeed: 3, dailyCap: 5}, adm)).j.settings.every, 4);
  let f = await call('GET', '/api/posts?feed=rec', null, a.tok);
  assert.equal(f.j.adEvery, 4);
  assert.equal(f.j.ads.length, 3);
  assert.ok(f.j.ads.every(x => x.id === id && x.badge === '推广'));
  // 曝光计数 + 每日上限
  for (let i = 0; i < 4; i++) assert.equal((await call('POST', `/api/marketing/ads/${id}/impression`, {}, a.tok)).s, 200);
  f = await call('GET', '/api/posts?feed=rec', null, a.tok);
  assert.equal(f.j.ads.length, 1, '今天还剩 1 条额度');
  await call('POST', `/api/marketing/ads/${id}/click`, {}, a.tok);
  assert.equal((await call('POST', `/api/marketing/ads/${id}/hide`, {reason: '不感兴趣'}, a.tok)).s, 200);
  f = await call('GET', '/api/posts?feed=rec', null, a.tok);
  assert.equal(f.j.ads.length, 0);
  const list = await call('GET', '/api/admin/marketing/ads', null, adm);
  const ad = list.j.ads.find(x => x.id === id);
  assert.equal(ad.impressions, 4); assert.equal(ad.clicks, 1); assert.equal(ad.hides, 1);
  // 别的用户不受影响；翻页（带 cursor）不再附带广告
  const b = await acc('mkb');
  assert.equal((await call('GET', '/api/posts?feed=rec', null, b.tok)).j.ads.length, 3);
});

test('营销帖：多条时随机且不重复；关闭后不下发；停用/删除生效；校验', async () => {
  const u = await acc('mkc');
  await call('POST', '/api/admin/marketing/settings', {enabled: true, every: 5, perFeed: 2, dailyCap: 0}, adm);
  const ids = [];
  for (const t of ['甲', '乙']) ids.push((await call('POST', '/api/admin/marketing/ads', {kind: 'text', text: '广告' + t}, adm)).j.ad.id);
  const f = await call('GET', '/api/posts?feed=rec', null, u.tok);
  assert.equal(f.j.ads.length, 2);
  assert.notEqual(f.j.ads[0].id, f.j.ads[1].id);
  await call('POST', '/api/admin/marketing/settings', {enabled: false}, adm);
  assert.equal((await call('GET', '/api/posts?feed=rec', null, u.tok)).j.ads.length, 0);
  await call('POST', '/api/admin/marketing/settings', {enabled: true}, adm);
  const all = (await call('GET', '/api/admin/marketing/ads', null, adm)).j.ads.map(x => x.id);
  for (const id of all) await call('POST', `/api/admin/marketing/ads/${id}`, {enabled: false}, adm);
  assert.equal((await call('GET', '/api/posts?feed=rec', null, u.tok)).j.ads.length, 0);
  assert.equal((await call('POST', `/api/admin/marketing/ads/${ids[0]}/delete`, {}, adm)).s, 200);
  assert.equal((await call('POST', '/api/admin/marketing/ads', {kind: 'image'}, adm)).s, 400);
  assert.equal((await call('POST', '/api/admin/marketing/ads', {kind: 'text', text: 'x', linkUrl: 'javascript:alert(1)'}, adm)).s, 400);
  assert.equal((await call('GET', '/api/admin/marketing/ads', null, u.tok)).s, 403);
});

test('营销帖素材：上传图片后可公开读取；非图片视频拒绝', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const up = await call('POST', '/api/admin/marketing/media', {data: png.toString('base64')}, adm);
  assert.equal(up.s, 200, JSON.stringify(up.j));
  assert.equal(up.j.kind, 'image');
  const r = await fetch(base + up.j.url);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/png');
  assert.equal((await call('POST', '/api/admin/marketing/media', {data: Buffer.from('hello world, not media').toString('base64')}, adm)).s, 400);
  const ad = await call('POST', '/api/admin/marketing/ads', {kind: 'image', title: '图', media: [{url: up.j.url}]}, adm);
  assert.equal(ad.s, 200);
  assert.equal(ad.j.ad.media[0].kind, 'image');
});
