// M2.4.6 开通按钮与价格占位：不得出现假成功、假订单、真实收款入口。
import test from 'node:test';
import assert from 'node:assert/strict';
import {startServer, openPage, register, launch} from './ui-helpers.mjs';

let browser;
const SHOT = new URL('../../screenshots/', import.meta.url).pathname;
test.before(async () => { browser = await launch(); });
test.after(async () => { await browser.close(); });
const goCenter = async p => { await p.click('nav [data-v=me]'); await p.click('#v [data-a=vip]'); await p.waitForSelector('#vipc [data-plan=vip]'); };

test('M2.4.6 开通按钮：不可点、写明「暂未开放 / 支付未接入」，点了不发请求、不改状态', async () => {
  for (const env of ['production', 'development']) {      // 开发环境也一样：测试开关不是购买
    const S = await startServer({env}); const p = await openPage(browser, S.base);
    try {
      await register(p, 'buy_' + env.slice(0, 3));
      await goCenter(p);
      const btn = p.locator('#vbuy');
      assert.equal(await btn.count(), 1);
      assert.equal(await btn.isDisabled(), true);
      assert.equal(await btn.getAttribute('aria-disabled'), 'true');
      assert.equal(await btn.innerText(), '暂未开放');
      assert.equal(await btn.getAttribute('data-a'), null, '没有绑定任何动作');
      const text = await p.innerText('#vipc');
      assert.match(text, /价格暂定，正式上线前可能调整/);
      assert.match(text, /支付功能尚未接入/);
      assert.match(text, /不会产生任何订单或扣款/);
      assert.match(text, /¥9\.9\/月[\s\S]*¥99\/年/);
      // 页面里没有任何收款入口：无链接、无表单、无输入框（会员中心内）
      assert.equal(await p.locator('#vipc a, #vipc form, #vipc input, #vipc iframe').count(), 0);
      assert.doesNotMatch(text, /购买成功|支付成功|订单号|立即支付|扫码|转账|收款码|开通成功/);
      // 强行点击：不发任何请求，状态不变
      const reqs = []; p.on('request', r => { if (r.url().includes('/api/')) reqs.push(r.method() + ' ' + new URL(r.url()).pathname); });
      await btn.click({force: true}).catch(() => {});
      await btn.dispatchEvent('click');
      await p.waitForTimeout(400);
      assert.deepEqual(reqs, [], '点开通按钮不应请求任何接口');
      assert.equal(await p.getAttribute('#vipc .vp[data-vs]', 'data-vs'), 'none');
      assert.equal(S.srv.db.prepare("SELECT vip_until u FROM users WHERE username=?").get('buy_' + env.slice(0, 3)).u, null);
      await p.screenshot({path: SHOT + 'm246-buy-placeholder-' + env + '.png'});
      assert.deepEqual(p.errors, []);
    } finally { await p.context().close(); await S.close(); }
  }
});

test('M2.4.6 服务端没有任何购买/订单接口，也没有订单表；目录里支付保持关闭', async () => {
  const S = await startServer();
  try {
    const reg = await fetch(S.base + '/api/auth/register', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({username: 'buy_api', email: 'buy_api@x.test', password: 'Passw0rd123'})});
    const {token} = await reg.json(); const H = {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'};
    for (const path of ['/api/vip/purchase', '/api/vip/buy', '/api/vip/order', '/api/vip/orders', '/api/vip/subscribe', '/api/vip/checkout', '/api/vip/pay', '/api/orders', '/api/pay', '/api/payment']) {
      for (const method of ['POST', 'GET', 'PUT']) {
        const r = await fetch(S.base + path, {method, headers: H, body: method === 'GET' ? undefined : '{"plan":"vip","period":"month"}'});
        assert.equal(r.status, 404, method + ' ' + path);
      }
    }
    const tables = S.srv.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
    assert.deepEqual(tables.filter(n => /order|payment|invoice|subscription/i.test(n)), [], '没有订单/支付/订阅表');
    const cat = await (await fetch(S.base + '/api/vip/catalog')).json();
    assert.equal(cat.plans.vip.purchase.enabled, false);
    assert.equal(cat.plans.vip.purchase.label, '暂未开放');
    const me = await (await fetch(S.base + '/api/vip/me', {headers: H})).json();
    assert.equal(me.vip.active, false, '没有任何办法通过接口变成 VIP（生产环境）');
    assert.equal(S.srv.db.prepare('SELECT COUNT(*) n FROM vip_events').get().n, 0);
  } finally { await S.close(); }
});

test('M2.4.6 目录被改写成「可购买」也无效：按钮仍禁用、文字仍是「暂未开放」', async () => {
  const S = await startServer(); const p = await openPage(browser, S.base);
  try {
    await p.route('**/api/vip/catalog', async route => { const r = await route.fetch(); const j = await r.json(); j.plans.vip.purchase = {enabled: true, label: '立即购买', reason: ''}; await route.fulfill({json: j}); });
    await register(p, 'buy_forge'); await goCenter(p);
    // 就算（被改写的）目录说 enabled:true，前端也没有支付能力：按钮仍是禁用占位，不绑定动作
    assert.equal(await p.locator('#vbuy').isDisabled(), true);
    assert.equal(await p.getAttribute('#vbuy', 'data-a'), null);
    assert.equal(await p.innerText('#vbuy'), '暂未开放');
  } finally { await p.context().close(); await S.close(); }
});
