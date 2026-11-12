// M4.5.5 文件鉴权与风险扫描接口：不能猜 URL；扫描有接口位，默认不假装已通过。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../index.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
let seq = 0;
const call = async (base, m, p, body, tok) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  return {s: r.status, j: await r.json().catch(() => ({}))};
};
async function acc(base, n) {
  const u = n + (++seq);
  const r = await call(base, 'POST', '/api/auth/register', {agree:true, username: u, email: u + '@x.test', password: 'Passw0rd123'});
  return {tok: r.j.token, id: r.j.user.id};
}

test('未登录或乱猜 id 拿不到文件；会话令牌不能放 URL；短期 ticket 可以', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nova-m455-'));
  const srv = createApp({mediaDir: dir});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  try {
    const a = await acc(base, 'au');
    const up = await call(base, 'POST', '/api/media', {name: 'dot.png', mime: 'image/png', data: PNG.toString('base64')}, a.tok);
    assert.equal(up.s, 200, JSON.stringify(up.j));
    const id = up.j.media.id;
    assert.equal((await fetch(base + '/api/media/' + id + '/file')).status, 401);
    assert.equal((await fetch(base + '/api/media/md_thisisnotarealid000000/file', {headers: {Authorization: 'Bearer ' + a.tok}})).status, 404);
    const tokUrl = await fetch(base + '/api/media/' + id + '/file?token=' + encodeURIComponent(a.tok), {headers: {Authorization: 'Bearer ' + a.tok}});
    assert.equal(tokUrl.status, 400);
    const j = await tokUrl.json();
    assert.equal(j.error.code, 'TOKEN_IN_URL');
    const tk = await call(base, 'POST', '/api/media/' + id + '/ticket', {}, a.tok);
    assert.equal(tk.s, 200, JSON.stringify(tk.j));
    assert.ok(tk.j.ticket);
    assert.ok(!tk.j.ticket.includes(a.tok), 'ticket 不是登录令牌');
    const ok = await fetch(base + '/api/media/' + id + '/file?ticket=' + encodeURIComponent(tk.j.ticket));
    assert.equal(ok.status, 200);
    // 默认扫描状态是 pending，不是假装的 clean
    assert.equal(up.j.media.scanStatus, 'pending');
  } finally { srv.close(); }
});

test('扫描接口位可注入：返回 blocked 则拒绝入库', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nova-m455b-'));
  const srv = createApp({mediaDir: dir, mediaScan: () => ({status: 'blocked', reason: '测试拦截'})});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  try {
    const a = await acc(base, 'sc');
    const up = await call(base, 'POST', '/api/media', {name: 'dot.png', mime: 'image/png', data: PNG.toString('base64')}, a.tok);
    assert.equal(up.s, 400);
    assert.equal(up.j.error.code, 'BLOCKED_FILE');
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM media').get().n, 0);
  } finally { srv.close(); }
});
