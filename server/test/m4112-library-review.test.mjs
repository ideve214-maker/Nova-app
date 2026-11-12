// M4.11.2：负责人选定 vodozemac（Apache-2.0）；仓库 vendored，不安装 libsignal。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const doc = readFileSync(join(root, 'docs/research/M4.11.2_协议库选型与许可证审查.md'), 'utf8');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const notice = readFileSync(join(root, 'vendor/vodozemac/NOTICE'), 'utf8');
const license = readFileSync(join(root, 'vendor/vodozemac/LICENSE'), 'utf8');

test('审查文档：负责人选定 vodozemac，Apache-2.0，不采用 libsignal，禁止自制', () => {
  assert.match(doc, /审查标准/);
  assert.match(doc, /libsignal/);
  assert.match(doc, /AGPLv3|AGPL/);
  assert.match(doc, /不采用/);
  assert.match(doc, /vodozemac/);
  assert.match(doc, /Apache-2\.0|Apache 2/);
  assert.match(doc, /负责人/);
  assert.match(doc, /禁止/);
  assert.match(doc, /不自创|自制/);
});

test('vodozemac 已以 Apache-2.0 引入仓库；未安装 libsignal', () => {
  assert.match(notice, /@kinsh\/vodozemac-wasm/);
  assert.match(notice, /0\.4\.2/);
  assert.match(license, /Apache License/);
  assert.equal(existsSync(join(root, 'vendor/vodozemac/pkg-node/kinsh_vodozemac_wasm_bg.wasm')), true);
  assert.equal(existsSync(join(root, 'vendor/vodozemac/pkg-web/kinsh_vodozemac_wasm_bg.wasm')), true);
  const deps = {...(pkg.dependencies || {}), ...(pkg.devDependencies || {})};
  assert.equal(Object.keys(deps).filter(n => /libsignal|@signalapp/.test(n)).length, 0);
  const nm = join(root, 'node_modules');
  if (existsSync(nm)) {
    const names = readdirSync(nm);
    assert.equal(names.some(n => /libsignal|@signalapp/.test(n)), false);
  }
});
