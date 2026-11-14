// VIP 服务：状态计算、公开目录。无 HTTP 依赖，便于单测。
// 判断 VIP 是否有效只看 users.vip_until 与「当前时间」，客户端传来的任何字段都不参与。
import {VIP_CONFIG, valueOf, DAY_MS} from './vip-config.mjs';

/** 权益检查失败。HTTP 层按 e.s / e.code / e.message / e.extra 返回，不要只靠前端隐藏按钮。 */
export class VipError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.s = status;
    this.code = code;
    this.extra = extra;
  }
}

export function createVip(db, {clock = Date.now, config = VIP_CONFIG} = {}) {
  const now = () => clock();
  const lastEvent = db.prepare('SELECT action, source FROM vip_events WHERE user_id=? ORDER BY id DESC LIMIT 1');
  const getUser = db.prepare('SELECT * FROM users WHERE id=?');
  const setVip = db.prepare('UPDATE users SET vip_until=?, vip_since=?, vip_source=? WHERE id=?');
  const addEvent = db.prepare('INSERT INTO vip_events(user_id,at,action,source,actor_id,until_before,until_after,note) VALUES(?,?,?,?,?,?,?,?)');

  /** state: none 未开通 | active 有效 | expiring 有效但即将到期 | expired 已过期 | revoked 已被撤销 */
  function status(user, at = now()) {
    const until = user.vip_until || null, since = user.vip_since || null;
    const base = {since: null, until: null, daysLeft: null, expiringSoon: false, expiredAt: null, source: null};
    if (until && until > at) {
      const soon = until - at <= config.expiry.soonDays * DAY_MS;
      return {...base, plan: 'vip', state: soon ? 'expiring' : 'active', active: true, since, until,
        daysLeft: Math.ceil((until - at) / DAY_MS), expiringSoon: soon, source: user.vip_source || null};
    }
    if (until) return {...base, plan: 'basic', state: 'expired', active: false, since, expiredAt: until, source: user.vip_source || null};
    const ev = lastEvent.get(user.id);
    // 测试开关关闭不算「被撤销」，回到未开通；只有管理员/支付侧的撤销才是 revoked。
    return {...base, plan: 'basic', state: ev && ev.action === 'revoke' && ev.source !== 'test' ? 'revoked' : 'none', active: false};
  }

  const tx = fn => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

  /** 开通/续期。未过期 → 从原到期日顺延；已过期或未开通 → 从现在开始。写事件流水。 */
  function grant(userId, {days, source, actorId = null, note = null}) {
    if (!(Number.isInteger(days) && days > 0 && days <= 3660)) throw new Error('days 必须是 1–3660 的整数');
    if (!['test', 'admin', 'payment'].includes(source)) throw new Error('未知来源 ' + source);
    return tx(() => {
      const u = getUser.get(userId); if (!u) throw new Error('用户不存在');
      const at = now(), active = !!(u.vip_until && u.vip_until > at), before = u.vip_until || null;
      const until = (active ? u.vip_until : at) + days * DAY_MS, since = active ? (u.vip_since || at) : at;
      setVip.run(until, since, active ? (u.vip_source || source) : source, userId);
      addEvent.run(userId, at, active ? 'extend' : 'grant', source, actorId, before, until, note);
      return getUser.get(userId);
    });
  }
  /** 撤销：立刻失效。 */
  function revoke(userId, {source, actorId = null, note = null}) {
    return tx(() => {
      const u = getUser.get(userId); if (!u) throw new Error('用户不存在');
      setVip.run(null, null, null, userId);
      addEvent.run(userId, now(), 'revoke', source, actorId, u.vip_until || null, null, note);
      return getUser.get(userId);
    });
  }

  /** 按天数缩短有效期（退款用）：只减去本笔天数，不抹掉其他授予。到期日落到现在或之前则清除。 */
  function shorten(userId, {days, source, actorId = null, note = null}) {
    if (!(Number.isInteger(days) && days > 0 && days <= 3660)) throw new Error('days 必须是 1–3660 的整数');
    if (!['test', 'admin', 'payment'].includes(source)) throw new Error('未知来源 ' + source);
    return tx(() => {
      const u = getUser.get(userId); if (!u) throw new Error('用户不存在');
      const at = now(), before = u.vip_until || null;
      let after = before ? before - days * DAY_MS : null;
      if (!after || after <= at) {
        setVip.run(null, null, null, userId);
        after = null;
      } else {
        setVip.run(after, u.vip_since || null, u.vip_source || source, userId);
      }
      addEvent.run(userId, at, 'shorten', source, actorId, before, after, note);
      return getUser.get(userId);
    });
  }

  /** 当前身份下每项权益的取值：flag → true/false；quota → 数字或按 scope 的对象；待定 → null。 */
  function entitlements(user, at = now()) {
    const plan = status(user, at).plan, out = {};
    for (const [key, e] of Object.entries(config.entitlements)) {
      const value = e[plan];
      out[key] = {value, enabled: value !== false && value !== null};
    }
    return out;
  }

  const has = (user, key, at = now()) => {
    const e = entitlements(user, at)[key];
    return !!(e && e.enabled);
  };
  const limit = (user, key, scope, at = now()) => valueOf(key, status(user, at).plan, scope, config);

  /** 公开目录：不含任何用户信息，未登录也可读。 */
  function catalog(extra = {}) {
    const {plans, expiry} = config;
    return {
      version: config.version,
      plans: {basic: {...plans.basic}, vip: {...plans.vip, prices: plans.vip.prices.map(p => ({...p})), purchase: {...plans.vip.purchase}}},
      entitlements: Object.entries(config.entitlements).map(([key, e]) => ({key, ...e})),
      expiry: {soonDays: expiry.soonDays, rule: expiry.rule, dataPolicy: expiry.dataPolicy},
      alwaysFree: [...config.alwaysFree],
      neverSold: [...config.neverSold],
      ...extra,
    };
  }


  /** 统一权益检查：flag 未开通 / 已到期一律抛 403 ENTITLEMENT_REQUIRED（带升级说明）。
      quota 类返回当前额度（Basic 也有免费额度，不会因「不是 VIP」被拒，超额由 requireQuota 处理）。
      判断只看服务端状态，与客户端传来的字段无关。 */
  function requireEntitlement(user, key, at = now()) {
    const e = config.entitlements[key];
    if (!e) throw new VipError(400, 'UNKNOWN_ENTITLEMENT', '未知权益', {entitlement: key});
    const st = status(user, at), ent = entitlements(user, at)[key];
    if (e.kind === 'flag' && !ent.enabled) {
      throw new VipError(403, 'ENTITLEMENT_REQUIRED',
        `这项功能需要 VEXO VIP。开通后即可使用「${e.title}」。`,
        {entitlement: key, plan: st.plan, state: st.state, upgrade: true});
    }
    if (e.kind === 'quota' && ent.value === null) {
      throw new VipError(403, 'ENTITLEMENT_UNAVAILABLE', `「${e.title}」尚未开放。`, {entitlement: key, plan: st.plan});
    }
    return {key, kind: e.kind, title: e.title, plan: st.plan, state: st.state, active: st.active, value: ent.value, enabled: ent.enabled};
  }

  /** 数量额度：used+add 超过当前套餐上限则 403 QUOTA_EXCEEDED。已有内容不受影响，本函数只拦「新增」。 */
  function requireQuota(user, key, {used = 0, add = 1, scope, at} = {}) {
    const r = requireEntitlement(user, key, at);
    const e = config.entitlements[key];
    if (e.kind !== 'quota') throw new VipError(400, 'NOT_A_QUOTA', '此项不是数量额度', {entitlement: key});
    const lim = scope !== undefined ? limit(user, key, scope, at) : r.value;
    if (typeof lim !== 'number') throw new VipError(400, 'BAD_SCOPE', '未知的额度范围', {entitlement: key, scope});
    const u = Number(used) || 0, a = Number(add) || 0;
    if (u + a > lim) {
      const unit = e.unit || '';
      const vipLim = scope !== undefined ? valueOf(key, 'vip', scope, config) : e.vip;
      const msg = r.plan === 'vip'
        ? `「${e.title}」已达 ${lim} ${unit}上限。`.replace(' 上限', '上限')
        : `「${e.title}」已达 ${lim} ${unit}上限（Basic）。升级 VIP 可至 ${vipLim} ${unit}。`.replace(' 上限', '上限');
      throw new VipError(403, 'QUOTA_EXCEEDED', msg.trim(),
        {entitlement: key, plan: r.plan, state: r.state, used: u, add: a, limit: lim, upgrade: r.plan !== 'vip'});
    }
    return {...r, used: u, add: a, limit: lim, remaining: lim - u, scope};
  }

  /** 文本长度：与前端 len() 相同，按 Unicode 码点计数。空内容 400；超限 403 TEXT_TOO_LONG。 */
  function requireTextLength(user, scope, text, at = now()) {
    if (!['post', 'chat', 'channel'].includes(scope)) throw new VipError(400, 'BAD_SCOPE', '请指定发帖、聊天或频道发言', {scope});
    if (typeof text !== 'string') throw new VipError(400, 'BAD_REQUEST', '请输入文字');
    const n = [...text].length;
    if (n < 1) throw new VipError(400, 'EMPTY_TEXT', '内容不能为空');
    const r = requireEntitlement(user, 'longer_post_text', at);
    const lim = limit(user, 'longer_post_text', scope, at);
    if (n > lim) {
      const name = (config.entitlements.longer_post_text.scopeNames || {})[scope] || scope;
      const vipLim = valueOf('longer_post_text', 'vip', scope, config);
      const msg = r.plan === 'vip'
        ? `${name}最多 ${lim} 字，当前 ${n} 字。`
        : `${name}最多 ${lim} 字（Basic），当前 ${n} 字。升级 VIP 可到 ${vipLim} 字。`;
      throw new VipError(403, 'TEXT_TOO_LONG', msg,
        {entitlement: 'longer_post_text', scope, plan: r.plan, state: r.state, length: n, limit: lim, upgrade: r.plan !== 'vip'});
    }
    return {...r, scope, length: n, limit: lim};
  }

  return {config, now, status, entitlements, has, limit, requireEntitlement, requireQuota, requireTextLength, catalog, lastEvent, grant, revoke, shorten};
}
