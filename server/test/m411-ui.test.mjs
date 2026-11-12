// M4.1.1 发帖：服务端确认后才显示成功；刷新后仍在；失败不出现在列表。
import test from 'node:test';
import assert from 'node:assert/strict';
import {startServer, openPage, register, launch} from './ui-helpers.mjs';

let browser;
test.before(async () => { browser = await launch(); });
test.after(async () => { await browser.close(); });

test('M4.1.1 登录后发帖：成功以服务器为准，刷新后仍在；演示样板帖不会出现在真实账号动态里', async () => {
  const S = await startServer(); const p = await openPage(browser, S.base);
  try {
    await register(p, 'feed_user');
    await p.waitForSelector('nav');
    // 真实账号空动态，不应出现演示「林知夏」的样板帖
    await p.waitForFunction(() => document.querySelector('#feedempty') || !document.body.innerText.includes('把没写完的段落折起来'));
    const body = await p.locator('#v').innerText();
    assert.ok(!body.includes('把没写完的段落折起来'), '真实账号不应混入演示帖');
    await p.click('#v [data-a=compose]');
    await p.waitForSelector('[data-d=pin]');
    await p.fill('[data-d=pin]', '把这一句交给服务器。');
    await p.click('[data-a=pub]');
    await p.waitForFunction(() => document.body.innerText.includes('把这一句交给服务器。') && document.body.innerText.includes('已发布'));
    // 刷新后仍在
    await p.reload(); await p.waitForSelector('nav');
    await p.waitForFunction(() => document.body.innerText.includes('把这一句交给服务器。'));
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); await S.close(); }
});
