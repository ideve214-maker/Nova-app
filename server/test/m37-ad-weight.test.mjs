// 营销帖权重：2.1.0 起去除（忽略 weight、不再唯一、随机不重复）；保留迁移 063 本身的回归测试。
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

test.describe('营销帖权重 HTTP（2.1.0 起权重去除）', {concurrency: false}, () => {
test('新建 / 编辑带不带 weight 都可以；重复的 weight 不再 409；列表不再给 nextWeight', async () => {
  const a = await call('POST', '/api/admin/marketing/ads', {kind: 'text', title: '一', text: 'a'}, adm);
  const b = await call('POST', '/api/admin/marketing/ads', {kind: 'text', title: '二', text: 'b', weight: 10}, adm);
  const c = await call('POST', '/api/admin/marketing/ads', {kind: 'text', title: '三', text: 'c', weight: 10}, adm);
  assert.equal(a.s, 200, JSON.stringify(a.j));
  assert.equal(b.s, 200, JSON.stringify(b.j));
  assert.equal(c.s, 200, '旧版管理端带重复权重也不报错');
  for (const r of [a, b, c]) assert.equal(r.j.ad.weight, 1, '权重被忽略，统一为 1');
  const up = await call('POST', `/api/admin/marketing/ads/${b.j.ad.id}`, {weight: 99, title: '改标题'}, adm);
  assert.equal(up.s, 200, JSON.stringify(up.j));
  assert.equal(up.j.ad.weight, 1);
  assert.equal(up.j.ad.title, '改标题');
  const list = await call('GET', '/api/admin/marketing/ads', null, adm);
  assert.equal(list.s, 200);
  assert.equal(list.j.nextWeight, undefined);
  assert.equal(list.j.weightEnabled, false);
  const del = await call('POST', `/api/admin/marketing/ads/${a.j.ad.id}/delete`, {}, adm);
  assert.equal(del.s, 200);
});
});

test('marketing.create 与外层事务兼容；pickFor 等概率随机且同一次不重复', () => {
  const db = openDb();
  const mk = createMarketing(db);
  mk.create({kind: 'text', text: '先发'});
  db.exec('BEGIN IMMEDIATE');
  mk.create({kind: 'text', text: '事务内'});
  db.exec('COMMIT');
  mk.create({kind: 'text', text: '第三条'});
  mk.saveSettings({perFeed: 10, dailyCap: 0});
  const firsts = new Map();
  for (let i = 0; i < 300; i++) {
    const {ads} = mk.pickFor({id: 1});
    assert.equal(ads.length, 3, '候选只有 3 条时只发 3 条，不重复填充');
    assert.equal(new Set(ads.map(x => x.id)).size, 3, '同一次不重复');
    firsts.set(ads[0].text, (firsts.get(ads[0].text) || 0) + 1);
  }
  assert.equal(firsts.size, 3, '每条都有机会排第一');
  for (const n of firsts.values()) assert.ok(n > 50, '大致等概率: ' + JSON.stringify([...firsts]));
  db.close();
});

test('迁移 064：去掉 063 的权重唯一索引', () => {
  const db = openDb();
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_marketing_ads_weight_alive'").get();
  assert.equal(idx, undefined);
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
