// 把 src/ 里的分段文件按文件名顺序拼成单个 HTML：dist/nova_v5.html
//
// 部署选项（Capacitor 把此 HTML 打进壳、API 在另一域名时使用）：
//   node scripts/build.mjs --api-base=https://api.example.com --disable-demo
//   或环境变量 NOVA_API_BASE、NOVA_DISABLE_DEMO=1
// 也可不重新构建，在主脚本之前放：
//   <script>window.NOVA_API_BASE='https://api.example.com';window.NOVA_DISABLE_DEMO=true;</script>
// window 上已有的值优先（构建注入用 ||，不会覆盖页面里先写的配置）。
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {vodozemacIife} from './embed-vodozemac.mjs';

export function parseBuildOpts(argv = process.argv.slice(2), env = process.env) {
  const get = (flag, envKey) => {
    const eq = argv.find(a => a.startsWith('--' + flag + '='));
    if (eq) return eq.slice(flag.length + 3);
    const i = argv.indexOf('--' + flag);
    if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('-')) return argv[i + 1];
    if (i >= 0) return '1';
    return (env && env[envKey]) || '';
  };
  const on = (flag, envKey) => ['1','true','yes','on'].includes(String(get(flag, envKey) || '').trim().toLowerCase());
  const apiBase = String(get('api-base', 'NOVA_API_BASE') || '').trim().replace(/\/+$/, '');
  const disableDemo = on('disable-demo', 'NOVA_DISABLE_DEMO');
  return {
    apiBase,
    disableDemo,
    secureTransport: on('secure-transport', 'NOVA_SECURE_TRANSPORT'),
    bugsink: on('bugsink', 'NOVA_BUGSINK'),
    bugsinkDsn: String(get('bugsink-dsn', 'NOVA_BUGSINK_DSN') || '').trim(),
    updateManifestUrl: String(get('update-manifest-url', 'NOVA_UPDATE_MANIFEST_URL') || '').trim(),
  };
}

function packageVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    return String(pkg.version || '').trim();
  } catch (e) {
    return '';
  }
}

export function build({apiBase = '', disableDemo = false, secureTransport = false, bugsink = false, bugsinkDsn = '', updateManifestUrl = '', destDir} = {}) {
  const dir = new URL('../src/', import.meta.url);
  const files = fs.readdirSync(dir).sort();
  const head = files.filter(f => f.endsWith('.html')).map(f => fs.readFileSync(new URL(f, dir), 'utf8')).join('');
  const appJs = files.filter(f => f.endsWith('.js')).map(f => `/* ===== ${f} ===== */\n` + fs.readFileSync(new URL(f, dir), 'utf8')).join('\n');
  const js = vodozemacIife() + '\n' + appJs;
  const cfg = [];
  cfg.push('/* 部署配置：页面里若已设置 window.NOVA_*，以其为准。 */');
  if (apiBase) cfg.push('window.NOVA_API_BASE = window.NOVA_API_BASE || ' + JSON.stringify(apiBase) + ';');
  if (disableDemo) cfg.push('window.NOVA_DISABLE_DEMO = window.NOVA_DISABLE_DEMO === undefined ? true : window.NOVA_DISABLE_DEMO;');
  if (secureTransport) cfg.push('window.NOVA_SECURE_TRANSPORT = window.NOVA_SECURE_TRANSPORT || "on";');
  if (bugsink) cfg.push('window.NOVA_BUGSINK = window.NOVA_BUGSINK || "on";');
  if (bugsinkDsn) cfg.push('window.NOVA_BUGSINK_DSN = window.NOVA_BUGSINK_DSN || ' + JSON.stringify(bugsinkDsn) + ';');
  const appVer = packageVersion();
  if (appVer) cfg.push('window.NOVA_APP_VERSION = window.NOVA_APP_VERSION || ' + JSON.stringify(appVer) + ';');
  if (updateManifestUrl) cfg.push('window.NOVA_UPDATE_MANIFEST_URL = window.NOVA_UPDATE_MANIFEST_URL || ' + JSON.stringify(updateManifestUrl) + ';');
  const configScript = cfg.length > 1 ? '<script>\n' + cfg.join('\n') + '\n</script>\n' : '';
  const here = dirname(fileURLToPath(import.meta.url));
  spawnSync(process.execPath, [join(here, 'bundle-vendor.mjs')], {stdio: 'inherit'});
  const vendor = [
    '<link rel="stylesheet" href="assets/vendor/photoswipe.css">',
    '<script src="assets/vendor/purify.min.js"></script>',
    '<script src="assets/vendor/dexie.min.js"></script>',
    '<script src="assets/vendor/photoswipe.js"></script>',
    '<script src="assets/vendor/pulltorefresh.min.js"></script>',
    '<script src="assets/vendor/virtual.js"></script>',
    '<script src="assets/vendor/sentry.js"></script>',
    '<script src="assets/vendor/nova-native.js"></script>',
  ].join('\n');
  const out = head.replace(/\n?$/, '\n') + vendor + '\n<div id="app"><div id="v"></div><div id="tt" role="status"></div></div>\n' + configScript + '<script>\n' + js + '\n</script></body></html>\n';
  const destRoot = destDir ? (destDir.endsWith('/') || destDir.endsWith('\\') ? destDir : destDir + '/') : new URL('../dist/', import.meta.url);
  const destPath = typeof destRoot === 'string' ? destRoot : destRoot;
  if (typeof destRoot === 'string') {
    fs.mkdirSync(destRoot, {recursive: true});
    const base = destRoot + (destRoot.endsWith('/') ? '' : '/');
    fs.writeFileSync(base + 'nova_v5.html', out);
    fs.writeFileSync(base + 'index.html', out);
  } else {
    fs.mkdirSync(destRoot, {recursive: true});
    fs.writeFileSync(new URL('nova_v5.html', destRoot), out);
    fs.writeFileSync(new URL('index.html', destRoot), out);
  }
  const assets = new URL('../assets/', import.meta.url);
  const destAssets = typeof destRoot === 'string' ? destRoot + (destRoot.endsWith('/') ? '' : '/') + 'assets/' : new URL('../dist/assets/', import.meta.url);
  const skip = new Set(['alipay.jpg', 'wechat.jpg']);
  const ok = /\.(jpe?g|png|webp|svg|css|json|html|md|js|mjs|woff2?|ttf|eot|mp3|ogg|wav|gif|ico)$/i;
  function copyTree(srcDir, destDir) {
    fs.mkdirSync(destDir, {recursive: true});
    for (const f of fs.readdirSync(srcDir, {withFileTypes: true})) {
      if (f.name.startsWith('.')) continue;
      const from = typeof srcDir === 'string' ? srcDir + (srcDir.endsWith('/') ? '' : '/') + f.name : new URL(f.name + (f.isDirectory() ? '/' : ''), srcDir);
      const to = typeof destDir === 'string' ? destDir + (destDir.endsWith('/') ? '' : '/') + f.name : new URL(f.name + (f.isDirectory() ? '/' : ''), destDir);
      if (f.isDirectory()) copyTree(from, typeof to === 'string' ? to + (to.endsWith('/') ? '' : '/') : new URL(f.name + '/', destDir));
      else if (!skip.has(f.name) && ok.test(f.name)) fs.copyFileSync(from, to);
    }
  }
  copyTree(assets, destAssets);
  return {html: out, apiBase, disableDemo, bytes: out.length};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = build(parseBuildOpts());
  console.log('built dist/nova_v5.html', r.bytes, 'bytes');
}
