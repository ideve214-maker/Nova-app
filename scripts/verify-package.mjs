#!/usr/bin/env node
// Post-build verification for a VEXO debug APK or unsigned IPA. Any failed
// check exits non-zero, which fails the CI job.
//
//   node scripts/verify-package.mjs --kind apk|ipa --file <pkg> --project <capacitor-project-dir>
//        --name <expected display name> --version-name 1.0.0 --version-code 100
//        --url <manifest URL that must be inside the package>
//        [--cert-sha256 <hex>]        (APK: expected signer certificate digest)
//        [--meta-out <file.json>]     (writes what was checked, incl. icon hashes)
//
// Checks
//   APK: aapt2 badging -> application-label, versionCode, versionName;
//        apksigner -> signer certificate SHA-256 equals the fixed debug key;
//        web assets contain the update manifest URL; launcher icon (below).
//   IPA: Info.plist -> CFBundleDisplayName, CFBundleShortVersionString,
//        CFBundleVersion; the URL is inside the app; launcher icon (below).
//
// Launcher icon check (robust to PNG re-encoding / crunching):
//   Images are compared by a hash of their DECODED RGBA pixels, not file bytes.
//   1. The icon the generator wrote into the native project from resources/
//      (mipmap-xxxhdpi/ic_launcher*.png, or AppIcon-512@2x.png on iOS) must
//      NOT equal Capacitor's default template icon (read straight from
//      @capacitor/cli/assets/*-template.tar.gz).
//   2. APK: res/mipmap-xxxhdpi*/ic_launcher.png and ic_launcher_foreground.png
//      inside the APK must have the same pixel hash as the generated ones.
//      IPA: actool resizes the 1024px icon, so the bundle's AppIcon60x60@2x.png
//      is compared perceptually: mean abs difference (grey, 60x60) to the
//      generated icon must be small and smaller than to the default icon.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const failures = [];
const meta = {};
function die(msg) { console.error(`VERIFY_FAIL ${msg}`); process.exit(1); }
const need = (k) => { if (!args[k]) die(`missing --${k}`); return args[k]; };
function check(ok, msg) { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failures.push(msg); }

const kind = need('kind');
const file = resolve(need('file'));
const proj = resolve(need('project'));
const expName = need('name');
const expVerName = need('version-name');
const expVerCode = String(need('version-code'));
const url = need('url');
if (!existsSync(file)) die(`package not found: ${file}`);

const req = createRequire(join(proj, 'package.json'));
let sharp;
try { sharp = req('sharp'); } catch {
  try { sharp = createRequire(req.resolve('@capacitor/assets/package.json'))('sharp'); }
  catch { die(`sharp not found under ${proj}/node_modules (it comes with @capacitor/assets)`); }
}

const sh = (cmd, a) => execFileSync(cmd, a, { encoding: 'utf8', maxBuffer: 64 << 20 });
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
async function pixelHash(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return `${info.width}x${info.height}:${sha256(data)}`;
}
const grey = (input, size) => sharp(input).flatten({ background: '#000000' }).resize(size, size, { fit: 'fill' }).greyscale().raw().toBuffer();
function mad(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; }
function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const n of readdirSync(dir)) { const p = join(dir, n); statSync(p).isDirectory() ? walk(p, acc) : acc.push(p); }
  return acc;
}
function grepTree(dir, needle) {
  for (const f of walk(dir)) {
    if (statSync(f).size > 40 << 20) continue;
    if (readFileSync(f).includes(needle)) return f;
  }
  return null;
}
function templateFile(tarName, inner) {
  const tgz = req.resolve(`@capacitor/cli/assets/${tarName}`);
  return execFileSync('tar', ['-xzOf', tgz, inner], { maxBuffer: 64 << 20 });
}

const stage = mkdtempSync(join(tmpdir(), 'vexo-verify-'));
execFileSync('unzip', ['-q', '-o', file, '-d', stage]);
meta.file = file.split('/').pop();
meta.sha256 = sha256(readFileSync(file));
meta.bytes = statSync(file).size;

