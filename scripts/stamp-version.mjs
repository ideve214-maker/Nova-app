#!/usr/bin/env node
// Write an explicit version into a Capacitor project's generated native
// projects (run after `cap add` + `cap sync`, before gradle / xcodebuild).
//
//   node scripts/stamp-version.mjs <project-dir> --version-name 1.1.0 --version-code 110
//
// Android: versionCode / versionName in android/app/build.gradle
// iOS:     MARKETING_VERSION / CURRENT_PROJECT_VERSION in project.pbxproj and
//          CFBundleShortVersionString / CFBundleVersion in App/Info.plist
//
// Same approach as Bob's user-app scripts/stamp-native.mjs (v7-m7.r8-vexo),
// but parameterised and without the user-app-only location / MainActivity
// changes, so it is safe for the admin app. The display name is NOT changed
// here: it must come from the app's own capacitor config and is checked by
// scripts/verify-package.mjs after the build.
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

export function patchGradle(text, name, code) {
  let out = text;
  if (/versionCode\s+\d+/.test(out)) out = out.replace(/versionCode\s+\d+/, `versionCode ${code}`);
  else out = out.replace(/defaultConfig\s*\{/, (m) => `${m}\n        versionCode ${code}`);
  if (/versionName\s+["'][^"']*["']/.test(out)) out = out.replace(/versionName\s+["'][^"']*["']/, `versionName "${name}"`);
  else out = out.replace(/versionCode\s+\d+/, (m) => `${m}\n        versionName "${name}"`);
  if (!out.includes(`versionCode ${code}`) || !out.includes(`versionName "${name}"`)) {
    throw new Error('stamp-version: could not write versionCode/versionName into build.gradle');
  }
  return out;
}

export function patchPbx(text, name, code) {
  return text
    .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${code};`)
    .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${name};`);
}

export function patchInfoPlist(text, name, code) {
  let out = text;
  const set = (key, value) => {
    const re = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`);
    if (re.test(out)) out = out.replace(re, `$1${value}$2`);
    else out = out.replace(/<\/dict>\s*<\/plist>\s*$/, `\t<key>${key}</key>\n\t<string>${value}</string>\n</dict>\n</plist>\n`);
    if (!re.test(out)) throw new Error(`stamp-version: could not set ${key}`);
  };
  set('CFBundleShortVersionString', name);
  set('CFBundleVersion', String(code));
  return out;
}

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const n of readdirSync(dir)) {
    if (n === 'Pods' || n === 'build' || n === 'node_modules' || n === 'DerivedData') continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

export function stamp(root, name, code) {
  const done = [];
  const gradle = join(root, 'android/app/build.gradle');
  if (existsSync(gradle)) {
    writeFileSync(gradle, patchGradle(readFileSync(gradle, 'utf8'), name, code));
    done.push(gradle);
  }
  for (const p of walk(join(root, 'ios')).filter((f) => f.endsWith('project.pbxproj'))) {
    writeFileSync(p, patchPbx(readFileSync(p, 'utf8'), name, code));
    done.push(p);
  }
  const plist = join(root, 'ios/App/App/Info.plist');
  if (existsSync(plist)) {
    writeFileSync(plist, patchInfoPlist(readFileSync(plist, 'utf8'), name, code));
    done.push(plist);
  }
  return done;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('stamp-version.mjs')) {
  const root = resolve(process.argv[2] || '.');
  const name = arg('--version-name') || process.env.APP_VERSION_NAME;
  const code = Number.parseInt(arg('--version-code') || process.env.APP_VERSION_CODE || '', 10);
  if (!/^\d+\.\d+\.\d+$/.test(String(name || ''))) throw new Error(`stamp-version: bad --version-name '${name}'`);
  if (!Number.isInteger(code) || code < 1) throw new Error('stamp-version: bad --version-code');
  const done = stamp(root, name, code);
  if (!done.length) {
    console.error(`stamp-version: no android/ or ios/ project under ${root}`);
    process.exit(1);
  }
  console.log(`stamp-version ${name} (${code})`);
  for (const p of done) console.log('   ', p);
}
