// 用户端 2.0.7：私聊重新登录后历史消息仍可解密（A）等聊天相关修复。
import test from 'node:test';
import assert from 'node:assert/strict';
import {startServer, openPage, register, launch} from './ui-helpers.mjs';

let browser;
test.before(async () => { browser = await launch(); });
test.after(async () => { await browser.close(); });

const me = p => p.evaluate(() => ({id: SESSION.user.id, tok: SESSION.token}));
async function befriend(pa, pb) {
  const b = await me(pb), a = await me(pa);
  await pa.evaluate(id => api('POST', '/api/friends/request', {userId: id}), b.id);
  await pb.evaluate(id => api('POST', '/api/friends/accept', {userId: id}), a.id);
  return {a, b};
}
const readAll = (p, cid) => p.evaluate(async cid => {
  const r = await api('GET', '/api/conversations/' + cid + '/messages');
  const out = [];
  for (const m of (r.j.messages || r.j.items || [])) { const x = await e2eeDecrypt(Object.assign({}, m)); out.push(x.text); }
  return out;
}, cid);
async function relogin(p, account) {
  await p.evaluate(() => { logout(); if (typeof render === 'function') render(); });
  await p.waitForFunction(() => !SESSION);
  await p.evaluate(async ac => { S.d.ac = ac; S.d.pw = 'Passw0rd123'; S.auth.pane = 'login'; await authgo(); }, account);
  await p.waitForSelector('nav');
  await p.evaluate(() => e2eeOnLogin());
}

test('A：私聊退出再登录后，历史加密消息（收到的和自己发的）仍能显示', async () => {
  const S = await startServer();
  const pa = await openPage(browser, S.base), pb = await openPage(browser, S.base);
  try {
    await register(pa, 'e2ea'); await register(pb, 'e2eb');
    await pa.evaluate(() => e2eeOnLogin()); await pb.evaluate(() => e2eeOnLogin());
    const {b} = await befriend(pa, pb);
    const cid = await pa.evaluate(async id => { const c = await openDm(id); await sendNet(c.id, '第一条：加密测试 hello'); await sendNet(c.id, '第二条'); return c.id; }, b.id);
    await pb.evaluate(() => loadConversations());
    const before = await readAll(pb, cid);
    assert.ok(before.includes('第一条：加密测试 hello') && before.includes('第二条'), JSON.stringify(before));
    // 对方（接收方）退出再登录
    await relogin(pb, 'e2eb');
    const after = await readAll(pb, cid);
    assert.ok(after.includes('第一条：加密测试 hello') && after.includes('第二条'), '接收方重新登录后：' + JSON.stringify(after));
    assert.ok(!after.some(t => /无法解密/.test(t)));
    // 刷新页面（App 重启）后也一样
    await pb.reload(); await pb.waitForSelector('nav'); await pb.evaluate(() => e2eeOnLogin());
    const afterReload = await readAll(pb, cid);
    assert.ok(afterReload.includes('第一条：加密测试 hello'), '重启后：' + JSON.stringify(afterReload));
    // 发送方退出再登录，自己发的也能看
    await relogin(pa, 'e2ea');
    const mine = await readAll(pa, cid);
    assert.ok(mine.includes('第一条：加密测试 hello'), '发送方：' + JSON.stringify(mine));
    // 重新登录后继续互发，仍能解密
    await pb.evaluate(async cid => { await loadConversations(); await sendNet(cid, '回复：收到'); }, cid);
    const got = await readAll(pa, cid);
    assert.ok(got.includes('回复：收到'), JSON.stringify(got));
    // 打开会话截图（接收方在 UI 里打开这条私聊）
    await pb.waitForFunction(() => { const e = document.getElementById('vxsplash'); return !e || e.classList.contains('out'); }, {timeout: 15000});
    await pb.evaluate(() => loadConversations());
    await pb.click('nav [data-v=chat], nav [data-v=msg]');
    await pb.locator('#v :text("e2ea")').first().click();
    await pb.waitForFunction(() => /回复：收到/.test(document.querySelector('#v').innerText), {timeout: 10000});
    await pb.waitForTimeout(600);
    const vis = await pb.locator('#v').innerText();
    assert.match(vis, /第一条：加密测试 hello/);
    assert.doesNotMatch(vis, /无法解密/);
    await pb.screenshot({path: '/workspace/vexo-client-shots/A-relogin-decrypt.png'});
    // H：对方头像和气泡顶部对齐（微信样式），不再在左下角
    const al = await pb.evaluate(() => { const r = document.querySelector('#v .mr:not(.me)'); const a = r.firstElementChild.getBoundingClientRect(), b = r.querySelector('.bub').getBoundingClientRect(); return {avTop: a.top, bubTop: b.top}; });
    assert.ok(Math.abs(al.avTop - al.bubTop) <= 2, 'H：头像应与气泡顶部对齐 ' + JSON.stringify(al));
  } finally { S.close(); await pa.close(); await pb.close(); }
});

