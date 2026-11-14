// 转帖状态按账号分开：A 转帖后删掉转帖，同一台设备换 B 登录，B 不能显示「你已经转过」，计数也不能是 1。
import test from 'node:test';
import assert from 'node:assert/strict';
import {startServer, openPage, register, launch} from './ui-helpers.mjs';

let browser;
test.before(async () => { browser = await launch(); });
test.after(async () => { await browser.close(); });

const xrState = (p, pid) => p.evaluate(id => {
  const el = document.querySelector(`.xbar [data-a=xrt][data-v="${id}"]`);
  return el ? {on: el.classList.contains('on'), n: el.querySelector('span').textContent} : null;
}, pid);

test('转帖记录按账号隔离；删除转帖后清除记录；旧的全局记录被丢弃', async () => {
  const S = await startServer(); const p = await openPage(browser, S.base);
  try {
    await register(p, 'rt_alice');
    await p.click('#v [data-a=compose]'); await p.waitForSelector('[data-d=pin]');
    await p.fill('[data-d=pin]', '原帖：转帖测试'); await p.click('[data-a=pub]');
    await p.waitForFunction(() => document.body.innerText.includes('原帖：转帖测试') && document.querySelector('.xbar [data-a=xrt]'));
    const pid = await p.evaluate(() => document.querySelector('.xbar [data-a=xrt]').getAttribute('data-v'));
    // A 转帖
    await p.click(`.xbar [data-a=xrt][data-v="${pid}"]`); await p.click(`[data-a=xrtgo][data-v="${pid}"]`);
    await p.waitForFunction(id => (repostMap()[id]), pid);
    const nid = await p.evaluate(id => repostMap()[id], pid);
    await p.waitForFunction(id => { const el = document.querySelector(`.xbar [data-a=xrt][data-v="${id}"]`); return el && el.classList.contains('on'); }, pid);
    assert.deepEqual(await xrState(p, pid), {on: true, n: '1'}, 'A 转帖后自己看到已转 1');
    // 记录写在按账号区分的键里，没有全局键
    const keys = await p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('nova_reposted')));
    assert.equal(keys.length, 1); assert.match(keys[0], /^nova_reposted:\d+$/);
    // A 删除转帖那条帖子
    await p.evaluate(v => A.delp(v), nid);
    await p.waitForFunction(id => !repostMap()[id], pid);
    await p.evaluate(() => render());
    assert.deepEqual(await xrState(p, pid), {on: false, n: ''}, 'A 删除转帖后不再显示已转、计数归零');
    // 再转一次，不删，然后换 B 登录同一台设备
    await p.click(`.xbar [data-a=xrt][data-v="${pid}"]`);
    assert.equal(await p.locator(`[data-a=xrtgo][data-v="${pid}"]`).count(), 1, '删除后可以重新转帖');
    await p.click(`[data-a=xrtgo][data-v="${pid}"]`);
    await p.waitForFunction(id => (repostMap()[id]), pid);
    // 模拟旧版留下的全局记录
    await p.evaluate(id => localStorage.setItem('nova_reposted', JSON.stringify({[id]: 'x'})), pid);
    await p.evaluate(() => { logout(); render(); });
    await p.reload(); await p.waitForSelector('#gate');
    assert.equal(await p.evaluate(() => localStorage.getItem('nova_reposted')), null, '旧版全局记录被丢弃');
    await register(p, 'rt_bob');
    assert.deepEqual(await p.evaluate(id => repostMap()[id] || null, pid), null, 'B 没有 A 的转帖记录');
    assert.equal(await p.evaluate(id => postReposts({id}), pid), 0, 'B 看到的转帖数不含 A 的本机记录');
    // B 打开 A 的原帖转帖面板，应该是「转帖」按钮而不是「你已经转过」
    await p.evaluate(id => { S.sh = {t: 'xrt', id}; render(); }, pid);
    const sheet = await p.evaluate(() => document.body.innerText);
    assert.ok(!sheet.includes('你已经转过这条帖子'), 'B 不应看到「你已经转过」');
    assert.equal(await p.locator(`[data-a=xrtgo][data-v="${pid}"]`).count(), 1, 'B 可以转帖');
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); await S.close(); }
});

test('在别的设备删掉转帖：打开转帖面板时向服务器确认并清掉记录', async () => {
  const S = await startServer(); const p = await openPage(browser, S.base);
  try {
    await register(p, 'rt_carol');
    await p.click('#v [data-a=compose]'); await p.waitForSelector('[data-d=pin]');
    await p.fill('[data-d=pin]', '原帖二'); await p.click('[data-a=pub]');
    await p.waitForFunction(() => document.querySelector('.xbar [data-a=xrt]'));
    const pid = await p.evaluate(() => document.querySelector('.xbar [data-a=xrt]').getAttribute('data-v'));
    await p.click(`.xbar [data-a=xrt][data-v="${pid}"]`); await p.click(`[data-a=xrtgo][data-v="${pid}"]`);
    await p.waitForFunction(id => (repostMap()[id]), pid);
    const nid = await p.evaluate(id => repostMap()[id], pid);
    // 绕过本机直接调接口删除（相当于在别的设备删）
    const r = await p.evaluate(v => api('POST', '/api/posts/' + v + '/delete', {}), nid);
    assert.equal(r.s, 200);
    await p.click(`.xbar [data-a=xrt][data-v="${pid}"]`);
    await p.waitForFunction(id => !repostMap()[id], pid);
    await p.waitForSelector(`[data-a=xrtgo][data-v="${pid}"]`);
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); await S.close(); }
});
