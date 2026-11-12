import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/workspace/nova-theme/brand';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.css': 'text/css',
  '.png': 'image/png',
};

function serve(root, port) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    const fp = path.join(root, url);
    if (!fp.startsWith(root)) { res.writeHead(403); res.end(); return; }
    fs.readFile(fp, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found '+url); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => r(server)));
}

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none', '--disable-dev-shm-usage'],
});
const server = await serve(ROOT, 8770);

async function shot(page, url, w, h, dest, dsf = 1) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: dsf });
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 15000 });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await new Promise(r => setTimeout(r, 150));
  await page.screenshot({ path: dest, type: 'png', omitBackground: false, clip: { x: 0, y: 0, width: w, height: h } });
  console.log('wrote', dest, fs.statSync(dest).size);
}

try {
  const page = await browser.newPage();

  // Icons — full bleed and masked previews
  const icons = [
    ['/user/icon/icon.svg', 1024, 1024, ROOT + '/user/icon/icon-1024.png'],
    ['/user/icon/icon-masked.svg', 1024, 1024, ROOT + '/user/icon/icon-1024-masked.png'],
    ['/admin/icon/icon.svg', 1024, 1024, ROOT + '/admin/icon/icon-1024.png'],
    ['/admin/icon/icon-masked.svg', 1024, 1024, ROOT + '/admin/icon/icon-1024-masked.png'],
    ['/shared/nova-mark.svg', 512, 512, ROOT + '/shared/nova-mark-512.png'],
  ];
  for (const [u, w, h, d] of icons) {
    await shot(page, 'http://127.0.0.1:8770' + u, w, h, d, 1);
  }

  // Splashes at exact 1170x2532 (dsf=2 then we keep 2x AND 1x via a second pass)
  const splashes = [
    ['user', 'dark'], ['user', 'light'],
    ['admin', 'dark'], ['admin', 'light'],
  ];
  for (const [kind, theme] of splashes) {
    const url = `http://127.0.0.1:8770/${kind}/splash/splash-${theme}.svg`;
    const dest2x = `${ROOT}/${kind}/splash/splash-${theme}-1170x2532@2x.png`;
    const dest1x = `${ROOT}/${kind}/splash/splash-${theme}-1170x2532.png`;
    // 2x
    await shot(page, url, 1170, 2532, dest2x, 2);
    // 1x
    await shot(page, url, 1170, 2532, dest1x, 1);
  }

  await page.close();
} finally {
  await browser.close();
  server.close();
}
