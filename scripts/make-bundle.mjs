// 把 dist/ 打成热更新 zip，并打印 SHA-256 校验和。
// 用法：先 npm run build，再 node scripts/make-bundle.mjs
// zip 根目录含 index.html（由 nova_v5.html 复制）和 assets/，符合 Capgo 对清单包的要求。
import {createHash} from 'node:crypto';
import {mkdirSync, cpSync, copyFileSync, existsSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = String(pkg.version || '0.0.0');
const dist = join(root, 'dist');
const outDir = join(root, 'dist-bundles');
const outName = `nova-${version}.zip`;
const outPath = join(outDir, outName);

if (!existsSync(join(dist, 'nova_v5.html'))) {
  console.error('缺少 dist/nova_v5.html，请先运行 npm run build');
  process.exit(1);
}

const stage = join(tmpdir(), 'nova-bundle-' + process.pid);
rmSync(stage, {recursive: true, force: true});
mkdirSync(stage, {recursive: true});
cpSync(dist, stage, {
  recursive: true,
  filter: (src) => !src.split(/[/\\]/).some(p => p.startsWith('.') || p === 'node_modules'),
});
copyFileSync(join(stage, 'nova_v5.html'), join(stage, 'index.html'));
function requireDeployConfig(html) {
  const missing = [];
  if (!/window\.NOVA_API_BASE\s*=/.test(html)) missing.push('NOVA_API_BASE');
  if (!/window\.NOVA_DISABLE_DEMO\s*=/.test(html)) missing.push('NOVA_DISABLE_DEMO');
  if (!/window\.NOVA_UPDATE_MANIFEST_URL\s*=/.test(html)) missing.push('NOVA_UPDATE_MANIFEST_URL');
  if (missing.length) {
    console.error('热更新包缺少部署配置：' + missing.join(', ') + '。请先运行：node scripts/build.mjs --api-base=https://47.239.0.90 --disable-demo --update-manifest-url=https://47.239.0.90/updates/user/manifest.json');
    process.exit(1);
  }
}
requireDeployConfig(readFileSync(join(stage, 'index.html'), 'utf8'));

// 1.0.7 精简包（--lean 或 --games-base=...）：iOS 更新插件整段下载只有约 25 秒（responseTimeout 20 秒 + 5 秒），
// 7.6MB 的包在手机网络下下不完。去掉重复入口、未启用的 sentry、小游戏（改从服务器加载），皮肤里与品牌图相同的 logo 改为引用品牌图，
// 再压缩大图。原始 assets/ 不改动。
const argv = process.argv.slice(2);
const argOf = k => { const a = argv.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : ''; };
const gamesBase = argOf('games-base') || process.env.NOVA_GAMES_BASE || '';
const lean = argv.includes('--lean') || !!gamesBase;
if (lean) {
  rmSync(join(stage, 'nova_v5.html'), {force: true});
  let html = readFileSync(join(stage, 'index.html'), 'utf8');
  if (!/NOVA_BUGSINK_DSN\s*=/.test(html)) {
    html = html.replace('<script src="assets/vendor/sentry.js"></script>\n', '');
    rmSync(join(stage, 'assets/vendor/sentry.js'), {force: true});
  }
  if (gamesBase) {
    html = html.replace('<div id="app">', '<script>window.NOVA_GAMES_BASE = window.NOVA_GAMES_BASE || ' + JSON.stringify(gamesBase) + ';</script>\n<div id="app">');
    rmSync(join(stage, 'assets/games'), {recursive: true, force: true});
  }
  writeFileSync(join(stage, 'index.html'), html);
  const r = spawnSync('python3', [join(root, 'scripts/lean-assets.py'), stage], {stdio: 'inherit'});
  if (r.status !== 0) { console.error('精简资源失败'); process.exit(1); }
}

mkdirSync(outDir, {recursive: true});
if (existsSync(outPath)) rmSync(outPath);

function zipWithCli() {
  const r = spawnSync('zip', ['-r', '-X', '-9', outPath, '.'], {cwd: stage, stdio: 'inherit'});
  return r.status === 0;
}

function zipWithPython() {
  const py = `
import zipfile, os, sys
root, dest = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(dest, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for dirpath, dirs, files in os.walk(root):
        dirs[:] = sorted(d for d in dirs if not d.startswith('.'))
        for f in sorted(files):
            if f.startswith('.'):
                continue
            p = os.path.join(dirpath, f)
            z.write(p, os.path.relpath(p, root))
`;
  const r = spawnSync('python3', ['-c', py, stage, outPath], {stdio: 'inherit'});
  return r.status === 0;
}

if (!zipWithCli() && !zipWithPython()) {
  console.error('无法创建 zip（需要 zip 命令或 python3）');
  rmSync(stage, {recursive: true, force: true});
  process.exit(1);
}

const buf = readFileSync(outPath);
const checksum = createHash('sha256').update(buf).digest('hex');
const meta = {
  version,
  url: '',
  checksum,
  file: outName,
  bytes: buf.length,
};
writeFileSync(join(outDir, `nova-${version}.json`), JSON.stringify(meta, null, 2) + '\n');
rmSync(stage, {recursive: true, force: true});

console.log('bundle', outPath);
console.log('version', version);
console.log('bytes', buf.length);
console.log('checksum', checksum);
console.log('manifest stub', JSON.stringify({version, url: '<由 Dift 填写下载地址>', checksum}, null, 2));
