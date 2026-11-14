#!/usr/bin/env node
// Hot-update manifest helper (Capgo self-hosted, unencrypted bundles).
//
//   make:  node make-update-manifest.mjs --zip bundle.zip --version 1.1.0 [--url URL] --out manifest.json
//   check: node make-update-manifest.mjs --check manifest.json
//
// Rules (admin client 8f927e4+ skips an update without them; user client passes
// the same field to download()):
//   - `checksum` (REQUIRED) and the optional alias `sha256` = lowercase 64-hex sha256 of the WHOLE zip
//   - no `session_key` / `sessionKey` (bundles are not encrypted)
//   - an `error` / kind:"up_to_date" manifest carries no bundle and needs no checksum
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const HEX64 = /^[0-9a-f]{64}$/;
const die = (m) => { console.error(`::error::${m}`); process.exit(1); };

export function checkManifest(m) {
  if (m == null || typeof m !== 'object' || Array.isArray(m)) return 'manifest is not a JSON object';
  if ('session_key' in m || 'sessionKey' in m) return 'manifest must not contain session_key/sessionKey';
  if (m.error || m.kind === 'up_to_date') return null;
  if (!String(m.version ?? '').trim()) return 'version is missing';
  for (const f of ['checksum', 'sha256']) {
    if (f in m && !HEX64.test(String(m[f]))) return `${f} is not a lowercase 64-hex sha256`;
  }
  // `checksum` is mandatory: the user client reads only that field (admin accepts either).
  if (!m.checksum) return 'checksum is missing (required; sha256 is only an optional alias)';
  if (m.checksum && m.sha256 && m.checksum !== m.sha256) return 'checksum and sha256 differ';
  return null;
}

const checkFile = opt('check');
if (checkFile) {
  let m;
  try { m = JSON.parse(readFileSync(checkFile, 'utf8')); } catch (e) { die(`${checkFile}: ${e.message}`); }
  const err = checkManifest(m);
  if (err) die(`${checkFile}: ${err}`);
  console.log(`${checkFile}: ok${m.error || m.kind === 'up_to_date' ? ' (up_to_date, no bundle)' : ` (version ${m.version})`}`);
} else {
  const zip = opt('zip'), version = opt('version'), out = opt('out');
  if (!zip || !version || !out) die('usage: --zip FILE --version V [--url URL] --out FILE | --check FILE');
  const buf = readFileSync(zip);
  if (buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50) die(`${zip} is not a zip file`);
  const sum = createHash('sha256').update(buf).digest('hex').toLowerCase();
  const m = { version: String(version), url: opt('url') || '', checksum: sum, sha256: sum };
  const err = checkManifest(m);
  if (err) die(err);
  writeFileSync(out, JSON.stringify(m, null, 2) + '\n');
  console.log(JSON.stringify({ ...m, bytes: buf.length }));
}
