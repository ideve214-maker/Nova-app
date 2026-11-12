// M4.11.5 UI：登录后可见 Olm 加密与审查未完成说明，绝不是「已端到端加密」。演示仍未加密。
import test from 'node:test';
import assert from 'node:assert/strict';
import {startServer, openPage, register, launch} from './ui-helpers.mjs';

let browser;
test.before(async () => { browser = await launch(); });
test.after(async () => { await browser.close(); });

test('登录后横幅说明 Olm 加密且审查未完成，绝不是已端到端加密', async () => {
  const S = await startServer();
  const p = await openPage(browser, S.base);
  try {
    await register(p, 'e2eeui');
    await p.waitForSelector('.ban');
    const home = await p.locator('body').innerText();
    assert.match(home, /Olm|vodozemac/);
    assert.match(home, /独立安全审查尚未完成|安全号码/);
    assert.doesNotMatch(home, /已端到端加密/);
    const chat = p.locator('nav [data-v=chat], nav [data-v=msg], nav button:has-text("聊天")').first();
    if (await chat.count()) {
      await chat.click();
      await p.waitForSelector('.ban');
      const bans = await p.locator('.ban').allInnerTexts();
      assert.ok(bans.some(t => /Olm|vodozemac/.test(t)), '聊天页应有 Olm 加密说明: ' + JSON.stringify(bans));
      assert.ok(bans.every(t => !/已端到端加密/.test(t)));
    }
    await p.click('nav [data-v=me]');
    await p.waitForSelector('#v .pf2, #v .top');
    await p.click('#v [data-a=go][data-v=set]');
    await p.waitForSelector('#v .pg');
    const set = await p.locator('#v').innerText();
    assert.match(set, /Olm|vodozemac/);
    assert.doesNotMatch(set, /已端到端加密/);
    await p.click('#v [data-a=sec]');
    await p.waitForSelector('#secp');
    const sec = await p.locator('#secp').innerText();
    assert.match(sec, /Olm|vodozemac/);
    assert.match(sec, /安全号码|加密设备/);
  } finally { S.close(); await p.close(); }
});
