// 人工收款码开通 VIP：会员中心展示套餐、收款码与订单码；付款后等待管理员核对，不假装立刻成功。
import test from 'node:test';
import assert from 'node:assert/strict';
import {startServer, openPage, register, launch} from './ui-helpers.mjs';

let browser;
const SHOT = new URL('../../screenshots/', import.meta.url).pathname;
test.before(async () => { browser = await launch(); });
test.after(async () => { await browser.close(); });
const goCenter = async p => { await p.click('nav [data-v=me]'); await p.click('#v [data-a=vip]'); await p.waitForSelector('#vipc [data-plan=vip]'); };

test('开通入口显示定价 ¥9.9/¥99 和扫码开通，不声称付款即到账', async () => {
  const S = await startServer({env: 'production'}); const p = await openPage(browser, S.base);
  try {
    await register(p, 'buy_qr1');
    await goCenter(p);
    const text = await p.innerText('#vipc');
    assert.doesNotMatch(text.replace(/数值暂定/g, ''), /暂定/); // 价格不含「暂定」；媒体额度说明可保留「数值暂定」
    assert.match(text, /¥9\.9/);
    assert.match(text, /¥9\.9\/月[\s\S]*¥99\/年/);
    assert.match(text, /开通 ¥9\.9\/月/);
    assert.match(text, /开通 ¥99\/年/);
    assert.match(text, /管理员核对/);
    assert.doesNotMatch(text, /支付成功|立即到账|购买成功|开通成功，欢迎/);
    assert.equal(await p.locator('#vbuy-month').count(), 1);
    assert.equal(await p.locator('#vbuy-month').isDisabled(), false);
    await p.screenshot({path: SHOT + 'm246-buy-qr-entry.png'});
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); await S.close(); }
});

test('选择套餐和付款方式后展示遮罩收款码、订单码和「我已付款」；提交后等待核对、VIP 仍未开通', async () => {
  const S = await startServer({env: 'production', adminUsername: 'ops_ui_pay', adminPassword: 'OpsUiPay1x'});
  const p = await openPage(browser, S.base);
  try {
    await register(p, 'buy_qr2');
    await goCenter(p);
    await p.click('#vbuy-month');
    await p.waitForSelector('#vpaypick');
    const pick = await p.innerText('#vpaypick');
    assert.match(pick, /微信|支付宝/);
    assert.match(pick, /管理员核对/);
    await p.click('#vpaypick [data-a=vipmethod][data-v="month|wechat"]');
    await p.waitForSelector('#vpay #vpaycode');
    const card = await p.innerText('#vpay');
    assert.match(card, /NV[A-Z2-9]{6}/);
    assert.match(card, /¥9\.9/);
    assert.match(card, /备注/);
    assert.match(card, /我已付款/);
    assert.match(card, /管理员核对/);
    const qr = p.locator('#vpayqr');
    assert.equal(await qr.count(), 1);
    await p.waitForFunction(() => {
      const img = document.getElementById('vpayqr');
      return img && img.complete && img.naturalWidth > 80;
    });
    await p.click('#vpaygo');
    await p.waitForFunction(() => document.querySelector('#vpay') && document.querySelector('#vpay').getAttribute('data-os') === 'awaiting_review');
    const after = await p.innerText('#vpay');
    assert.match(after, /等待管理员核对/);
    assert.equal(await p.getAttribute('#vipc .vp[data-vs]', 'data-vs'), 'none');
    const row = S.srv.db.prepare("SELECT vip_until u FROM users WHERE username=?").get('buy_qr2');
    assert.equal(row.u, null);
    await p.screenshot({path: SHOT + 'm246-buy-qr-pending.png'});
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); await S.close(); }
});

test('两种收款方式都关闭时，开通按钮回到「暂未开放」占位', async () => {
  const S = await startServer({env: 'production', payEnv: {NOVA_PAY_WECHAT_ENABLED: '0', NOVA_PAY_ALIPAY_ENABLED: '0'}});
  const p = await openPage(browser, S.base);
  try {
    await register(p, 'buy_off');
    await goCenter(p);
    const btn = p.locator('#vbuy');
    assert.equal(await btn.count(), 1);
    assert.equal(await btn.isDisabled(), true);
    assert.match(await btn.innerText(), /暂未开放|暂未/);
    const text = await p.innerText('#vipc');
    assert.doesNotMatch(text.replace(/数值暂定/g, ''), /暂定/); // 价格不含「暂定」；媒体额度说明可保留「数值暂定」
    assert.doesNotMatch(text, /我已付款/);
  } finally { await p.context().close(); await S.close(); }
});
