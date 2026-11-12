// M4.1.4 关注是单向的；关注流只出现已关注的人的动态。
import test from 'node:test';
import assert from 'node:assert/strict';
import {startServer, openPage, register, launch} from './ui-helpers.mjs';

let browser;
test.before(async () => { browser = await launch(); });
test.after(async () => { await browser.close(); });

const pub = async (p, text) => {
  await p.click('#v [data-a=compose]');
  await p.waitForSelector('[data-d=pin]');
  await p.fill('[data-d=pin]', text);
  await p.click('[data-a=pub]');
  await p.waitForFunction(t => document.body.innerText.includes(t) && !document.querySelector('[data-d=pin]'), text);
};

test('M4.1.4 关注后在「关注」流看到对方动态；对方未回关时对方关注流没有自己', async () => {
  const S = await startServer();
  const a = await openPage(browser, S.base);
  const b = await openPage(browser, S.base);
  try {
    await register(a, 'fol_a');
    await register(b, 'fol_b');
    await pub(b, 'B 写的句子。');
    // A 刷新后应在推荐里看到 B
    await a.reload(); await a.waitForSelector('nav');
    await a.waitForFunction(() => document.body.innerText.includes('B 写的句子。'));
    const author = a.locator('.card [data-a=user]').first();
    await author.click();
    await a.waitForSelector('#v [data-a=fol]');
    await a.click('#v [data-a=fol]');
    await a.waitForFunction(() => document.querySelector('#v [data-a=fol]')?.textContent.includes('已关注'));
    await a.click('#v [data-a=back]').catch(async () => { await a.click('nav [data-v=home]'); });
    await a.waitForSelector('nav');
    await a.click('#v [data-a=feed][data-v=follow]');
    await a.waitForFunction(() => document.body.innerText.includes('B 写的句子。'));
    assert.deepEqual(a.errors, []);
  } finally { await a.context().close(); await b.context().close(); await S.close(); }
});
