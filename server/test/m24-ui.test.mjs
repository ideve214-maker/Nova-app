// M2.4 会员中心浏览器测试（真实页面 + 真实服务器）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {startServer, openPage, register, launch, overflowX} from './ui-helpers.mjs';

let S, browser, page;
const SHOT = new URL('../../screenshots/', import.meta.url).pathname;
test.before(async () => { S = await startServer(); browser = await launch(); page = await openPage(browser, S.base); await register(page, 'vip_ui_1'); });
test.after(async () => { await browser.close(); await S.close(); });

const openCenter = async () => {
  await page.click('nav [data-v=me]');
  await page.click('#v [data-a=vip]');
  await page.waitForSelector('#vipc .vp[data-vs]:not([data-vs=loading])');
};

test('M2.4.3 会员中心：Basic 状态、套餐、7 项权益对比，来自服务端目录', async () => {
  await openCenter();
  assert.equal(await page.getAttribute('#vipc .vp[data-vs]', 'data-vs'), 'none');
  assert.match(await page.innerText('#vipc'), /当前套餐：Basic/);
  assert.match(await page.innerText('[data-plan=vip]'), /¥9\.9\/月[\s\S]*¥99\/年/);
  assert.equal(await page.locator('#vipc .ent').count(), 7);
  const saved = page.locator('[data-ent=personal_saved_items_plus]');
  assert.match(await saved.locator('[data-p=basic]').innerText(), /20 条/);
  assert.match(await saved.locator('[data-p=vip]').innerText(), /100 条/);
  const post = page.locator('[data-ent=longer_post_text]');
  assert.match(await post.locator('[data-p=vip]').innerText(), /动态 1000/);
  assert.match(await page.innerText('#vipc'), /这些永远免费/);
  assert.equal(await page.locator('#vipc .tag', {hasText: '即将推出'}).count(), 6, '尚未实现的权益要标明「即将推出」，不提前承诺（香槟金主题已于 M2.4.5 实现）');
  assert.ok(await overflowX(page) <= 0, '390px 宽度不应出现横向溢出');
  await page.screenshot({path: SHOT + 'm243-center-basic.png', fullPage: false});
});

test('M2.4.3 页面数据不是硬编码：目录和状态被改写，页面必须跟着变', async () => {
  await page.route('**/api/vip/catalog', async route => {
    const r = await route.fetch(); const j = await r.json();
    j.entitlements.find(e => e.key === 'personal_saved_items_plus').basic = 7;
    j.entitlements.find(e => e.key === 'personal_saved_items_plus').vip = 77;
    j.entitlements.find(e => e.key === 'vip_badge').title = '测试标题XYZ';
    j.plans.vip.prices = [{period: 'month', label: '¥1.23/月', amountCents: 123, currency: 'CNY'}];
    await route.fulfill({json: j});
  });
  const T = Date.now();
  await page.route('**/api/vip/me', route => route.fulfill({json: {ok: true, now: T, vip: {plan: 'vip', state: 'active', active: true, since: T - 864e5 * 3, until: T + 864e5 * 40, daysLeft: 40, expiringSoon: false, expiredAt: null, source: 'admin'}, entitlements: {}}}));
  await page.reload(); await page.waitForSelector('nav');
  await openCenter();
  const text = await page.innerText('#vipc');
  assert.equal(await page.getAttribute('#vipc .vp[data-vs]', 'data-vs'), 'active');
  assert.match(text, /当前套餐：NOVA VIP/); assert.match(text, /剩余 40 天/); assert.match(text, /开通于/);
  assert.match(text, /测试标题XYZ/); assert.match(text, /¥1\.23\/月/);
  assert.match(await page.locator('[data-ent=personal_saved_items_plus] [data-p=vip]').innerText(), /77 条/);
  assert.match(await page.locator('[data-ent=personal_saved_items_plus] [data-p=basic]').innerText(), /7 条/);
  await page.unroute('**/api/vip/catalog'); await page.unroute('**/api/vip/me');
});

test('M2.4.3 各状态文案：即将到期 / 已过期 / 已撤销', async () => {
  const T = Date.now(), mk = vip => route => route.fulfill({json: {ok: true, now: T, vip: {since: null, until: null, daysLeft: null, expiringSoon: false, expiredAt: null, source: null, ...vip}, entitlements: {}}});
  const cases = [
    [{plan: 'vip', state: 'expiring', active: true, until: T + 864e5 * 2, daysLeft: 2, expiringSoon: true}, /即将到期[\s\S]*还剩 2 天/],
    [{plan: 'basic', state: 'expired', active: false, expiredAt: T - 864e5}, /VIP 已过期[\s\S]*内容都还在/],
    [{plan: 'basic', state: 'revoked', active: false}, /VIP 已被撤销/],
  ];
  for (const [vip, re] of cases) {
    await page.route('**/api/vip/me', mk(vip));
    await page.reload(); await page.waitForSelector('nav'); await openCenter();
    assert.match(await page.innerText('#vipc .vp[data-vs]'), re, vip.state);
    assert.equal(await page.getAttribute('#vipc .vp[data-vs]', 'data-vs'), vip.state);
    await page.unroute('**/api/vip/me');
  }
});

