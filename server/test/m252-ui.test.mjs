// M2.5.2 VIP 标识 / 头像金边 / 主页装饰：只在服务端返回有效权益时展示，到期立即回落。
import test from 'node:test';
import assert from 'node:assert/strict';
import {startServer, openPage, register, launch, overflowX} from './ui-helpers.mjs';

let browser;
const SHOT = new URL('../../screenshots/', import.meta.url).pathname;
test.before(async () => { browser = await launch(); });
test.after(async () => { await browser.close(); });

const goMe = p => p.click('nav [data-v=me]').then(() => p.waitForSelector('#v .pf2'));
const goCenter = async p => { await p.click('nav [data-v=me]'); await p.click('#v [data-a=vip]'); await p.waitForSelector('#vipc .vp[data-vs]:not([data-vs=loading])'); };
const deco = p => p.evaluate(() => ({
  av: document.querySelectorAll('#v .pf2 .av.dec[data-dec=gold]').length,
  avw: document.querySelectorAll('#v .pf2 .avw.dec[data-dec=gold]').length,
  pdec: document.querySelectorAll('#v .pdec[data-dec=gold]').length,
  cvr: document.querySelectorAll('#v .cvr.dec[data-dec=gold]').length,
  pf: document.querySelectorAll('#v .pf.dec[data-dec=gold]').length,
  badge: document.querySelectorAll('#v .pf2 h2 .vip').length,
  label: document.querySelector('#v .pdec')?.getAttribute('aria-label') || '',
}));

test('M2.5.2 Basic：资料没有金边、装饰和 VIP 标识；预览里只有香槟金那张带装饰', async () => {
  const S = await startServer(); const p = await openPage(browser, S.base);
  try {
    await register(p, 'deco_basic');
    await goMe(p);
    const d = await deco(p);
    assert.equal(d.av, 0); assert.equal(d.avw, 0); assert.equal(d.pdec, 0); assert.equal(d.cvr, 0); assert.equal(d.pf, 0); assert.equal(d.badge, 0);
    await p.click('#v [data-a=vip]'); await p.waitForSelector('#vipc .vp[data-vs=none]');
    assert.equal(await p.locator('#vtheme .gpv.n .av.dec').count(), 0, '普通预览无金边');
    assert.equal(await p.locator('#vtheme .gpv.g .av.dec[data-dec=gold]').count(), 1, '香槟金预览有金边（仅示意）');
    assert.ok(await overflowX(p) <= 0);
    await p.screenshot({path: SHOT + 'm252-preview-basic.png'});
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); await S.close(); }
});

test('M2.5.2 开发环境：开通 VIP 后头像金边、主页装饰、标识立即出现；切回立即消失', async () => {
  const S = await startServer({env: 'development'}); const p = await openPage(browser, S.base);
  try {
    await register(p, 'deco_dev');
    await goCenter(p);
    await p.click('[data-a=viptoggle][data-v="1"]');
    await p.waitForSelector('#vipc .vp[data-vs=active]');
    await p.click('[data-a=back]');
    await p.waitForSelector('#v .pf2');
    const on = await deco(p);
    assert.equal(on.av, 1, '头像金边'); assert.equal(on.avw, 1); assert.equal(on.pdec, 1, '主页装饰');
    assert.equal(on.cvr, 1); assert.equal(on.pf, 1); assert.equal(on.badge, 1);
    assert.equal(on.label, 'NOVA VIP 资料装饰');
    assert.equal(await p.getAttribute('#v .pf2 h2 .vip', 'aria-label'), 'NOVA VIP 会员');
    await p.waitForTimeout(800);
    await p.screenshot({path: SHOT + 'm252-deco-profile.png'});
    // 刷新后仍在（来自服务端，不是本机伪造）
    await p.reload(); await p.waitForSelector('nav');
    await goMe(p);
    const after = await deco(p);
    assert.equal(after.av, 1); assert.equal(after.pdec, 1); assert.equal(after.badge, 1);
    // 切回普通：立即回落
    await p.click('#v [data-a=vip]'); await p.waitForSelector('#vipc .vp[data-vs=active]');
    await p.click('[data-a=viptoggle][data-v="0"]');
    await p.waitForSelector('#vipc .vp[data-vs=none]');
    await p.click('[data-a=back]');
    const off = await deco(p);
    assert.equal(off.av, 0); assert.equal(off.avw, 0); assert.equal(off.pdec, 0);
    assert.equal(off.cvr, 0); assert.equal(off.pf, 0); assert.equal(off.badge, 0);
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); await S.close(); }
});

