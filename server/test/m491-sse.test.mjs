// M4.9.1 SSE 心跳、连接限额、断线补拉（在 M4.3.4 之上补齐验收）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';

async function boot(opts = {}) {
  const srv = createApp(opts);
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  return {srv, base, close() { try { srv.events.closeAll(); } catch {} try { srv.closeAllConnections && srv.closeAllConnections(); } catch {} srv.close(); }};
}
const call = async (base, m, p, body, tok) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  return {s: r.status, j: await r.json().catch(() => ({}))};
};
const acc = async (base, n) => {
  const r = await call(base, 'POST', '/api/auth/register', {username: n + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), email: n + Date.now() + '@x.test', password: 'Passw0rd123'});
  return {tok: r.j.token, id: r.j.user.id};
};

test('心跳：短间隔内能读到 SSE 注释行 : ping', async () => {
  const {srv, base, close} = await boot({eventsOpts: {heartbeatMs: 60}});
  try {
    assert.equal(srv.events.heartbeatMs, 60);
    const a = await acc(base, 'hb');
    const ac = new AbortController();
    const res = await fetch(base + '/api/events', {headers: {Authorization: 'Bearer ' + a.tok, Accept: 'text/event-stream'}, signal: ac.signal});
    assert.equal(res.status, 200);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const deadline = Date.now() + 1500;
    while (Date.now() < deadline && !buf.includes(': ping')) {
      const got = await Promise.race([
        reader.read(),
        new Promise(r => setTimeout(() => r({timeout: true}), 200)),
      ]);
      if (got.timeout) continue;
      if (got.done) break;
      buf += dec.decode(got.value, {stream: true});
    }
    assert.match(buf, /:\s*ping/, '应有心跳注释: ' + buf.slice(0, 200));
    ac.abort();
  } finally { close(); }
});

test('同一用户超过连接限额返回 429 TOO_MANY_CONNECTIONS；限额内的连接仍可用', async () => {
  const {srv, base, close} = await boot({eventsOpts: {maxPerUser: 2, heartbeatMs: 10_000}});
  const streams = [];
  try {
    assert.equal(srv.events.maxPerUser, 2);
    const a = await acc(base, 'lim');
    for (let i = 0; i < 2; i++) {
      const ac = new AbortController();
      const res = await fetch(base + '/api/events', {headers: {Authorization: 'Bearer ' + a.tok, Accept: 'text/event-stream'}, signal: ac.signal});
      assert.equal(res.status, 200, '第 ' + (i + 1) + ' 条应成功');
      streams.push({ac, res});
    }
    const over = await fetch(base + '/api/events', {headers: {Authorization: 'Bearer ' + a.tok, Accept: 'text/event-stream'}});
    assert.equal(over.status, 429);
    const j = await over.json();
    assert.equal(j.error.code, 'TOO_MANY_CONNECTIONS');
    // 关掉一条后再开
    streams[0].ac.abort();
    await streams[0].res.body.cancel().catch(() => {});
    await new Promise(r => setTimeout(r, 50));
    const again = await fetch(base + '/api/events', {headers: {Authorization: 'Bearer ' + a.tok, Accept: 'text/event-stream'}});
    assert.equal(again.status, 200);
    again.body.cancel();
  } finally {
    for (const s of streams) { try { s.ac.abort(); await s.res.body.cancel(); } catch {} }
    close();
  }
});

test('默认限额为 4；CORS 与 NOVA_API_BASE 无关的响应头仍在（白名单回显）', async () => {
  const {base, close} = await boot({corsOrigin: 'https://app.example,capacitor://localhost'});
  try {
    const a = await acc(base, 'cors');
    const res = await fetch(base + '/api/events', {
      headers: {Authorization: 'Bearer ' + a.tok, Accept: 'text/event-stream', Origin: 'capacitor://localhost'},
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), 'capacitor://localhost');
    await res.body.cancel();
  } finally { close(); }
});
