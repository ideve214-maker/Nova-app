// M4.11.0：调研结论入库；仓库未引入 libsignal 或其它 E2EE 依赖；消息仍为明文。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const doc = readFileSync(join(root, 'docs/research/M4.11.0_私聊E2EE调研结论.md'), 'utf8');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

test('调研结论文档写明：1:1 私聊、禁止自创、尚未选定生产库、不安装、上线门槛', () => {
  assert.match(doc, /1:1|双向好友/);
  assert.match(doc, /群聊暂不承诺/);
  assert.match(doc, /禁止自创算法/);
  assert.match(doc, /尚未选定可直接投入生产/);
  assert.match(doc, /AGPLv3|AGPL/);
  assert.match(doc, /不受支持/);
  assert.match(doc, /不安装/);
  assert.match(doc, /尚未端到端加密/);
  assert.match(doc, /留给负责人/);
  assert.match(doc, /独立安全审查/);
});

test('package.json 与 node_modules 未引入 libsignal / libmls / @signalapp', () => {
  const deps = {...(pkg.dependencies || {}), ...(pkg.devDependencies || {})};
  const names = Object.keys(deps).join(' ');
  assert.doesNotMatch(names, /libsignal|@signalapp|libmls|mls-ts|@matrix-org\/olm/);
  assert.equal(existsSync(join(root, 'node_modules/libsignal')), false);
  assert.equal(existsSync(join(root, 'node_modules/@signalapp')), false);
});
