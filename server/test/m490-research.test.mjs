// M4.9.0：调研结论已入库，并与当前实现一致（SSE+POST，令牌不进 URL）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createApp} from '../index.mjs';

const doc = readFileSync(fileURLToPath(new URL('../../docs/research/M4.9.0_实时通信调研结论.md', import.meta.url)), 'utf8');

test('调研结论文档写明：先 SSE+POST、禁止令牌入 URL、升级条件', () => {
  assert.match(doc, /SSE\s*\+\s*POST/);
  assert.match(doc, /TOKEN_IN_URL|禁止把访问令牌放进 URL/);
  assert.match(doc, /Authorization/);
  assert.match(doc, /在线状态/);
  assert.match(doc, /NOVA_API_BASE/);
  assert.match(doc, /留给负责人/);
  assert.match(doc, /不引入 WebSocket 依赖/);
});

test('实现与结论一致：/api/events 是 event-stream；URL 带令牌 400', async () => {
  const srv = createApp();
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  try {
    const acc = await fetch(base + '/api/auth/register', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({username: 'm490a', email: 'm490a@x.test', password: 'Passw0rd123'}),
    });
    const j = await acc.json();
    assert.equal(acc.status, 200, JSON.stringify(j));
    const bad = await fetch(base + '/api/events?token=' + encodeURIComponent(j.token), {
      headers: {Authorization: 'Bearer ' + j.token},
    });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error.code, 'TOKEN_IN_URL');
    const ok = await fetch(base + '/api/events', {
      headers: {Authorization: 'Bearer ' + j.token, Accept: 'text/event-stream'},
    });
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('content-type') || '', /text\/event-stream/);
    await ok.body.cancel();
  } finally { try { srv.events.closeAll(); } catch {} srv.close(); }
});
