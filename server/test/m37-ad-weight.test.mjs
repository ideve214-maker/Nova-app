// 营销帖权重唯一：新建取 MAX+1，手动重复 409，权重为 1 的帖可改可删，迁移 063 先去重再加索引。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, cpSync, rmSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createApp} from '../index.mjs';
import {openDb} from '../db.mjs';
import {createMarketing} from '../marketing.mjs';

const migSrc = join(dirname(fileURLToPath(import.meta.url)), '../migrations');
const sql063 = readFileSync(join(migSrc, '063_ad_weight_unique.sql'), 'utf8');

let srv, base, adm;
test.before(async () => {
  srv = createApp({adminUsername: 'ops_wt', adminPassword: 'OpsWtPass1!'});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  adm = (await call('POST', '/api/admin/auth/login', {username: 'ops_wt', password: 'OpsWtPass1!'})).j.token;
});
test.after(() => srv.close());

const call = async (m, p, body, tok) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  let j = null; try { j = await r.json(); } catch {}
  return {s: r.status, j};
};

test.describe('营销帖权重 HTTP', {concurrency: false}, () => {
test('新建不填权重：按当前最大权重 +1 递增，列表带回 nextWeight', async () => {
  const a = await call('POST', '/api/admin/marketing/ads', {kind: 'text', title: '一', text: 'a'}, adm);
  const b = await call('POST', '/api/admin/marketing/ads', {kind: 'text', title: '二', text: 'b'}, adm);
  const c = await call('POST', '/api/admin/marketing/ads', {kind: 'text', title: '三', text: 'c'}, adm);
  assert.equal(a.s, 200, JSON.stringify(a.j));
  assert.equal(a.j.ad.weight, 1);
  assert.equal(b.j.ad.weight, 2);
  assert.equal(c.j.ad.weight, 3);
  const list = await call('GET', '/api/admin/marketing/ads', null, adm);
  assert.equal(list.s, 200);
  assert.equal(list.j.nextWeight, 4);
});

test('手动指定未被占用的权重可以；占用则 409 并提示下一个', async () => {
  const ok = await call('POST', '/api/admin/marketing/ads', {kind: 'text', text: '指定 10', weight: 10}, adm);
  assert.equal(ok.s, 200, JSON.stringify(ok.j));
  assert.equal(ok.j.ad.weight, 10);
  const dup = await call('POST', '/api/admin/marketing/ads', {kind: 'text', text: '再要 10', weight: 10}, adm);
  assert.equal(dup.s, 409);
  assert.equal(dup.j.error.code, 'WEIGHT_TAKEN');
  assert.match(dup.j.error.message, /权重 10 已被其他营销帖占用，请改用 11/);
  assert.equal(dup.j.error.nextWeight, 11);
  const auto = await call('POST', '/api/admin/marketing/ads', {kind: 'text', text: '自动'}, adm);
  assert.equal(auto.s, 200);
  assert.equal(auto.j.ad.weight, 11);
});

test('编辑：可以把权重 1 改成别的；改成已占用的被拒；只改启用不影响权重', async () => {
  const list = await call('GET', '/api/admin/marketing/ads', null, adm);
  const one = list.j.ads.find(x => x.weight === 1);
  assert.ok(one, '应有一条权重为 1 的营销帖');
  const bad = await call('POST', `/api/admin/marketing/ads/${one.id}`, {weight: 10}, adm);
  assert.equal(bad.s, 409);
  assert.equal(bad.j.error.code, 'WEIGHT_TAKEN');
  const next = list.j.nextWeight;
  const good = await call('POST', `/api/admin/marketing/ads/${one.id}`, {weight: next, title: '改过权重'}, adm);
  assert.equal(good.s, 200, JSON.stringify(good.j));
  assert.equal(good.j.ad.weight, next);
  assert.equal(good.j.ad.title, '改过权重');
  const tog = await call('POST', `/api/admin/marketing/ads/${one.id}`, {enabled: false}, adm);
  assert.equal(tog.s, 200);
  assert.equal(tog.j.ad.enabled, false);
  assert.equal(tog.j.ad.weight, next);
});

test('权重为 1 的营销帖可以删除，删除后不再出现在列表里', async () => {
  const made = await call('POST', '/api/admin/marketing/ads', {kind: 'text', text: '用来删的 1', weight: 1}, adm);
  assert.equal(made.s, 200, JSON.stringify(made.j));
  assert.equal(made.j.ad.weight, 1);
  const id = made.j.ad.id;
  const del = await call('POST', `/api/admin/marketing/ads/${id}/delete`, {}, adm);
  assert.equal(del.s, 200, JSON.stringify(del.j));
  assert.equal(del.j.deleted, id);
  const list = await call('GET', '/api/admin/marketing/ads', null, adm);
  assert.ok(!list.j.ads.some(x => x.id === id));
  // 权重 1 已腾出，可以再指定 1
  const again = await call('POST', '/api/admin/marketing/ads', {kind: 'text', text: '重新占用 1', weight: 1}, adm);
  assert.equal(again.s, 200, JSON.stringify(again.j));
  assert.equal(again.j.ad.weight, 1);
});

});

