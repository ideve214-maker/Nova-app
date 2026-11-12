// M2.4.1 权益与额度配置：结构合法、边界明确、文档与配置一致。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {VIP_CONFIG as C, validateConfig, valueOf, entitlementKeys} from '../vip-config.mjs';
import {renderDoc, DOC_PATH} from '../../scripts/gen-vip-doc.mjs';

const clone = o => JSON.parse(JSON.stringify(o));

test('当前配置通过校验', () => assert.deepEqual(validateConfig(), []));

test('每项权益都有 key、名称、说明、过期行为、免费额度与 VIP 额度', () => {
  const keys = entitlementKeys();
  for (const k of ['vip_badge', 'profile_theme_gold', 'profile_decoration', 'personal_saved_items_plus', 'longer_post_text', 'premium_emoji_pack', 'media_quota_plus'])
    assert.ok(keys.includes(k), '缺少权益 ' + k);
  for (const k of keys) {
    const e = C.entitlements[k];
    assert.ok(e.title && e.description && e.onExpire && e.phase, k + ' 文案不全');
    assert.notEqual(e.basic, undefined, k); assert.notEqual(e.vip, undefined, k);   // 待定请显式写 null
  }
});

test('额度数值：收藏 20→100；发帖 280→1000、聊天 500→1500、频道 280→800；VIP 不低于 Basic', () => {
  assert.equal(valueOf('personal_saved_items_plus', 'basic'), 20);
  assert.equal(valueOf('personal_saved_items_plus', 'vip'), 100);
  assert.equal(valueOf('longer_post_text', 'basic', 'post'), 280);
  assert.equal(valueOf('longer_post_text', 'vip', 'post'), 1000);
  assert.equal(valueOf('longer_post_text', 'basic', 'chat'), 500);
  assert.equal(valueOf('longer_post_text', 'vip', 'chat'), 1500);
  assert.equal(valueOf('longer_post_text', 'basic', 'channel'), 280);
  assert.equal(valueOf('longer_post_text', 'vip', 'channel'), 800);
  assert.equal(valueOf('vip_badge', 'basic'), false);
  assert.equal(valueOf('vip_badge', 'vip'), true);
  assert.equal(valueOf('nope', 'vip'), undefined);
  assert.equal(valueOf('longer_post_text', 'vip', 'bogus'), undefined);
  assert.equal(valueOf('longer_post_text', 'vip'), undefined, 'scope 额度不带 scope 不返回数字');
});

test('Basic 额度保持现有产品行为（不因本次改动缩水）', () => {
  // 现有前端：发帖 280、聊天 500、频道发言 280。
  assert.deepEqual({...C.entitlements.longer_post_text.basic}, {post: 280, chat: 500, channel: 280});
});

test('过期行为：无宽限期，已有内容保留', () => {
  assert.equal(C.expiry.graceDays, 0);
  assert.match(C.expiry.rule, /立即/);
  assert.match(C.expiry.dataPolicy, /保留/);
  assert.ok(C.expiry.soonDays > 0 && C.expiry.testGrantDays > 0);
});

test('支付未接入：开通不可用，价格带「暂定」声明', () => {
  assert.equal(C.plans.vip.purchase.enabled, false);
  assert.match(C.plans.vip.priceNote, /暂定/);
  assert.deepEqual(C.plans.vip.prices.map(p => p.label), ['¥9.9/月', '¥99/年']);
});

test('产品边界：基础能力永远免费，不出售曝光/优先级/公共置顶', () => {
  const text = C.alwaysFree.join('|');
  for (const w of ['发帖', '好友', '举报', '安全', '端到端加密', '管理权限']) assert.ok(text.includes(w), '缺少免费承诺：' + w);
  assert.ok(C.neverSold.some(x => x.includes('曝光')) && C.neverSold.some(x => x.includes('公共置顶')));
  const keys = entitlementKeys().join(',');
  assert.ok(!/priority|boost|expose|public_pin|moderat|admin|e2ee|encrypt/.test(keys), '权益 key 不得包含曝光/优先级/公共置顶/管理/加密类');
});

test('校验器能抓住错误配置', () => {
  const bad = f => { const c = clone(C); f(c); return validateConfig(c); };
  assert.ok(bad(c => { c.entitlements.vip_badge.basic = true; }).some(m => m.includes('basic 必须为 false')));
  assert.ok(bad(c => { c.entitlements.personal_saved_items_plus.vip = 10; }).some(m => m.includes('VIP > Basic')));
  assert.ok(bad(c => { c.entitlements.longer_post_text.vip.post = 100; }).some(m => m.includes('post')));
  assert.ok(bad(c => { delete c.entitlements.vip_badge.onExpire; }).some(m => m.includes('onExpire')));
  assert.ok(bad(c => { c.entitlements.Bad_Key = clone(c.entitlements.vip_badge); }).some(m => m.includes('key 只能')));
  assert.ok(bad(c => { c.plans.vip.purchase.enabled = true; }).some(m => m.includes('支付未接入')));
  assert.ok(bad(c => { c.expiry.graceDays = 3; }).some(m => m.includes('graceDays')));
  assert.ok(bad(c => { c.entitlements.longer_post_text.vip = 5; }).some(m => m.includes('类型必须一致')));
});

test('权益表文档与配置一致（改配置后请运行 node scripts/gen-vip-doc.mjs）', () => {
  assert.equal(readFileSync(DOC_PATH, 'utf8'), renderDoc());
});
