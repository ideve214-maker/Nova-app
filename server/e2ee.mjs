// M4.11.3 设备公钥目录与一次性预密钥领取。
// 服务端只保存公钥；领取一次性密钥是消耗性的。不实现加解密，不加自写 ratchet。
import {createHash} from 'node:crypto';
import {ApiError} from './errors.mjs';

const DEVICE_RE = /^[A-Za-z0-9_-]{8,64}$/;
const KEY_RE = /^[A-Za-z0-9+/_-]+=*$/;
const KEY_ID_RE = /^[A-Za-z0-9+/=_-]{1,64}$/;
const MAX_DEVICES = 20; // 防滥用上限，不是产品策略（设备数量由负责人决定）
const MAX_OTK_UPLOAD = 100;
const MAX_OTK_STORED = 100;

function isB64Key(s) {
  return typeof s === 'string' && s.length >= 32 && s.length <= 64 && KEY_RE.test(s);
}

// 安全号码：双方 Ed25519 身份公钥按字典序拼接后 SHA-256，取前 24 字节编成 12 组 5 位十进制数字。
// 这是展示用指纹，不是密钥交换。客户端用同一算法独立计算以便核对。
export function safetyNumber(edA, edB) {
  const a = String(edA || ''), b = String(edB || '');
  const [x, y] = a < b ? [a, b] : [b, a];
  const hash = createHash('sha256').update(x + '|' + y, 'utf8').digest();
  const groups = [];
  for (let i = 0; i < 24; i += 2) {
    const n = hash[i] * 256 + hash[i + 1];
    groups.push(String(n % 100000).padStart(5, '0'));
  }
  return groups.join(' ');
}

function rejectPrivate(body) {
  if (!body || typeof body !== 'object') return;
  const blob = JSON.stringify(body);
  if (/pickle|privateKey|private_key|identityPrivate|secretKey|secret_key|accountPickle/i.test(blob)
      && /"(pickle|privateKey|private_key|identityPrivate|secretKey|secret_key|accountPickle)"\s*:/i.test(blob)) {
    throw new ApiError(400, 'PRIVATE_KEY_REJECTED', '私钥不得上传到服务器');
  }
}


const CT_MAX = 32 * 1024;

// 密文体是应用层信封，里面是 vodozemac 产出的 Olm 密文。拒绝夹带明文。
export function parseCiphertext(raw) {
  if (typeof raw !== 'string' || !raw.length || raw.length > CT_MAX) {
    throw new ApiError(400, 'BAD_CIPHERTEXT', '密文无效或过长');
  }
  let o;
  try { o = JSON.parse(raw); } catch { throw new ApiError(400, 'BAD_CIPHERTEXT', '密文格式不正确'); }
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new ApiError(400, 'BAD_CIPHERTEXT', '密文格式不正确');
  if (o.text != null || o.plaintext != null || o.plain != null) {
    throw new ApiError(400, 'PLAINTEXT_IN_CIPHERTEXT', '密文中不得夹带明文');
  }
  const envs = o.envelopes;
  if (o.v !== 1 || !Array.isArray(envs) || !envs.length || envs.length > 20) {
    throw new ApiError(400, 'BAD_CIPHERTEXT', '密文信封无效');
  }
  const out = [];
  for (const e of envs) {
    if (!e || typeof e !== 'object') throw new ApiError(400, 'BAD_CIPHERTEXT', '密文信封无效');
    if (e.text != null || e.plaintext != null) throw new ApiError(400, 'PLAINTEXT_IN_CIPHERTEXT', '密文中不得夹带明文');
    const deviceId = String(e.deviceId || '').trim();
    const body = String(e.body || '').trim();
    let type = e.type;
    if (type === 'olm.prekey' || type === 0 || type === '0') type = 0;
    else if (type === 'olm.message' || type === 1 || type === '1') type = 1;
    else throw new ApiError(400, 'BAD_E2EE_TYPE', '密文类型无效');
    if (!DEVICE_RE.test(deviceId) || !body || body.length > 16384 || !/^[A-Za-z0-9+/_=-]+$/.test(body)) {
      throw new ApiError(400, 'BAD_CIPHERTEXT', '密文信封无效');
    }
    out.push({deviceId, type, body, sessionId: e.sessionId ? String(e.sessionId).slice(0, 80) : undefined});
  }
  return {v: 1, envelopes: out};
}