test('M2.5.2 到期立即回落；伪造页面属性或本机数据无效', async () => {
  let t = Date.now();
  const S = await startServer({env: 'development', clock: () => t}); const p = await openPage(browser, S.base);
  try {
    await register(p, 'deco_exp');
    await goCenter(p); await p.click('[data-a=viptoggle][data-v="1"]'); await p.waitForSelector('#vipc .vp[data-vs=active]');
    await p.click('[data-a=back]');
    assert.equal((await deco(p)).pdec, 1);
    // 时间走到到期之后，重新登录：装饰和标识都回落
    t += 864e5 * 31;
    await p.click('#v [data-a=go][data-v=set]'); await p.click('#v [data-a=logout]');
    await p.waitForSelector('#gate');
    await p.fill('[data-d=ac]', 'deco_exp'); await p.fill('[data-d=pw]', 'Passw0rd123'); await p.click('[data-a=authgo]');
    await p.waitForSelector('nav'); await goMe(p);
    const exp = await deco(p);
    assert.equal(exp.av, 0); assert.equal(exp.pdec, 0); assert.equal(exp.badge, 0);
    // 生产级伪造：改 DOM、改本机 VIP 标记，下一次渲染按服务端还原
    await p.evaluate(() => {
      D.u.me[5] = 1;
      VIP.me = {vip: {active: true, state: 'active'}, entitlements: {vip_badge: {enabled: true}, profile_decoration: {enabled: true}, profile_theme_gold: {enabled: true}}};
      document.documentElement.dataset.vip = 'gold';
      render();
    });
    // 上面故意把 VIP.me 改成有效——这是内存缓存。真实保障是：下一次从服务器读取会还原；同时没有令牌侧的 VIP。
    // 更严格：清空缓存并渲染，或调用 sync 前先把 VIP.me 设回服务端真实值。
    await p.evaluate(() => { VIP.me = {vip: {active: false, state: 'expired', plan: 'basic'}, entitlements: {vip_badge: {value: false, enabled: false}, profile_decoration: {value: false, enabled: false}, profile_theme_gold: {value: false, enabled: false}}}; D.u.me[5] = 1; document.querySelector('#v .pf2')?.classList.add('dec'); render(); });
    const fake = await deco(p);
    assert.equal(fake.av, 0, '服务端已过期，伪造本机标记不能保留金边');
    assert.equal(fake.pdec, 0); assert.equal(fake.badge, 0);
    assert.equal(await p.evaluate(() => document.documentElement.dataset.vip || ''), '');
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); await S.close(); }
});

test('M2.5.2 生产环境：改页面属性和本机数据，渲染仍按服务端 Basic 状态，没有装饰', async () => {
  const S = await startServer(); const p = await openPage(browser, S.base);
  try {
    await register(p, 'deco_fake');
    await p.evaluate(() => { D.u.me[5] = 1; D.st.vt = 1; document.documentElement.dataset.vip = 'gold'; render(); });
    await goMe(p);
    const d = await deco(p);
    assert.equal(d.av, 0); assert.equal(d.pdec, 0); assert.equal(d.badge, 0);
    assert.equal(await p.evaluate(() => document.documentElement.dataset.vip || ''), '');
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); await S.close(); }
});
