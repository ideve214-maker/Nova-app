// r8：被删帖子从首页去掉；他人主页按钮一行；关注后粉丝数即时更新。
import test from 'node:test';
import assert from 'node:assert/strict';
import {startServer, openPage, register, launch} from './ui-helpers.mjs';

async function apiReg(base, u) {
  const r = await fetch(base + '/api/auth/register', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({agree: true, username: u, email: u + '@x.test', password: 'Passw0rd123'})});
  return r.json();
}
async function apiPost(base, tok, text) {
  const r = await fetch(base + '/api/posts', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + tok}, body: JSON.stringify({text})});
  return (await r.json()).post;
}

test('管理员删帖后：回到首页刷新掉；打开/举报得到 404 时从列表移除并提示', async () => {
  const browser = await launch();
  const S = await startServer({adminUsername: 'ops_m', adminPassword: 'OpsMPass1'});
  const p = await openPage(browser, S.base);
  try {
    const b = await apiReg(S.base, 'mdauth');
    const p1 = await apiPost(S.base, b.token, '第一条会被删 AAA');
    const p2 = await apiPost(S.base, b.token, '第二条会被删 BBB');
    await register(p, 'mdview');
    await p.waitForFunction(() => document.body.innerText.includes('第一条会被删 AAA') && document.body.innerText.includes('第二条会被删 BBB'));
    const admin = {id: 1, username: 'ops_m'};
    S.srv.adminOps.hideContent(admin, 'post', p1.id, {reason: 't'});
    S.srv.adminOps.hideContent(admin, 'post', p2.id, {reason: 't'});
    // 1) 点首页 tab 重新拉列表
    await p.evaluate(() => { A.tab('home'); });
    await p.waitForFunction(() => !document.body.innerText.includes('第一条会被删 AAA'), null, {timeout: 5000});
    // 2) 旧列表里残留的帖子：打开详情（评论 404）→ 移除 + 提示
    await p.evaluate(id => { S.posts.unshift({...S.posts[0] || {}, id, x: '残留 CCC', t: '刚刚', a: '1'}); }, p2.id);
    const gone = await p.evaluate(async id => { await loadComments(id); return {inList: S.posts.some(x => x.id === id), err: S.commentErr}; }, p2.id);
    assert.equal(gone.inList, false);
    assert.equal(gone.err, '该帖子已被删除');
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); await S.close(); await browser.close(); }
});

test('他人主页：按钮一行不折行不溢出；关注后粉丝数立刻 +1，取关 -1', async () => {
  const browser = await launch();
  const S = await startServer();
  const p = await openPage(browser, S.base, {width: 390});
  try {
    const b = await apiReg(S.base, 'mdtarget');
    await register(p, 'mdfan');
    await p.evaluate(id => A.user(String(id)), b.user.id);
    await p.waitForSelector('.pf.ovl .fr [data-a=fol]');
    await p.waitForFunction(() => S.userSocial);
    await p.waitForTimeout(800);
    const row = await p.evaluate(() => {
      const fr = document.querySelector('.pf.ovl .fr');
      const r = fr.getBoundingClientRect();
      const btns = [...fr.querySelectorAll('.pb')].map(b => { const x = b.getBoundingClientRect(); return {t: b.innerText, top: x.top, right: x.right, h: x.height, lh: parseFloat(getComputedStyle(b).lineHeight) || 20}; });
      return {right: r.right, vw: innerWidth, btns};
    });
    assert.match(await p.locator('.pf.ovl').innerText(), /mdtarget/);
    assert.doesNotMatch(await p.locator('.pf.ovl').innerText(), /mdfan/);
    assert.ok(row.btns.length >= 3, JSON.stringify(row));
    assert.ok(new Set(row.btns.map(x => Math.round(x.top))).size === 1, '按钮应在同一行 ' + JSON.stringify(row));
    for (const x of row.btns) assert.ok(x.right <= row.vw + 0.5, '按钮超出屏幕 ' + JSON.stringify(x));
    for (const x of row.btns) assert.ok(!x.t.includes('\n'), '文字折行 ' + JSON.stringify(x));
    assert.ok(row.btns.some(x => x.t === '⋯'));
    const followers = () => p.evaluate(() => S.userSocial.followers);
    assert.equal(await followers(), 0);
    await p.click('.pf.ovl .fr [data-a=fol]');
    await p.waitForFunction(() => S.userSocial.followers === 1);
    await p.waitForFunction(() => /1\s*粉丝|粉丝\s*1/.test(document.querySelector('.pf.ovl').innerText) || document.querySelector('.pf.ovl').innerText.includes('1'));
    await p.click('.pf.ovl .fr [data-a=fol]');
    await p.waitForFunction(() => S.userSocial.followers === 0);
    // ⋯ 菜单里有举报和拉黑
    await p.click('.pf.ovl .fr [data-a=umore]');
    await p.waitForSelector('.pn [data-a=reportu]');
    assert.equal(await p.locator('.pn [data-a=blockq]').count(), 1);
    await p.screenshot({path: 'screenshots/m7r8-profile-row.png'});
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); await S.close(); await browser.close(); }
});
