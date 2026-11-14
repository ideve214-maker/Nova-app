// M2.4.5 香槟金主题 / 会员标识 / 资料预览浏览器测试（真实页面 + 真实服务器）。
// 可读性：直接读浏览器算出来的颜色，按 WCAG 对比度公式计算，香槟金下的文字对比度必须 ≥ 4.5。
import test from 'node:test';
import assert from 'node:assert/strict';
import {startServer, openPage, register, launch, overflowX} from './ui-helpers.mjs';

let browser;
const SHOT = new URL('../../screenshots/', import.meta.url).pathname;
test.before(async () => { browser = await launch(); });
test.after(async () => { await browser.close(); });

const lum = ([r, g, b]) => { const f = c => { c /= 255; return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + .05) / (y + .05); };
const rgbs = str => [...String(str).matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)/g)].map(m => [+m[1], +m[2], +m[3]]);
const parse = c => rgbs(c)[0];

// 在页面里造一个临时元素，读它真实算出的前景/背景色；背景是渐变时取每个色标，取最差的一个。
const worst = (page, html, {fg = 'color', bgOf} = {}) => page.evaluate(([html, bgOf]) => {
  const host = document.createElement('div'); host.innerHTML = html; document.querySelector('#app').appendChild(host);
  const el = host.firstElementChild, bgEl = bgOf ? host.querySelector(bgOf) : el, tgt = bgOf ? host.querySelector(bgOf) : el;
  const cs = getComputedStyle(tgt); const out = {color: cs.color, bg: cs.backgroundColor, img: cs.backgroundImage};
  host.remove(); return out;
}, [html, bgOf]);
const pair = async (page, html) => { const o = await worst(page, html); const stops = rgbs(o.img); const bgs = stops.length ? stops : [parse(o.bg)]; return Math.min(...bgs.map(b => ratio(parse(o.color), b))); };
const cssVar = (page, name) => page.evaluate(n => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
const varRatio = async (page, fgVar, bgVar) => {
  const [f, b] = await Promise.all([cssVar(page, fgVar), cssVar(page, bgVar)]);
  const tmp = await page.evaluate(([f, b]) => { const e = document.createElement('i'); e.style.cssText = `color:${f};background:${b}`; document.body.appendChild(e); const cs = getComputedStyle(e), r = [cs.color, cs.backgroundColor]; e.remove(); return r; }, [f, b]);
  return ratio(parse(tmp[0]), parse(tmp[1]));
};
const goCenter = async p => { await p.click('nav [data-v=me]'); await p.click('#v [data-a=vip]'); await p.waitForSelector('#vipc .vp[data-vs]:not([data-vs=loading])'); };
const goProfile = async p => { await p.click('[data-a=back]'); };
const attr = p => p.evaluate(() => document.documentElement.dataset.vip || '');
const ac = p => cssVar(p, '--ac');

test('M2.4.5 Basic：没有香槟金主题；资料预览并排显示普通 / 香槟金两种样子', async () => {
  const S = await startServer(); const p = await openPage(browser, S.base);
  try {
    await register(p, 'gold_basic');
    assert.equal(await attr(p), '', '未开通时不应有香槟金');
    await goCenter(p);
    assert.equal(await attr(p), '');
    assert.equal(await p.locator('#vtheme .gpv').count(), 2);
    assert.equal(await p.locator('#vtheme .gpv.n .vip').count(), 0, '普通预览里没有 VIP 标识');
    assert.equal(await p.locator('#vtheme .gpv.g .vip').count(), 1, '香槟金预览里有 VIP 标识');
    assert.equal(await p.locator('[data-a=vtheme]').count(), 0, 'Basic 没有主题切换按钮');
    assert.match(await p.innerText('#vtheme'), /普通主题[\s\S]*香槟金主题/);
    assert.match(await p.innerText('.vtn[data-vt]'), /预览仅作示意/);
    // 预览是真实配色：两张卡的强调色必须不同，并且普通预览保持原蓝色
    const acs = await p.evaluate(() => ['.gpv.n', '.gpv.g'].map(s => getComputedStyle(document.querySelector(s + ' .gb')).backgroundColor));
    assert.notEqual(acs[0], acs[1]); assert.equal(acs[0], 'rgb(45, 136, 255)');
    assert.ok(await overflowX(p) <= 0, '390px 无横向溢出');
    await p.screenshot({path: SHOT + 'm245-preview-basic.png'});
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); await S.close(); }
});

