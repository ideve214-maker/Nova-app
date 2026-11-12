// 人工收款码默认支付层：下单、截图、管理员核对/拒绝、mock 回调、渠道桩、过期与限额。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac, createHash} from 'node:crypto';
import {readFileSync, existsSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createApp} from '../index.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const MASKED_WECHAT = join(ROOT, 'assets/pay-wechat.jpg');
const MASKED_ALIPAY = join(ROOT, 'assets/pay-alipay.jpg');
const UNMASKED_DIR = join(ROOT, '../../pay_qr');

function jpeg1() {
  return Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDz+iiivlD+gD//2Q==',
    'base64');
}

let srv, base, seq = 0, adminTok;
test.before(async () => {
  srv = createApp({adminUsername: 'ops_pay', adminPassword: 'OpsPayPass1'});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  const login = await call('POST', '/api/admin/auth/login', {username: 'ops_pay', password: 'OpsPayPass1'});
  adminTok = login.j.token;
});
test.after(() => srv.close());
const call = async (m, p, body, tok, {raw, headers} = {}) => {
  const payload = raw !== undefined ? raw : (body ? JSON.stringify(body) : undefined);
  const r = await fetch(base + p, {
    method: m,
    headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {}), ...(headers || {})},
    body: payload,
    redirect: 'manual',
  });
  const ct = r.headers.get('content-type') || '';
  const j = ct.includes('json') ? await r.json() : null;
  const buf = j ? null : Buffer.from(await r.arrayBuffer());
  return {s: r.status, j, buf, headers: r.headers};
};
const AH = () => adminTok;
async function acc(n) {
  const u = n + (++seq);
  const r = await call('POST', '/api/auth/register', {agree:true, username: u, email: u + '@x.test', password: 'Passw0rd123'});
  return {tok: r.j.token, id: r.j.user.id, u};
}

test('目录与 /api/pay/config：人工收款码可用，价格为 ¥9.9/¥99，两种方式默认可开', async () => {
  const c = await call('GET', '/api/vip/catalog');
  assert.equal(c.s, 200);
  assert.equal(c.j.plans.vip.purchase.enabled, true);
  assert.equal(c.j.plans.vip.purchase.provider, 'manual_qr');
  assert.doesNotMatch(c.j.plans.vip.priceNote, /暂定/);
  assert.match(JSON.stringify(c.j), /¥9\.9/);
  assert.doesNotMatch(JSON.stringify(c.j.plans.vip), /暂定/);
  const cfg = await call('GET', '/api/pay/config');
  assert.equal(cfg.s, 200);
  const ids = cfg.j.methods.map(m => m.id);
  assert.deepEqual(ids.sort(), ['alipay', 'wechat']);
  assert.ok(cfg.j.methods.every(m => m.enabled));
  assert.match(cfg.j.instructions, /备注/);
});

test('默认收款码是遮罩图，不是未遮罩原图', async () => {
  assert.ok(existsSync(MASKED_WECHAT) && existsSync(MASKED_ALIPAY));
  const wh = await call('GET', '/api/pay/qr/wechat');
  const ali = await call('GET', '/api/pay/qr/alipay');
  assert.equal(wh.s, 200);
  assert.equal(ali.s, 200);
  assert.match(wh.headers.get('content-type'), /image\/jpeg/);
  const whHash = createHash('md5').update(wh.buf).digest('hex');
  const aliHash = createHash('md5').update(ali.buf).digest('hex');
  assert.equal(whHash, createHash('md5').update(readFileSync(MASKED_WECHAT)).digest('hex'));
  assert.equal(aliHash, createHash('md5').update(readFileSync(MASKED_ALIPAY)).digest('hex'));
  const unW = join(UNMASKED_DIR, 'wechat.jpg');
  const unA = join(UNMASKED_DIR, 'alipay.jpg');
  if (existsSync(unW)) assert.notEqual(whHash, createHash('md5').update(readFileSync(unW)).digest('hex'));
  if (existsSync(unA)) assert.notEqual(aliHash, createHash('md5').update(readFileSync(unA)).digest('hex'));
  // 仓库内不得出现未遮罩原文件名
  assert.equal(existsSync(join(ROOT, 'assets/alipay.jpg')), false);
  assert.equal(existsSync(join(ROOT, 'assets/wechat.jpg')), false);
  const asset = await call('GET', '/assets/pay-wechat.jpg');
  assert.equal(asset.s, 200);
});

