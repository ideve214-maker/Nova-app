// M4.5.6 用户额度和存储清理：免费/VIP 限额服务端执行；删除后可清理文件。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, existsSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../index.mjs';
import {MEDIA_QUOTA} from '../media.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
let srv, base, seq = 0, dir;
test.before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'nova-m456-'));
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

test('额度由服务端执行；删除后 purge 释放空间和文件', async () => {
  const a = await acc('qa');
  const usage0 = await call('GET', '/api/media/usage', null, a.tok);
  assert.equal(usage0.s, 200);
  assert.equal(usage0.j.usage.quota, MEDIA_QUOTA.basic);
  assert.equal(usage0.j.usage.used, 0);
  const up = await call('POST', '/api/media', {name: 'dot.png', mime: 'image/png', data: PNG.toString('base64')}, a.tok);
  assert.equal(up.s, 200);
  const usage1 = (await call('GET', '/api/media/usage', null, a.tok)).j.usage;
  assert.ok(usage1.used > 0);
  assert.ok(usage1.used < usage1.quota);
  const row = srv.db.prepare('SELECT * FROM media WHERE id=?').get(up.j.media.id);
  const fp = join(dir, row.path);
  assert.ok(existsSync(fp));
  // 模拟额度用尽：把已用大小改到额度
  srv.db.prepare('UPDATE media SET size=? WHERE id=?').run(MEDIA_QUOTA.basic, up.j.media.id);
  const deny = await call('POST', '/api/media', {name: 'dot2.png', mime: 'image/png', data: PNG.toString('base64')}, a.tok);
  assert.equal(deny.s, 403); assert.equal(deny.j.error.code, 'QUOTA');
  // VIP 额度更高
  srv.db.prepare('UPDATE users SET vip_until=? WHERE id=?').run(Date.now() + 86400e3, a.id);
  const usageV = (await call('GET', '/api/media/usage', null, a.tok)).j.usage;
  assert.equal(usageV.quota, MEDIA_QUOTA.vip);
  assert.equal(usageV.vip, true);
  const up2 = await call('POST', '/api/media', {name: 'dot2.png', mime: 'image/png', data: PNG.toString('base64')}, a.tok);
  assert.equal(up2.s, 200, JSON.stringify(up2.j));
  // 删除并清理
  srv.db.prepare('UPDATE media SET size=? WHERE id=?').run(up.j.media.size, up.j.media.id); // 恢复真实大小避免干扰
  const del = await call('POST', '/api/media/' + up.j.media.id + '/delete', {}, a.tok);
  assert.equal(del.s, 200);
  assert.ok(existsSync(fp), '软删除后文件仍在，等 purge');
  const pur = srv.media.purgeDeleted();
  assert.ok(pur.purged >= 1);
  assert.ok(!existsSync(fp), 'purge 后文件被删除');
  assert.ok(!srv.db.prepare('SELECT * FROM media WHERE id=?').get(up.j.media.id));
});
