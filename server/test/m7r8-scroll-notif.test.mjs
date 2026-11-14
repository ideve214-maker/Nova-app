// r8.3：首页滚动不被打断（无下拉刷新、无收起动画、无虚拟列表重建、滚动中不整页重绘、后台刷新不换列表）；通知可打开、内容完整。
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

test('首页滚动：内容随滚动区滚走、滚动中不改高度不重建卡片、滚动中的重绘推迟、后台刷新给提示不换列表、失败不报错', async () => {
  const browser = await launch();
  const S = await startServer();
  const p = await openPage(browser, S.base);
  try {
    const b = await apiReg(S.base, 'scauthor');
    for (let i = 0; i < 30; i++) await apiPost(S.base, b.token, `滚动帖 ${i} ` + '一段用来撑高卡片的文字。'.repeat(1 + (i % 4)));
    await register(p, 'scviewer');
    await p.waitForFunction(() => document.querySelectorAll('.fcard').length >= 30);
    await p.waitForTimeout(500);
    const st = await p.evaluate(() => {
      const sc = document.querySelector('#v .pg.home > .sc');
      return {hcolInSc: !!sc.querySelector('.hcol'), segInSc: !!sc.querySelector('.feed-seg'), ptr: !!document.querySelector('.ptr--ptr'), vhost: !!document.querySelector('.vhost'), sticky: getComputedStyle(sc.querySelector('.feed-seg')).position};
    });
    assert.deepEqual(st, {hcolInSc: true, segInSc: true, ptr: false, vhost: false, sticky: 'sticky'});
    await p.evaluate(() => {
      window.__m = {pgClass: 0, cardRemoved: 0, heights: new Set()};
      new MutationObserver(ms => ms.forEach(m => {
        if (m.type === 'attributes' && m.target.classList.contains('pg')) __m.pgClass++;
        m.removedNodes.forEach(n => { if (n.nodeType === 1 && (n.classList.contains('fcard') || n.querySelector?.('.fcard'))) __m.cardRemoved++; });
      })).observe(document.getElementById('v'), {attributes: true, attributeFilter: ['class'], childList: true, subtree: true});
      (function f() { const sc = document.querySelector('#v .sc'); if (sc) __m.heights.add(sc.clientHeight); if (!window.__stop) requestAnimationFrame(f); })();
    });
    const box = await p.evaluate(() => { const r = document.querySelector('#v .sc').getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2}; });
    await p.mouse.move(box.x, box.y);
    for (let i = 0; i < 12; i++) { await p.mouse.wheel(0, 260); await p.waitForTimeout(30); }
    // 滚动进行中：模拟服务器推送引起的 render()
    const mid = await p.evaluate(() => { const card = document.querySelector('.fcard'); render(); return document.querySelector('.fcard') === card; });
    assert.equal(mid, true, '滚动中 render() 应推迟，不应立刻重建列表');
    for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, 260); await p.waitForTimeout(30); }
    await p.waitForTimeout(600);
    const m = await p.evaluate(() => { window.__stop = 1; return {pgClass: __m.pgClass, cardRemoved: __m.cardRemoved, heights: [...__m.heights], top: document.querySelector('#v .sc').scrollTop}; });
    assert.equal(m.pgClass, 0, '滚动中不应切换 .pg 的 class');
    assert.equal(m.heights.length, 1, '滚动区高度不应变化 ' + JSON.stringify(m.heights));
    assert.ok(m.cardRemoved <= 1, '只允许滚动停下后的一次合并重绘 ' + m.cardRemoved);
    assert.ok(m.top > 3000, '滚动位置应保持 ' + m.top);
    // 后台刷新：已经往下滑 → 不换列表，出现「有 N 条新动态」
    await apiPost(S.base, b.token, '新来的帖子 NEW1');
    await apiPost(S.base, b.token, '新来的帖子 NEW2');
    const before = await p.evaluate(() => ({first: document.querySelector('.fcard'), top: document.querySelector('#v .sc').scrollTop}));
    await p.evaluate(() => refreshFeedSafe());
    await p.waitForSelector('.newpill');
    const r1 = await p.evaluate(() => ({pill: document.querySelector('.newpill').innerText, top: document.querySelector('#v .sc').scrollTop, hasNew: document.body.innerText.includes('NEW1')}));
    assert.equal(r1.pill, '有 2 条新动态');
    assert.equal(r1.hasNew, false);
    assert.ok(Math.abs(r1.top - before.top) < 2);
    // 断网刷新：保留当前列表，不出现错误提示
    await p.route('**/api/posts?**', r => r.abort());
    await p.evaluate(() => refreshFeedSafe());
    await p.waitForTimeout(400);
    const r2 = await p.evaluate(() => ({cards: document.querySelectorAll('.fcard').length, err: /动态加载失败|网络不太好/.test(document.querySelector('#v .sc').innerText)}));
    assert.ok(r2.cards >= 30); assert.equal(r2.err, false);
    await p.unroute('**/api/posts?**');
    // 点提示：换上新列表并回到顶部
    await p.evaluate(() => refreshFeedSafe());
    await p.waitForSelector('.newpill');
    await p.click('.newpill');
    await p.waitForFunction(() => document.body.innerText.includes('NEW2') && document.querySelector('#v .sc').scrollTop === 0);
    assert.equal(await p.locator('.newpill').count(), 0);
    // 再点首页标签：回到顶部并刷新
    await apiPost(S.base, b.token, '新来的帖子 NEW3');
    await p.evaluate(() => { document.querySelector('#v .sc').scrollTop = 1500; });
    await p.click('nav [data-a=tab][data-v=home]');
    await p.waitForFunction(() => document.body.innerText.includes('NEW3') && document.querySelector('#v .sc').scrollTop === 0, null, {timeout: 5000});
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); await S.close(); await browser.close(); }
});

