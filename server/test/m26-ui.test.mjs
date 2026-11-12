// M2.6 资料 / 头像 / 隐私 / 设备：前端读写都走服务器，刷新和重登后仍在。
import test from 'node:test';
import assert from 'node:assert/strict';
import {startServer, openPage, register, launch, overflowX} from './ui-helpers.mjs';

let browser;
const SHOT = new URL('../../screenshots/', import.meta.url).pathname;
test.before(async () => { browser = await launch(); });
test.after(async () => { await browser.close(); });

const goMe = p => p.click('nav [data-v=me]').then(() => p.waitForSelector('#v .pf2'));
const goEdit = async p => { await goMe(p); await p.click('#v [data-a=edit]'); await p.waitForSelector('#editp'); };
const goSet = async p => { await goMe(p); await p.click('#v [data-a=go][data-v=set]'); await p.waitForSelector('#v .pg'); };
const logout = async p => {
  await goSet(p);
  const btn = p.locator('#v [data-a=logout]');
  if (await btn.count()) { await btn.click(); await p.waitForSelector('#gate'); }
};

test('M2.6.1 资料读取与编辑：改昵称简介性别生日后刷新、退出再登录仍在；账号只读', async () => {
  const S = await startServer(); const p = await openPage(browser, S.base);
  try {
    await register(p, 'prof_save');
    await goEdit(p);
    assert.ok(await p.locator('#editp [data-d=eh][readonly]').count(), '登录后账号只读');
    await p.fill('#editp [data-d=en]', '夏至未至');
    await p.fill('#editp [data-d=eb]', '一座自己的城。');
    await p.click('#editp [data-a=gen][data-v=女]');
    await p.fill('#editp [data-d=ebd]', '1998-06-21');
    await p.click('#editp [data-a=saveedit]');
    await p.waitForSelector('#v .pf2');
    await p.waitForFunction(() => document.querySelector('#v .pf2 h2')?.textContent.includes('夏至未至'));
    assert.match(await p.locator('#v .pf2 p').innerText(), /一座自己的城/);
    await p.click('#v [data-a=mt][data-v=about]');
    await p.waitForFunction(() => document.body.innerText.includes('1998年06月21日'));
    assert.match(await p.locator('#v').innerText(), /女/);
    // 刷新仍在
    await p.reload(); await p.waitForSelector('nav');
    await goMe(p);
    assert.match(await p.locator('#v .pf2 h2').innerText(), /夏至未至/);
    assert.match(await p.locator('#v .pf2 p').innerText(), /一座自己的城/);
    // 退出再登录
    await logout(p);
    await p.waitForSelector('#gate [data-d=ac]');
    await p.fill('#gate [data-d=ac]', 'prof_save');
    await p.fill('#gate [data-d=pw]', 'Passw0rd123');
    await p.click('#gate [data-a=authgo]');
    await p.waitForSelector('nav');
    await goMe(p);
    assert.match(await p.locator('#v .pf2 h2').innerText(), /夏至未至/);
    assert.match(await p.locator('#v .pf2 p').innerText(), /一座自己的城/);
    await p.click('#v [data-a=mt][data-v=about]');
    assert.match(await p.locator('#v').innerText(), /1998年06月21日/);
    assert.ok(await overflowX(p) <= 0);
    await p.screenshot({path: SHOT + 'm261-profile.png'});
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); await S.close(); }
});

