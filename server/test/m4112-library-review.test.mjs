// M4.11.2：协议库审查结论入库；仓库仍未安装任何 E2EE 库。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const doc = readFileSync(join(root, 'docs/research/M4.11.2_协议库选型与许可证审查.md'), 'utf8');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

test('审查文档：标准、libsignal AGPL 与不受支持、不采用自制、不选定、不安装', () => {
  assert.match(doc, /审查标准/);
  assert.match(doc, /libsignal/);
  assert.match(doc, /AGPLv3|AGPL/);
  assert.match(doc, /不受支持/);
  assert.match(doc, /不采用/);
  assert.match(doc, /禁止/);
  assert.match(doc, /尚未选定可直接投入生产/);
  assert.match(doc, /不安装/);
  assert.match(doc, /留给负责人/);
  assert.match(doc, /RFC 9420|MLS/);
  assert.match(doc, /不自创|自制/);
});

test('依赖清单与 node_modules 没有 E2EE 协议库', () => {
  const deps = {...(pkg.dependencies || {}), ...(pkg.devDependencies || {})};
  assert.equal(Object.keys(deps).filter(n => /libsignal|@signalapp|libmls|vodozemac|@matrix-org\/olm|^olm$/.test(n)).length, 0);
  const nm = join(root, 'node_modules');
  if (existsSync(nm)) {
    const names = readdirSync(nm);
    assert.equal(names.some(n => /libsignal|@signalapp/.test(n)), false);
  }
});
