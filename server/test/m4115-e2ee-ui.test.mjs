// M4.11.5：诚实 UI。已用 vodozemac 加密传输，但独立审查未通过，不得宣称「已端到端加密」。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const doc = readFileSync(join(root, 'docs/research/M4.11.5_E2EE审查与UI标识.md'), 'utf8');
const dist = readFileSync(join(root, 'dist/nova_v5.html'), 'utf8');

test('审查文档：独立审查尚未通过；诚实说明已用 Olm 加密且服务端只存密文；不得写成已端到端加密', () => {
  assert.match(doc, /尚未进行|未通过/);
  assert.match(doc, /vodozemac|Olm/);
  assert.match(doc, /安全号码/);
  assert.match(doc, /不宣称审查已完成/);
  assert.match(doc, /不得改成「已端到端加密」|不得写成「已端到端加密」|不得.*已端到端加密/);
  assert.match(doc, /群聊/);
});

test('构建产物诚实标识：私聊已加密、有安全号码；不宣称已端到端加密；演示与群聊标明未加密', () => {
  // 文案在 9b145ed（r6）起改为更口语的「已登录 · 私聊已加密」，测试跟上当前界面。
  assert.match(dist, /已登录 · 私聊已加密/);
  assert.match(dist, /一对一聊天会加密后发送/);
  assert.match(dist, /群聊暂时还没有加密|群聊暂不加密/);
  assert.match(dist, /安全号码/);
  assert.match(dist, /演示模式/);
  assert.match(dist, /不会发送真实消息/);
  assert.doesNotMatch(dist, /已端到端加密/);
  assert.doesNotMatch(dist, /端到端加密已开启/);
  assert.doesNotMatch(dist, /独立安全审查已通过/);
  // 「尚未端到端加密」已不再符合事实（消息已加密），不应作为登录后标识。
  const srcs = readdirSync(join(root, 'src')).filter(f => f.endsWith('.js')).map(f => join(root, 'src', f));
  for (const f of srcs) {
    const t = readFileSync(f, 'utf8');
    assert.doesNotMatch(t, /已端到端加密/, f);
    assert.doesNotMatch(t, /端到端加密已开启/, f);
    assert.doesNotMatch(t, /独立安全审查已通过/, f);
  }
  const ban = readFileSync(join(root, 'src/20_ui.js'), 'utf8');
  assert.match(ban, /已登录 · 私聊已加密/);
  assert.doesNotMatch(ban, /尚未端到端加密/);
});