test('M2.4.3 读取失败时显示错误并可重试；设置页有入口', async () => {
  let fail = true;
  await page.route('**/api/vip/catalog', route => fail ? route.abort() : route.continue());
  await page.reload(); await page.waitForSelector('nav');
  await page.click('nav [data-v=me]'); await page.click('#v [data-a=vip]');
  await page.waitForSelector('#vipc [role=alert]');
  assert.match(await page.innerText('#vipc'), /连不上服务器/);
  fail = false;
  await page.click('[data-a=vipretry]');
  await page.waitForSelector('#vipc [data-plan=vip]');
  await page.unroute('**/api/vip/catalog');
  // 设置页入口
  await page.click('[data-a=back]'); await page.click('#v [data-a=go][data-v=set]');
  assert.match(await page.innerText('#v [data-a=vip]'), /会员中心[\s\S]*Basic · 免费/);
  await page.click('#v [data-a=vip]'); await page.waitForSelector('#vipc [data-plan=basic]');
  assert.deepEqual(page.errors, [], '无控制台报错');
});

// ---- M2.4.4 测试模式切换 ----
test('M2.4.4 生产环境（默认）：界面没有测试开关，直接调接口也被 403', async () => {
  // 上面共用的 S 是默认（生产）服务器
  await page.reload(); await page.waitForSelector('nav'); await openCenter();
  assert.equal(await page.locator('[data-a=viptoggle]').count(), 0);
  assert.equal(await page.locator('#vtest').count(), 0);
  assert.doesNotMatch(await page.innerText('#vipc'), /测试模式/);
  const r = await page.evaluate(async () => { const t = JSON.parse(localStorage.getItem('nova_session')).token; const x = await fetch('/api/vip/test-toggle', {method: 'POST', headers: {Authorization: 'Bearer ' + t, 'Content-Type': 'application/json'}, body: '{"on":true}'}); return [x.status, (await x.json()).error.code]; });
  assert.deepEqual(r, [403, 'TEST_MODE_DISABLED']);
  assert.match(await page.innerText('#vipc'), /当前套餐：Basic/);
});

test('M2.4.4 开发环境：一键切 VIP / 普通，状态由服务端返回并刷新后保持', async () => {
  const D = await startServer({env: 'development'});
  const p = await openPage(browser, D.base);
  try {
    await register(p, 'vip_dev_1');
    await p.click('nav [data-v=me]'); await p.click('#v [data-a=vip]');
    await p.waitForSelector('#vtest');
    assert.match(await p.innerText('#vtest'), /仅开发环境可见/);
    assert.equal(await p.getAttribute('#vipc .vp[data-vs]', 'data-vs'), 'none');
    await p.click('[data-a=viptoggle][data-v="1"]');
    await p.waitForSelector('#vipc .vp[data-vs=active]');
    assert.match(await p.innerText('#vipc'), /当前套餐：NOVA VIP[\s\S]*剩余 30 天/);
    assert.equal(D.srv.db.prepare("SELECT vip_source s FROM users WHERE username='vip_dev_1'").get().s, 'test', '服务端真实入库');
    await p.screenshot({path: SHOT + 'm244-center-vip-test.png'});
    await p.reload(); await p.waitForSelector('nav');
    await p.click('nav [data-v=me]'); await p.click('#v [data-a=vip]');
    await p.waitForSelector('#vipc .vp[data-vs=active]');                 // 刷新后仍是 VIP（服务端状态）
    await p.click('[data-a=viptoggle][data-v="0"]');
    await p.waitForSelector('#vipc .vp[data-vs=none]');
    assert.match(await p.innerText('#vipc'), /当前套餐：Basic/);
    assert.equal(D.srv.db.prepare("SELECT vip_until u FROM users WHERE username='vip_dev_1'").get().u, null);
    // 正式 VIP 不被测试开关改动
    D.srv.db.prepare("UPDATE users SET vip_until=?, vip_since=?, vip_source='admin' WHERE username='vip_dev_1'").run(Date.now() + 864e5 * 60, Date.now());
    await p.reload(); await p.waitForSelector('nav');
    await p.click('nav [data-v=me]'); await p.click('#v [data-a=vip]');
    await p.waitForSelector('#vipc .vp[data-vs=active]');
    assert.equal(await p.locator('[data-a=viptoggle]').count(), 0);
    assert.match(await p.innerText('#vtest'), /正式 VIP，测试开关不会改动它/);
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); await D.close(); }
});