test('通知：长内容在列表里多行显示，点开看完整内容并标为已读；跟帖子有关的跳到帖子', async () => {
  const browser = await launch();
  const S = await startServer();
  const p = await openPage(browser, S.base);
  try {
    await register(p, 'ntviewer');
    const me = await p.evaluate(() => SESSION.user.id);
    const long = '你发布的相关内容已被删除，这是一次警告。' + '请遵守社区规范，多次违规会被限制发帖甚至封禁账号。'.repeat(4) + '结尾标记ZZEND';
    S.srv.notifications.push(me, {kind: 'report_result', title: '你的内容被处理', body: long, refType: 'report', refId: 'rp1'});
    S.srv.notifications.push(me, {kind: 'system', title: '全体通知：今晚 23:00 系统维护，预计 30 分钟', body: '维护期间可能无法发帖和聊天。', refType: null, refId: null});
    const author = await apiReg(S.base, 'ntauthor');
    const post = await apiPost(S.base, author.token, '通知要跳到的帖子 PPOST');
    S.srv.notifications.push(me, {kind: 'comment', title: '有人评论了你的动态', body: '评论内容', refType: 'post', refId: post.id, actorId: author.user.id});
    await p.click('[data-a=notif]');
    await p.waitForSelector('.pn .nr');
    const rows = await p.evaluate(() => [...document.querySelectorAll('.pn .nr')].map(r => ({t: r.querySelector('.nt')?.innerText, b: r.querySelector('.nb')?.innerText || '', h: r.getBoundingClientRect().height})));
    assert.equal(rows.length, 3);
    const warn = rows.find(r => r.t === '你的内容被处理');
    assert.ok(warn && warn.b.includes('ZZEND'), '正文应完整在 DOM 里（显示上最多 3 行）');
    assert.ok(warn.h > 70, '长通知应多行显示 ' + warn.h);
    // 点开警告 → 详情显示完整正文，标为已读
    await p.click('.pn .nr:has-text("你的内容被处理")');
    await p.waitForSelector('.pn .ndet');
    assert.ok((await p.locator('.pn .ndb').innerText()).includes('ZZEND'));
    await p.waitForFunction(() => S.notifications.find(n => n.title === '你的内容被处理').u === 0);
    // 返回列表 → 点全体通知 → 标题完整
    await p.click('.pn [data-a=notif]');
    await p.click('.pn .nr:has-text("全体通知")');
    await p.waitForSelector('.pn .ndet');
    assert.match(await p.locator('.pn .ndt').innerText(), /预计 30 分钟/);
    // 跟帖子有关 → 打开帖子
    await p.click('.pn [data-a=notif]');
    await p.click('.pn .nr:has-text("有人评论了你的动态")');
    await p.waitForFunction(id => S.st[S.st.length - 1] === 'post:' + id && !S.sh, post.id);
    await p.waitForFunction(() => document.body.innerText.includes('PPOST'));
    const unread = await (await fetch(S.base + '/api/notifications', {headers: {Authorization: 'Bearer ' + await p.evaluate(() => SESSION.token)}})).json();
    assert.equal(unread.unread, 0, '三条都打开过，应全部已读');
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); await S.close(); await browser.close(); }
});

