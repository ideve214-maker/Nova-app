import {mkdirSync} from 'node:fs';
import {createApp} from '../server/index.mjs';
import {createRequire} from 'node:module';
const {chromium} = createRequire(import.meta.url)('playwright');

const OUT = '/workspace/nova/m72_shots';
mkdirSync(OUT, {recursive: true});

const srv = createApp({adminUsername: 'shot_adm', adminPassword: 'ShotAdmPass1'});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + srv.address().port;
const browser = await chromium.launch({args: ['--no-sandbox']});
const page = await browser.newPage({viewport: {width: 390, height: 844}, deviceScaleFactor: 2});
page.on('pageerror', e => console.error('pageerror', e));

async function shot(name) {
  await page.waitForTimeout(250);
  await page.screenshot({path: OUT + '/' + name, fullPage: false});
  console.log('wrote', name);
}

try {
  await page.goto(base + '/');
  await page.waitForSelector('#gate');
  await shot('00_login.png');

  await page.click('[data-a=authpane][data-v=reg]');
  await page.waitForSelector('[data-a=agreetog]');
  await shot('00b_register.png');

  const demo = page.locator('[data-a=authdemo]');
  if (await demo.count()) {
    await demo.click();
  } else {
    await page.click('[data-a=authpane][data-v=login]');
    await page.click('[data-a=authpane][data-v=reg]');
    await page.fill('[data-d=ru]', 'shotuser');
    await page.fill('[data-d=re]', 'shot@x.test');
    await page.fill('[data-d=rpw]', 'Passw0rd123');
    await page.fill('[data-d=rpw2]', 'Passw0rd123');
    await page.click('[data-a=agreetog]');
    await page.click('[data-a=authgo]');
  }
  await page.waitForSelector('nav');
  await shot('01_home.png');

  await page.click('nav [data-v=chat]');
  await page.waitForTimeout(300);
  await shot('02_chat.png');
  const firstConv = page.locator('[data-a=conv], [data-a=unhide]').first();
  if (await firstConv.count()) {
    await firstConv.click();
    await page.waitForTimeout(300);
    await shot('02b_chat_detail.png');
    const back = page.locator('[data-a=back]').first();
    if (await back.count()) await back.click();
  }

  await page.click('nav [data-v=cm]');
  await page.waitForTimeout(300);
  await shot('06_community.png');

  await page.click('nav [data-v=me]');
  await page.waitForTimeout(300);
  await shot('03_profile.png');

  const setBtn = page.locator('.pf [data-a=go][data-v=set], .pb[data-a=go][data-v=set]').first();
  if (await setBtn.count()) {
    await setBtn.click();
    await page.waitForTimeout(300);
    await shot('05_settings.png');
    const light = page.locator('[data-a=theme][data-v=light]');
    if (await light.count()) {
      await light.click();
      await page.waitForTimeout(300);
      await shot('05b_settings_light.png');
      await page.click('[data-a=theme][data-v=dark]');
    }
    const privacy = page.locator('[data-a=legal][data-v=privacy]');
    if (await privacy.count()) {
      await privacy.click();
      await page.waitForTimeout(400);
      await shot('05c_privacy.png');
      const bk = page.locator('[data-a=back]').first();
      if (await bk.count()) await bk.click();
    }
    const sec = page.locator('#secrow, [data-a=sec]');
    if (await sec.count()) {
      await sec.click();
      await page.waitForTimeout(300);
      await shot('05d_security_delete.png');
      const bk = page.locator('[data-a=back]').first();
      if (await bk.count()) await bk.click();
    }
  }

  const vip = page.locator('.pf [data-a=vip], [data-a=vip]').first();
  if (await vip.count()) {
    await vip.click();
    await page.waitForTimeout(400);
    await shot('04_vip.png');
  }

  // legal html page
  await page.goto(base + '/legal/privacy');
  await page.waitForSelector('h1, h2');
  await shot('07_legal_privacy.png');
  await page.goto(base + '/legal/terms');
  await page.waitForSelector('h1, h2');
  await shot('07b_legal_terms.png');
} finally {
  await browser.close();
  srv.close();
}
console.log('done', OUT);
