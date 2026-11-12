// M2.5.5 专属贴纸：VIP 可发送；Basic 面板锁定；已发出的贴纸对所有人可见。
import test from 'node:test';
import assert from 'node:assert/strict';
import {startServer, openPage, register, launch} from './ui-helpers.mjs';

let browser;
const SHOT = new URL('../../screenshots/', import.meta.url).pathname;
test.before(async () => { browser = await launch(); });
test.after(async () => { await browser.close(); });

async function ensureDm(p, S) {
  const has = await p.evaluate(() => Array.isArray(S.conversations) && S.conversations.length > 0);
  if (has) {
    await p.evaluate(async () => { if (typeof loadConversations === 'function') await loadConversations(); if (typeof render === 'function') render(); });
    return;
  }
  const me = await p.evaluate(() => ({tok: SESSION && SESSION.token, id: SESSION && SESSION.user && SESSION.user.id}));
  const u = 'fr' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const r = await fetch(S.base + '/api/auth/register', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({username: u, email: u + '@x.test', password: 'Passw0rd123'})});
  const j = await r.json();
  if (!j.user) throw new Error('register friend failed: ' + JSON.stringify(j));
  S.srv.friends.setAccepted(Number(me.id), Number(j.user.id));
  const cv = await fetch(S.base + '/api/conversations', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + me.tok}, body: JSON.stringify({kind: 'dm', userId: j.user.id})});
  const cj = await cv.json();
  if (!cj.conversation) throw new Error('create dm failed: ' + cv.status + ' ' + JSON.stringify(cj));
  await p.evaluate(async () => { if (typeof loadConversations === 'function') await loadConversations(); if (typeof render === 'function') render(); });
}
const openChat = async (p, S) => {
  if (S) await ensureDm(p, S);
  await p.click('nav [data-v=chat]');
  await p.waitForSelector('[data-a=conv], .row[data-a=conv], [data-a="conv"]', {timeout: 10000});
  const conv = p.locator('[data-a=conv]').first();
  await conv.click();
  await p.waitForSelector('#stkp, [data-a=stkp]');
};

test('M2.5.5 Basic：面板能看到香槟金系列但不可用；常用表情可发送；所有人能看见贴纸', async () => {
  const S = await startServer(); const p = await openPage(browser, S.base);
  try {
    await register(p, 'stk_ui1');
    await openChat(p, S);
    await p.click('[data-a=stkp]');
    await p.waitForSelector('.pn .stkgrid');
    assert.ok(await p.locator('.pn [data-pack=nova_gold]').count() >= 1, '免费用户看得到专属包');
    assert.equal(await p.locator('.pn [data-stk-lock=nova_gold]').count(), 1, '有锁定说明');
    assert.equal(await p.locator('.pn [data-v="nova_gold|gold_star"]').count(), 0, '专属按钮不可用（disabled，无 data-a）');
    assert.match(await p.innerText('.pn'), /开通 NOVA VIP/);
    await p.click('.pn [data-v="basic|smile"]');
    await p.waitForSelector('.stk[data-stk="basic:smile"]');
    assert.equal(await p.locator('.stk[data-stk="basic:smile"]').count(), 1);
    await p.screenshot({path: SHOT + 'm255-basic-panel.png'});
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); await S.close(); }
});

test('M2.5.5 开通 VIP 后可发送香槟金贴纸；切回后不能再选用，已发出的仍可见', async () => {
  const S = await startServer({env: 'development'}); const p = await openPage(browser, S.base);
  try {
    await register(p, 'stk_ui2');
    await p.click('nav [data-v=me]'); await p.click('#v [data-a=vip]');
    await p.waitForSelector('#vipc .vp[data-vs]:not([data-vs=loading])');
    await p.click('[data-a=viptoggle][data-v="1"]');
    await p.waitForSelector('#vipc .vp[data-vs=active]');
    await p.click('[data-a=back]');
    await openChat(p, S);
    await p.click('[data-a=stkp]');
    await p.waitForSelector('.pn [data-v="nova_gold|gold_star"]');
    assert.equal(await p.locator('.pn [data-stk-lock=nova_gold]').count(), 0);
    await p.click('.pn [data-v="nova_gold|gold_cheers"]');
    await p.waitForSelector('.stk[data-stk="nova_gold:gold_cheers"]');
    await p.screenshot({path: SHOT + 'm255-vip-sticker.png'});
    // 切回普通
    await p.click('[data-a=back]');
    await p.click('nav [data-v=me]'); await p.click('#v [data-a=vip]');
    await p.waitForSelector('#vipc .vp[data-vs=active]');
    await p.click('[data-a=viptoggle][data-v="0"]');
    await p.waitForSelector('#vipc .vp[data-vs=none]');
    await p.click('[data-a=back]');
    await openChat(p, S);
    assert.equal(await p.locator('.stk[data-stk="nova_gold:gold_cheers"]').count(), 1, '已发出的专属贴纸仍可见');
    await p.click('[data-a=stkp]');
    await p.waitForSelector('.pn [data-stk-lock=nova_gold]');
    assert.equal(await p.locator('.pn [data-v="nova_gold|gold_star"]').count(), 0, '不能再选用');
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); await S.close(); }
});
