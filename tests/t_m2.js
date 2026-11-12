// M2 左滑操作
const T = require('./lib');
async function swipe(p, loc, dx, steps = 8, delay = 12) {
  const b = await loc.boundingBox(); const x0 = b.x + b.width - 60, y = b.y + b.height / 2;
  await p.mouse.move(x0, y); await p.mouse.down();
  for (let i = 1; i <= steps; i++) { await p.mouse.move(x0 - dx * i / steps, y + 1); await T.wait(delay); }
  await p.mouse.up(); await T.wait(350);
}
module.exports = async () => {
  await T.group('M2 社区列表左滑：置顶/静音/退出', async () => {
    const p = await T.open();
    await p.click('nav [data-v=cm]'); await T.wait(450);
    const rows = () => p.locator('#cl .swc');
    T.ok(await rows().count() >= 4, '已加入社区行都带左滑容器');
    const cafe = p.locator('#cl .swc[data-v=cm_cafe]');
    await swipe(p, cafe, 180);
    T.ok(await cafe.evaluate(e => e.classList.contains('o')), '左滑后展开');
    const labels = await cafe.evaluate(e => [...e.parentElement.querySelectorAll('.swa button')].map(b => b.textContent));
    T.eq(labels, ['置顶', '静音', '退出'], '成员角色露出 置顶/静音/退出');
    await p.click('#cl .swa button[data-a=cmpin][data-v=cm_cafe]');
    T.eq(await p.evaluate(() => D.cm.find(c => c.id == 'cm_cafe').pin), 1, '置顶生效');
    T.eq(await p.evaluate(() => document.querySelector('#cl .swc').dataset.v), 'cm_cafe', '置顶的社区排到第一位');
    await swipe(p, p.locator('#cl .swc[data-v=cm_cafe]'), 180);
    await p.click('#cl .swa button[data-a=cmmute][data-v=cm_cafe]');
    T.eq(await p.evaluate(() => D.cm.find(c => c.id == 'cm_cafe').mute), 1, '静音生效');
    T.ok((await p.locator('#cl').innerText()).includes('🔕'), '静音标记显示');
    const own = p.locator('#cl .swc[data-v=cm_new]'); await swipe(p, own, 180);
    T.eq(await own.evaluate(e => [...e.parentElement.querySelectorAll('.swa button')].map(b => b.textContent)), ['置顶', '静音'], '所有者没有"退出"按钮');
    const walk = p.locator('#cl .swc[data-v=cm_walk]'); await swipe(p, walk, 180);
    await p.click('#cl .swa button[data-a=leave][data-v=cm_walk]'); T.ok(await p.locator('.pn h3').innerText() === '退出这个社区？', '退出需要二次确认');
    await p.click('[data-a=leave2]'); T.eq(await p.evaluate(() => D.cm.find(c => c.id == 'cm_walk').j), 0, '确认后退出');
    T.eq(p.errors, [], '无报错'); await p.ctx.close();
  });
  await T.group('M2 左滑：发现页加入 / 单行展开 / 竖滚不误触 / 点行收起 / 轻扫', async () => {
    const p = await T.open();
    await p.click('nav [data-v=cm]'); await p.click('[data-a=cmseg][data-v=d]'); await T.wait(450);
    const g = p.locator('#cl .swc[data-v=cm_game]'); await swipe(p, g, 160);
    await p.click('#cl .swa button[data-a=join]'); T.eq(await p.evaluate(() => D.cm.find(c => c.id == 'cm_game').j), 1, '发现页左滑"加入"');
    await p.click('[data-a=cmseg][data-v=j]'); await T.wait(300);
    const a = p.locator('#cl .swc').nth(0), b = p.locator('#cl .swc').nth(1);
    await swipe(p, a, 180); await swipe(p, b, 180);
    T.eq(await p.locator('#cl .swc.o').count(), 1, '同一时间只展开一行');
    await p.evaluate(() => document.querySelectorAll('.swc.o').forEach(swClose));
    const c = p.locator('#cl .swc').nth(2); const bb = await c.boundingBox();
    await p.mouse.move(bb.x + 200, bb.y + 20); await p.mouse.down(); await p.mouse.move(bb.x + 203, bb.y + 90, { steps: 5 }); await p.mouse.up();
    T.eq(await p.locator('#cl .swc.o').count(), 0, '竖向拖动不会展开');
    await swipe(p, c, 180); const st = await p.evaluate(() => S.st.length);
    const bc = await c.boundingBox(); await p.mouse.click(bc.x + 20, bc.y + 20); await T.wait(300);
    T.eq(await p.locator('#cl .swc.o').count(), 0, '点行本身只收起');
    T.eq(await p.evaluate(() => S.st.length), st, '收起时不会误进入社区页');
    const d = p.locator('#cl .swc').nth(3); await swipe(p, d, 70, 3, 8);
    T.ok(await d.evaluate(e => e.classList.contains('o')), '快速轻扫（距离不到一半）也能展开');
    T.ok((await p.evaluate(() => __feel.log)).includes('snap'), '展开时有"吸附"反馈');
    await p.ctx.close();
  });
  await T.group('M2 通知左滑：标记已读/删除', async () => {
    const p = await T.open();
    await p.click('[data-a=notif]'); await T.wait(450);
    const n1 = p.locator('.pn .swc').first(); T.ok(await p.locator('.pn .swc').count() === 4, '4 条通知都可左滑');
    const before = await p.evaluate(() => D.n[0].u);
    await swipe(p, n1, 150); await p.click('.pn .swa button[data-a=nrtog]');
    T.eq(await p.evaluate(() => D.n[0].u), before ? 0 : 1, '切换已读/未读');
    await swipe(p, p.locator('.pn .swc').first(), 150); await p.click('.pn .swa button[data-a=nrdel]');
    T.eq(await p.evaluate(() => D.n.length), 3, '删除一条通知'); T.ok(await p.locator('.pn').count() === 1, '删除后面板仍保持打开');
    T.eq(p.errors, [], '无报错'); await p.ctx.close();
  });
};
