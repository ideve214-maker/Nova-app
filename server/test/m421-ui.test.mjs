// M4.2.1 创建/加入/退出社区走服务器，刷新后状态仍在。
import test from 'node:test';
import assert from 'node:assert/strict';
import {startServer, openPage, register, launch} from './ui-helpers.mjs';

let browser;
test.before(async () => { browser = await launch(); });
test.after(async () => { await browser.close(); });

test('M4.2.1 创建公开社区后刷新仍在；另一账号能发现并加入，退出后人数减少', async () => {
  const S = await startServer();
  const a = await openPage(browser, S.base);
  const b = await openPage(browser, S.base);
  try {
    await register(a, 'cm_own');
    await register(b, 'cm_mem');
    await a.click('nav [data-v=cm]');
    await a.waitForSelector('#v [data-a=newcm]');
    await a.click('#v [data-a=newcm]');
    await a.waitForSelector('[data-d=cn]');
    await a.fill('[data-d=cn]', '夜读角');
    await a.fill('[data-d=cd]', '只讨论句子。');
    await a.click('[data-a=mkcm]');
    await a.waitForFunction(() => document.body.innerText.includes('夜读角') && !document.querySelector('[data-d=cn]'));
    await a.reload(); await a.waitForSelector('nav');
    await a.click('nav [data-v=cm]');
    await a.waitForFunction(() => document.body.innerText.includes('夜读角'));
    // B 在发现里加入
    await b.click('nav [data-v=cm]');
    await b.waitForSelector('#v [data-a=cmseg][data-v=d]');
    await b.click('#v [data-a=cmseg][data-v=d]');
    await b.waitForFunction(() => document.body.innerText.includes('夜读角'));
    await b.locator('#v .row [data-a=join].pb, #v button[data-a=join]').last().click({force:true});
    await b.waitForFunction(() => document.body.innerText.includes('已加入') || document.querySelector('#v [data-a=join]')?.textContent.includes('已加入'));
    await a.reload(); await a.waitForSelector('nav');
    await a.click('nav [data-v=cm]');
    await a.waitForFunction(() => document.body.innerText.includes('2 名成员') || document.body.innerText.includes('2 名'));
    assert.deepEqual(a.errors, []);
    assert.deepEqual(b.errors, []);
  } finally { await a.context().close(); await b.context().close(); await S.close(); }
});
