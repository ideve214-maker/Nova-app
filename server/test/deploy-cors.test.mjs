// DEPLOY.2 CORS：未设置保持 *；逗号白名单只回显匹配 Origin；预检与 SSE 都带 CORS 头。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';

async function listen(app) {
  await new Promise(r => app.listen(0, '127.0.0.1', r));
  return 'http://127.0.0.1:' + app.address().port;
}

test('默认（未设置）：Access-Control-Allow-Origin 仍是 *，预检 204', async () => {
  const srv = createApp();
  const base = await listen(srv);
  try {
    const r = await fetch(base + '/api/health', {headers: {Origin: 'https://evil.example'}});
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    const opt = await fetch(base + '/api/auth/login', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.example',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Authorization, Content-Type, X-File-Name',
      },
    });
    assert.equal(opt.status, 204);
    assert.equal(opt.headers.get('access-control-allow-origin'), '*');
    const allow = (opt.headers.get('access-control-allow-headers') || '').toLowerCase();
    assert.match(allow, /authorization/);
    assert.match(allow, /content-type/);
    assert.match(allow, /x-file-name/);
    const methods = (opt.headers.get('access-control-allow-methods') || '').toUpperCase();
    assert.match(methods, /GET/);
    assert.match(methods, /POST/);
  } finally { srv.close(); }
});

test('白名单：只回显匹配的 Origin；未匹配不回显；预检与 SSE 同样生效', async () => {
  const srv = createApp({corsOrigin: 'capacitor://localhost, https://localhost'});
  const base = await listen(srv);
  try {
    const ok = await fetch(base + '/api/health', {headers: {Origin: 'capacitor://localhost'}});
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('access-control-allow-origin'), 'capacitor://localhost');

    const ok2 = await fetch(base + '/api/health', {headers: {Origin: 'https://localhost'}});
    assert.equal(ok2.headers.get('access-control-allow-origin'), 'https://localhost');

    const bad = await fetch(base + '/api/health', {headers: {Origin: 'https://evil.example'}});
    assert.equal(bad.status, 200);
    assert.equal(bad.headers.get('access-control-allow-origin'), null);

    const opt = await fetch(base + '/api/media', {
      method: 'OPTIONS',
      headers: {
        Origin: 'capacitor://localhost',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Authorization, Content-Type, X-File-Name',
      },
    });
    assert.equal(opt.status, 204);
    assert.equal(opt.headers.get('access-control-allow-origin'), 'capacitor://localhost');
    const allow = (opt.headers.get('access-control-allow-headers') || '').toLowerCase();
    assert.match(allow, /authorization/);
    assert.match(allow, /content-type/);
    assert.match(allow, /x-file-name/);
    const methods = (opt.headers.get('access-control-allow-methods') || '').toUpperCase();
    assert.match(methods, /GET/);
    assert.match(methods, /POST/);
    assert.match(methods, /OPTIONS/);

    const optBad = await fetch(base + '/api/media', {
      method: 'OPTIONS',
      headers: {Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST'},
    });
    assert.equal(optBad.status, 204);
    assert.equal(optBad.headers.get('access-control-allow-origin'), null);

    const acc = await fetch(base + '/api/auth/register', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({username: 'cors_sse', email: 'cors_sse@x.test', password: 'Passw0rd123'}),
    });
    const j = await acc.json();
    assert.equal(acc.status, 200, JSON.stringify(j));
    const sse = await fetch(base + '/api/events', {
      headers: {
        Authorization: 'Bearer ' + j.token,
        Origin: 'https://localhost',
        Accept: 'text/event-stream',
      },
    });
    assert.equal(sse.status, 200);
    assert.match(sse.headers.get('content-type') || '', /text\/event-stream/);
    assert.equal(sse.headers.get('access-control-allow-origin'), 'https://localhost');
    const sseAllow = (sse.headers.get('access-control-allow-headers') || '').toLowerCase();
    assert.match(sseAllow, /authorization/);
    await sse.body.cancel();
  } finally { srv.close(); }
});

test('白名单包含管理端 Origin 时回显，预检允许 Authorization', async () => {
  const adminOrigin = 'http://127.0.0.1:5173';
  const srv = createApp({corsOrigin: adminOrigin + ', http://localhost:5173, https://admin.example.test'});
  const base = await listen(srv);
  try {
    const r = await fetch(base + '/api/health', {headers: {Origin: adminOrigin}});
    assert.equal(r.headers.get('access-control-allow-origin'), adminOrigin);
    const opt = await fetch(base + '/api/admin/auth/login', {
      method: 'OPTIONS',
      headers: {
        Origin: adminOrigin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Authorization, Content-Type',
      },
    });
    assert.equal(opt.status, 204);
    assert.equal(opt.headers.get('access-control-allow-origin'), adminOrigin);
    const allow = (opt.headers.get('access-control-allow-headers') || '').toLowerCase();
    assert.match(allow, /authorization/);
    const r2 = await fetch(base + '/api/health', {headers: {Origin: 'https://admin.example.test'}});
    assert.equal(r2.headers.get('access-control-allow-origin'), 'https://admin.example.test');
  } finally { srv.close(); }
});
