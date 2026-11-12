// M4.11.5：UI 明确尚未端到端加密；源码与构建产物都不得宣称已加密；审查文档写明未通过。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const doc = readFileSync(join(root, 'docs/research/M4.11.5_E2EE审查与UI标识.md'), 'utf8');
const dist = readFileSync(join(root, 'dist/nova_v5.html'), 'utf8');

test('审查文档：独立审查尚未通过；通过前必须保持尚未加密标识', () => {
  assert.match(doc, /尚未进行|未通过/);
  assert.match(doc, /尚未端到端加密/);
  assert.match(doc, /不得改成「已端到端加密」|不得.*已端到端加密/);
  assert.match(doc, /安全号码/);
  assert.match(doc, /不宣称审查已完成/);
});

test('构建产物与源码含强制标识，且不宣称已加密或审查已通过', () => {
  assert.match(dist, /已登录 · 私聊尚未端到端加密/);
  assert.match(dist, /消息会发到服务器/);
  assert.match(dist, /独立安全审查完成前/);
  assert.match(dist, /演示模式 · 未加密/);
  assert.doesNotMatch(dist, /已端到端加密/);
  assert.doesNotMatch(dist, /端到端加密已开启/);
  assert.doesNotMatch(dist, /消息已加密/);
  assert.doesNotMatch(dist, /独立安全审查已通过/);
  const srcs = readdirSync(join(root, 'src')).filter(f => f.endsWith('.js')).map(f => join(root, 'src', f));
  for (const f of srcs) {
    const t = readFileSync(f, 'utf8');
    assert.doesNotMatch(t, /已端到端加密/, f);
    assert.doesNotMatch(t, /端到端加密已开启/, f);
    assert.doesNotMatch(t, /独立安全审查已通过/, f);
  }
  const ban = readFileSync(join(root, 'src/20_ui.js'), 'utf8');
  assert.match(ban, /私聊尚未端到端加密/);
});
