// M4.3.4 SSE 推送：新消息实时送达；断线后从最后事件恢复；令牌不得放 URL。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';

let srv, base, seq = 0;
test.before(async () => { srv = createApp(); await new Promise(r => srv.listen(0, '127.0.0.1', r)); base = 'http://127.0.0.1:' + srv.address().port; });
test.after(() => { try { srv.events.closeAll(); } catch {} srv.close(); });
const call = async (m, p, body, tok) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  return {s: r.status, j: await r.json().catch(() => ({}))};
};
async function acc(n) {
  const u = n + (++seq);
  const r = await call('POST', '/api/auth/register', {username: u, email: u + '@x.test', password: 'Passw0rd123'});
  return {tok: r.j.token, id: r.j.user.id};
}

function parseSse(buf) {
  const evs = [];
  for (const raw of buf.split('\n\n')) {
    if (!raw.trim() || raw.trim().startsWith(':')) continue;
    let id, ev, data = '';
    for (const line of raw.split('\n')) {
      if (line.startsWith('id:')) id = line.slice(3).trim();
      else if (line.startsWith('event:')) ev = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (ev || data) evs.push({id, ev, data: data ? JSON.parse(data) : null});
  }
  return evs;
}

async function openSse(tok, {lastId, extraQuery} = {}) {
  const headers = {Authorization: 'Bearer ' + tok, Accept: 'text/event-stream'};
  if (lastId) headers['Last-Event-ID'] = String(lastId);
  const ac = new AbortController();
  const url = base + '/api/events' + (extraQuery || '');
  const res = await fetch(url, {headers, signal: ac.signal});
  return {res, ac, reader: res.body && res.body.getReader(), dec: new TextDecoder(), buf: ''};
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

test('URL 带令牌被拒绝；必须用 Authorization 头', async () => {
  const a = await acc('sa');
  const bad = await fetch(base + '/api/events?token=' + encodeURIComponent(a.tok), {headers: {Authorization: 'Bearer ' + a.tok}});
  assert.equal(bad.status, 400);
  const j = await bad.json();
  assert.equal(j.error.code, 'TOKEN_IN_URL');
  const noauth = await fetch(base + '/api/events');
  assert.equal(noauth.status, 401);
});

test('新消息通过 SSE 实时送达；断线后用 Last-Event-ID 补发漏掉的事件', async () => {
  const a = await acc('ea'), b = await acc('eb');
  srv.friends.setAccepted(a.id, b.id);
  const cv = (await call('POST', '/api/conversations', {kind: 'dm', userId: b.id}, a.tok)).j.conversation;
  const sse = await openSse(b.tok);
  assert.equal(sse.res.status, 200, await sse.res.text().catch(() => ''));
  assert.match(sse.res.headers.get('content-type') || '', /text\/event-stream/);
  await readUntil(sse, s => s.includes(': ok') || s.includes('ping') || s.length > 0);

  const sent = await call('POST', '/api/conversations/' + cv.id + '/messages', {text: '实时你好'}, a.tok);
  assert.equal(sent.s, 200);
  const buf = await readUntil(sse, s => s.includes('实时你好') && s.includes('conversation.message'));
  const evs = parseSse(buf);
  const hit = evs.find(e => e.ev === 'conversation.message' && e.data && e.data.message && e.data.message.text === '实时你好');
  assert.ok(hit, '应收到实时事件: ' + buf);
  const lastId = hit.id;
  assert.ok(lastId);

  sse.ac.abort();
  // 断线期间再发两条
  await call('POST', '/api/conversations/' + cv.id + '/messages', {text: '离线一'}, a.tok);
  await call('POST', '/api/conversations/' + cv.id + '/messages', {text: '离线二'}, a.tok);

  const sse2 = await openSse(b.tok, {lastId});
  assert.equal(sse2.res.status, 200);
  const buf2 = await readUntil(sse2, s => s.includes('离线一') && s.includes('离线二'));
  const evs2 = parseSse(buf2);
  const texts = evs2.filter(e => e.ev === 'conversation.message').map(e => e.data.message.text);
  assert.ok(texts.includes('离线一'));
  assert.ok(texts.includes('离线二'));
  assert.ok(!texts.includes('实时你好'), '不应重复已确认的事件');
  sse2.ac.abort();
});
