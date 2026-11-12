// M4.1.2 编辑/删除：自己的可以改和删并持久化；他人菜单没有删除。
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

test('M4.1.2 编辑后刷新仍在；删除后刷新不再出现', async () => {
  const S = await startServer(); const p = await openPage(browser, S.base);
  try {
    await register(p, 'ed_user');
    await p.waitForSelector('nav');
    await pub(p, '原稿在这里。');
    await p.click('#v [data-a=more]');
    await p.waitForSelector('[data-a=edp]');
    await p.click('[data-a=edp]');
    await p.waitForSelector('[data-d=ep]');
    await p.fill('[data-d=ep]', '改过之后的句子。');
    await p.click('[data-a=savep]');
    await p.waitForFunction(() => document.body.innerText.includes('改过之后的句子。'));
    await p.reload(); await p.waitForSelector('nav');
    await p.waitForFunction(() => document.body.innerText.includes('改过之后的句子。'));
    assert.ok(!(await p.locator('#v').innerText()).includes('原稿在这里。'));
    await p.click('#v [data-a=more]');
    await p.click('[data-a=delp]');
    await p.waitForFunction(() => !document.body.innerText.includes('改过之后的句子。') || document.querySelector('#feedempty'));
    await p.reload(); await p.waitForSelector('nav');
    await p.waitForSelector('#feedempty, #v');
    assert.ok(!(await p.locator('#v').innerText()).includes('改过之后的句子。'));
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); await S.close(); }
});