test('用户下单：得到短订单码、金额、收款码与备注说明；我已付款后进入待审核', async () => {
  const a = await acc('buyer');
  const bad = await call('POST', '/api/pay/orders', {period: 'week', method: 'wechat'}, a.tok);
  assert.equal(bad.s, 400);
  const o = await call('POST', '/api/pay/orders', {period: 'month', method: 'wechat'}, a.tok);
  assert.equal(o.s, 200, JSON.stringify(o.j));
  const order = o.j.order;
  assert.equal(order.status, 'pending');
  assert.equal(order.amountCents, 990);
  assert.match(order.code, /^NV[A-Z2-9]{6}$/);
  assert.ok(order.qrUrl);
  assert.match(order.instructions, new RegExp(order.code));
  assert.match(order.instructions, /备注/);
  assert.match(order.instructions, /管理员核对/);

  const mine = await call('GET', '/api/pay/orders', null, a.tok);
  assert.ok(mine.j.orders.some(x => x.id === order.id));

  const jpeg = jpeg1();
  const paid = await call('POST', '/api/pay/orders/' + order.id + '/paid', {
    receipt: {mime: 'image/jpeg', name: 'shot.jpg', data: jpeg.toString('base64')},
  }, a.tok);
  assert.equal(paid.s, 200, JSON.stringify(paid.j));
  assert.equal(paid.j.order.status, 'awaiting_review');
  assert.equal(paid.j.order.hasReceipt, true);
  // 提交「我已付款」不得立刻开通
  const me = await call('GET', '/api/vip/me', null, a.tok);
  assert.equal(me.j.vip.active, false);
});

test('管理员确认：幂等开通 VIP；拒绝需原因；重复确认不重复加时长', async () => {
  const a = await acc('cfm');
  const o = await call('POST', '/api/pay/orders', {period: 'month', method: 'alipay'}, a.tok);
  // 未提交「我已付款」不能确认
  const early = await call('POST', '/api/admin/payments/' + o.j.order.id + '/confirm', {}, AH());
  assert.equal(early.s, 409);

  await call('POST', '/api/pay/orders/' + o.j.order.id + '/paid', {}, a.tok);
  const list = await call('GET', '/api/admin/payments?status=awaiting_review', null, AH());
  assert.equal(list.s, 200);
  assert.ok(list.j.orders.some(x => x.id === o.j.order.id && x.user && x.user.username === a.u));

  const conf = await call('POST', '/api/admin/payments/' + o.j.order.id + '/confirm', {}, AH());
  assert.equal(conf.s, 200, JSON.stringify(conf.j));
  assert.equal(conf.j.order.status, 'paid');
  assert.equal(conf.j.already, false);
  const me = await call('GET', '/api/vip/me', null, a.tok);
  assert.equal(me.j.vip.active, true);
  const until = me.j.vip.until;

  const again = await call('POST', '/api/admin/payments/' + o.j.order.id + '/confirm', {}, AH());
  assert.equal(again.s, 200);
  assert.equal(again.j.already, true);
  const me2 = await call('GET', '/api/vip/me', null, a.tok);
  assert.equal(me2.j.vip.until, until);

  const b = await acc('rej');
  const o2 = await call('POST', '/api/pay/orders', {period: 'year', method: 'wechat'}, b.tok);
  await call('POST', '/api/pay/orders/' + o2.j.order.id + '/paid', {}, b.tok);
  const noR = await call('POST', '/api/admin/payments/' + o2.j.order.id + '/reject', {}, AH());
  assert.equal(noR.s, 400);
  const rej = await call('POST', '/api/admin/payments/' + o2.j.order.id + '/reject', {reason: '金额不对'}, AH());
  assert.equal(rej.s, 200);
  assert.equal(rej.j.order.status, 'rejected');
  assert.equal(rej.j.order.rejectReason, '金额不对');
  const got = await call('GET', '/api/pay/orders/' + o2.j.order.id, null, b.tok);
  assert.equal(got.j.order.status, 'rejected');
  assert.equal((await call('GET', '/api/vip/me', null, b.tok)).j.vip.active, false);

  // 退款会扣回本笔授予的天数；本用例只有这一笔，VIP 应失效
  const rf = await call('POST', '/api/admin/payments/' + o.j.order.id + '/refund', {reason: '测试退款'}, AH());
  assert.equal(rf.s, 200, JSON.stringify(rf.j));
  assert.equal(rf.j.order.status, 'refunded');
  assert.equal(rf.j.vipRevoked, true);
  assert.equal(rf.j.daysSubtracted, 30);
  assert.equal((await call('GET', '/api/vip/me', null, a.tok)).j.vip.active, false);
  const againRf = await call('POST', '/api/admin/payments/' + o.j.order.id + '/refund', {reason: '再退'}, AH());
  assert.equal(againRf.s, 200);
  assert.equal(againRf.j.already, true);
});

