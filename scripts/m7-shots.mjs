import {mkdirSync} from 'node:fs';
import {createApp} from '../server/index.mjs';
import {createRequire} from 'node:module';
const {chromium} = createRequire('/workspace/nova-admin/app/package.json')('playwright');

const OUT = '/workspace/nova/redesign_shots';
mkdirSync(OUT, {recursive: true});

const srv = createApp({adminUsername: 'shot_adm', adminPassword: 'ShotAdmPass1'});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + srv.address().port;
const browser = await chromium.launch({args: ['--no-sandbox', '--disable-dev-shm-usage']});
const page = await browser.newPage({viewport: {width: 390, height: 844}, deviceScaleFactor: 2});
page.on('pageerror', e => console.error('pageerror', e.message));

async function shot(name) {
  await page.waitForTimeout(400);
  await page.screenshot({path: OUT + '/' + name, fullPage: false});
  console.log('wrote', name);
}

try {
  await page.goto(base + '/', {waitUntil: 'domcontentloaded', timeout: 20000});
  await page.waitForSelector('#gate, nav', {timeout: 15000});
  const demo = page.locator('[data-a=authdemo]');
  if (await demo.count()) {
    await demo.click();
  } else if (await page.locator('#gate').count()) {
    await page.click('[data-a=authpane][data-v=reg]');
    await page.fill('[data-d=ru]', 'shotuser');
    await page.fill('[data-d=re]', 'shot@x.test');
    await page.fill('[data-d=rpw]', 'Passw0rd123');
    await page.fill('[data-d=rpw2]', 'Passw0rd123');
    const ag = page.locator('[data-a=agreetog]');
    if (await ag.count()) await ag.click();
    await page.click('[data-a=authgo]');
  }
  await page.waitForSelector('nav', {timeout: 15000});
  await shot('01_home.png');

  const comp = page.locator('[data-a=compose]').first();
  await comp.click();
  await page.waitForSelector('.compose-pg, textarea.cta, [data-d=pin]', {timeout: 8000});
  await shot('02_composer.png');

  const cancel = page.locator('[data-a=compx], [data-a=back]').first();
  if (await cancel.count()) await cancel.click();
  await page.waitForTimeout(200);

  await page.click('nav [data-v=me]');
  await page.waitForTimeout(500);
  await shot('03_profile.png');
} catch (e) {
  console.error('SHOT_FAIL', e);
  try { await page.screenshot({path: OUT + '/fail.png'}); } catch {}
  process.exitCode = 1;
} finally {
  await browser.close();
  srv.close();
}
