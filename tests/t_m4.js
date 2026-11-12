// M4 消息置顶 + @所有人
const T = require('./lib');
module.exports = async () => {
  await T.group('M4 群主：置顶栏、取消/新增置顶、多条轮播', async () => {
    const p = await T.open();
    await p.click('nav [data-v=chat]'); await T.wait(400);
    T.ok((await p.locator('#xl').innerText()).includes('[@所有人]'), '会话列表对未读的@所有人有红色标记');
    await p.evaluate(() => { A.conv('cv_read'); render(); }); await T.wait(500);
    T.ok(await p.locator('.pinb').count() === 1, '群里显示置顶消息栏');
    T.ok((await p.locator('.pinb').innerText()).includes('明天继续读短句'), '置顶栏显示被置顶消息内容');
    T.ok(await p.locator('.bub .at.all').count() === 1, '@所有人 在消息里高亮');
    T.ok((await p.locator('.bub .pnt').count()) === 1, '被置顶的消息带📌标记');
    await p.click('.bub:has(.pnt)'); T.ok(await p.locator('.pn [data-a=unpinm]').count() === 1, '点消息弹出菜单，群主可"取消置顶"');
    await p.click('.pn [data-a=unpinm]'); T.eq(await p.locator('.pinb').count(), 0, '取消置顶后置顶栏消失');
    const first = p.locator('.mr[data-mid]').first(); await first.locator('.bub').click(); await p.click('.pn [data-a=pinm]');
    T.eq(await p.evaluate(() => pinned('cv', 'cv_read').length), 1, '置顶一条消息'); T.ok((await p.locator('.mr, .mt').last().innerText()).includes('置顶'), '群里出现"你置顶了一条消息"系统提示');
    await p.locator('.mr[data-mid]').nth(1).locator('.bub').click(); await p.click('.pn [data-a=pinm]');
    T.ok((await p.locator('.pinb').innerText()).includes('2'), '多条置顶显示 n/m');
    const before = (await p.locator('.pinb').innerText()); await p.click('.pinb'); await T.wait(300);
    T.ok(await p.locator('.flash').count() >= 1, '点击置顶栏跳到原消息并闪一下'); T.ok((await p.locator('.pinb').innerText()) !== before, '再点切换到下一条置顶');
    await p.reload(); await p.waitForSelector('nav'); T.eq(await p.evaluate(() => pinned('cv', 'cv_read').length), 2, '刷新后置顶仍在');
    T.eq(p.errors, [], '无报错'); await p.ctx.close();
  });
  await T.group('M4 @所有人：群主可发、成员被拦、人人可见高亮', async () => {
    const p = await T.open();
    await p.evaluate(() => { A.conv('cv_read'); render(); }); await T.wait(500);
    await p.click('[data-a=ment]'); T.ok(await p.locator('.pn [data-a=mins]:not([disabled])').count() >= 3, '群主的提及面板里有 @所有人 + 成员');
    await p.click('.pn [data-a=mins][data-v="chin|@所有人"]'); T.eq(await p.inputValue('[data-d=chin]'), '@所有人 ', '@所有人 被插入输入框');
    await p.fill('[data-d=chin]', '@所有人 周末见'); await p.click('[data-a=send]');
    T.eq(await p.locator('.bub .at.all').count(), 2, '发出的 @所有人 同样高亮'); T.ok((await p.locator('#tt').innerText()).includes('每位成员'), '提示已@所有人');
    await p.click('[data-a=ment]'); await p.click('.pn [data-a=mins][data-v="chin|@陈晚"]'); await p.click('[data-a=send]').catch(() => {});
    await p.fill('[data-d=chin]', '@陈晚 你好'); await p.click('[data-a=send]'); T.ok(await p.locator('.bub .at:not(.all)').count() >= 1, '@某人 高亮');
    await p.evaluate(() => { cvf('cv_read').own = 'chen'; render(); });
    await p.click('[data-a=ment]'); T.ok(await p.locator('.pn [data-v="chin|@所有人"][disabled]').count() === 1, '普通成员的 @所有人 选项被禁用并说明原因');
    await p.click('.ov'); await p.fill('[data-d=chin]', '@所有人 我也想喊'); const n0 = await p.evaluate(() => D.m.cv_read.length);
    await p.click('[data-a=send]'); T.eq(await p.evaluate(() => D.m.cv_read.length), n0, '成员发 @所有人 被拦截，消息没发出'); T.ok((await p.locator('#tt').innerText()).includes('只有群主和管理员'), '给出原因');
    await p.fill('[data-d=chin]', '普通一句'); await p.click('[data-a=send]'); T.eq(await p.evaluate(() => D.m.cv_read.length), n0 + 1, '普通消息照常发送');
    await p.evaluate(() => { cvf('cv_read').adm = ['me']; render(); }); await p.fill('[data-d=chin]', '@所有人 管理员也可以'); await p.click('[data-a=send]');
    T.eq(await p.evaluate(() => D.m.cv_read.length), n0 + 2, '被任命为管理员后可以@所有人');
    T.eq(p.errors, [], '无报错'); await p.ctx.close();
  });
  await T.group('M4 成员/管理员：置顶权限边界', async () => {
    const p = await T.open();
    await p.evaluate(() => { cvf('cv_walk').own = 'he'; A.conv('cv_walk'); render(); }); await T.wait(500);
    await p.locator('.mr[data-mid] .bub').first().click(); T.eq(await p.locator('.pn [data-a=pinm]').count(), 0, '普通成员的消息菜单没有"置顶"');
    T.ok(await p.locator('.pn [data-a=mcopy]').count() === 1, '但可以复制');
    await p.evaluate(() => { const m = D.m.cv_walk[0]; A.pinm('cv|cv_walk|' + m[5]); }); T.eq(await p.evaluate(() => pinned('cv', 'cv_walk').length), 0, '直接调用动作也不能越权置顶');
    await p.evaluate(() => { cvf('cv_walk').adm = ['me']; S.sh = null; render(); }); await p.locator('.mr[data-mid] .bub').first().click(); T.eq(await p.locator('.pn [data-a=pinm]').count(), 1, '成为管理员后出现"置顶"');
    await p.ctx.close();
  });
  await T.group('M4 社区频道：置顶 / @所有人 / 删除', async () => {
    const p = await T.open();
    await p.evaluate(() => { A.cm('cm_cafe'); render(); }); await T.wait(500);
    T.ok(await p.locator('.cm[data-mid]').count() >= 1, '社区消息带 ID');
    await p.locator('.cm[data-mid]').first().click(); await p.click('.pn [data-a=pinm]');
    T.eq(await p.locator('.pinb').count(), 1, '管理员置顶后频道出现置顶栏');
    await p.click('[data-a=ment]'); T.ok(await p.locator('.pn [data-a=mins][data-v="cmin|@所有人"]:not([disabled])').count() === 1, '管理员可@所有人'); await p.click('.ov');
    await p.fill('[data-d=cmin]', '@所有人 今晚见'); await p.click('[data-a=cmsend]'); T.ok(await p.locator('.cm .at.all').count() === 1, '频道里@所有人高亮');
    await p.locator('.cm[data-mid]').last().click(); T.ok(await p.locator('.pn [data-a=delmsg]').count() === 1, '自己的消息可删除'); await p.click('.pn [data-a=delmsg]');
    T.eq(await p.locator('.cm .at.all').count(), 0, '删除后消息消失');
    await p.evaluate(() => { S.st = []; A.cm('cm_read'); A.chan('cm_read|ch_read_ann'); render(); }); await T.wait(450);
    T.ok(await p.locator('.pinb').count() === 1, '种子：夜读角公告频道有置顶');
    await p.click('[data-a=ment]'); T.ok(await p.locator('.pn [data-v="cmin|@所有人"][disabled]').count() === 1, '版主可置顶但不能@所有人');
    await p.click('.ov'); await p.locator('.cm[data-mid]').first().click(); T.ok(await p.locator('.pn [data-a=unpinm]').count() === 1, '版主可取消置顶'); T.eq(await p.locator('.pn [data-a=delmsg]').count(), 1, '版主可删除他人消息');
    await p.click('.ov'); await p.evaluate(() => { S.st = []; A.cm('cm_walk'); render(); }); await T.wait(450);
    await p.locator('.cm[data-mid]').first().click(); T.eq(await p.locator('.pn [data-a=pinm]').count(), 0, '社区普通成员没有置顶'); T.eq(await p.locator('.pn [data-a=delmsg]').count(), 0, '也不能删别人的消息');
    T.eq(p.errors, [], '无报错'); await p.ctx.close();
  });
  await T.group('M4 安全：消息内容转义', async () => {
    const p = await T.open();
    await p.evaluate(() => { A.conv('cv_read'); render(); }); await T.wait(450);
    await p.fill('[data-d=chin]', '<img src=x onerror="window.__xss=1">@所有人'); await p.click('[data-a=send]'); await T.wait(200);
    T.eq(await p.evaluate(() => window.__xss || 0), 0, '恶意 HTML 不会执行'); T.eq(await p.locator('.bub img').count(), 0, '没有注入 img 元素');
    T.ok((await p.locator('.bub').last().innerText()).includes('<img'), '以文字形式原样显示'); await p.ctx.close();
  });
};