test('截图类型与大小限制；不能看别人的订单', async () => {
  const a = await acc('shot'), b = await acc('other');
  const o = await call('POST', '/api/pay/orders', {period: 'month', method: 'wechat'}, a.tok);
  const badType = await call('POST', '/api/pay/orders/' + o.j.order.id + '/paid', {
    receipt: {mime: 'application/pdf', name: 'x.pdf', data: Buffer.from('%PDF-1.4 hello world!!!!').toString('base64')},
  }, a.tok);
  assert.equal(badType.s, 400);
  const other = await call('GET', '/api/pay/orders/' + o.j.order.id, null, b.tok);
  assert.equal(other.s, 404);
  const rcpt = await call('GET', '/api/admin/payments/' + o.j.order.id + '/receipt', null, a.tok);
  assert.ok(rcpt.s === 401 || rcpt.s === 403 || rcpt.s === 404);
});

test('真实渠道是未配置桩：下单与回调均 501，不接受凭证', async () => {
  const a = await acc('stub');
  for (const provider of ['stripe', 'apple_iap', 'wechat', 'alipay']) {
    const r = await call('POST', '/api/pay/orders', {period: 'month', method: 'wechat', provider}, a.tok);
    assert.equal(r.s, 501, provider + ' ' + JSON.stringify(r.j));
    assert.equal(r.j.error.code, 'NOT_CONFIGURED');
    const wh = await call('POST', '/api/pay/webhook/' + provider, {event: 'paid', orderId: 'x'}, a.tok);
    assert.equal(wh.s, 501, provider + ' webhook');
  }
});

