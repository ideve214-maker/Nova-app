// M4.11.5 UI：登录后可见「私聊已加密」与安全号码说明，绝不是「已端到端加密」。
import test from 'node:test';
import assert from 'node:assert/strict';
import {startServer, openPage, register, launch} from './ui-helpers.mjs';

let browser;
test.before(async () => { browser = await launch(); });
test.after(async () => { await browser.close(); });

test('登录后横幅说明私聊已加密并提示核对安全号码，绝不是已端到端加密', async () => {
  const S = await startServer();
  const p = await openPage(browser, S.base);
  try {
    await register(p, 'e2eeui');
    // 首页自 r7 起不再放加密横幅；横幅在聊天页。
    const chat = p.locator('nav [data-v=chat], nav [data-v=msg], nav button:has-text("聊天")').first();
    assert.ok(await chat.count(), '应有聊天入口');
    await chat.click();
    await p.waitForSelector('.ban');
    const chatText = await p.locator('body').innerText();
    assert.match(chatText, /已登录 · 私聊已加密/);
    assert.match(chatText, /安全号码/);
    assert.doesNotMatch(chatText, /已端到端加密/);
    const bans = await p.locator('.ban').allInnerTexts();
    assert.ok(bans.some(t => /私聊已加密/.test(t)), '聊天页应有私聊已加密说明: ' + JSON.stringify(bans));
    assert.ok(bans.every(t => !/已端到端加密/.test(t)));
    await p.click('nav [data-v=me]');
    await p.waitForSelector('#v .pf2, #v .top');
    await p.click('#v [data-a=go][data-v=set]');
    await p.waitForSelector('#v .pg');
    const set = await p.locator('#v').innerText();
    assert.match(set, /一对一聊天会加密/);
    assert.match(set, /群聊暂时还没有加密/);
    assert.doesNotMatch(set, /已端到端加密/);
    await p.click('#v [data-a=sec]');
    await p.waitForSelector('#secp');
    const sec = await p.locator('#secp').innerText();
    assert.match(sec, /安全号码|加密设备|密钥只留在本机/);
    assert.doesNotMatch(sec, /已端到端加密/);
  } finally { S.close(); await p.close(); }
});
