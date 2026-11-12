// M2.5.4 前端提示与服务端限制一致。
import test from 'node:test';
import assert from 'node:assert/strict';
import {startServer, openPage, register, launch} from './ui-helpers.mjs';

let browser;
test.before(async () => { browser = await launch(); });
test.after(async () => { await browser.close(); });

test('M2.5.4 Basic 发帖框上限 280，计数器与发布按钮一致；超长不能发；服务端同样拒绝', async () => {
  const S = await startServer(); const p = await openPage(browser, S.base);
  try {
    await register(p, 'tx_ui1');
    await p.click('[data-a=compose]');
    await p.waitForSelector('[data-d=pin]');
    assert.equal(await p.getAttribute('[data-d=pin]', 'data-max'), '280');
    await p.fill('[data-d=pin]', '啊'.repeat(280));
    assert.match(await p.innerText('[data-cnt=pin]'), /280\/280/);
    assert.equal(await p.locator('[data-a=pub]').isDisabled(), false);
    await p.fill('[data-d=pin]', '啊'.repeat(281));
    assert.match(await p.innerText('[data-cnt=pin]'), /已超出 1 字/);
    assert.equal(await p.locator('[data-a=pub]').isDisabled(), true);
    const t = await p.evaluate(() => JSON.parse(localStorage.getItem('nova_session')).token);
    const r = await p.evaluate(async t => {
      const r = await fetch('/api/content/check', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + t}, body: JSON.stringify({scope: 'post', text: '啊'.repeat(281)})});
      return {s: r.status, c: (await r.json()).error.code, lim: (await r.json().catch(()=>({})))};
    }, t);
    // re-fetch properly
    const r2 = await p.evaluate(async t => {
      const res = await fetch('/api/content/check', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + t}, body: JSON.stringify({scope: 'post', text: '啊'.repeat(281)})});
      const j = await res.json(); return {s: res.status, c: j.error.code, limit: j.error.limit};
    }, t);
    assert.equal(r2.s, 403); assert.equal(r2.c, 'TEXT_TOO_LONG'); assert.equal(r2.limit, 280);
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); await S.close(); }
});

test('M2.5.4 开通 VIP 后发帖框立即变成 1000 字；到期后回落 280', async () => {
  let tnow = Date.now();
  const S = await startServer({env: 'development', clock: () => tnow}); const p = await openPage(browser, S.base);
  try {
    await register(p, 'tx_ui2');
    await p.click('nav [data-v=me]'); await p.click('#v [data-a=vip]');
    await p.waitForSelector('#vipc .vp[data-vs]:not([data-vs=loading])');
    await p.click('[data-a=viptoggle][data-v="1"]');
    await p.waitForSelector('#vipc .vp[data-vs=active]');
    await p.click('[data-a=back]');
    await p.click('nav [data-v=home]');
    await p.click('[data-a=compose]');
    await p.waitForSelector('[data-d=pin]');
    assert.equal(await p.getAttribute('[data-d=pin]', 'data-max'), '1000');
    await p.fill('[data-d=pin]', '字'.repeat(281));
    assert.match(await p.innerText('[data-cnt=pin]'), /281\/1000/);
    assert.equal(await p.locator('[data-a=pub]').isDisabled(), false);
    const tok = await p.evaluate(() => JSON.parse(localStorage.getItem('nova_session')).token);
    const ok = await p.evaluate(async t => {
      const res = await fetch('/api/content/check', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + t}, body: JSON.stringify({scope: 'post', text: '字'.repeat(1000)})});
      return res.status;
    }, tok);
    assert.equal(ok, 200);
    // 把到期时间改到明天，再把时钟推过到期；会话（30 天）仍然有效。
    const me = await p.evaluate(async t => (await (await fetch('/api/me', {headers: {Authorization: 'Bearer ' + t}})).json()).user, tok);
    S.srv.db.prepare('UPDATE users SET vip_until=? WHERE id=?').run(tnow + 864e5, me.id);
    tnow += 864e5 * 2;
    const exp = await p.evaluate(async t => {
      const res = await fetch('/api/content/check', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + t}, body: JSON.stringify({scope: 'post', text: '字'.repeat(281)})});
      const j = await res.json(); return {s: res.status, limit: j.error && j.error.limit, code: j.error && j.error.code};
    }, tok);
    assert.equal(exp.s, 403); assert.equal(exp.limit, 280);
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); await S.close(); }
});