test('每用户待处理订单上限', async () => {
  let now = 1_700_000_000_000;
  const tmp = createApp({
    clock: () => now,
    adminUsername: 'ops_lim', adminPassword: 'OpsLimPass1',
    payEnv: {NOVA_PAY_PENDING_LIMIT: '1', NOVA_PAY_ORDER_EXPIRE_MINUTES: '30'},
  });
  await new Promise(r => tmp.listen(0, '127.0.0.1', r));
  const b = 'http://127.0.0.1:' + tmp.address().port;
  const f = async (m, p, body, tok) => {
    const r = await fetch(b + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
    return {s: r.status, j: await r.json()};
  };
  try {
    const reg = await f('POST', '/api/auth/register', {agree:true, username: 'limu', email: 'limu@x.test', password: 'Passw0rd123'});
    const tok = reg.j.token;
    const o1 = await f('POST', '/api/pay/orders', {period: 'month', method: 'wechat'}, tok);
    assert.equal(o1.s, 200, JSON.stringify(o1.j));
    const o2 = await f('POST', '/api/pay/orders', {period: 'year', method: 'alipay'}, tok);
    assert.equal(o2.s, 429);
    assert.equal(o2.j.error.code, 'PENDING_LIMIT');
  } finally { tmp.close(); }
});

test('过期：到期后 pending 变为 expired，不能再提交付款', async () => {
  let now = 1_700_000_000_000;
  const tmp = createApp({
    clock: () => now,
    adminUsername: 'ops_exp', adminPassword: 'OpsExpPass1',
    payEnv: {NOVA_PAY_ORDER_EXPIRE_MINUTES: '10'},
  });
  await new Promise(r => tmp.listen(0, '127.0.0.1', r));
  const b = 'http://127.0.0.1:' + tmp.address().port;
  const f = async (m, p, body, tok) => {
    const r = await fetch(b + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
    return {s: r.status, j: await r.json()};
  };
  try {
    const reg = await f('POST', '/api/auth/register', {agree:true, username: 'expu', email: 'expu@x.test', password: 'Passw0rd123'});
    const tok = reg.j.token;
    const o = await f('POST', '/api/pay/orders', {period: 'month', method: 'wechat'}, tok);
    assert.equal(o.s, 200);
    now += 11 * 60e3;
    const got = await f('GET', '/api/pay/orders/' + o.j.order.id, null, tok);
    assert.equal(got.j.order.status, 'expired');
    const paid = await f('POST', '/api/pay/orders/' + o.j.order.id + '/paid', {}, tok);
    assert.equal(paid.s, 409);
  } finally { tmp.close(); }
});

test('单渠道可关闭；关闭后目录与下单均不可用该方式', async () => {
  const tmp = createApp({
    adminUsername: 'ops_off', adminPassword: 'OpsOffPass1',
    payEnv: {NOVA_PAY_WECHAT_ENABLED: '0'},
  });
  await new Promise(r => tmp.listen(0, '127.0.0.1', r));
  const b = 'http://127.0.0.1:' + tmp.address().port;
  const f = async (m, p, body, tok) => {
    const r = await fetch(b + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
    const ct = r.headers.get('content-type') || '';
    return {s: r.status, j: ct.includes('json') ? await r.json() : null};
  };
  try {
    const cfg = await f('GET', '/api/pay/config');
    const wechat = cfg.j.methods.find(m => m.id === 'wechat');
    const alipay = cfg.j.methods.find(m => m.id === 'alipay');
    assert.equal(wechat.enabled, false);
    assert.equal(alipay.enabled, true);
    const qr = await f('GET', '/api/pay/qr/wechat');
    assert.equal(qr.s, 404);
    const reg = await f('POST', '/api/auth/register', {agree:true, username: 'offu', email: 'offu@x.test', password: 'Passw0rd123'});
    const tok = reg.j.token;
    const w = await f('POST', '/api/pay/orders', {period: 'month', method: 'wechat'}, tok);
    assert.equal(w.s, 400);
    const a = await f('POST', '/api/pay/orders', {period: 'month', method: 'alipay'}, tok);
    assert.equal(a.s, 200, JSON.stringify(a.j));
  } finally { tmp.close(); }
});

test('两种方式都关闭时目录 purchase.enabled 为 false', async () => {
  const tmp = createApp({payEnv: {NOVA_PAY_WECHAT_ENABLED: '0', NOVA_PAY_ALIPAY_ENABLED: '0'}});
  await new Promise(r => tmp.listen(0, '127.0.0.1', r));
  const b = 'http://127.0.0.1:' + tmp.address().port;
  try {
    const r = await fetch(b + '/api/vip/catalog');
    const j = await r.json();
    assert.equal(j.plans.vip.purchase.enabled, false);
  } finally { tmp.close(); }
});

test('mock 回调：签名校验、幂等开通 VIP', async () => {
  const secret = 'mock-secret-test-1';
  let now = 1_700_100_000_000;
  const tmp = createApp({
    clock: () => now,
    adminUsername: 'ops_mock', adminPassword: 'OpsMockPass1',
    payEnv: {NOVA_PAY_PROVIDER: 'mock', NOVA_PAY_MOCK_SECRET: secret},
  });
  await new Promise(r => tmp.listen(0, '127.0.0.1', r));
  const b = 'http://127.0.0.1:' + tmp.address().port;
  const f = async (m, p, body, tok, {sign = true, secretOv} = {}) => {
    const raw = body ? JSON.stringify(body) : undefined;
    const headers = {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})};
    if (sign && raw) headers['X-Nova-Pay-Signature'] = createHmac('sha256', secretOv || secret).update(raw).digest('hex');
    const r = await fetch(b + p, {method: m, headers, body: raw});
    return {s: r.status, j: await r.json()};
  };
  try {
    const cat = await f('GET', '/api/vip/catalog');
    assert.equal(cat.j.plans.vip.purchase.enabled, true);
    const reg = await f('POST', '/api/auth/register', {agree:true, username: 'mocku', email: 'mocku@x.test', password: 'Passw0rd123'}, null, {sign: false});
    const tok = reg.j.token;
    const o = await f('POST', '/api/pay/orders', {period: 'month', provider: 'mock'}, tok, {sign: false});
    assert.equal(o.s, 200, JSON.stringify(o.j));
    const id = o.j.order.id;
    const bad = await f('POST', '/api/pay/webhook/mock', {event: 'paid', orderId: id}, null, {sign: true, secretOv: 'wrong'});
    assert.equal(bad.s, 401);
    const nosig = await f('POST', '/api/pay/webhook/mock', {event: 'paid', orderId: id}, null, {sign: false});
    assert.equal(nosig.s, 401);
    const ok = await f('POST', '/api/pay/webhook/mock', {event: 'paid', orderId: id, providerRef: 'mock_1'});
    assert.equal(ok.s, 200, JSON.stringify(ok.j));
    assert.equal(ok.j.order.status, 'paid');
    const me = await f('GET', '/api/vip/me', null, tok, {sign: false});
    assert.equal(me.j.vip.active, true);
    const until = me.j.vip.until;
    const again = await f('POST', '/api/pay/webhook/mock', {event: 'paid', orderId: id, providerRef: 'mock_1'});
    assert.equal(again.s, 200);
    assert.equal(again.j.already, true);
    const me2 = await f('GET', '/api/vip/me', null, tok, {sign: false});
    assert.equal(me2.j.vip.until, until);
  } finally { tmp.close(); }
});

test('退款只扣回本笔天数，不影响其他授予；写审计且幂等', async () => {
  const a = await acc('rfkeep');
  // 管理员先赠 60 天
  const g = await call('POST', '/api/admin/vip/grant', {userId: a.id, days: 60, reason: '活动赠送'}, AH());
  assert.equal(g.s, 200, JSON.stringify(g.j));
  const afterGrant = await call('GET', '/api/vip/me', null, a.tok);
  assert.equal(afterGrant.j.vip.active, true);
  const untilGrant = afterGrant.j.vip.until;
  // 再买一个月（从原到期日顺延 30 天）
  const o = await call('POST', '/api/pay/orders', {period: 'month', method: 'wechat'}, a.tok);
  await call('POST', '/api/pay/orders/' + o.j.order.id + '/paid', {}, a.tok);
  const conf = await call('POST', '/api/admin/payments/' + o.j.order.id + '/confirm', {}, AH());
  assert.equal(conf.s, 200, JSON.stringify(conf.j));
  const afterPay = await call('GET', '/api/vip/me', null, a.tok);
  const DAY = 864e5;
  assert.ok(Math.abs(afterPay.j.vip.until - (untilGrant + 30 * DAY)) < 2000, '续期应在原到期日上加 30 天 ' + afterPay.j.vip.until + ' vs ' + (untilGrant + 30 * DAY));
  const rf = await call('POST', '/api/admin/payments/' + o.j.order.id + '/refund', {reason: '用户申请退款'}, AH());
  assert.equal(rf.s, 200, JSON.stringify(rf.j));
  assert.equal(rf.j.already, false);
  assert.equal(rf.j.vipRevoked, true);
  assert.equal(rf.j.daysSubtracted, 30);
  const afterRf = await call('GET', '/api/vip/me', null, a.tok);
  assert.equal(afterRf.j.vip.active, true, '其他授予仍应有效');
  assert.ok(Math.abs(afterRf.j.vip.until - untilGrant) < 2000, '退款后应回到赠送的 60 天到期日');
  // 幂等：再退不继续扣
  const rf2 = await call('POST', '/api/admin/payments/' + o.j.order.id + '/refund', {reason: '重复'}, AH());
  assert.equal(rf2.s, 200);
  assert.equal(rf2.j.already, true);
  const after2 = await call('GET', '/api/vip/me', null, a.tok);
  assert.equal(after2.j.vip.until, afterRf.j.vip.until);
  const audit = await call('GET', '/api/admin/audit?action=admin.payment.refund', null, AH());
  assert.equal(audit.s, 200);
  const hit = audit.j.audits.find(x => x.target === 'order:' + o.j.order.id);
  assert.ok(hit, '应有退款审计');
  assert.equal(hit.detail && hit.detail.daysSubtracted, 30);
  const ev = srv.db.prepare("SELECT action,source,until_before,until_after,note FROM vip_events WHERE user_id=? AND action='shorten'").all(a.id);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].source, 'payment');
  assert.ok(String(ev[0].note).includes(o.j.order.code));
});
