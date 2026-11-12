// M2.4.7 页面层的状态边界：同一个账号，状态在服务端变化后，页面（主题、标识、文案、测试按钮）必须跟着变。
import test from 'node:test';
import assert from 'node:assert/strict';
import {startServer, openPage, register, launch} from './ui-helpers.mjs';

const DAY = 864e5;
let browser;
const SHOT = new URL('../../screenshots/', import.meta.url).pathname;
test.before(async () => { browser = await launch(); });
test.after(async () => { await browser.close(); });
const goCenter = async p => { await p.click('nav [data-v=me]'); await p.click('#v [data-a=vip]'); await p.waitForSelector('#vipc .vp[data-vs]:not([data-vs=loading])'); };
const reopen = async p => { await p.reload(); await p.waitForSelector('nav'); await goCenter(p); };
const gold = p => p.evaluate(() => document.documentElement.dataset.vip || '');

test('M2.4.7 页面跟着服务端状态走：有效 → 即将到期 → 已过期 → 重新开通 → 管理员撤销', async () => {
  let t = Date.now();
  const S = await startServer({env: 'development', clock: () => t}); const p = await openPage(browser, S.base);
  const row = () => S.srv.db.prepare("SELECT * FROM users WHERE username='ui_bnd'").get();
  const setUntil = u => S.srv.db.prepare("UPDATE users SET vip_until=?, vip_since=?, vip_source='admin' WHERE username='ui_bnd'").run(u, t - DAY);
  try {
    await register(p, 'ui_bnd');
    await goCenter(p);
    assert.equal(await p.getAttribute('#vipc .vp[data-vs]', 'data-vs'), 'none'); assert.equal(await gold(p), '');

    setUntil(t + 40 * DAY); await reopen(p);
    assert.equal(await p.getAttribute('#vipc .vp[data-vs]', 'data-vs'), 'active'); assert.equal(await gold(p), 'gold');
    assert.match(await p.innerText('#vipc .vp[data-vs]'), /剩余 40 天/);

    setUntil(t + 2 * DAY); await reopen(p);
    assert.equal(await p.getAttribute('#vipc .vp[data-vs]', 'data-vs'), 'expiring');
    assert.equal(await gold(p), 'gold', '即将到期权益仍有效');
    assert.match(await p.innerText('#vipc .vp[data-vs]'), /即将到期[\s\S]*还剩 2 天/);
    assert.equal(await p.locator('#vipc .vp[data-vs=expiring] b').evaluate(e => getComputedStyle(e).color !== getComputedStyle(document.body).color), true, '即将到期标题仍是金色强调');
    await p.screenshot({path: SHOT + 'm247-expiring.png'});

    // 时间走过到期点（登录令牌仍有效，只快进 3 天）
    t += 3 * DAY; await reopen(p);
    assert.equal(await p.getAttribute('#vipc .vp[data-vs]', 'data-vs'), 'expired');
    assert.equal(await gold(p), '', '过期立即回落默认主题');
    assert.match(await p.innerText('#vipc .vp[data-vs]'), /VIP 已过期[\s\S]*内容都还在/);
    assert.equal(await p.locator('[data-a=vtheme]').count(), 0);
    assert.equal(await p.locator('[data-a=viptoggle][data-v="1"]').count(), 1, '过期后开发环境可以重新开测试 VIP');
    await p.click('[data-a=back]'); assert.equal(await p.locator('#v .pf2 h2 .vip').count(), 0, '过期后资料里没有 VIP 标识');
    await p.click('#v [data-a=vip]'); await p.waitForSelector('#vipc .vp[data-vs=expired]');

    // 过期后重新开通（测试开关）：回到有效
    await p.click('[data-a=viptoggle][data-v="1"]'); await p.waitForSelector('#vipc .vp[data-vs=active]');
    assert.equal(await gold(p), 'gold');

    // 管理员撤销（用服务层，管理端 M3.4 之后走同一函数）
    S.srv.vip.revoke(row().id, {source: 'admin', note: 'ui 边界'}); await reopen(p);
    assert.equal(await p.getAttribute('#vipc .vp[data-vs]', 'data-vs'), 'revoked');
    assert.equal(await gold(p), '');
    assert.match(await p.innerText('#vipc .vp[data-vs]'), /VIP 已被撤销[\s\S]*联系管理员/);
    assert.equal(await p.locator('[data-a=vtheme]').count(), 0);
    await p.click('[data-a=back]'); assert.equal(await p.locator('#v .pf2 h2 .vip').count(), 0);
    await p.screenshot({path: SHOT + 'm247-revoked-profile.png'});
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); await S.close(); }
});

test('M2.4.7 已打开的页面里 VIP 被撤销：下一次读取（重新进会员中心）就回落', async () => {
  const S = await startServer({env: 'development'}); const p = await openPage(browser, S.base);
  try {
    await register(p, 'ui_bnd2'); await goCenter(p);
    await p.click('[data-a=viptoggle][data-v="1"]'); await p.waitForSelector('#vipc .vp[data-vs=active]');
    const id = S.srv.db.prepare("SELECT id FROM users WHERE username='ui_bnd2'").get().id;
    S.srv.vip.revoke(id, {source: 'admin'});
    await p.click('[data-a=back]'); await p.click('#v [data-a=vip]');            // 重新进入会员中心 → 重新读取
    await p.waitForSelector('#vipc .vp[data-vs=revoked]');
    assert.equal(await p.evaluate(() => document.documentElement.dataset.vip || ''), '');
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); await S.close(); }
});