test('M2.4.5 开发环境：切到 VIP 立即换成香槟金，切回普通立即恢复原主题；深色/浅色都过 WCAG 对比度', async () => {
  const S = await startServer({env: 'development'}); const p = await openPage(browser, S.base);
  try {
    await register(p, 'gold_dev');
    const original = await ac(p); assert.equal(original, '#2D88FF');
    await goCenter(p);
    await p.click('[data-a=viptoggle][data-v="1"]');
    await p.waitForSelector('#vipc .vp[data-vs=active]');
    assert.equal(await attr(p), 'gold', '切换后立即生效，无需刷新');
    assert.equal((await ac(p)).toUpperCase(), '#D6B86F');
    assert.match(await p.innerText('.vtn[data-vt=gold]'), /当前正在使用香槟金主题/);
    await p.screenshot({path: SHOT + 'm245-gold-dark-center.png'});

    // 深色 + 香槟金：对比度
    const check = async (label, min = 4.5) => {
      assert.ok(await pair(p, '<button class="pb">x</button>') >= min, label + ' 主按钮文字');
      assert.ok(await varRatio(p, '--ac', '--bg') >= min, label + ' 强调色文字 / 页面底');
      assert.ok(await varRatio(p, '--ac', '--sf') >= min, label + ' 强调色文字 / 卡片底');
      assert.ok(await varRatio(p, '--ac', '--s2') >= min, label + ' 强调色文字 / 次级底');
      assert.ok(await varRatio(p, '--vip', '--sf') >= min, label + ' VIP 文字 / 卡片底');
      assert.ok(await varRatio(p, '--onac', '--ac') >= min, label + ' 强调色底上的文字');
      const bub = await worst(p, '<div class="me"><div class="bub">x</div></div>', {bgOf: '.bub'});
      assert.ok(ratio(parse(bub.color), parse(bub.bg)) >= min, label + ' 自己发的聊天气泡');
      assert.ok(await pair(p, '<i class="vip">VIP</i>') >= min, label + ' VIP 标识文字 / 渐变底（取最差色标）');
    };
    await check('深色+香槟金');
    // 浅色 + 香槟金
    await p.click('[data-a=back]'); await p.click('#v [data-a=go][data-v=set]');
    await p.click('[data-a=theme][data-v=light]');
    assert.equal(await attr(p), 'gold', '换深/浅色不影响香槟金');
    assert.equal((await ac(p)).toUpperCase(), '#7A5A10');
    await check('浅色+香槟金');
    await p.waitForTimeout(900);
    await p.screenshot({path: SHOT + 'm245-gold-light-settings.png'});
    await p.click('[data-a=theme][data-v=dark]');

    // 个人资料里有 VIP 标识
    await p.click('[data-a=back]');
    assert.equal(await p.locator('#v .pf2 h2 .vip').count(), 1, '我的主页名字旁有 VIP 标识');
    assert.equal((await p.getAttribute('#v .pf2 h2 .vip', 'aria-label')), 'VEXO VIP 会员');
    await p.waitForTimeout(900);   // 等页面转场和提示条结束再截图
    await p.screenshot({path: SHOT + 'm245-gold-profile.png'});

    // 刷新后仍是香槟金（来自服务端状态，不是本机记录）
    await p.reload(); await p.waitForSelector('nav');
    await p.waitForFunction(() => document.documentElement.dataset.vip === 'gold');

    // 切回普通模式：原主题恢复、标识消失
    await goCenter(p);
    await p.click('[data-a=viptoggle][data-v="0"]');
    await p.waitForSelector('#vipc .vp[data-vs=none]');
    assert.equal(await attr(p), '', '切回普通立即恢复');
    assert.equal(await ac(p), original, '恢复的是原来的蓝色，不是别的颜色');
    assert.equal(await p.locator('#vtheme .gpv.g .vip').count(), 1, '预览仍可看');
    await p.click('[data-a=back]');
    assert.equal(await p.locator('#v .pf2 h2 .vip').count(), 0, '普通模式下资料里没有 VIP 标识');
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); await S.close(); }
});

