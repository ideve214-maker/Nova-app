// 浏览器走一遍：未登录进不去、注册、错误提示、刷新仍登录、退出、再登录、两个账号本机数据隔离、库中无明文密码。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../index.mjs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright'); // 兼容 NODE_PATH 全局安装

test('M2.2 网页注册登录刷新退出', { timeout: 90000 }, async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'nova-m22-')), 't.db');
  const srv = createApp({ dbPath });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const reg = async (name, email) => {
    await page.click('[data-a=authpane][data-v=reg]');
    await page.fill('[data-d=ru]', name);
    await page.fill('[data-d=re]', email);
    await page.fill('[data-d=rpw]', 'Passw0rd123');
    await page.fill('[data-d=rpw2]', 'Passw0rd123');
    await page.click('[data-a=authgo]');
    await page.waitForSelector('nav');
  };
  try {
    const home = await fetch(base + '/');
    assert.equal(home.status, 200);
    assert.match(await home.text(), /NOVA/);

    await page.goto(base + '/');
    await page.waitForSelector('#gate');
    assert.equal(await page.locator('nav').count(), 0, '未登录没有底栏');

    await page.fill('[data-d=ac]', 'nobody_z');
    await page.fill('[data-d=pw]', 'Wrongpass1');
    await page.click('[data-a=authgo]');
    await page.waitForSelector('.err');
    assert.match(await page.locator('.err').innerText(), /账号或密码错误/);

    await page.click('[data-a=authpane][data-v=reg]');
    await page.fill('[data-d=ru]', 'friend_a');
    await page.fill('[data-d=re]', 'A@Friend.test');
    await page.fill('[data-d=rpw]', 'short');
    await page.fill('[data-d=rpw2]', 'short');
    await page.click('[data-a=authgo]');
    await page.waitForSelector('.err');
    assert.match(await page.locator('.err').innerText(), /密码/);

    await page.fill('[data-d=rpw]', 'Passw0rd123');
    await page.fill('[data-d=rpw2]', 'Passw0rd123');
    await page.click('[data-a=authgo]');
    await page.waitForSelector('nav');
    assert.match(await page.locator('.ban').first().innerText(), /friend_a/);

    await page.click('[data-a=compose].p');
    await page.fill('[data-d=pin]', '仅账号A可见');
    await page.click('[data-a=pub]');
    await page.waitForFunction(() => document.body.innerText.includes('仅账号A可见'));

    const tok = await page.evaluate(() => JSON.parse(localStorage.getItem('nova_session')).token);
    await page.reload();
    await page.waitForSelector('nav');
    assert.match(await page.locator('.ban').first().innerText(), /friend_a/);
    assert.match(await page.locator('body').innerText(), /仅账号A可见/);

    await page.click('nav [data-v=me]');
    await page.waitForSelector('[data-a=go][data-v=set]');
    await page.click('[data-a=go][data-v=set]');
    await page.waitForSelector('[data-a=todemo]');
    await page.click('[data-a=todemo]');
    await page.waitForFunction(() => document.body.innerText.includes('林知夏') || document.body.innerText.includes('演示模式'));
    assert.equal(await page.evaluate(() => D.u.me[0]), '林知夏');
    assert.equal(await page.evaluate(() => document.body.innerText.includes('仅账号A可见')), false);
    const split = await page.evaluate(() => {
      const demo = JSON.parse(localStorage.getItem('nova_v5'));
      const acctKey = Object.keys(localStorage).find(k => k.startsWith('nova_v5_u_'));
      const acct = JSON.parse(localStorage.getItem(acctKey));
      return { demo: demo.u.me[0], acct: acct.u.me[0], post: JSON.stringify(acct).includes('仅账号A可见'), demoPost: JSON.stringify(demo).includes('仅账号A可见') };
    });
    assert.equal(split.demo, '林知夏');
    assert.equal(split.acct, 'friend_a');
    assert.equal(split.post, true);
    assert.equal(split.demoPost, false);

    await page.click('[data-a=toacct]');
    await page.waitForFunction(() => document.body.innerText.includes('仅账号A可见'));

    await page.click('nav [data-v=me]');
    await page.click('[data-a=go][data-v=set]');
    await page.waitForSelector('[data-a=logout]');
    await page.click('[data-a=logout]');
    await page.waitForSelector('#gate');
    await page.reload();
    await page.waitForSelector('#gate');
    assert.equal(await page.evaluate(() => localStorage.getItem('nova_session')), null);

    await page.fill('[data-d=ac]', 'A@Friend.test');
    await page.fill('[data-d=pw]', 'Passw0rd123');
    await page.click('[data-a=authgo]');
    await page.waitForSelector('nav');
    assert.match(await page.locator('body').innerText(), /仅账号A可见/);

    await page.evaluate(() => { A.logout(); render(); });
    await page.waitForSelector('#gate');
    await reg('friend_b', 'b@friend.test');
    assert.equal(await page.evaluate(() => document.body.innerText.includes('仅账号A可见')), false);
    assert.match(await page.locator('.ban').first().innerText(), /friend_b/);

    const row = srv.db.prepare('SELECT * FROM users WHERE username=?').get('friend_a');
    assert.equal(row.email, 'a@friend.test');
    assert.ok(row.password_hash.startsWith('scrypt$'));
    assert.equal(JSON.stringify(row).includes('Passw0rd123'), false);
    const sess = JSON.stringify(srv.db.prepare('SELECT * FROM sessions').all());
    assert.equal(sess.includes(tok), false);
    assert.equal(sess.includes('Passw0rd123'), false);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    srv.close();
  }
});
