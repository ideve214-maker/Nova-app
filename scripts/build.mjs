// 把 src/ 里的分段文件按文件名顺序拼成单个 HTML：dist/nova_v5.html
//
// 部署选项（Capacitor 把此 HTML 打进壳、API 在另一域名时使用）：
//   node scripts/build.mjs --api-base=https://api.example.com --disable-demo
//   或环境变量 NOVA_API_BASE、NOVA_DISABLE_DEMO=1
// 也可不重新构建，在主脚本之前放：
//   <script>window.NOVA_API_BASE='https://api.example.com';window.NOVA_DISABLE_DEMO=true;</script>
// window 上已有的值优先（构建注入用 ||，不会覆盖页面里先写的配置）。
import fs from 'node:fs';

export function parseBuildOpts(argv = process.argv.slice(2), env = process.env) {
  const get = (flag, envKey) => {
    const eq = argv.find(a => a.startsWith('--' + flag + '='));
    if (eq) return eq.slice(flag.length + 3);
    const i = argv.indexOf('--' + flag);
    if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('-')) return argv[i + 1];
    if (i >= 0) return '1';
    return (env && env[envKey]) || '';
  };
  const apiBase = String(get('api-base', 'NOVA_API_BASE') || '').trim().replace(/\/+$/, '');
  const raw = String(get('disable-demo', 'NOVA_DISABLE_DEMO') || '').trim().toLowerCase();
  const disableDemo = ['1', 'true', 'yes', 'on'].includes(raw);
  return {apiBase, disableDemo};
}

export function build({apiBase = '', disableDemo = false, destDir} = {}) {
  const dir = new URL('../src/', import.meta.url);
  const files = fs.readdirSync(dir).sort();
  const head = files.filter(f => f.endsWith('.html')).map(f => fs.readFileSync(new URL(f, dir), 'utf8')).join('');
  const js = files.filter(f => f.endsWith('.js')).map(f => `/* ===== ${f} ===== */\n` + fs.readFileSync(new URL(f, dir), 'utf8')).join('\n');
  const cfg = [];
  cfg.push('/* 部署配置：页面里若已设置 window.NOVA_*，以其为准。 */');
  if (apiBase) cfg.push('window.NOVA_API_BASE = window.NOVA_API_BASE || ' + JSON.stringify(apiBase) + ';');
  if (disableDemo) cfg.push('window.NOVA_DISABLE_DEMO = window.NOVA_DISABLE_DEMO === undefined ? true : window.NOVA_DISABLE_DEMO;');
  const configScript = cfg.length > 1 ? '<script>\n' + cfg.join('\n') + '\n</script>\n' : '';
  const out = head.replace(/\n?$/, '\n') + '<div id="app"><div id="v"></div><div id="tt" role="status"></div></div>\n' + configScript + '<script>\n' + js + '\n</script></body></html>\n';
  const destRoot = destDir ? (destDir.endsWith('/') || destDir.endsWith('\\') ? destDir : destDir + '/') : new URL('../dist/', import.meta.url);
  const destPath = typeof destRoot === 'string' ? destRoot : destRoot;
  if (typeof destRoot === 'string') {
    fs.mkdirSync(destRoot, {recursive: true});
    fs.writeFileSync(destRoot + (destRoot.endsWith('/') ? '' : '/') + 'nova_v5.html', out);
  } else {
    fs.mkdirSync(destRoot, {recursive: true});
    fs.writeFileSync(new URL('nova_v5.html', destRoot), out);
  }
  const assets = new URL('../assets/', import.meta.url);
  const destAssets = typeof destRoot === 'string' ? destRoot + (destRoot.endsWith('/') ? '' : '/') + 'assets/' : new URL('../dist/assets/', import.meta.url);
  if (typeof destRoot !== 'string') {
    fs.mkdirSync(destAssets, {recursive: true});
    for (const f of fs.readdirSync(assets)) {
      if (/\.(jpe?g|png|webp)$/i.test(f)) fs.copyFileSync(new URL(f, assets), new URL(f, destAssets));
    }
  }
  return {html: out, apiBase, disableDemo, bytes: out.length};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = build(parseBuildOpts());
  console.log('built dist/nova_v5.html', r.bytes, 'bytes');
}
