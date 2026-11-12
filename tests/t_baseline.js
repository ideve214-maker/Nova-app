// 回归：V5 原有行为不能被破坏
const T = require('./lib');
module.exports = async () => {
  await T.group('基线：四个主导航与首页', async () => {
    const p = await T.open();
    T.eq((await p.locator('nav button').allInnerTexts()).map(s => s.replace(/\s*\d+$/, '')), ['首页', '社区', '聊天', '我的'], '底栏顺序 首页|社区|聊天|我的（聊天可带未读角标）');
    T.ok(await p.locator('.card').count() >= 5, '首页有帖子');
    await p.click('[data-a=feed][data-v=follow]'); T.ok(await p.locator('.card').count() > 0, '关注栏有内容');
    await p.click('nav [data-v=cm]'); await T.wait(450); T.ok(await p.locator('#v .top h1').innerText() === '社区', '进入社区');
    await p.click('nav [data-v=chat]'); T.ok(await p.locator('.ban').count() === 1, '聊天页显示"演示模式·未加密"');
    await p.click('nav [data-v=me]'); await T.wait(450); T.ok((await p.locator('#v .top h1').innerText()).startsWith('@'), '进入我的');
    T.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '无横向溢出');
    T.eq(p.errors, [], '无控制台报错'); T.eq(p.reqs, [], '无网络请求');
    await p.ctx.close();
  });
  await T.group('基线：发帖/表态/评论', async () => {
    const p = await T.open();
    await p.click('[data-a=compose].p'); await p.fill('[data-d=pin]', '测试帖子一'); await p.click('[data-a=pub]'); await T.wait(450);
    T.ok((await p.locator('.card .bd').first().innerText()).includes('测试帖子一'), '新帖置顶');
    await p.click('.card [data-a=post]', { timeout: 2000 }).catch(() => {});
    await p.evaluate(() => { A.post('p3'); render(); }); await T.wait(450);
    await p.fill('[data-d=cin]', '一条评论'); await p.click('[data-a=cs]'); T.ok((await p.content()).includes('一条评论'), '评论成功');
    T.eq(p.errors, [], '无报错'); await p.ctx.close();
  });
  await T.group('基线：社区加入/退出/创建', async () => {
    const p = await T.open();
    await p.click('nav [data-v=cm]'); await p.click('[data-a=cmseg][data-v=d]');
    await p.click('.pb[data-a=join]'); T.ok(await p.evaluate(() => D.cm.find(c => c.id == 'cm_game').j) == 1, '加入社区');
    await p.evaluate(() => { A.leave('cm_game'); render(); }); await p.click('[data-a=leave2]'); T.ok(await p.evaluate(() => !D.cm.find(c => c.id == 'cm_game').j), '退出社区');
    await p.evaluate(() => { A.newcm(); render(); }); await p.fill('[data-d=cn]', '新社区A'); await p.click('[data-a=mkcm]');
    T.ok(await p.evaluate(() => D.cm.some(c => c.n == '新社区A')), '创建社区');
    await p.ctx.close();
  });
  await T.group('基线：聊天发送/群聊/持久化', async () => {
    const p = await T.open();
    await p.evaluate(() => { A.conv('cv_zhou'); render(); }); await T.wait(400);
    await p.fill('[data-d=chin]', '你好'); await p.click('[data-a=send]');
    T.ok(await p.evaluate(() => D.m.cv_zhou.at(-1)[4]) == '你好', '发送消息');
    await p.evaluate(() => { S.st = []; S.tab = 'chat'; render(); });
    await p.evaluate(() => { A.newg(); render(); }); await p.fill('[data-d=gn]', '测试群'); await p.click('[data-a=gsel][data-v=zhou]'); await p.click('[data-a=mkg]');
    T.ok(await p.evaluate(() => D.cv.some(c => c.n == '测试群' && c.g)), '创建群聊');
    await p.reload(); await p.waitForSelector('nav');
    T.ok(await p.evaluate(() => D.cv.some(c => c.n == '测试群')), '刷新后数据仍在(localStorage)');
    await p.ctx.close();
  });
  await T.group('基线：聊天行左滑露出操作', async () => {
    const p = await T.open();
    await p.click('nav [data-v=chat]'); await T.wait(400);
    const b = await p.locator('.swc').first().boundingBox();
    await p.mouse.move(b.x + 300, b.y + 30); await p.mouse.down(); await p.mouse.move(b.x + 200, b.y + 32, { steps: 6 }); await p.mouse.move(b.x + 100, b.y + 32, { steps: 6 }); await p.mouse.up(); await T.wait(300);
    T.ok(await p.locator('.swc.o').count() === 1, '左滑后该行展开');
    T.ok(await p.locator('.swc.o').first().evaluate(e => e.parentElement.querySelectorAll('.swa button').length) >= 3, '露出置顶/静音/隐藏等按钮');
    await p.ctx.close();
  });
  await T.group('基线：设置开关', async () => {
    const p = await T.open();
    await p.evaluate(() => { A.go('set'); render(); }); await T.wait(450);
    await p.click('[data-a=theme][data-v=light]'); T.eq(await p.evaluate(() => document.documentElement.dataset.theme), 'light', '浅色主题');
    await p.click('[data-a=sound]'); T.eq(await p.evaluate(() => D.st.sound), 0, '关闭音效');
    await p.click('[data-a=haptic]'); T.eq(await p.evaluate(() => D.st.haptic), 0, '关闭震动');
    await p.ctx.close();
  });
};
