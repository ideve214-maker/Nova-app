// r10 营销管理（3）：推流 / 加热（参考抖音 DOU+、快手粉条）。
// 价格 → 曝光：DOU+ 市场参考约 100 元 ≈ 5000 次播放（约 0.02 元 / 次），平台只给预估、不承诺。
// 这里按「保证曝光人数」卖：每个用户最多算 1 次（真实露出 ≥0.8 秒才算），投满即止；到期没投满按实际曝光结束，管理员可退款。
// 付款沿用会员的人工收款码流程：下单 → 扫码转账并备注订单码 → 点「我已付款」→ 管理员核对后开始投放。
import {randomBytes} from 'node:crypto';
import {ApiError} from './errors.mjs';

const CODE_ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DEFAULT_PLANS = [
  {id: 'p1', name: '体验', priceCents: 990, impressions: 300, days: 3},
  {id: 'p2', name: '标准', priceCents: 2990, impressions: 1000, days: 3},
  {id: 'p3', name: '进阶', priceCents: 9900, impressions: 4000, days: 7},
  {id: 'p4', name: '爆款', priceCents: 29900, impressions: 15000, days: 7},
];
const DEFAULT_SETTINGS = {enabled: true, perFeed: 2, slots: [2, 7], pendingLimit: 3, expireMinutes: 1440};
const OPEN = ['pending', 'awaiting_review'];
const STATUS_LABEL = {pending: '待付款', awaiting_review: '等待核对', active: '推流中', done: '已投完', ended: '已结束', rejected: '已拒绝', expired: '已过期', refunded: '已退款'};
const yuan = c => '¥' + (c / 100).toFixed(c % 100 ? (c % 10 ? 2 : 1) : 0);
const clampInt = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