test('marketing.create 与 AI 发布一样：不传 weight 时取 MAX+1，且与外层事务兼容', () => {
  const db = openDb();
  const mk = createMarketing(db);
  const a = mk.create({kind: 'text', text: '先发'});
  const b = mk.create({kind: 'text', text: '后发'});
  assert.equal(a.ad.weight, 1);
  assert.equal(b.ad.weight, 2);
  db.exec('BEGIN IMMEDIATE');
  const c = mk.create({kind: 'text', text: '事务内'});
  db.exec('COMMIT');
  assert.equal(c.ad.weight, 3);
  db.close();
});

test('迁移 063：先按规则去掉重复权重，再成功加上 UNIQUE 索引', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'adw-'));
  const mig = join(tmp, 'migrations');
  cpSync(migSrc, mig, {recursive: true});
  rmSync(join(mig, '063_ad_weight_unique.sql'));
  const db = openDb(join(tmp, 't.db'), {migrationsDir: mig});
  const t = 1700000000000;
  const ins = db.prepare(`INSERT INTO marketing_ads(id,kind,title,text,enabled,weight,impressions,clicks,hides,created_at,updated_at,deleted_at)
    VALUES(?,?,?,?,1,?,0,0,0,?,?,?)`);
  // 权重 1 三条：keep a1（最早），a2、a3 后移；权重 5 唯一保留；已删除的 d1 不参与
  ins.run('a1', 'text', '留1', 'x', 1, t, t, null);
  ins.run('a2', 'text', '走1-早', 'x', 1, t + 1, t + 1, null);
  ins.run('a3', 'text', '走1-晚', 'x', 1, t + 2, t + 2, null);
  ins.run('a5', 'text', '唯一5', 'x', 5, t + 3, t + 3, null);
  ins.run('d1', 'text', '已删也是1', 'x', 1, t + 4, t + 4, t + 5);
  ins.run('a1b', 'text', '走5的重复', 'x', 5, t + 6, t + 6, null);
  db.exec(sql063);
  const alive = db.prepare('SELECT id, weight FROM marketing_ads WHERE deleted_at IS NULL ORDER BY weight, id').all();
  const byId = Object.fromEntries(alive.map(r => [r.id, r.weight]));
  assert.equal(byId.a1, 1, '最早的权重 1 保留');
  assert.equal(byId.a5, 5, '原来唯一的权重不动');
  // 其余按 原权重、created_at、id 接到 max(5)+1 起：a2(weight1), a3(weight1), a1b(weight5) → 6,7,8
  assert.equal(byId.a2, 6);
  assert.equal(byId.a3, 7);
  assert.equal(byId.a1b, 8);
  assert.equal(db.prepare('SELECT weight FROM marketing_ads WHERE id=?').get('d1').weight, 1, '已删除的不改');
  const dups = db.prepare(`SELECT weight FROM marketing_ads WHERE deleted_at IS NULL GROUP BY weight HAVING COUNT(*)>1`).all();
  assert.equal(dups.length, 0);
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_marketing_ads_weight_alive'").get();
  assert.ok(idx);
  // 再执行一遍应是空操作
  db.exec(sql063);
  assert.equal(db.prepare('SELECT weight FROM marketing_ads WHERE id=?').get('a2').weight, 6);
  db.close();
  rmSync(tmp, {recursive: true, force: true});
});
