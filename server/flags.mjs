// r9 全站开关。管理端写入，用户端 GET /api/app/status 读取。
import {ApiError} from './errors.mjs';

const BOOL_KEYS = ['maintenance', 'registrationOpen', 'reviewRequired', 'loginProtect'];
const DEFAULTS = {
  maintenance: false,
  registrationOpen: true,
  reviewRequired: false,
  loginProtect: true,
  maintenanceMessage: '系统维护中，请稍后再试',
};

function asBool(v, dflt) {
  if (v == null || v === '') return dflt;
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  const s = String(v).trim().toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true;
  if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false;
  return dflt;
}

export function createFlags(db, {now = Date.now} = {}) {
  const all = db.prepare('SELECT key, value FROM app_flags');
  const upsert = db.prepare(`INSERT INTO app_flags(key, value, updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`);

  function read() {
    const map = Object.fromEntries(all.all().map(r => [r.key, r.value]));
    const out = {
      maintenance: asBool(map.maintenance, DEFAULTS.maintenance),
      registrationOpen: asBool(map.registrationOpen, DEFAULTS.registrationOpen),
      reviewRequired: asBool(map.reviewRequired, DEFAULTS.reviewRequired),
      loginProtect: asBool(map.loginProtect, DEFAULTS.loginProtect),
      maintenanceMessage: map.maintenanceMessage != null && String(map.maintenanceMessage).trim()
        ? String(map.maintenanceMessage).slice(0, 200)
        : DEFAULTS.maintenanceMessage,
    };
    return out;
  }

  function save(body = {}) {
    const src = body && body.flags && typeof body.flags === 'object' ? body.flags : (body || {});
    const cur = read();
    const next = {...cur};
    for (const k of BOOL_KEYS) {
      if (src[k] != null) next[k] = asBool(src[k], cur[k]);
    }
    if (src.maintenanceMessage != null) {
      const msg = String(src.maintenanceMessage).trim().slice(0, 200);
      if (!msg) throw new ApiError(400, 'BAD_MESSAGE', '请填写维护说明');
      next.maintenanceMessage = msg;
    }
    const t = now();
    for (const k of BOOL_KEYS) upsert.run(k, next[k] ? '1' : '0', t);
    upsert.run('maintenanceMessage', next.maintenanceMessage, t);
    return read();
  }

  return {read, save};
}
