// DEPLOY.1 / DEPLOY.3 浏览器：跨源 API 基址；关闭演示后连不上不掉进演示。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {startServer, openPage, register, launch} from './ui-helpers.mjs';

let browser;
const HTML = fileURLToPath(new URL('../../dist/nova_v5.html', import.meta.url));
test.before(async () => { browser = await launch(); });
test.after(async () => { await browser.close(); });

function serveHtml(html) {
  const srv = createServer((req, res) => {
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'});
    res.end(html);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => {
    r({srv, base: 'http://127.0.0.1:' + srv.address().port, close: () => new Promise(ok => srv.close(ok))});
  }));
}

test('设置 NOVA_API_BASE 后，注册请求打到该源（页面在另一端口）', async () => {
  const S = await startServer();
  const html = readFileSync(HTML, 'utf8').replace(
    '<script>\n',
    '<script>window.NOVA_API_BASE=' + JSON.stringify(S.base) + ';</script>\n<script>\n',
  );
  const pageSrv = await serveHtml(html);
  const p = await openPage(browser, pageSrv.base);
  try {
    const url = await p.evaluate(() => apiUrl('/api/health'));
    assert.equal(url, S.base + '/api/health');
    const health = await p.evaluate(async () => {
      const r = await fetch(apiUrl('/api/health'));
      return {s: r.status, href: r.url};
    });
    assert.equal(health.s, 200);
    assert.ok(health.href.startsWith(S.base + '/api/health'));
    await register(p, 'dep_base1');
    assert.ok(await p.locator('nav').count());
    const row = S.srv.db.prepare('SELECT * FROM users WHERE username=?').get('dep_base1');
    assert.ok(row, '应在 API 源的库里找到新用户');
    assert.deepEqual(p.errors, []);
  } finally {
    await p.context().close();
    await pageSrv.close();
    await S.close();
  }
});

test('NOVA_DISABLE_DEMO：健康检查失败或超时不进入演示，展示无法连接与重试；重试成功后出现登录页', async () => {
  let healthy = false;
  const stub = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-File-Name, Last-Event-ID, Last-Event-Id');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const path = new URL(req.url, 'http://x').pathname;
    if (path === '/api/health') {
      if (!healthy) {
        // 慢到超过客户端 2s 超时
        const t = setTimeout(() => { try { res.writeHead(503); res.end('{}'); } catch {} }, 8000);
        res.on('close', () => clearTimeout(t));
        return;
      }
      res.writeHead(200, {'Content-Type': 'application/json'});
      return res.end(JSON.stringify({status: 'ok', time: Date.now()}));
    }
    res.writeHead(404, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({error: {code: 'NOT_FOUND', message: 'no'}}));
  });
  await new Promise(r => stub.listen(0, '127.0.0.1', r));
  const apiBase = 'http://127.0.0.1:' + stub.address().port;
  const html = readFileSync(HTML, 'utf8').replace(
    '<script>\n',
    '<script>window.NOVA_API_BASE=' + JSON.stringify(apiBase) + ';window.NOVA_DISABLE_DEMO=true;</script>\n<script>\n',
  );
  const pageSrv = await serveHtml(html);
  const ctx = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 1});
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', e => p.errors.push(String(e)));
  await p.goto(pageSrv.base + '/');
  try {
    await p.waitForSelector('#offline, [data-offline], [data-a=retryconnect]', {timeout: 8000});
    assert.equal(await p.evaluate(() => MODE), 'offline');
    const text = await p.innerText('body');
    assert.match(text, /无法连接/);
    assert.match(text, /重试/);
    assert.equal(text.includes('林知夏'), false, '不得掉进演示数据');
    assert.equal(await p.locator('[data-a=authdemo]').count(), 0);
    healthy = true;
    await p.click('[data-a=retryconnect]');
    await p.waitForSelector('#gate', {timeout: 8000});
    assert.equal(await p.evaluate(() => MODE), 'gate');
    assert.equal(await p.evaluate(() => NET), true);
    assert.equal(await p.locator('[data-a=authdemo]').count(), 0, '关闭演示后登录页没有演示入口');
    assert.equal((await p.innerText('body')).includes('林知夏'), false);
    assert.deepEqual(p.errors, []);
  } finally {
    await p.context().close();
    await pageSrv.close();
    await new Promise(r => stub.close(r));
  }
});

test('NOVA_DISABLE_DEMO 且服务器正常：进入登录页，没有「先用演示看看」', async () => {
  const S = await startServer();
  const p = await openPage(browser, S.base);
  // 默认未关演示，应有入口；这个用例用 init 脚本在导航前设置。另开一页。
  await p.context().close();
  const ctx = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 1});
  const p2 = await ctx.newPage();
  p2.errors = [];
  p2.on('pageerror', e => p2.errors.push(String(e)));
  await p2.addInitScript(() => { window.NOVA_DISABLE_DEMO = true; });
  await p2.goto(S.base + '/');
  await p2.waitForSelector('#gate', {timeout: 8000});
  try {
    assert.equal(await p2.evaluate(() => MODE), 'gate');
    assert.equal(await p2.locator('[data-a=authdemo]').count(), 0);
    assert.match(await p2.innerText('#gate'), /登录/);
    assert.deepEqual(p2.errors, []);
  } finally {
    await ctx.close();
    await S.close();
  }
});
