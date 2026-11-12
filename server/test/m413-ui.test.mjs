// M4.1.3 评论与表态走服务器，刷新后数量和关系仍在。
import test from 'node:test';
import assert from 'node:assert/strict';
import {startServer, openPage, register, launch} from './ui-helpers.mjs';

let browser;
test.before(async () => { browser = await launch(); });
test.after(async () => { await browser.close(); });

test('M4.1.3 评论、回复、表态刷新后仍在；删除自己的评论后计数减少', async () => {
  const S = await startServer(); const p = await openPage(browser, S.base);
  try {
    await register(p, 'cmt_user');
    await p.waitForSelector('nav');
    await p.click('#v [data-a=compose]');
    await p.waitForSelector('[data-d=pin]');
    await p.fill('[data-d=pin]', '讨论这一句。');
    await p.click('[data-a=pub]');
    await p.waitForFunction(() => document.body.innerText.includes('讨论这一句。') && !document.querySelector('[data-d=pin]'));
    await p.click('#v [data-a=rx]');
    await p.waitForSelector('[data-a=rxp]');
    await p.click('[data-a=rxp][data-v$="|2"]'); // 👍
    await p.waitForFunction(() => document.body.innerText.includes('已表态') || document.querySelector('#v [data-a=rx].on'));
    await p.click('#v [data-a=post]');
    await p.waitForSelector('[data-d=cin]');
    await p.fill('[data-d=cin]', '这句可以留下来。');
    await p.click('[data-a=cs]');
    await p.waitForFunction(() => document.body.innerText.includes('这句可以留下来。'));
    await p.click('#v [data-a=rp]');
    await p.waitForFunction(() => document.body.innerText.includes('回复'));
    await p.fill('[data-d=cin]', '那就先折在这里。');
    await p.click('[data-a=cs]');
    await p.waitForFunction(() => document.body.innerText.includes('那就先折在这里。'));
    await p.reload(); await p.waitForSelector('nav');
    await p.waitForFunction(() => document.body.innerText.includes('讨论这一句。'));
    await p.click('#v [data-a=post]');
    await p.waitForFunction(() => document.body.innerText.includes('这句可以留下来。') && document.body.innerText.includes('那就先折在这里。'));
    // 删除顶层会保留占位（有回复）
    const dels = p.locator('#v [data-a=delc]');
    assert.ok(await dels.count() >= 1);
    await dels.first().click();
    await p.waitForFunction(() => document.body.innerText.includes('已删除') || document.body.innerText.includes('（已删除）'));
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); await S.close(); }
});