export function createE2ee(db, {now, friends} = {}) {
  const nowFn = now || Date.now;
  const devById = db.prepare('SELECT * FROM e2ee_devices WHERE id=?');
  const devsOf = db.prepare('SELECT * FROM e2ee_devices WHERE user_id=? ORDER BY created_at');
  const activeOf = db.prepare('SELECT * FROM e2ee_devices WHERE user_id=? AND revoked_at IS NULL ORDER BY created_at');
  const nActive = db.prepare('SELECT COUNT(*) AS n FROM e2ee_devices WHERE user_id=? AND revoked_at IS NULL');
  const insDev = db.prepare(`INSERT INTO e2ee_devices(id,user_id,curve25519,ed25519,fallback_key_id,fallback_key,created_at,updated_at,revoked_at)
    VALUES(?,?,?,?,?,?,?,?,NULL)`);
  const updDev = db.prepare(`UPDATE e2ee_devices SET fallback_key_id=?, fallback_key=?, updated_at=? WHERE id=? AND user_id=? AND revoked_at IS NULL`);
  const revokeDev = db.prepare('UPDATE e2ee_devices SET revoked_at=?, updated_at=? WHERE id=? AND user_id=? AND revoked_at IS NULL');
  const insOtk = db.prepare(`INSERT INTO e2ee_one_time_keys(device_id,user_id,key_id,key,created_at) VALUES(?,?,?,?,?)`);
  const nFree = db.prepare('SELECT COUNT(*) AS n FROM e2ee_one_time_keys WHERE device_id=? AND claimed_at IS NULL');
  const nextOtk = db.prepare('SELECT * FROM e2ee_one_time_keys WHERE device_id=? AND claimed_at IS NULL ORDER BY id LIMIT 1');
  const claimOtk = db.prepare(`UPDATE e2ee_one_time_keys SET claimed_at=?, claimed_by_user_id=?, claimed_by_device_id=?
    WHERE id=? AND claimed_at IS NULL`);
  const dropFree = db.prepare('DELETE FROM e2ee_one_time_keys WHERE device_id=? AND claimed_at IS NULL');
  const otkExists = db.prepare('SELECT 1 FROM e2ee_one_time_keys WHERE device_id=? AND key_id=?');

  function pubDev(d, {includeCounts = false} = {}) {
    if (!d) return null;
    const out = {
      deviceId: d.id,
      userId: d.user_id,
      identityKey: {curve25519: d.curve25519, ed25519: d.ed25519},
      fingerprint: safetyNumber(d.ed25519, d.ed25519), // 单设备自身指纹；双方安全号码由客户端用双方 ed25519 计算
      createdAt: d.created_at,
      revoked: !!d.revoked_at,
      revokedAt: d.revoked_at || null,
    };
    if (includeCounts) out.oneTimeKeyCount = nFree.get(d.id).n;
    return out;
  }

  function canSee(viewer, targetId) {
    if (Number(viewer.id) === Number(targetId)) return true;
    if (friends && typeof friends.areFriends === 'function' && friends.areFriends(viewer.id, targetId)) return true;
    return false;
  }

  function upload(user, body = {}) {
    rejectPrivate(body);
    const deviceId = String(body.deviceId || '').trim();
    if (!DEVICE_RE.test(deviceId)) throw new ApiError(400, 'BAD_DEVICE', '设备 ID 格式不正确');
    const idk = body.identityKey || body.identityKeys || {};
    const curve = String(idk.curve25519 || '').trim();
    const ed = String(idk.ed25519 || '').trim();
    if (!isB64Key(curve) || !isB64Key(ed)) throw new ApiError(400, 'BAD_IDENTITY', '身份公钥格式不正确');
    const t = nowFn();
    const existing = devById.get(deviceId);
    if (existing) {
      if (Number(existing.user_id) !== Number(user.id)) throw new ApiError(409, 'DEVICE_TAKEN', '该设备已属于其他账号');
      if (existing.revoked_at) throw new ApiError(409, 'DEVICE_REVOKED', '该设备已撤销，请使用新的设备 ID');
      if (existing.curve25519 !== curve || existing.ed25519 !== ed) {
        throw new ApiError(409, 'IDENTITY_CHANGED', '同一设备不得更换身份密钥，请用新设备 ID 并请对方重新核对安全号码');
      }
    } else {
      const n = nActive.get(Number(user.id)).n;
      if (n >= MAX_DEVICES) throw new ApiError(400, 'TOO_MANY_DEVICES', '设备数量已达上限，请先撤销一台');
      insDev.run(deviceId, Number(user.id), curve, ed, null, null, t, t);
    }
    let fbId = null, fbKey = null;
    const fb = body.fallbackKey;
    if (fb && (fb.key || fb.publicKey)) {
      fbId = String(fb.keyId || fb.id || 'fallback').trim();
      fbKey = String(fb.key || fb.publicKey).trim();
      if (!KEY_ID_RE.test(fbId) || !isB64Key(fbKey)) throw new ApiError(400, 'BAD_FALLBACK', '备用密钥格式不正确');
    }
    if (fbKey) updDev.run(fbId, fbKey, t, deviceId, Number(user.id));
    else updDev.run(existing ? existing.fallback_key_id : null, existing ? existing.fallback_key : null, t, deviceId, Number(user.id));

    const rawOtks = body.oneTimeKeys || body.otks || {};
    const map = rawOtks.curve25519 && typeof rawOtks.curve25519 === 'object' ? rawOtks.curve25519 : rawOtks;
    const entries = Object.entries(map || {}).filter(([k, v]) => k && v);
    if (entries.length > MAX_OTK_UPLOAD) throw new ApiError(400, 'TOO_MANY_KEYS', '一次最多上传 ' + MAX_OTK_UPLOAD + ' 个一次性密钥');
    let added = 0;
    const free = nFree.get(deviceId).n;
    for (const [kid, key] of entries) {
      if (!KEY_ID_RE.test(String(kid)) || !isB64Key(String(key))) throw new ApiError(400, 'BAD_OTK', '一次性密钥格式不正确');
      if (free + added >= MAX_OTK_STORED) break;
      if (otkExists.get(deviceId, String(kid))) continue;
      try { insOtk.run(deviceId, Number(user.id), String(kid), String(key), t); added++; }
      catch (e) { if (!/UNIQUE/i.test(String(e.message))) throw e; }
    }
    const dev = devById.get(deviceId);
    return {device: pubDev(dev, {includeCounts: true}), added};
  }

  function listMine(user) {
    return {devices: devsOf.all(Number(user.id)).map(d => pubDev(d, {includeCounts: true}))};
  }

  function listOf(user, userId) {
    const uid = Number(userId);
    if (!Number.isInteger(uid) || uid <= 0) throw new ApiError(400, 'BAD_USER', '请指定用户');
    if (!canSee(user, uid)) throw new ApiError(403, 'FORBIDDEN', '只能查看自己或好友的设备密钥');
    const rows = activeOf.all(uid);
    return {
      userId: uid,
      devices: rows.map(d => pubDev(d, {includeCounts: true})),
    };
  }

  function claim(user, body = {}) {
    const uid = Number(body.userId);
    if (!Number.isInteger(uid) || uid <= 0) throw new ApiError(400, 'BAD_USER', '请指定用户');
    if (Number(uid) === Number(user.id)) throw new ApiError(400, 'SELF_CLAIM', '不能领取自己的一次性密钥');
    if (!canSee(user, uid)) throw new ApiError(403, 'FORBIDDEN', '只能向好友领取密钥');
    const want = body.deviceId ? String(body.deviceId) : null;
    const devices = activeOf.all(uid);
    if (!devices.length) throw new ApiError(404, 'NO_KEYS', '对方尚未上传加密设备密钥');
    const targets = want ? devices.filter(d => d.id === want) : devices;
    if (want && !targets.length) throw new ApiError(404, 'NO_DEVICE', '找不到该设备或已撤销');
    const myDev = body.myDeviceId ? String(body.myDeviceId) : null;
    const t = nowFn();
    const claimed = [];
    for (const d of targets) {
      let otk = null;
      for (let i = 0; i < 3; i++) {
        const row = nextOtk.get(d.id);
        if (!row) break;
        const r = claimOtk.run(t, Number(user.id), myDev, row.id);
        if (r.changes === 1) { otk = {keyId: row.key_id, key: row.key}; break; }
      }
      const fallback = (!otk && d.fallback_key) ? {keyId: d.fallback_key_id, key: d.fallback_key} : null;
      if (!otk && !fallback) continue;
      claimed.push({
        deviceId: d.id,
        identityKey: {curve25519: d.curve25519, ed25519: d.ed25519},
        oneTimeKey: otk,
        fallbackKey: fallback,
        remaining: nFree.get(d.id).n,
      });
    }
    if (!claimed.length) throw new ApiError(409, 'KEYS_EXHAUSTED', '对方一次性密钥已用尽，请稍后再试');
    return {userId: uid, keys: claimed};
  }

  function revoke(user, deviceId) {
    const id = String(deviceId || '').trim();
    const d = devById.get(id);
    if (!d || Number(d.user_id) !== Number(user.id)) throw new ApiError(404, 'NOT_FOUND', '找不到这台设备');
    if (d.revoked_at) return {device: pubDev(d), already: true};
    const t = nowFn();
    revokeDev.run(t, t, id, Number(user.id));
    dropFree.run(id);
    return {device: pubDev(devById.get(id))};
  }

  return {upload, listMine, listOf, claim, revoke, safetyNumber, pubDev, MAX_DEVICES};
}