test('通知：默认只显示最新 5 条，「加载更多」每次再显示 5 条，没有更多时隐藏；行宽与通知一致', async () => {
  const browser = await launch();
  const S = await startServer();
  const p = await openPage(browser, S.base);
  try {
    await register(p, 'ntpager');
    const me = await p.evaluate(() => SESSION.user.id);
    for (let i = 1; i <= 12; i++) { S.srv.notifications.push(me, {kind: 'system', title: '分页通知 #' + i, body: '第 ' + i + ' 条', dedupeKey: 'pg' + i}); await new Promise(r => setTimeout(r, 5)); }
    await p.click('[data-a=notif]');
    await p.waitForSelector('.pn .nr .nt');
    const titles = () => p.evaluate(() => [...document.querySelectorAll('.pn .nr .nt')].map(x => x.innerText));
    let t = await titles();
    assert.equal(t.length, 5); assert.equal(t[0], '分页通知 #12'); assert.equal(t[4], '分页通知 #8');
    const geo = await p.evaluate(() => { const a = document.querySelector('.pn .swr .nr.swc').getBoundingClientRect(), b = document.querySelector('.pn .nmore').getBoundingClientRect(); return {aw: a.width, bw: b.width, al: a.left, bl: b.left, bh: b.height}; });
    assert.ok(Math.abs(geo.aw - geo.bw) < 1 && Math.abs(geo.al - geo.bl) < 1 && geo.bh >= 52, JSON.stringify(geo));
    assert.equal(await p.locator('.pn .nmore').innerText(), '加载更多');
    await p.click('.pn .nmore');
    t = await titles(); assert.equal(t.length, 10); assert.equal(t[9], '分页通知 #3');
    await p.click('.pn .nmore');
    t = await titles(); assert.equal(t.length, 12);
    assert.equal(await p.locator('.pn .nmore').count(), 0);
    // 打开一条再「返回通知」，已加载的条数保留；重新打开面板回到 5 条
    await p.click('.pn .nr:has-text("分页通知 #1")');
    await p.waitForSelector('.pn .ndet');
    await p.click('.pn [data-a=notif]');
    assert.equal((await titles()).length, 12);
    await p.evaluate(() => { S.sh = null; render(); });
    await p.click('[data-a=notif]');
    await p.waitForSelector('.pn .nr .nt');
    assert.equal((await titles()).length, 5);
    // 左滑仍然可用：露出「标为已读/删除」，点删除后少一条
    const r = await p.locator('.pn .swr .nr.swc').first().boundingBox();
    await p.mouse.move(r.x + r.width - 20, r.y + r.height / 2); await p.mouse.down();
    for (let i = 1; i <= 10; i++) await p.mouse.move(r.x + r.width - 20 - i * 16, r.y + r.height / 2);
    await p.mouse.up();
    await p.waitForSelector('.pn .nr.swc.o');
    await p.waitForTimeout(400);
    await p.locator('.pn .swr:has(.nr.swc.o) [data-a=nrdel]').click();
    await p.waitForFunction(() => S.notifications.length === 11);
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); await S.close(); await browser.close(); }
});
