// VIP 服务：状态计算、公开目录。无 HTTP 依赖，便于单测。
// 判断 VIP 是否有效只看 users.vip_until 与「当前时间」，客户端传来的任何字段都不参与。
import {VIP_CONFIG, valueOf, DAY_MS} from './vip-config.mjs';

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

  return {config, now, status, entitlements, has, limit, catalog, lastEvent, grant, revoke};
}