test('M2.4.5 VIP 可以选「默认」主题：偏好刷新后保留；退出登录清除；到期后回落、偏好保留', async () => {
  let t = Date.now();
  const S = await startServer({env: 'development', clock: () => t}); const p = await openPage(browser, S.base);
  try {
    await register(p, 'gold_pref');
    await goCenter(p); await p.click('[data-a=viptoggle][data-v="1"]'); await p.waitForSelector('#vipc .vp[data-vs=active]');
    assert.equal(await attr(p), 'gold');
    await p.click('[data-a=vtheme][data-v=off]');
    assert.equal(await attr(p), '', '选默认立即生效');
    assert.equal(await p.getAttribute('[data-a=vtheme][data-v=off]', 'aria-pressed'), 'true');
    assert.equal(await ac(p), '#2D88FF');
    assert.match(await p.innerText('.vtn[data-vt=default]'), /你选择了默认主题/);
    assert.equal(await p.locator('#vipc .vp[data-vs=active]').count(), 1, '仍是 VIP，只是不用金色');
    await p.reload(); await p.waitForSelector('nav');
    assert.equal(await attr(p), '', '刷新后偏好保留');
    await p.click('nav [data-v=me]'); assert.equal(await p.locator('#v .pf2 h2 .vip').count(), 1, 'VIP 标识不受主题偏好影响');
    // 切回香槟金
    await p.click('#v [data-a=vip]'); await p.waitForSelector('#vipc .vp[data-vs=active]');
    await p.click('[data-a=vtheme][data-v=gold]'); assert.equal(await attr(p), 'gold');
    // 退出登录：登录页不带金色
    await p.click('[data-a=back]'); await p.click('#v [data-a=go][data-v=set]'); await p.click('#v [data-a=logout]');
    await p.waitForSelector('#gate'); assert.equal(await attr(p), '', '退出后恢复默认');
    // 时间走到到期之后：服务端不再返回有效 VIP，主题回落；偏好仍在
    t += 864e5 * 31;
    await p.fill('[data-d=ac]', 'gold_pref'); await p.fill('[data-d=pw]', 'Passw0rd123'); await p.click('[data-a=authgo]');
    await p.waitForSelector('nav'); await goCenter(p);
    assert.equal(await p.getAttribute('#vipc .vp[data-vs]', 'data-vs'), 'expired');
    assert.equal(await attr(p), '', '到期后立即回落默认主题');
    assert.equal(await p.locator('[data-a=vtheme]').count(), 0);
    assert.deepEqual(p.errors, []);
  } finally { await p.context().close(); await S.close(); }
});

test('M2.4.5 伪造无效：生产环境即使改页面属性、改本机数据，渲染也会按服务端状态恢复', async () => {
  const S = await startServer(); const p = await openPage(browser, S.base);
  try {
    await register(p, 'gold_fake');
    await p.evaluate(() => { document.documentElement.dataset.vip = 'gold'; D.st.vt = 1; render(); });
    assert.equal(await attr(p), '', '服务端说不是 VIP，下一次渲染就把金色去掉');
    await p.evaluate(() => { D.u.me[5] = 1; render(); });
    await goCenter(p);
    assert.equal(await attr(p), '');
    assert.equal(await p.locator('[data-a=vtheme]').count(), 0);
  } finally { await p.context().close(); await S.close(); }
});