test('M2.6.2 颜色与文字头像：登录后不再用演示样板照；设置后刷新仍在；图片头像提示尚未开放', async () => {
  const S = await startServer(); const p = await openPage(browser, S.base);
  try {
    await register(p, 'ava_user');
    await goMe(p);
    const before = await p.evaluate(() => {
      const el = document.querySelector('#v .pf2 .av');
      return {tag: el?.tagName, cls: el?.className, bg: el && getComputedStyle(el).backgroundColor, txt: (el?.textContent||'').trim(), isImg: !!el?.querySelector('img') || el?.tagName==='IMG'};
    });
    assert.equal(before.isImg, false, '登录后不用演示样板照片');
    assert.ok(before.txt, '默认有首字母');
    await goEdit(p);
    assert.ok(await p.locator('#editp').innerText().then(t => t.includes('图片头像将在后续版本')));
    await p.click('#avcols [data-a=avcol][data-v="#6B3A4A"]');
    await p.waitForTimeout(200);
    await p.fill('#editp [data-d=al]', '夏');
    await p.click('#editp [data-a=avlet]');
    await p.waitForTimeout(300);
    await p.click('#editp [data-a=saveedit]');
    await p.waitForSelector('#v .pf2');
    const after = await p.evaluate(() => {
      const el = document.querySelector('#v .pf2 .av');
      return {bg: el && getComputedStyle(el).backgroundColor, txt: (el?.textContent||'').trim()};
    });
    assert.equal(after.txt, '夏');
    // rgb of #6B3A4A = rgb(107, 58, 74)
    assert.match(after.bg, /107,\s*58,\s*74/);
    await p.reload(); await p.waitForSelector('nav');
    await goMe(p);
    const again = await p.evaluate(() => {
      const el = document.querySelector('#v .pf2 .av');
      return {bg: el && getComputedStyle(el).backgroundColor, txt: (el?.textContent||'').trim(), isImg: !!el?.querySelector('img') || el?.tagName==='IMG'};
    });
    assert.equal(again.txt, '夏');
    assert.match(again.bg, /107,\s*58,\s*74/);
    assert.equal(again.isImg, false);
    await p.screenshot({path: SHOT + 'm262-avatar.png'});
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); await S.close(); }
});

test('M2.6.3 隐私设置：新用户全是默认值；每项可改并在刷新后仍在', async () => {
  const S = await startServer(); const p = await openPage(browser, S.base);
  try {
    await register(p, 'priv_user');
    await goSet(p);
    await p.click('#privrow');
    await p.waitForSelector('#privp');
    await p.waitForFunction(() => !document.querySelector('#privp')?.innerText.includes('正在读取'));
    const def = await p.evaluate(() => [...document.querySelectorAll('#privp [data-a=privset], #privp [data-a=privtog]')].filter(e => !e.classList.contains('s')).map(e => e.dataset.v + ':' + e.textContent.trim()));
    assert.ok(def.some(x => x.startsWith('profileVisibility|everyone')), '默认资料所有人可见: ' + def);
    assert.ok(def.some(x => x.startsWith('friendRequests|everyone')));
    assert.ok(def.filter(x => x.includes('已开启')).length >= 4, '四项开关默认开启');
    await p.click('#privp [data-a=privset][data-v="profileVisibility|private"]');
    await p.waitForTimeout(200);
    await p.click('#privp [data-a=privtog][data-v=showBirthday]');
    await p.waitForTimeout(200);
    await p.reload(); await p.waitForSelector('nav');
    await goSet(p); await p.click('#privrow');
    await p.waitForSelector('#privp');
    await p.waitForFunction(() => !document.querySelector('#privp')?.innerText.includes('正在读取'));
    const on = await p.evaluate(() => [...document.querySelectorAll('#privp [data-a=privset]:not(.s), #privp [data-a=privtog]:not(.s)')].map(e => (e.dataset.v||'') + ':' + e.textContent.trim()));
    assert.ok(on.some(x => x.startsWith('profileVisibility|private')), '隐私保存后仍在: ' + on);
    const bd = await p.locator('#privp [data-a=privtog][data-v=showBirthday]').innerText();
    assert.match(bd, /已关闭/);
    await p.screenshot({path: SHOT + 'm263-privacy.png'});
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); await S.close(); }
});