export function createBoost(db, {now = Date.now, pay, posts, audit} = {}) {
  const getFlag = db.prepare('SELECT value FROM app_flags WHERE key=?');
  const setFlag = db.prepare(`INSERT INTO app_flags(key,value,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`);
  const byId = db.prepare('SELECT * FROM boost_orders WHERE id=?');
  const byCode = db.prepare('SELECT * FROM boost_orders WHERE code=?');
  const ins = db.prepare(`INSERT INTO boost_orders(id,code,user_id,post_id,plan_id,plan_name,amount_cents,impressions,days,method,status,expires_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,'pending',?,?,?)`);
  const setStatus = db.prepare('UPDATE boost_orders SET status=?, reject_reason=?, reviewed_by=?, updated_at=? WHERE id=?');
  const activate = db.prepare("UPDATE boost_orders SET status='active', paid_at=?, starts_at=?, ends_at=?, reviewed_by=?, updated_at=? WHERE id=?");
  const openCnt = db.prepare("SELECT COUNT(*) n FROM boost_orders WHERE user_id=? AND status IN ('pending','awaiting_review')");
  const mine = db.prepare('SELECT * FROM boost_orders WHERE user_id=? ORDER BY created_at DESC LIMIT 50');
  const ofPost = db.prepare("SELECT * FROM boost_orders WHERE post_id=? AND status='active' ORDER BY created_at LIMIT 1");
  const activeAll = db.prepare("SELECT * FROM boost_orders WHERE status='active' AND ends_at>? AND delivered<impressions");
  const insImp = db.prepare('INSERT OR IGNORE INTO boost_impressions(order_id,user_id,at) VALUES(?,?,?)');
  const incDel = db.prepare("UPDATE boost_orders SET delivered=delivered+1, updated_at=? WHERE id=?");
  const finish = db.prepare("UPDATE boost_orders SET status='done', updated_at=? WHERE id=? AND status='active' AND delivered>=impressions");
  const expirePending = db.prepare("UPDATE boost_orders SET status='expired', updated_at=? WHERE status='pending' AND expires_at<=?");
  const endDue = db.prepare("UPDATE boost_orders SET status='ended', updated_at=? WHERE status='active' AND ends_at<=?");
  const seenPost = db.prepare('SELECT 1 FROM post_views WHERE post_id=? AND user_id=?');
  const postRow = db.prepare('SELECT * FROM posts WHERE id=?');

  function jsonFlag(key, d) { try { const r = getFlag.get(key); return r ? JSON.parse(r.value) : d; } catch { return d; } }
  function plans() {
    const v = jsonFlag('boost.plans', null);
    const list = Array.isArray(v) && v.length ? v : DEFAULT_PLANS;
    return list.map(p => ({...p, priceLabel: yuan(p.priceCents), cpm: Math.round(p.priceCents / p.impressions * 1000) / 100}));
  }
  function savePlans(list) {
    if (!Array.isArray(list) || !list.length || list.length > 8) throw new ApiError(400, 'BAD_PLANS', '请设置 1–8 个套餐');
    const out = list.map((p, i) => {
      const name = String(p.name || '').trim().slice(0, 12);
      const priceCents = Math.round(Number(p.priceCents != null ? p.priceCents : Number(p.price) * 100));
      const impressions = Math.round(Number(p.impressions));
      const days = Math.round(Number(p.days));
      if (!name) throw new ApiError(400, 'BAD_PLANS', '套餐名称不能为空');
      if (!Number.isFinite(priceCents) || priceCents < 1 || priceCents > 10000000) throw new ApiError(400, 'BAD_PLANS', '价格需在 ¥0.01 到 ¥100000 之间');
      if (!Number.isFinite(impressions) || impressions < 1 || impressions > 10000000) throw new ApiError(400, 'BAD_PLANS', '曝光数需在 1 到 1000 万之间');
      if (!Number.isFinite(days) || days < 1 || days > 30) throw new ApiError(400, 'BAD_PLANS', '投放天数需在 1 到 30 天之间');
      return {id: String(p.id || ('p' + (i + 1))).slice(0, 16), name, priceCents, impressions, days};
    });
    setFlag.run('boost.plans', JSON.stringify(out), now());
    return plans();
  }
  function settings() {
    const v = jsonFlag('boost.settings', {}) || {};
    return {
      enabled: v.enabled == null ? DEFAULT_SETTINGS.enabled : !!v.enabled,
      perFeed: clampInt(v.perFeed, 0, 5, DEFAULT_SETTINGS.perFeed),
      slots: Array.isArray(v.slots) && v.slots.length ? v.slots.map(n => clampInt(n, 0, 50, 2)).slice(0, 5) : DEFAULT_SETTINGS.slots,
      pendingLimit: DEFAULT_SETTINGS.pendingLimit,
      expireMinutes: DEFAULT_SETTINGS.expireMinutes,
    };
  }
  function saveSettings(b = {}) {
    const cur = settings();
    const next = {
      enabled: b.enabled == null ? cur.enabled : !!b.enabled && b.enabled !== 'false' && b.enabled !== '0',
      perFeed: b.perFeed == null ? cur.perFeed : clampInt(b.perFeed, 0, 5, cur.perFeed),
      slots: Array.isArray(b.slots) ? b.slots.map(n => clampInt(n, 0, 50, 2)).slice(0, 5) : cur.slots,
    };
    setFlag.run('boost.settings', JSON.stringify(next), now());
    if (b.plans) savePlans(b.plans);
    return {settings: settings(), plans: plans()};
  }
  function sweep() { const t = now(); expirePending.run(t, t); endDue.run(t, t); }
  function newCode() { let s = 'BT'; for (let i = 0; i < 6; i++) s += CODE_ALPH[randomBytes(1)[0] % CODE_ALPH.length]; return s; }

  function pub(r, {admin = false} = {}) {
    if (!r) return null;
    const m = pay ? pay.methods().find(x => x.id === r.method) : null;
    const out = {
      id: r.id, code: r.code, postId: r.post_id, planId: r.plan_id, planName: r.plan_name,
      amountCents: r.amount_cents, amountLabel: yuan(r.amount_cents), impressions: r.impressions, days: r.days,
      method: r.method, methodName: m ? m.name : r.method, status: r.status, statusLabel: STATUS_LABEL[r.status] || r.status,
      delivered: r.delivered, progress: r.impressions ? Math.min(100, Math.round(r.delivered / r.impressions * 100)) : 0,
      rejectReason: r.reject_reason || null, createdAt: r.created_at, paidAt: r.paid_at, startsAt: r.starts_at, endsAt: r.ends_at, expiresAt: r.expires_at,
    };
    if (OPEN.includes(r.status) && m) {
      out.qrUrl = m.qrUrl;
      out.instructions = `请用${m.name}扫描收款码，转账 ${out.amountLabel}，并在转账备注中填写订单码 ${r.code}。付款后点「我已付款」，管理员核对后开始推流，不会自动扣款。`;
    }
    if (admin) {
      const u = db.prepare('SELECT u.id,u.username,p.display_name FROM users u LEFT JOIN profiles p ON p.user_id=u.id WHERE u.id=?').get(r.user_id);
      out.user = u ? {id: u.id, username: u.username, displayName: u.display_name || u.username} : null;
      const p = postRow.get(r.post_id);
      out.post = p ? {id: p.id, text: String(p.text || '').slice(0, 120), deleted: !!p.deleted_at} : null;
      out.reviewedBy = r.reviewed_by || null;
    }
    return out;
  }

  function catalog(user) {
    const st = settings();
    const methods = pay ? pay.methods().filter(m => m.enabled).map(m => ({id: m.id, name: m.name})) : [];
    return {enabled: st.enabled && methods.length > 0, plans: plans(), methods,
      note: '曝光按人计：每个用户最多算 1 次，真实露出才计数，投满即止。到期没投满按实际曝光结束，可联系管理员处理退款。数字是保底人数，不承诺点赞、关注等效果。'};
  }
  function create(user, b = {}) {
    sweep();
    const st = settings();
    if (!st.enabled) throw new ApiError(403, 'BOOST_OFF', '推流暂未开放');
    const postId = String(b.postId || '').trim();
    const p = postRow.get(postId);
    if (!p || p.deleted_at) throw new ApiError(404, 'NOT_FOUND', '动态不存在');
    if (Number(p.author_id) !== Number(user.id)) throw new ApiError(403, 'FORBIDDEN', '只能给自己的帖子推流');
    if ((p.audience || 'public') !== 'public') throw new ApiError(400, 'NOT_PUBLIC', '只有公开的帖子才能推流');
    const plan = plans().find(x => x.id === String(b.planId || ''));
    if (!plan) throw new ApiError(400, 'BAD_PLAN', '请选择推流套餐');
    const method = String(b.method || '');
    const m = pay && pay.methods().find(x => x.id === method && x.enabled);
    if (!m) throw new ApiError(400, 'BAD_METHOD', '请选择微信或支付宝');
    const n = openCnt.get(user.id).n;
    if (n >= st.pendingLimit) throw new ApiError(429, 'PENDING_LIMIT', `你已有 ${n} 笔待处理的推流订单，请先完成或等待过期`);
    let code = newCode(), g = 0;
    while (byCode.get(code) && g++ < 16) code = newCode();
    const id = 'bo_' + randomBytes(10).toString('base64url'), t = now();
    ins.run(id, code, user.id, postId, plan.id, plan.name, plan.priceCents, plan.impressions, plan.days, method, t + st.expireMinutes * 60e3, t, t);
    if (audit) audit(user.id, 'boost.create', 'boost:' + id, null, {postId, plan: plan.id, code});
    return {order: pub(byId.get(id))};
  }
  function ownOrder(user, id) {
    sweep();
    const r = byId.get(id) || byCode.get(String(id || '').toUpperCase());
    if (!r || Number(r.user_id) !== Number(user.id)) throw new ApiError(404, 'NOT_FOUND', '订单不存在');
    return r;
  }
  function markPaid(user, id) {
    const r = ownOrder(user, id);
    if (r.status === 'expired') throw new ApiError(409, 'EXPIRED', '订单已过期，请重新下单');
    if (r.status === 'pending') { setStatus.run('awaiting_review', null, null, now(), r.id); if (audit) audit(user.id, 'boost.paid', 'boost:' + r.id); }
    return {order: pub(byId.get(r.id))};
  }
  function listMine(user, q = {}) {
    sweep();
    let rows = mine.all(user.id);
    if (q.postId) rows = rows.filter(r => r.post_id === q.postId);
    return {orders: rows.map(r => pub(r))};
  }
  function adminList(q = {}) {
    sweep();
    const status = String(q.status || '').trim();
    const rows = status && status !== 'all'
      ? db.prepare('SELECT * FROM boost_orders WHERE status=? ORDER BY created_at DESC LIMIT 100').all(status)
      : db.prepare('SELECT * FROM boost_orders ORDER BY created_at DESC LIMIT 100').all();
    return {orders: rows.map(r => pub(r, {admin: true})), plans: plans(), settings: settings()};
  }
  function confirm(admin, id) {
    sweep();
    const r = byId.get(id);
    if (!r) throw new ApiError(404, 'NOT_FOUND', '订单不存在');
    if (r.status === 'active' || r.status === 'done') return {order: pub(r, {admin: true}), already: true};
    if (!['awaiting_review', 'pending', 'expired'].includes(r.status)) throw new ApiError(409, 'BAD_STATUS', '这个订单当前不能开通');
    const p = postRow.get(r.post_id);
    if (!p || p.deleted_at) throw new ApiError(409, 'POST_GONE', '帖子已删除，不能开始推流');
    const t = now();
    activate.run(t, t, t + r.days * 864e5, admin.id, t, r.id);
    return {order: pub(byId.get(r.id), {admin: true}), already: false};
  }
  function reject(admin, id, b = {}) {
    const r = byId.get(id);
    if (!r) throw new ApiError(404, 'NOT_FOUND', '订单不存在');
    const reason = String(b.reason || '').trim().slice(0, 200);
    if (!reason) throw new ApiError(400, 'BAD_REASON', '请填写拒绝原因');
    if (!OPEN.includes(r.status) && r.status !== 'expired') throw new ApiError(409, 'BAD_STATUS', '这个订单当前不能拒绝');
    setStatus.run('rejected', reason, admin.id, now(), r.id);
    return {order: pub(byId.get(r.id), {admin: true})};
  }
  function stop(admin, id, b = {}) {
    const r = byId.get(id);
    if (!r) throw new ApiError(404, 'NOT_FOUND', '订单不存在');
    const refund = !!b.refund;
    if (refund && !['active', 'done', 'ended'].includes(r.status)) throw new ApiError(409, 'BAD_STATUS', '只有已开通的订单才能退款');
    if (!refund && r.status !== 'active') throw new ApiError(409, 'BAD_STATUS', '只有推流中的订单才能停止');
    setStatus.run(refund ? 'refunded' : 'ended', String(b.reason || '').slice(0, 200) || null, admin.id, now(), r.id);
    return {order: pub(byId.get(r.id), {admin: true})};
  }

  // 信息流：为这个用户挑出还没看过、没投满的推流帖（落后进度的优先）。
  function pickFor(user) {
    sweep();
    const st = settings();
    if (!st.enabled || !st.perFeed || !user) return {posts: [], slots: st.slots};
    const t = now();
    const rows = activeAll.all(t).filter(r => Number(r.user_id) !== Number(user.id)
      && !db.prepare('SELECT 1 FROM boost_impressions WHERE order_id=? AND user_id=?').get(r.id, user.id)
      && !seenPost.get(r.post_id, user.id));
    const scored = rows.map(r => {
      const span = Math.max(1, r.ends_at - r.starts_at), elapsed = Math.min(1, (t - r.starts_at) / span);
      const behind = elapsed - r.delivered / r.impressions; // >0 表示落后于均匀投放进度
      return {r, s: behind + Math.random() * 0.2};
    }).sort((a, b) => b.s - a.s);
    const out = [], usedPosts = new Set();
    for (const {r} of scored) {
      if (out.length >= st.perFeed) break;
      if (usedPosts.has(r.post_id)) continue;
      const row = postRow.get(r.post_id);
      if (!row || row.deleted_at || (posts && !posts.canSee(row, user))) continue;
      const p = posts ? posts.pub(row, user) : null;
      if (!p) continue;
      p.boost = {orderId: r.id, label: '曝光中'};
      usedPosts.add(r.post_id);
      out.push(p);
    }
    return {posts: out, slots: st.slots};
  }
  // 真实阅读（postStats.onView）时计入曝光；作者本人不算；每单每人只算一次。
  function onView(row, user) {
    const r = ofPost.get(row.id);
    if (!r || Number(r.user_id) === Number(user.id) || r.ends_at <= now() || r.delivered >= r.impressions) return;
    const x = insImp.run(r.id, user.id, now());
    if (x.changes) { incDel.run(now(), r.id); finish.run(now(), r.id); }
  }
  // 作者自己看到的推流状态
  function badgeFor(postId, me) {
    const r = ofPost.get(postId);
    if (!r || !me || Number(r.user_id) !== Number(me.id)) return null;
    return {orderId: r.id, label: '推流中', delivered: r.delivered, impressions: r.impressions};
  }
  return {catalog, create, markPaid, listMine, adminList, confirm, reject, stop, pickFor, onView, badgeFor, plans, savePlans, settings, saveSettings, sweep, pub};
}
