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
