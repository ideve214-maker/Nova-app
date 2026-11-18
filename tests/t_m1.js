// M1 手感引擎
const T = require('./lib');
module.exports = async () => {
  await T.group('M1 转场：切 Tab / 推入 / 返回', async () => {
    const p = await T.open();
    await p.click('nav [data-v=cm]');
    T.ok(await p.locator('#app>.ghost').count() === 1, '切 Tab 时出现旧页面幽灵层');
    await T.wait(500); T.eq(await p.locator('#app>.ghost').count(), 0, '动画结束后幽灵层被清理');
    await p.click('nav [data-v=home]'); await T.wait(400);
    await p.evaluate(() => { A.post('p3'); render(); });
    const n = await p.locator('#app>.ghost').count(); T.ok(n === 1, '推入子页时旧页面作为幽灵层保留');
    const z = await p.evaluate(() => $('#v .pg').style.zIndex); T.eq(z, '2', '推入中新页面在上层');
    await T.wait(500); T.eq(await p.locator('#app>.ghost').count(), 0, '推入结束后清理');
    T.eq(await p.evaluate(() => $('#v .pg').style.cssText), '', '结束后页面无残留内联样式');
    await p.click('[data-a=back]'); T.ok(await p.locator('#app>.ghost').count() === 1, '返回时旧页面向右滑出');
    await T.wait(500); T.eq(await p.evaluate(() => S.st.length), 0, '返回成功');
    T.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '转场后无横向溢出');
    T.eq(p.errors, [], '无报错'); await p.ctx.close();
  });
  await T.group('M1 转场：只用 transform/opacity（性能约束）', async () => {
    const src = require('fs').readFileSync(__dirname + '/../src/65_feel.js', 'utf8');
    const frames = [...src.matchAll(/run\([^,]+,\[(.*?)\],\{/g)].map(m => m[1]).join(' ');
    T.ok(!/(width|height|left|top|margin|filter)\s*:/.test(frames), '动画关键帧不含触发布局/重绘的属性');
  });
  await T.group('M1 减少动态效果', async () => {
    let p = await T.open();
    await p.evaluate(() => { D.st.rm = 1; }); await p.click('nav [data-v=cm]');
    T.eq(await p.locator('#app>.ghost').count(), 0, '应用内开启后无转场层'); await p.ctx.close();
    p = await T.open({ reduced: true });
    await p.click('nav [data-v=cm]'); T.eq(await p.locator('#app>.ghost').count(), 0, '系统"减少动态效果"时无转场层'); await p.ctx.close();
  });
  await T.group('M1 面板打开/收起动画', async () => {
    const p = await T.open();
    await p.click('[data-a=compose].p'); T.ok(await p.locator('.pn').count() === 1, '发帖面板打开');
    await p.click('.ov'); T.ok(await p.locator('#app>.ghost').count() >= 1, '收起时有离场层'); await T.wait(450);
    T.eq(await p.locator('#app>.ghost').count(), 0, '离场层被清理');
    await p.click('[data-a=compose].p'); await p.fill('[data-d=pin]', 'x'); await p.click('[data-a=compose][aria-label=发帖]').catch(() => {});
    T.eq(p.errors, [], '无报错'); await p.ctx.close();
  });
  await T.group('M1 触觉与音效', async () => {
    const p = await T.open();
    await p.click('nav [data-v=cm]'); T.ok((await p.evaluate(() => __feel.log)).includes('switch'), '切页记录"switch"反馈');
    T.ok(await p.evaluate(() => __vib.length) >= 1, '调用了 navigator.vibrate');
    await p.evaluate(() => { __vib.length = 0; D.st.haptic = 0; }); await p.click('nav [data-v=chat]');
    T.eq(await p.evaluate(() => __vib.length), 0, '关闭震动后不再振动');
    await p.evaluate(() => { D.st.haptic = 1; D.st.sound = 1; window.__ac = 0; });
    const used = await p.evaluate(() => { const A0 = window.AudioContext; let n = 0; window.AudioContext = class extends A0 { constructor() { super(); n++; } }; _ac = null; return new Promise(r => { feel('tap'); r(n); }); });
    T.ok(used >= 1, '开启音效时创建并使用 AudioContext');
    const none = await p.evaluate(() => { D.st.sound = 0; _ac = null; let n = 0; window.AudioContext = class { constructor() { n++; } }; feel('tap'); return n; });
    T.eq(none, 0, '关闭音效后不创建 AudioContext');
    await p.evaluate(() => { D.st.sound = 1; A.go('set'); render(); }); await T.wait(400);
    T.ok((await p.locator('.sc').innerText()).includes('振动'), '设置页诚实显示本设备触觉能力');
    await p.ctx.close();
  });
  await T.group('M1 触觉：短震、防抖、滚动不震', async () => {
    const p = await T.open();
    const first = await p.evaluate(() => { __feel.resetHaptic(); __vib.length = 0; D.st.haptic = 1; feel('tap'); return __vib.slice(); });
    T.ok(first.length === 1 && first[0] === 8, '非 iOS 降级为 8ms 短震：' + JSON.stringify(first));
    const burst = await p.evaluate(() => { __feel.resetHaptic(); __vib.length = 0; feel('tap'); feel('tap'); feel('tap'); return __vib.slice(); });
    T.eq(burst.length, 1, '连点防抖，只震动一次');
    await T.wait(80);
    const again = await p.evaluate(() => { feel('tap'); return __vib.slice(); });
    T.ok(again.length >= 2, '间隔后可以再次震动');
    const edge = await p.evaluate(() => { __vib.length = 0; feel('edge'); return { n: __vib.length, log: __feel.log.slice(-1)[0] }; });
    T.eq(edge.n, 0, '滚动/边缘回弹不震动');
    T.eq(edge.log, 'edge', 'edge 仍记入手感日志（可有音效）');
    const jsErr = p.errors.filter(e => !/skins\/index\.json|Failed to load resource|CORS policy/.test(e));
    T.eq(jsErr, [], '无 JS 报错');
    await p.ctx.close();
  });
  await T.group('M1 iPhone 触觉降级路径（不振动、不抛错）', async () => {
    const p = await T.open({ ua: T.IPHONE_UA, init: () => { window.__vib = []; Object.defineProperty(Navigator.prototype, 'vibrate', { value: function (x) { window.__vib.push(x); return true; }, configurable: true }); } });
    await p.click('nav [data-v=cm]');
    T.eq(await p.locator('label.hxl input[switch]').count(), 0, '不再使用隐藏 switch 触觉技巧');
    T.eq(await p.evaluate(() => __vib.length), 0, 'iOS 浏览器不调用 vibrate');
    T.eq(p.errors.filter(e => !/skins\/index\.json|Failed to load resource|CORS policy/.test(e)), [], 'Haptics 缺失时不抛错');
    const cap = await p.evaluate(() => FEEL.cap());
    T.ok(/安装包|不能振动/.test(cap), '设置页说明完整手感需要安装包：' + cap);
    await p.ctx.close();
  });
  await T.group('M1 Haptics 插件缺失时降级不抛错', async () => {
    const p = await T.open();
    const cap = await p.evaluate(() => {
      window.NovaNative = { Capacitor: { isNativePlatform: () => true, isPluginAvailable: () => false, PluginHeaders: [] } };
      __feel.resetHaptic();
      __vib.length = 0;
      D.st.haptic = 1;
      feel('tap');
      return { vib: __vib.slice(), cap: FEEL.cap() };
    });
    T.eq(p.errors.filter(e => !/skins\/index\.json|Failed to load resource|CORS policy/.test(e)), [], '原生壳没有 Haptics 插件时不抛错');
    T.ok(cap.vib.length >= 1, '非 iOS 降级为短震动');
    T.ok(cap.vib.every(v => v === 8 || (Array.isArray(v) && v.length === 1 && v[0] === 8)), '只有 8ms 短震，没有长震或振动模式：' + JSON.stringify(cap.vib));
    T.ok(cap.cap.includes('安装包'), '设置页说明完整手感需要下次出安装包：' + cap.cap);
    await p.ctx.close();
  });
  await T.group('M1 原生 Haptics 按按钮分级，绝不长震', async () => {
    const p = await T.open();
    const got = await p.evaluate(async () => {
      window.__hap = [];
      window.NovaNative = {
        Capacitor: { isNativePlatform: () => true, isPluginAvailable: (n) => n === 'Haptics', PluginHeaders: [{ name: 'Haptics' }] },
        ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' },
        NotificationType: { Success: 'SUCCESS', Warning: 'WARNING', Error: 'ERROR' },
        Haptics: {
          impact: (o) => { window.__hap.push(['impact', o && o.style]); return Promise.resolve(); },
          selectionStart: () => { window.__hap.push(['selectionStart']); return Promise.resolve(); },
          selectionChanged: () => { window.__hap.push(['selectionChanged']); return Promise.resolve(); },
          notification: (o) => { window.__hap.push(['notification', o && o.type]); return Promise.resolve(); },
          vibrate: (o) => { window.__hap.push(['vibrate', o]); return Promise.resolve(); }
        }
      };
      __vib.length = 0;
      D.st.haptic = 1;
      const run = (k) => new Promise(r => { feel(k); setTimeout(r, 60); });
      await run('switch'); await run('tap'); await run('like'); await run('fav'); await run('send'); await run('warn'); await run('success');
      return { hap: window.__hap, vib: __vib.slice() };
    });
    const kinds = got.hap.map(x => x.join(':'));
    T.ok(kinds.some(k => k.startsWith('selectionChanged') || k === 'selectionStart'), '切 Tab 走 selection：' + kinds.join(','));
    T.ok(kinds.includes('impact:LIGHT'), '普通/点赞/收藏走 Light impact');
    T.ok(kinds.includes('impact:MEDIUM'), '发送走 Medium impact');
    T.ok(kinds.some(k => k.startsWith('notification:')), '确认/删除走 notification');
    T.ok(!kinds.some(k => k.startsWith('vibrate')), '不调用 Haptics.vibrate 长震');
    T.eq(got.vib.length, 0, '有原生插件时不走 navigator.vibrate');
    T.eq(p.errors.filter(e => !/skins\/index\.json|Failed to load resource|CORS policy/.test(e)), [], '无 JS 报错');
    await p.ctx.close();
  });
  await T.group('M1 边缘右滑返回', async () => {
    const p = await T.open({ touch: true });
    await p.evaluate(() => { A.post('p3'); render(); }); await T.wait(500);
    let d = await T.drag(p, [[4, 400], [40, 402], [100, 402], [160, 402]]);
    T.ok(await p.locator('#app>.ghost').count() === 1, '拖动中露出下层页面');
    const tr = await p.evaluate(() => $('#v .pg').style.transform); T.ok(tr.includes('translate3d'), '当前页面跟手位移');
    await d.end(); await T.wait(500);
    T.eq(await p.evaluate(() => S.st.length), 0, '松手超过阈值后返回');
    T.eq(await p.locator('#app>.ghost').count(), 0, '返回后无残留层');
    await p.evaluate(() => { A.post('p3'); render(); }); await T.wait(500);
    d = await T.drag(p, [[4, 400], [30, 402], [60, 402]], 90); await d.end(); await T.wait(450);
    T.eq(await p.evaluate(() => S.st.length), 1, '拖得太短会回弹、不返回');
    T.eq(await p.evaluate(() => $('#v .pg').style.cssText), '', '回弹后无内联残留');
    d = await T.drag(p, [[200, 400], [260, 402], [330, 402]], 90); await d.end(); await T.wait(300);
    T.eq(await p.evaluate(() => S.st.length), 1, '从屏幕中间右滑不会触发返回');
    T.eq(p.errors, [], '无报错'); await p.ctx.close();
  });
  await T.group('M1 滚动阻尼（非 iOS）', async () => {
    const p = await T.open({ touch: true });
    const d = await T.drag(p, [[200, 300], [200, 330], [200, 380], [200, 460], [200, 560]]);
    const mid = await p.evaluate(() => $('#v .sc').style.transform);
    T.ok(/translate3d\(0px, [\d.]+px, 0px\)/.test(mid), '在顶部继续下拉，内容跟随并有阻尼：' + mid);
    const off = parseFloat(mid.split(',')[1]); T.ok(off > 20 && off < 130, '位移被压缩（手指 ≥ 230px，内容 ≤ 130px）：' + off);
    await d.end(); await T.wait(700);
    T.eq(await p.evaluate(() => $('#v .sc').style.transform), '', '松手后弹回原位');
    T.ok((await p.evaluate(() => __feel.log)).includes('edge'), '过阈值触发"edge"反馈');
    await p.ctx.close();
    const q = await T.open({ touch: true, ua: T.IPHONE_UA, init: () => { Object.defineProperty(Navigator.prototype, 'vibrate', { value: undefined, configurable: true }); } });
    const d2 = await T.drag(q, [[200, 300], [200, 400], [200, 500]]);
    T.eq(await q.evaluate(() => $('#v .sc').style.transform), '', 'iPhone 使用原生回弹，不叠加自定义阻尼'); await d2.end(); await q.ctx.close();
  });
};
