// 浏览器测试共用工具：启动真实服务器 + 无头 Chromium，走真实页面。
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {createApp} from '../index.mjs';
const {chromium} = createRequire(import.meta.url)('playwright');   // 兼容 NODE_PATH 全局安装

export async function startServer(opts = {}) {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'nova-ui-')), 't.db');
  const srv = createApp({dbPath, ...opts});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return {srv, base: 'http://127.0.0.1:' + srv.address().port, close: () => new Promise(r => { srv.close(r); srv.closeAllConnections?.(); })};
}
export async function openPage(browser, base, {width = 390, height = 844, storage} = {}) {
  const ctx = await browser.newContext({viewport: {width, height}, deviceScaleFactor: 1});
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errors.push(m.text()); });
  await page.goto(base + '/');
  await page.waitForSelector('#gate');
  return page;
}
export async function register(page, name, email = name + '@x.test', pw = 'Passw0rd123') {
  await page.click('[data-a=authpane][data-v=reg]');
  await page.fill('[data-d=ru]', name); await page.fill('[data-d=re]', email);
  await page.fill('[data-d=rpw]', pw); await page.fill('[data-d=rpw2]', pw);
  await page.click('[data-a=authgo]');
  await page.waitForSelector('nav');
}
export const launch = () => chromium.launch({args: ['--no-sandbox']});
export const overflowX = page => page.evaluate(() => Math.max(document.documentElement.scrollWidth - innerWidth, ...[...document.querySelectorAll('.sc')].map(e => e.scrollWidth - e.clientWidth)));
