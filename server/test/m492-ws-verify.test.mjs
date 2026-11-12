// M4.9.2：WebSocket 只做技术验证，不迁移；现网仍是 SSE+POST。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createApp} from '../index.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const doc = readFileSync(root + 'docs/research/M4.9.2_WebSocket技术验证.md', 'utf8');
const pkg = JSON.parse(readFileSync(root + 'package.json', 'utf8'));

test('验证文档：候选库、鉴权/心跳/重连/确认/补拉清单；明确不迁移', () => {
  assert.match(doc, /`ws`/);
  assert.match(doc, /MIT/);
  assert.match(doc, /Authorization/);
  assert.match(doc, /禁止/);
  assert.match(doc, /NOVA_API_BASE/);
  assert.match(doc, /NOVA_CORS_ORIGIN/);
  assert.match(doc, /不把传输从 SSE 换成 WebSocket|不迁移/);
  assert.match(doc, /待办/);
  assert.match(doc, /已送达/);
});

test('package.json 未加入 WebSocket 依赖；工作区没有 node_modules/ws（本步不安装）', () => {
  const deps = {...(pkg.dependencies || {}), ...(pkg.devDependencies || {})};
  assert.ok(!Object.keys(deps).some(k => k === 'ws' || k === 'websocket' || k === 'socket.io'), '不应在本步引入 WS 依赖: ' + JSON.stringify(deps));
  assert.equal(existsSync(root + 'node_modules/ws'), false);
});

test('现网 /api/events 仍是 event-stream，不是 WebSocket 升级', async () => {
  const srv = createApp();
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  try {
    const acc = await fetch(base + '/api/auth/register', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({agree:true, username: 'm492a', email: 'm492a@x.test', password: 'Passw0rd123'}),
    });
    const j = await acc.json();
    const res = await fetch(base + '/api/events', {
      headers: {Authorization: 'Bearer ' + j.token, Accept: 'text/event-stream'},
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/event-stream/);
    assert.ok(!(res.headers.get('upgrade') || '').toLowerCase().includes('websocket'));
    await res.body.cancel();
  } finally { try { srv.events.closeAll(); } catch {} srv.close(); }
});