async function touchPage(base) {
  const ctx = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 1, hasTouch: true, isMobile: true});
  const page = await ctx.newPage();
  page.errors = []; page.on('pageerror', e => page.errors.push(String(e)));
  await page.goto(base + '/'); await page.waitForSelector('#gate');
  return page;
}
async function edgeSwipe(p, {midRender = false, release = true} = {}) {
  const cdp = await p.context().newCDPSession(p);
  const t = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {type, touchPoints: type === 'touchEnd' ? [] : [{x, y}]});
  await t('touchStart', 6, 400);
  for (let x = 16; x <= 200; x += 16) { await t('touchMove', x, 402); await p.waitForTimeout(16); }
  if (midRender) await p.evaluate(() => { const pg = document.querySelector('#v .pg'); if (pg) pg.replaceWith(pg.cloneNode(true)); S.noAnim = 1; render(true); });
  if (release) await t('touchEnd');
  await p.waitForTimeout(700);
}

test('E：帖子详情左缘右滑返回，滑动中页面重绘也不会卡在半路', async () => {
  const S = await startServer();
  const p = await touchPage(S.base);
  try {
    await register(p, 'swipee');
    await p.waitForFunction(() => { const e = document.getElementById('vxsplash'); return !e || e.classList.contains('out'); }, {timeout: 15000});
    const id = await p.evaluate(async () => { const r = await api('POST', '/api/posts', {text: '右滑返回测试'}); await loadFeed(); render(); return r.j.post.id; });
    for (const midRender of [false, true]) {
      await p.evaluate(async id => { S.tab = 'home'; S.st = []; await A.post(id); render(); }, id);
      await p.waitForSelector('#v .pg');
      assert.equal(await p.evaluate(() => S.st.length), 1);
      await edgeSwipe(p, {midRender});
      const st = await p.evaluate(() => ({depth: S.st.length, tf: [...document.querySelectorAll('#v .pg')].map(e => e.style.transform).join('|'), ghosts: document.querySelectorAll('#app>.ghost').length}));
      assert.equal(st.depth, 0, '应已返回上一页 ' + JSON.stringify({midRender, st}));
      assert.ok(!/translate/.test(st.tf), '页面不应停在半路 ' + JSON.stringify(st));
      assert.equal(st.ghosts, 0);
    }
    // 松手事件丢失（节点被换掉）时，兜底在 1.5 秒内收尾
    await p.evaluate(async id => { S.tab = 'home'; S.st = []; await A.post(id); render(); }, id);
    await edgeSwipe(p, {release: false});
    await p.waitForTimeout(1800);
    const st2 = await p.evaluate(() => ({depth: S.st.length, ghosts: document.querySelectorAll('#app>.ghost').length}));
    assert.deepEqual(st2, {depth: 0, ghosts: 0});
    await p.screenshot({path: '/workspace/vexo-client-shots/E-swipe-back-after.png'});
  } finally { S.close(); await p.context().close(); }
});

test('G：小组频道栏点了靠右的频道后，不弹回开头', async () => {
  const S = await startServer();
  const p = await openPage(browser, S.base);
  try {
    await register(p, 'chang');
    await p.waitForFunction(() => { const e = document.getElementById('vxsplash'); return !e || e.classList.contains('out'); }, {timeout: 15000});
    const cm = await p.evaluate(async () => {
      const c = await api('POST', '/api/communities', {name: '频道测试组', description: '频道栏'});
      const id = c.j.community.id;
      for (const n of ['新人报到', '公告栏', '反馈bug', '闲聊灌水', '资源分享', '活动通知']) await api('POST', '/api/communities/' + id + '/channels', {name: n});
      return id;
    });
    await p.evaluate(async id => { S.tab = 'cm'; S.st = []; await A.cm(id); render(); }, cm);
    await p.waitForSelector('#v .chs');
    await p.evaluate(() => { const c = document.querySelector('#v .chs'); c.scrollLeft = c.scrollWidth; });
    await p.waitForTimeout(200);
    const before = await p.evaluate(() => document.querySelector('#v .chs').scrollLeft);
    assert.ok(before > 50, '频道栏应能横向滑动');
    const last = p.locator('#v .chs [data-a=chan]').last();
    const name = (await last.innerText()).trim();
    await last.click();
    await p.waitForTimeout(800);
    const st = await p.evaluate(() => { const c = document.querySelector('#v .chs'), on = c.querySelector('.on'), r = on.getBoundingClientRect(), cr = c.getBoundingClientRect(); return {sl: c.scrollLeft, on: on.innerText.trim(), visible: r.left >= cr.left - 1 && r.right <= cr.right + 1}; });
    assert.equal(st.on, name);
    assert.ok(st.sl > 50, '点完后不应弹回开头 ' + JSON.stringify(st));
    assert.ok(st.visible, '选中的频道应完整可见 ' + JSON.stringify(st));
    await p.screenshot({path: '/workspace/vexo-client-shots/G-channel-bar-after.png', clip: {x: 0, y: 0, width: 390, height: 560}});
  } finally { S.close(); await p.close(); }
});

