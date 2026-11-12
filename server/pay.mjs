// VIP 支付：提供商无关的订单层。
// 默认渠道是人工收款码（微信 / 支付宝个人码），用户在转账备注填写订单码，管理员核对后开通。
// 另有 mock 沙箱（签名回调）以及微信/支付宝官方、Stripe、Apple IAP 的未配置桩（不接受商户凭证）。
import {createHmac, randomBytes, timingSafeEqual} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ApiError} from './errors.mjs';
import {VIP_CONFIG} from './vip-config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_QR = {
  wechat: join(ROOT, 'assets/pay-wechat.jpg'),
  alipay: join(ROOT, 'assets/pay-alipay.jpg'),
};
const PERIOD_DAYS = {month: 30, year: 365};
const STUB_PROVIDERS = Object.freeze(['wechat', 'alipay', 'stripe', 'apple_iap']);
const MANUAL_METHODS = Object.freeze(['wechat', 'alipay']);
const CODE_ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECEIPT_MAX = 5 * 1024 * 1024;
const RECEIPT_MIME = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const OPEN = new Set(['pending', 'awaiting_review']);

function envOn(env, key, fallback = true) {
  const v = env[key];
  if (v === undefined || v === null || String(v).trim() === '') return fallback;
  const s = String(v).trim().toLowerCase();
  if (['0', 'false', 'off', 'no'].includes(s)) return false;
  if (['1', 'true', 'on', 'yes'].includes(s)) return true;
  return fallback;
}
function isHttp(s) { return /^https?:\/\//i.test(String(s || '').trim()); }
function numEnv(env, key, fallback) {
  const n = Number(env[key]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
function newCode() {
  let s = 'NV';
  for (let i = 0; i < 6; i++) s += CODE_ALPH[randomBytes(1)[0] % CODE_ALPH.length];
  return s;
}
function newId() { return 'pay_' + randomBytes(12).toString('base64url'); }
function priceOf(period) {
  const p = (VIP_CONFIG.plans.vip.prices || []).find(x => x.period === period);
  if (!p) throw new ApiError(400, 'BAD_PERIOD', '请选择月度或年度套餐');
  return p;
}
function daysOf(period) {
  const d = PERIOD_DAYS[period];
  if (!d) throw new ApiError(400, 'BAD_PERIOD', '请选择月度或年度套餐');
  return d;
}
function sniffMime(buf, claimed) {
  if (!buf || buf.length < 12) return null;
  const jpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const webp = buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf.slice(8, 12).toString() === 'WEBP';
  const real = jpg ? 'image/jpeg' : png ? 'image/png' : webp ? 'image/webp' : null;
  if (!real) return null;
  const c = String(claimed || real).toLowerCase();
  if (c === 'image/jpg') return real === 'image/jpeg' ? real : null;
  if (c && c !== real && !(c === 'image/jpeg' && real === 'image/jpeg')) return null;
  return real;
}
function b64ToBuf(s) {
  try { return Buffer.from(String(s).replace(/\s/g, ''), 'base64'); }
  catch { throw new ApiError(400, 'BAD_RECEIPT', '截图数据无法读取'); }
}
function hmacHex(secret, raw) {
  return createHmac('sha256', String(secret)).update(raw).digest('hex');
}
function sameHex(a, b) {
  const A = Buffer.from(String(a || ''), 'hex'), B = Buffer.from(String(b || ''), 'hex');
  if (A.length !== B.length || A.length === 0) return false;
  return timingSafeEqual(A, B);
}

export function createPay(db, {now, vip, audit, dataDir, env = process.env} = {}) {
  const nowFn = now || Date.now;
  const root = dataDir || join(ROOT, 'data/pay');
  const receiptDir = join(root, 'receipts');
  mkdirSync(receiptDir, {recursive: true});

  const ins = db.prepare(`INSERT INTO pay_orders(
    id,code,user_id,provider,method,period,plan,amount_cents,currency,status,note,
    expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const byId = db.prepare('SELECT * FROM pay_orders WHERE id=?');
  const byCode = db.prepare('SELECT * FROM pay_orders WHERE code=?');
  const updStatus = db.prepare('UPDATE pay_orders SET status=?, reject_reason=?, provider_ref=?, paid_at=?, reviewed_by=?, updated_at=?, vip_event_id=? WHERE id=?');
  const updReceipt = db.prepare('UPDATE pay_orders SET receipt_path=?, receipt_mime=?, receipt_name=?, updated_at=? WHERE id=?');
  const expireDue = db.prepare("UPDATE pay_orders SET status='expired', updated_at=? WHERE status='pending' AND expires_at<=?");
  const openCount = db.prepare("SELECT COUNT(*) n FROM pay_orders WHERE user_id=? AND status IN ('pending','awaiting_review')");
  const listMine = db.prepare('SELECT * FROM pay_orders WHERE user_id=? ORDER BY created_at DESC LIMIT ?');
  const insEv = db.prepare('INSERT INTO pay_events(order_id,at,action,actor_type,actor_id,detail) VALUES(?,?,?,?,?,?)');
  const listEv = db.prepare('SELECT * FROM pay_events WHERE order_id=? ORDER BY id');

  function expire() { expireDue.run(nowFn(), nowFn()); }

  function methods() {
    const out = [];
    for (const id of MANUAL_METHODS) {
      const key = id === 'wechat' ? 'NOVA_PAY_WECHAT' : 'NOVA_PAY_ALIPAY';
      const enabled = envOn(env, key + '_ENABLED', true);
      const override = String(env[key + '_QR'] || '').trim();
      let qrUrl = '/api/pay/qr/' + id;
      let source = 'bundled';
      if (override) {
        if (isHttp(override)) { qrUrl = override; source = 'url'; }
        else { source = 'file'; }
      }
      const name = id === 'wechat' ? '微信支付' : '支付宝';
      const defaultNote = id === 'wechat'
        ? '若此收款码无法付款（例如账号已停用），请改用支付宝。'
        : '请按订单金额转账，并在备注中填写订单码。';
      const note = String(env[key + '_NOTE'] || defaultNote);
      out.push({id, name, enabled, qrUrl, source, note});
    }
    return out;
  }

  function isAvailable() {
    const provider = String(env.NOVA_PAY_PROVIDER || 'manual_qr');
    if (provider === 'mock') return true;
    if (provider === 'manual_qr' || !provider) return methods().some(m => m.enabled);
    return false; // stubs are not available for purchase
  }

  function purchaseInfo() {
    if (!isAvailable()) {
      return {enabled: false, label: '暂未开放', reason: '当前没有可用的收款方式', provider: String(env.NOVA_PAY_PROVIDER || 'manual_qr')};
    }
    return {
      enabled: true,
      label: '扫码开通',
      reason: '通过微信或支付宝收款码转账，在备注中填写订单码，管理员核对后开通。不会自动扣款，也不会即时到账。',
      provider: String(env.NOVA_PAY_PROVIDER || 'manual_qr'),
    };
  }

  function expireMinutes() { return numEnv(env, 'NOVA_PAY_ORDER_EXPIRE_MINUTES', 1440); }
  function pendingLimit() { return Math.max(1, Math.min(20, numEnv(env, 'NOVA_PAY_PENDING_LIMIT', 3))); }

  function publicConfig() {
    return {
      defaultProvider: String(env.NOVA_PAY_PROVIDER || 'manual_qr'),
      methods: methods(),
      instructions: '选择套餐并生成订单后，请用对应 App 扫描收款码，按显示金额转账，并在转账备注中填写订单码。付款后点击「我已付款」，可选择上传截图。开通需管理员核对后生效，本页不会自动扣款或立刻开通会员。价格暂定。',
      expireMinutes: expireMinutes(),
      pendingLimit: pendingLimit(),
      receiptMaxBytes: RECEIPT_MAX,
      receiptTypes: Object.keys(RECEIPT_MIME),
      periodDays: {...PERIOD_DAYS},
      prices: (VIP_CONFIG.plans.vip.prices || []).map(p => ({...p, days: PERIOD_DAYS[p.period]})),
    };
  }

  function qrFile(method) {
    if (!MANUAL_METHODS.includes(method)) throw new ApiError(404, 'NOT_FOUND', '没有这个收款方式');
    const m = methods().find(x => x.id === method);
    if (!m || !m.enabled) throw new ApiError(404, 'NOT_FOUND', '该收款方式暂未开放');
    if (m.source === 'url') throw new ApiError(302, 'REDIRECT', '请使用配置的收款码地址', {url: m.qrUrl});
    const key = method === 'wechat' ? 'NOVA_PAY_WECHAT_QR' : 'NOVA_PAY_ALIPAY_QR';
    const override = String(env[key] || '').trim();
    const fp = override && !isHttp(override) ? override : DEFAULT_QR[method];
    if (!fp || !existsSync(fp)) throw new ApiError(404, 'NOT_FOUND', '收款码图片不存在');
    const buf = readFileSync(fp);
    const lower = String(fp).toLowerCase();
    const mime = lower.endsWith('.png') ? 'image/png' : lower.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    return {buf, mime, name: method + '.jpg'};
  }

  function pub(row, {admin = false} = {}) {
    if (!row) return null;
    const price = (VIP_CONFIG.plans.vip.prices || []).find(p => p.period === row.period);
    const m = methods().find(x => x.id === row.method);
    const out = {
      id: row.id,
      code: row.code,
      userId: row.user_id,
      provider: row.provider,
      method: row.method,
      methodName: m ? m.name : row.method,
      period: row.period,
      plan: row.plan,
      amountCents: row.amount_cents,
      amountLabel: price ? price.label : ('¥' + (row.amount_cents / 100).toFixed(1)),
      currency: row.currency,
      status: row.status,
      note: row.note || '',
      rejectReason: row.reject_reason || null,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      paidAt: row.paid_at || null,
      hasReceipt: !!row.receipt_path,
      days: daysOf(row.period),
    };
    if (row.provider === 'manual_qr' && (row.status === 'pending' || row.status === 'awaiting_review') && m) {
      out.qrUrl = m.qrUrl;
      out.methodNote = m.note;
      out.instructions = `请用${m.name}扫描收款码，转账 ${out.amountLabel}，并在转账备注中填写订单码 ${row.code}。付款后点击「我已付款」。开通需管理员核对，不会自动到账。`;
    }
    if (admin) {
      out.providerRef = row.provider_ref || null;
      out.reviewedBy = row.reviewed_by || null;
      out.receiptMime = row.receipt_mime || null;
      out.receiptName = row.receipt_name || null;
      out.receiptUrl = row.receipt_path ? '/api/admin/payments/' + row.id + '/receipt' : null;
      out.vipEventId = row.vip_event_id || null;
    }
    return out;
  }

  function ev(orderId, action, actorType, actorId, detail) {
    insEv.run(orderId, nowFn(), action, actorType || null, actorId || null, detail ? JSON.stringify(detail) : null);
  }

  function get(idOrCode) {
    expire();
    return byId.get(idOrCode) || byCode.get(String(idOrCode || '').toUpperCase()) || null;
  }

  function create(user, body = {}) {
    expire();
    if (!user) throw new ApiError(401, 'UNAUTHENTICATED', '请先登录');
    const period = String(body.period || body.planPeriod || '').trim();
    const price = priceOf(period);
    let provider = String(body.provider || env.NOVA_PAY_PROVIDER || 'manual_qr').trim() || 'manual_qr';
    if (STUB_PROVIDERS.includes(provider)) {
      throw new ApiError(501, 'NOT_CONFIGURED', '该支付渠道尚未配置商户凭证。当前应用使用人工收款码开通 VIP，请改用 manual_qr。', {provider});
    }
    if (provider !== 'manual_qr' && provider !== 'mock') {
      throw new ApiError(400, 'BAD_PROVIDER', '不支持的支付方式', {provider});
    }
    if (!isAvailable() && provider === 'manual_qr') {
      throw new ApiError(503, 'PAY_UNAVAILABLE', '当前没有可用的收款方式');
    }
    let method = String(body.method || '').trim();
    if (provider === 'mock') method = method || 'mock';
    if (provider === 'manual_qr') {
      if (!MANUAL_METHODS.includes(method)) throw new ApiError(400, 'BAD_METHOD', '请选择微信或支付宝');
      const m = methods().find(x => x.id === method);
      if (!m || !m.enabled) throw new ApiError(400, 'METHOD_DISABLED', (method === 'wechat' ? '微信支付' : '支付宝') + '暂未开放，请换一种方式');
    }
    const n = openCount.get(user.id).n;
    const cap = pendingLimit();
    if (n >= cap) throw new ApiError(429, 'PENDING_LIMIT', `你已有 ${n} 笔待处理订单，请先完成或等待过期（最多 ${cap} 笔）`);
    const at = nowFn();
    const expires = at + expireMinutes() * 60e3;
    let code = newCode(), guard = 0;
    while (byCode.get(code) && guard++ < 16) code = newCode();
    if (byCode.get(code)) throw new ApiError(500, 'CODE_COLLISION', '订单码生成失败，请重试');
    const id = newId();
    ins.run(id, code, user.id, provider, method, period, 'vip', price.amountCents, price.currency || 'CNY',
      'pending', null, expires, at, at);
    ev(id, 'created', 'user', user.id, {provider, method, period, amountCents: price.amountCents});
    if (audit) audit(user.id, 'pay.create', 'order:' + id, null, {code, period, method, provider});
    return {order: pub(byId.get(id)), config: publicConfig()};
  }

  function listFor(user, {limit = 20} = {}) {
    expire();
    const n = Math.min(Math.max(Number(limit) || 20, 1), 50);
    return {orders: listMine.all(user.id, n).map(r => pub(r)), config: publicConfig()};
  }

  function getFor(user, id, {admin = false} = {}) {
    expire();
    const row = get(id);
    if (!row) throw new ApiError(404, 'NOT_FOUND', '订单不存在');
    if (!admin && Number(row.user_id) !== Number(user.id)) throw new ApiError(404, 'NOT_FOUND', '订单不存在');
    return {order: pub(row, {admin}), events: admin ? listEv.all(row.id).map(e => ({
      id: e.id, at: e.at, action: e.action, actorType: e.actor_type, actorId: e.actor_id,
      detail: e.detail ? (() => { try { return JSON.parse(e.detail); } catch { return e.detail; } })() : null,
    })) : undefined};
  }

  function saveReceipt(row, receipt) {
    if (!receipt) return row;
    const buf = Buffer.isBuffer(receipt.data) ? receipt.data : b64ToBuf(receipt.data || receipt.base64 || receipt.body);
    if (buf.length > RECEIPT_MAX) throw new ApiError(413, 'RECEIPT_TOO_LARGE', '截图不能超过 5 MB');
    if (buf.length < 24) throw new ApiError(400, 'BAD_RECEIPT', '截图文件太小或不完整');
    const mime = sniffMime(buf, receipt.mime || receipt.type);
    if (!mime || !RECEIPT_MIME[mime]) throw new ApiError(400, 'BAD_RECEIPT_TYPE', '截图只接受 JPG、PNG 或 WebP');
    const name = String(receipt.name || ('receipt.' + RECEIPT_MIME[mime])).replace(/[^\w.\u4e00-\u9fff-]/g, '_').slice(0, 80);
    const fp = join(receiptDir, row.id + '.' + RECEIPT_MIME[mime]);
    // 清掉旧扩展名的文件
    for (const ext of Object.values(RECEIPT_MIME)) {
      const old = join(receiptDir, row.id + '.' + ext);
      if (existsSync(old) && old !== fp) try { unlinkSync(old); } catch { /* ignore */ }
    }
    writeFileSync(fp, buf);
    updReceipt.run(fp, mime, name, nowFn(), row.id);
    ev(row.id, 'receipt', 'user', row.user_id, {mime, bytes: buf.length, name});
    return byId.get(row.id);
  }

  function markPaid(user, id, body = {}) {
    expire();
    const row0 = get(id);
    if (!row0 || Number(row0.user_id) !== Number(user.id)) throw new ApiError(404, 'NOT_FOUND', '订单不存在');
    if (row0.status === 'expired') throw new ApiError(409, 'EXPIRED', '订单已过期，请重新下单');
    if (row0.status === 'rejected') throw new ApiError(409, 'REJECTED', '订单已被拒绝：' + (row0.reject_reason || ''));
    if (row0.status === 'paid' || row0.status === 'refunded') throw new ApiError(409, 'ALREADY_PAID', '该订单已处理完毕');
    let row = row0;
    if (body.receipt || body.screenshot) row = saveReceipt(row, body.receipt || body.screenshot) || row;
    if (row.status === 'pending') {
      updStatus.run('awaiting_review', null, row.provider_ref, null, null, nowFn(), row.vip_event_id, row.id);
      ev(row.id, 'awaiting_review', 'user', user.id, {hasReceipt: !!(body.receipt || body.screenshot || row.receipt_path)});
      if (audit) audit(user.id, 'pay.awaiting_review', 'order:' + row.id, null, {code: row.code});
    }
    return {order: pub(byId.get(row.id))};
  }

  function receiptFile(row) {
    if (!row || !row.receipt_path || !existsSync(row.receipt_path)) throw new ApiError(404, 'NOT_FOUND', '没有付款截图');
    return {buf: readFileSync(row.receipt_path), mime: row.receipt_mime || 'image/jpeg', name: row.receipt_name || 'receipt.jpg'};
  }

  function activate(row, {actorType, actorId, providerRef, note} = {}) {
    // 幂等：已开通则不再重复授予
    if (row.status === 'paid') return {order: pub(byId.get(row.id), {admin: true}), already: true};
    if (row.status === 'refunded') throw new ApiError(409, 'REFUNDED', '订单已退款，不能再开通');
    if (row.status === 'rejected') throw new ApiError(409, 'REJECTED', '订单已被拒绝');
    const days = daysOf(row.period);
    const u = vip.grant(row.user_id, {days, source: 'payment', actorId: actorId || null, note: note || ('order:' + row.code)});
    const evId = db.prepare('SELECT id FROM vip_events WHERE user_id=? ORDER BY id DESC LIMIT 1').get(row.user_id);
    updStatus.run('paid', null, providerRef || row.provider_ref, nowFn(), actorId || null, nowFn(), evId ? evId.id : null, row.id);
    ev(row.id, 'paid', actorType || 'admin', actorId || null, {days, providerRef, vipUntil: u.vip_until});
    return {order: pub(byId.get(row.id), {admin: true}), already: false, vipUntil: u.vip_until, user: u};
  }

  function confirm(admin, id, body = {}) {
    expire();
    const row = get(id);
    if (!row) throw new ApiError(404, 'NOT_FOUND', '订单不存在');
    if (row.status === 'pending') throw new ApiError(409, 'NOT_CLAIMED', '用户尚未提交「我已付款」');
    if (row.status === 'expired' && !row.receipt_path) throw new ApiError(409, 'EXPIRED', '订单已过期');
    const r = activate(row, {actorType: 'admin', actorId: admin.id, providerRef: body.providerRef || body.provider_ref, note: body.note});
    if (audit) audit(admin.id, 'admin.payment.confirm', 'order:' + row.id, null, {code: row.code, already: r.already, adminUsername: admin.username});
    return r;
  }

  function reject(admin, id, body = {}) {
    expire();
    const row = get(id);
    if (!row) throw new ApiError(404, 'NOT_FOUND', '订单不存在');
    if (row.status === 'paid') throw new ApiError(409, 'ALREADY_PAID', '订单已开通，不能拒绝。如需撤销会员请走 VIP 撤销。');
    if (row.status === 'rejected') return {order: pub(row, {admin: true}), already: true};
    const reason = String(body.reason || body.note || '').trim();
    if (!reason) throw new ApiError(400, 'BAD_REASON', '请填写拒绝原因');
    updStatus.run('rejected', reason.slice(0, 500), row.provider_ref, null, admin.id, nowFn(), row.vip_event_id, row.id);
    ev(row.id, 'rejected', 'admin', admin.id, {reason: reason.slice(0, 500)});
    if (audit) audit(admin.id, 'admin.payment.reject', 'order:' + row.id, null, {code: row.code, reason: reason.slice(0, 200), adminUsername: admin.username});
    return {order: pub(byId.get(row.id), {admin: true}), already: false};
  }

  function refund(admin, id, body = {}) {
    expire();
    const row = get(id);
    if (!row) throw new ApiError(404, 'NOT_FOUND', '订单不存在');
    if (row.status === 'refunded') return {order: pub(row, {admin: true}), already: true};
    if (row.status !== 'paid') throw new ApiError(409, 'NOT_PAID', '只能对已开通的订单标记退款状态（不会自动撤销 VIP）');
    updStatus.run('refunded', body.reason || row.reject_reason, body.providerRef || row.provider_ref, row.paid_at, admin ? admin.id : row.reviewed_by, nowFn(), row.vip_event_id, row.id);
    ev(row.id, 'refunded', admin ? 'admin' : 'provider', admin ? admin.id : null, {reason: body.reason || null, vipRevoked: false});
    if (audit && admin) audit(admin.id, 'admin.payment.refund', 'order:' + row.id, null, {code: row.code, note: '仅标记退款状态，未自动撤销 VIP'});
    return {order: pub(byId.get(row.id), {admin: true}), already: false, vipRevoked: false};
  }

  function adminList(q = {}) {
    expire();
    const limit = Math.min(Math.max(Number(q.limit) || 30, 1), 100);
    const cursor = q.cursor != null && q.cursor !== '' ? String(q.cursor) : null;
    const status = String(q.status || '').trim();
    const search = String(q.q || q.query || '').trim();
    const where = [], args = [];
    if (status && status !== 'all') { where.push('o.status=?'); args.push(status); }
    if (search) {
      where.push('(o.code LIKE ? OR o.id LIKE ? OR IFNULL(p.display_name,"") LIKE ? OR u.username LIKE ?)');
      const like = '%' + search.replace(/%/g, '') + '%';
      args.push(like, like, like, like);
    }
    if (cursor) { where.push('o.created_at<?'); args.push(Number(cursor) || 0); }
    const sql = `SELECT o.* FROM pay_orders o JOIN users u ON u.id=o.user_id LEFT JOIN profiles p ON p.user_id=u.id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY o.created_at DESC LIMIT ?`;
    const rows = db.prepare(sql).all(...args, limit + 1);
    const more = rows.length > limit;
    const slice = more ? rows.slice(0, limit) : rows;
    const userOf = db.prepare('SELECT u.id,u.username,u.email,u.status,u.vip_until,p.display_name FROM users u LEFT JOIN profiles p ON p.user_id=u.id WHERE u.id=?');
    const orders = slice.map(r => {
      const o = pub(r, {admin: true});
      const u = userOf.get(r.user_id);
      o.user = u ? {id: u.id, username: u.username, displayName: u.display_name || u.username, email: u.email, status: u.status, vipUntil: u.vip_until || null} : null;
      return o;
    });
    return {orders, nextCursor: more ? String(slice[slice.length - 1].created_at) : null};
  }

  function webhook(provider, raw, headers = {}, body = {}) {
    expire();
    if (STUB_PROVIDERS.includes(provider)) {
      throw new ApiError(501, 'NOT_CONFIGURED', '该支付渠道尚未配置商户凭证，已拒绝回调。', {provider});
    }
    if (provider !== 'mock') throw new ApiError(404, 'NOT_FOUND', '未知的支付回调');
    const secret = env.NOVA_PAY_MOCK_SECRET;
    if (!secret) throw new ApiError(501, 'NOT_CONFIGURED', '未设置 NOVA_PAY_MOCK_SECRET，拒绝 mock 回调');
    const sig = headers['x-nova-pay-signature'] || headers['X-Nova-Pay-Signature'] || body.signature;
    const rawBuf = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw || ''), 'utf8');
    if (!sameHex(hmacHex(secret, rawBuf), sig)) throw new ApiError(401, 'BAD_SIGNATURE', '回调签名不正确');
    const event = String(body.event || body.type || '').trim();
    const id = body.orderId || body.order_id || body.code || body.id;
    const row = get(id);
    if (!row) throw new ApiError(404, 'NOT_FOUND', '订单不存在');
    if (row.provider !== 'mock') throw new ApiError(409, 'WRONG_PROVIDER', '该订单不是 mock 订单');
    ev(row.id, 'webhook', 'provider', null, {event, providerRef: body.providerRef || body.provider_ref});
    if (event === 'paid' || event === 'payment.succeeded') {
      return activate(row, {actorType: 'provider', actorId: null, providerRef: body.providerRef || body.provider_ref, note: 'mock webhook'});
    }
    if (event === 'refunded' || event === 'refund') {
      return refund(null, row.id, {reason: body.reason || 'mock refund', providerRef: body.providerRef});
    }
    throw new ApiError(400, 'BAD_EVENT', '未知的回调事件');
  }

  return {
    create, listFor, getFor, markPaid, confirm, reject, refund, adminList, webhook,
    pub, get, qrFile, receiptFile, publicConfig, purchaseInfo, isAvailable, methods,
    expire, STUB_PROVIDERS, PERIOD_DAYS, RECEIPT_MAX,
  };
}
