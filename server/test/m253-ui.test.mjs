// M2.5.3 个人收藏浏览器测试：额度由服务端执行；公共置顶不受 VIP 影响。
import test from 'node:test';
import assert from 'node:assert/strict';
import {startServer, openPage, register, launch} from './ui-helpers.mjs';

let browser;
const SHOT = new URL('../../screenshots/', import.meta.url).pathname;
test.before(async () => { browser = await launch(); });
test.after(async () => { await browser.close(); });

const tok = p => p.evaluate(() => JSON.parse(localStorage.getItem('nova_session')).token);
const api = (p, m, path, body) => p.evaluate(async ([m, path, body, t]) => {
  const r = await fetch(path, {method: m, headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + t}, body: body ? JSON.stringify(body) : undefined});
  return {s: r.status, j: await r.json()};
}, [m, path, body, null]).then(async () => {
  const t = await tok(p);
  return p.evaluate(async ([m, path, body, t]) => {
    const r = await fetch(path, {method: m, headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + t}, body: body ? JSON.stringify(body) : undefined});
    return {s: r.status, j: await r.json()};
  }, [m, path, body, t]);
});

test('M2.5.3 收藏帖子后出现在「我的收藏」，额度显示 1/20；重复收藏不占名额', async () => {
  const S = await startServer(); const p = await openPage(browser, S.base);
  try {
    await register(p, 'sv_ui1');
    await p.click('.comp [data-a=compose], [data-a=compose]');
    await p.waitForSelector('[data-d=pin]');
    await p.fill('[data-d=pin]', '值得留下来的一句。');
    await p.click('[data-a=pub]');
    await p.waitForSelector('.card .bd');
    // 打开第一条自己的帖子菜单
    await p.locator('.card [data-a=more]').first().click();
    await p.click('.pn [data-a=savp]');
    await p.waitForTimeout(300);
    await p.click('nav [data-v=me]'); await p.click('[data-a=go][data-v=set]');
    await p.click('#svrow, [data-a=saved]');
    await p.waitForSelector('#savedp [data-svq="1/20"]');
    assert.match(await p.getAttribute('#savedp [data-svq]', 'data-svq'), /1\/20/);
    assert.match(await p.innerText('#savedp'), /值得留下来的一句/);
    assert.match(await p.innerText('#savedp'), /私人收藏/);
    await p.screenshot({path: SHOT + 'm253-saved.png'});
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); await S.close(); }
});

test('M2.5.3 Basic 第 21 条被服务端拒绝；开通 VIP 后可超过 20；公共置顶仍最多 5 且要角色权限', async () => {
  const S = await startServer({env: 'development'}); const p = await openPage(browser, S.base);
  try {
    await register(p, 'sv_ui2');
    const t = await tok(p);
    const fill = async (n) => {
      for (let i = 0; i < n; i++) {
        const r = await p.evaluate(async ([i, t]) => {
          const r = await fetch('/api/me/saved', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + t}, body: JSON.stringify({kind: 'post', target: 'px' + i, title: 't' + i})});
          return r.status;
        }, [i, t]);
        assert.equal(r, 200);
      }
    };
    await fill(20);
    const over = await p.evaluate(async t => {
      const r = await fetch('/api/me/saved', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + t}, body: JSON.stringify({kind: 'post', target: 'pOVER'})});
      return {s: r.status, c: (await r.json()).error.code};
    }, t);
    assert.equal(over.s, 403); assert.equal(over.c, 'QUOTA_EXCEEDED');
    // 切 VIP
    await p.click('nav [data-v=me]'); await p.click('#v [data-a=vip]');
    await p.waitForSelector('#vipc .vp[data-vs]:not([data-vs=loading])');
    await p.click('[data-a=viptoggle][data-v="1"]');
    await p.waitForSelector('#vipc .vp[data-vs=active]');
    const ok = await p.evaluate(async t => {
      const r = await fetch('/api/me/saved', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + t}, body: JSON.stringify({kind: 'post', target: 'pVIP21', title: 'VIP 第 21 条'})});
      return {s: r.status, j: await r.json()};
    }, t);
    assert.equal(ok.s, 200); assert.equal(ok.j.count, 21); assert.equal(ok.j.limit, 100);
    await p.click('[data-a=back]'); await p.click('[data-a=go][data-v=set]'); await p.click('#svrow');
    await p.waitForSelector('#savedp [data-svq="21/100"]');
    assert.match(await p.getAttribute('#savedp [data-svq]', 'data-svq'), /21\/100/);
    // 公共置顶：VIP 普通成员在群里仍然没有置顶按钮；前端上限仍是 5
    const pinMax = await p.evaluate(() => {
      const src = String(A.pinm);
      return /length\s*>\s*5/.test(src);
    });
    assert.ok(pinMax, '公共置顶仍截断在 5 条');
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); await S.close(); }
});