test('B：私聊能选 doc/docx（安卓按 MIME 过滤），iPhone .mov 视频和 docx 能发出去', async () => {
  const {readFileSync} = await import('node:fs');
  const {fileURLToPath} = await import('node:url');
  const mov = readFileSync(fileURLToPath(new URL('./fixtures-m207.mov', import.meta.url))).toString('base64');
  const S = await startServer();
  const pa = await openPage(browser, S.base), pb = await openPage(browser, S.base);
  try {
    await register(pa, 'fila'); await register(pb, 'filb');
    await pa.evaluate(() => e2eeOnLogin()); await pb.evaluate(() => e2eeOnLogin());
    const {b} = await befriend(pa, pb);
    const cid = await pa.evaluate(async id => (await openDm(id)).id, b.id);
    await pa.waitForFunction(() => { const e = document.getElementById('vxsplash'); return !e || e.classList.contains('out'); }, {timeout: 15000});
    // 文件选择器的 accept 同时带扩展名和 MIME
    const [chooser] = await Promise.all([pa.waitForEvent('filechooser'), pa.evaluate(cid => cbPickFile('cv|' + cid, 'file'), cid)]);
    const accept = await chooser.element().getAttribute('accept');
    for (const x of ['.doc', '.docx', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip']) assert.ok(accept.split(',').includes(x), '缺少 ' + x);
    // .mov（iPhone 声明 video/quicktime）和 docx（手机常给空类型）
    const res = await pa.evaluate(async ({cid, mov}) => {
      const bin = Uint8Array.from(atob(mov), c => c.charCodeAt(0));
      const docx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array(200).fill(0)]);
      const out = [];
      for (const f of [new File([bin], 'IMG_0001.MOV', {type: 'video/quicktime'}), new File([docx], '报告.docx', {type: ''})]) {
        try { const m = await cbUpload(f, f.name); out.push(m.kind); } catch (e) { out.push('ERR ' + e.message); }
      }
      try { await cbUpload(new File([new Uint8Array(1)], 'big.mp4', {type: 'video/mp4'}), 'big.mp4'); } catch (e) {}
      const big = {size: 101 * 1024 * 1024, type: 'video/mp4', name: 'big.mp4'};
      try { await cbUpload(Object.setPrototypeOf(big, Blob.prototype), 'big.mp4'); out.push('big ok?'); } catch (e) { out.push('big: ' + e.message); }
      return out;
    }, {cid, mov});
    assert.equal(res[0], 'video', JSON.stringify(res));
    assert.equal(res[1], 'file', JSON.stringify(res));
    assert.match(res[2], /文件太大/);
  } finally { S.close(); await pa.close(); await pb.close(); }
});

test('D：外部作者头像用服务端 2.1.0 的 avatar.path（按 API 根补全），加载失败显示 avatar.fallback', async () => {
  const S = await startServer();
  const p = await openPage(browser, S.base);
  try {
    await register(p, 'avd');
    const r = await p.evaluate(async () => {
      window.NOVA_API_BASE = 'https://api.example.test';
      const fb = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#2F6F5E"/></svg>');
      rememberAuthor({id: 'ext:v2ex:alice', username: 'alice', displayName: 'alice', avatar: {kind: 'image', image: 'http://wrong-origin/api/import/avatar?u=a', path: '/api/import/avatar?u=abc', fallback: fb}, external: true});
      rememberAuthor({id: 'ext:hn:bob', username: 'bob', displayName: 'bob', avatar: {kind: 'image', image: fb, path: null, fallback: fb}, external: true});
      const h1 = av('ext:v2ex:alice', 32), h2 = av('ext:hn:bob', 32);
      return {h1, h2, fb};
    });
    assert.match(r.h1, /src="https:\/\/api\.example\.test\/api\/import\/avatar\?u=abc"/);
    assert.ok(r.h1.includes('data-fb="' + r.fb.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"') || r.h1.includes('data-fb="data:image/svg+xml'), r.h1.slice(0, 300));
    assert.match(r.h2, /src="data:image\/svg\+xml/);
  } finally { S.close(); await p.close(); }
});
