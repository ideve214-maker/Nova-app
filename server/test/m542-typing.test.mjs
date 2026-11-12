// M5.4.2 输入中提示：仅短时 SSE 事件，不写入永久存储，重连不重放。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';

let srv, base, seq = 0;
test.before(async () => { srv = createApp({eventsOpts: {heartbeatMs: 10_000}}); await new Promise(r => srv.listen(0, '127.0.0.1', r)); base = 'http://127.0.0.1:' + srv.address().port; });
test.after(() => { try { srv.events.closeAll(); } catch {} srv.close(); });
const call = async (m, p, body, tok) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  return {s: r.status, j: await r.json().catch(() => ({}))};
};
async function acc(n) {
  const u = n + (++seq);
  const r = await call('POST', '/api/auth/register', {agree:true, username: u, email: u + '@x.test', password: 'Passw0rd123'});
  return {tok: r.j.token, id: r.j.user.id};
}
function parseSse(buf) {
  const evs = [];
  for (const raw of buf.split('\n\n')) {
    if (!raw.trim() || raw.trim().startsWith(':')) continue;
    let ev, data = '';
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) ev = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (ev || data) evs.push({ev, data: data ? JSON.parse(data) : null});
  }
  return evs;
}
async function openSse(tok) {
  const ac = new AbortController();
  const res = await fetch(base + '/api/events', {headers: {Authorization: 'Bearer ' + tok, Accept: 'text/event-stream'}, signal: ac.signal});
  return {res, ac, reader: res.body.getReader(), dec: new TextDecoder(), buf: ''};
}
async function readUntil(stream, pred, ms = 2500) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const remain = Math.max(50, deadline - Date.now());
    const got = await Promise.race([
      stream.reader.read(),
      new Promise(r => setTimeout(() => r({timeout: true}), Math.min(300, remain))),
    ]);
    if (got.timeout) { if (pred(stream.buf)) return stream.buf; continue; }
    if (got.done) break;
    stream.buf += stream.dec.decode(got.value, {stream: true});
    if (pred(stream.buf)) return stream.buf;
  }
  throw new Error('SSE 超时: ' + stream.buf.slice(0, 500));
}

test('输入中经 SSE 实时送达，不入库，断线重连不会重放', async () => {
  const a = await acc('tya'), b = await acc('tyb'), c = await acc('tyc');
  srv.friends.setAccepted(a.id, b.id);
  const cv = (await call('POST', '/api/conversations', {kind: 'dm', userId: b.id}, a.tok)).j.conversation;
  const before = srv.db.prepare('SELECT COUNT(*) AS n FROM chat_events').get().n;
  const sse = await openSse(b.tok);
  assert.equal(sse.res.status, 200);
  await readUntil(sse, s => s.includes(': ok') || s.length > 0);
  const ty = await call('POST', '/api/conversations/' + cv.id + '/typing', {on: true}, a.tok);
  assert.equal(ty.s, 200, JSON.stringify(ty.j));
  assert.equal(ty.j.typing.stored, false);
  assert.equal(ty.j.typing.ephemeral, true);
  const buf = await readUntil(sse, s => s.includes('conversation.typing'));
  const evs = parseSse(buf).filter(e => e.ev === 'conversation.typing');
  assert.ok(evs.length >= 1, buf);
  assert.equal(evs[0].data.userId, a.id);
  assert.equal(evs[0].data.stored, false);
  const after = srv.db.prepare('SELECT COUNT(*) AS n FROM chat_events').get().n;
  assert.equal(after, before, '输入中事件不得写入 chat_events');
  const stored = srv.db.prepare("SELECT * FROM chat_events WHERE type LIKE '%typing%'").all();
  assert.equal(stored.length, 0);
  // 非成员不能发
  assert.equal((await call('POST', '/api/conversations/' + cv.id + '/typing', {on: true}, c.tok)).s, 404);
  sse.ac.abort();
  await sse.res.body.cancel().catch(() => {});
  // 重连不会拿到 typing
  const sse2 = await openSse(b.tok);
  assert.equal(sse2.res.status, 200);
  const buf2 = await readUntil(sse2, s => s.includes(': ok') || s.length > 0);
  await new Promise(r => setTimeout(r, 200));
  // 再读一点
  try { await readUntil(sse2, s => s.includes('conversation.typing'), 400); assert.fail('不应重放 typing'); }
  catch (e) { assert.match(String(e.message), /超时/); }
  sse2.ac.abort();
  await sse2.res.body.cancel().catch(() => {});
});