test('M2.6.4 / M2.6.5 登录设备列表脱敏；退出其他设备后另一台立即失效，本机仍在', async () => {
  const S = await startServer();
  const p1 = await openPage(browser, S.base);
  let p2;
  try {
    await register(p1, 'dev_user');
    // 第二台设备：同样账号再登录
    p2 = await openPage(browser, S.base);
    await p2.waitForSelector('#gate [data-d=ac]');
    await p2.fill('#gate [data-d=ac]', 'dev_user');
    await p2.fill('#gate [data-d=pw]', 'Passw0rd123');
    await p2.click('#gate [data-a=authgo]');
    await p2.waitForSelector('nav');
    await goSet(p1); await p1.click('#secrow');
    await p1.waitForSelector('#secp');
    await p1.waitForFunction(() => Number(document.querySelector('#secp [data-ndev]')?.dataset.ndev) >= 2);
    const list = await p1.evaluate(() => {
      const rows = [...document.querySelectorAll('#secp [data-sid]')];
      return {
        n: rows.length,
        ids: rows.map(r => r.dataset.sid),
        text: document.querySelector('#secp').innerText,
        current: rows.filter(r => r.innerText.includes('当前设备')).length,
        rawIp: /(?:\d{1,3}\.){3}\d{1,3}(?!\*)/.test(document.querySelector('#secp').innerText),
        tok: /[A-Za-z0-9+/=]{24,}/.test(document.querySelector('#secp').innerText) && document.querySelector('#secp').innerText.includes('token'),
      };
    });
    assert.ok(list.n >= 2, '至少两台设备');
    assert.ok(list.ids.every(id => id.startsWith('ss_')), 'id 是公开会话号: ' + list.ids);
    assert.equal(list.current, 1, '标记当前设备');
    assert.equal(list.rawIp, false, '不含完整原始 IP');
    // 退出其他设备（确认弹层）
    await p1.click('#secp [data-a=revothersq]');
    await p1.waitForSelector('[data-a=revothers]');
    assert.match(await p1.locator('#v').innerText(), /当前这台设备保持登录|当前这台设备将保持登录|当前这台设备保持登录/);
    await p1.click('[data-a=revothers]');
    await p1.waitForFunction(() => Number(document.querySelector('#secp [data-ndev]')?.dataset.ndev) === 1);
    assert.match(await p1.locator('#v').innerText(), /当前设备/);
    // 另一台刷新后要重新登录
    await p2.reload();
    await p2.waitForSelector('#gate, nav', {timeout: 8000});
    assert.ok(await p2.locator('#gate').count(), '其他设备令牌已失效');
    // 本机刷新仍登录
    await p1.reload(); await p1.waitForSelector('nav');
    await p1.screenshot({path: SHOT + 'm265-devices.png'});
    assert.deepEqual(p1.errors, []);
  } finally { await p1.context().close(); if (p2) await p2.context().close(); await S.close(); }
});

test('M2.6.6 改密后其他设备下线、本机仍在；密码错误有提示', async () => {
  const S = await startServer();
  const p1 = await openPage(browser, S.base);
  let p2;
  try {
    await register(p1, 'pw_user');
    p2 = await openPage(browser, S.base);
    await p2.waitForSelector('#gate [data-d=ac]');
    await p2.fill('#gate [data-d=ac]', 'pw_user');
    await p2.fill('#gate [data-d=pw]', 'Passw0rd123');
    await p2.click('#gate [data-a=authgo]');
    await p2.waitForSelector('nav');
    await goSet(p1); await p1.click('#secrow');
    await p1.waitForSelector('#pwbox');
    await p1.fill('#pwbox [data-d=opw]', 'wrong');
    await p1.fill('#pwbox [data-d=npw]', 'Newpass123');
    await p1.fill('#pwbox [data-d=npw2]', 'Newpass123');
    await p1.click('#pwbox [data-a=chpw]');
    await p1.waitForSelector('#pwbox .err, #secp [role=alert]');
    assert.match(await p1.locator('#secp').innerText(), /原密码不正确|不正确/);
    await p1.fill('#pwbox [data-d=opw]', 'Passw0rd123');
    await p1.fill('#pwbox [data-d=npw]', 'Newpass123');
    await p1.fill('#pwbox [data-d=npw2]', 'Newpass123');
    await p1.click('#pwbox [data-a=chpw]');
    await p1.waitForFunction(() => (document.body.innerText||'').includes('密码已修改') || Number(document.querySelector('#secp [data-ndev]')?.dataset.ndev) === 1, {timeout: 5000});
    await p2.reload();
    await p2.waitForSelector('#gate, nav', {timeout: 8000});
    assert.ok(await p2.locator('#gate').count(), '改密后其他设备下线');
    await p1.reload(); await p1.waitForSelector('nav', {timeout: 5000});
    assert.deepEqual(p1.errors, []);
  } finally { await p1.context().close(); if (p2) await p2.context().close(); await S.close(); }
});