if (kind === 'apk') {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdk) die('ANDROID_HOME not set');
  const bt = readdirSync(join(sdk, 'build-tools')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
  const badging = sh(join(sdk, 'build-tools', bt, 'aapt2'), ['dump', 'badging', file]);
  const pkg = badging.match(/^package: name='([^']*)' versionCode='([^']*)' versionName='([^']*)'/m) || [];
  const label = (badging.match(/^application-label:'([^']*)'/m) || [])[1];
  Object.assign(meta, { packageId: pkg[1], versionCode: pkg[2], versionName: pkg[3], label });
  check(label === expName, `application-label '${label}' == '${expName}'`);
  check(pkg[2] === expVerCode, `versionCode '${pkg[2]}' == '${expVerCode}'`);
  check(pkg[3] === expVerName, `versionName '${pkg[3]}' == '${expVerName}'`);

  const certs = sh(join(sdk, 'build-tools', bt, 'apksigner'), ['verify', '--print-certs', file]);
  const digest = (certs.match(/certificate SHA-256 digest:\s*([0-9a-f]+)/i) || [])[1]?.toLowerCase();
  meta.signerSha256 = digest;
  if (args['cert-sha256']) {
    const want = args['cert-sha256'].replace(/:/g, '').toLowerCase();
    check(digest === want, `signer certificate is the fixed debug key (${String(digest).slice(0, 16)}...)`);
  } else {
    check(!!digest, 'APK is signed');
  }

  check(!!grepTree(join(stage, 'assets'), url), 'update manifest URL present in APK assets');

  meta.icons = {};
  for (const name of ['ic_launcher.png', 'ic_launcher_foreground.png']) {
    const def = await pixelHash(templateFile('android-template.tar.gz', `app/src/main/res/mipmap-xxxhdpi/${name}`));
    const gen = join(proj, 'android/app/src/main/res/mipmap-xxxhdpi', name);
    if (!existsSync(gen)) { check(false, `generated ${name} exists in project`); continue; }
    const genHash = await pixelHash(gen);
    check(genHash !== def, `generated ${name} is not Capacitor's default icon`);
    const inApk = walk(join(stage, 'res')).filter((f) => /\/mipmap-xxxhdpi[^/]*\//.test(f) && f.endsWith(`/${name}`));
    if (!inApk.length) { check(false, `${name} (xxxhdpi) present in APK`); continue; }
    const apkHash = await pixelHash(inApk[0]);
    check(apkHash === genHash, `APK ${name} pixels == icon generated from resources/ (${apkHash.slice(0, 26)})`);
    meta.icons[name] = apkHash;
  }
} else if (kind === 'ipa') {
  const payload = join(stage, 'Payload');
  const app = existsSync(payload) && readdirSync(payload).find((n) => n.endsWith('.app'));
  if (!app) die('no Payload/*.app in IPA');
  const appDir = join(payload, app);
  const pl = JSON.parse(sh('plutil', ['-convert', 'json', '-o', '-', join(appDir, 'Info.plist')]));
  const shown = pl.CFBundleDisplayName || pl.CFBundleName;
  Object.assign(meta, { bundleId: pl.CFBundleIdentifier, label: shown, versionName: pl.CFBundleShortVersionString, versionCode: pl.CFBundleVersion });
  check(shown === expName, `CFBundleDisplayName '${shown}' == '${expName}'`);
  check(String(pl.CFBundleShortVersionString) === expVerName, `CFBundleShortVersionString '${pl.CFBundleShortVersionString}' == '${expVerName}'`);
  check(String(pl.CFBundleVersion) === expVerCode, `CFBundleVersion '${pl.CFBundleVersion}' == '${expVerCode}'`);
  const exe = pl.CFBundleExecutable;
  check(!!exe && existsSync(join(appDir, exe)), `executable '${exe}' present`);
  check(!!grepTree(appDir, url), 'update manifest URL present in IPA');

  const gen = join(proj, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');
  if (!existsSync(gen)) die('generated AppIcon-512@2x.png missing from project');
  const defBuf = templateFile('ios-pods-template.tar.gz', 'App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');
  const genHash = await pixelHash(gen);
  check(genHash !== await pixelHash(defBuf), "generated AppIcon is not Capacitor's default icon");
  meta.icons = { 'AppIcon-512@2x.png': genHash };
  check(existsSync(join(appDir, 'Assets.car')), 'Assets.car (compiled icons) present');
  const loose = readdirSync(appDir).filter((n) => /^AppIcon.*\.png$/.test(n)).sort();
  if (!loose.length) {
    check(false, 'AppIcon*.png present in .app (needed to compare the shipped icon)');
  } else {
    const pick = loose.includes('AppIcon60x60@2x.png') ? 'AppIcon60x60@2x.png' : loose[loose.length - 1];
    // Bundle PNGs are Apple-optimised (CgBI); sips converts them back to plain PNG.
    const plain = join(stage, 'shipped-icon.png');
    execFileSync('sips', ['-s', 'format', 'png', join(appDir, pick), '--out', plain], { stdio: 'ignore' });
    const shipped = await grey(plain, 60);
    const dGen = mad(shipped, await grey(gen, 60));
    const dDef = mad(shipped, await grey(defBuf, 60));
    meta.icons.shipped = pick;
    meta.icons.shippedVsGeneratedMAD = Number(dGen.toFixed(2));
    meta.icons.shippedVsDefaultMAD = Number(dDef.toFixed(2));
    check(dGen < 12 && dGen < dDef, `shipped ${pick} matches generated icon (MAD ${dGen.toFixed(2)} vs default ${dDef.toFixed(2)})`);
  }
} else {
  die('--kind must be apk or ipa');
}

if (args['meta-out']) writeFileSync(args['meta-out'], JSON.stringify(meta, null, 2) + '\n');
if (failures.length) die(`${failures.length} check(s) failed`);
console.log(`VERIFY_OK ${meta.file}`);
