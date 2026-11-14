// r10 营销管理（1）：营销帖（广告）。
// - 管理端维护广告（文字 / 图片 / 视频 / 第三方广告位），设置「每 N 条普通帖插 1 条」「每次刷新每人最多几条」「每人每天上限」。
// - 用户端信息流第一页附带 ads（服务端为每个用户随机挑选，已点「不感兴趣」的不再出现；只有一条时重复使用）。
// - 曝光、点击、不感兴趣都回报到服务端，管理端可看数据。
import {randomBytes} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {ApiError} from './errors.mjs';

const KINDS = new Set(['text', 'image', 'video', 'sdk']);
const SDK_PROVIDERS = new Set(['revive', 'admob', 'pangle', 'gdt']);
const MEDIA_MIME = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm'};
const MEDIA_MAX = 30 * 1024 * 1024;
const DEFAULTS = {enabled: true, every: 5, perFeed: 3, dailyCap: 20};
const HIDE_REASONS = ['不感兴趣', '重复看到', '内容不适', '虚假广告', '其他'];

const nid = () => 'ad_' + randomBytes(9).toString('base64url');
const clampInt = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
function str(v, max) { if (v == null) return null; const s = String(v).trim(); return s ? [...s].slice(0, max).join('') : null; }
function isHttpUrl(s) { return /^https?:\/\/[^\s]+$/i.test(String(s || '')); }
function isSafeMediaUrl(s) { return isHttpUrl(s) || /^\/api\/marketing\/media\/[A-Za-z0-9_.-]+$/.test(String(s || '')); }
function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.slice(0, 3).toString() === 'GIF') return 'image/gif';
  if (buf.slice(4, 8).toString() === 'ftyp') return 'video/mp4';
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'video/webm';
  return null;
}

export function createMarketing(db, {now = Date.now, dataDir, blockwords} = {}) {
  const mediaDir = dataDir;
  if (mediaDir) mkdirSync(mediaDir, {recursive: true});
  const getFlag = db.prepare('SELECT value FROM app_flags WHERE key=?');
  const setFlag = db.prepare(`INSERT INTO app_flags(key,value,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`);
  const byId = db.prepare('SELECT * FROM marketing_ads WHERE id=? AND deleted_at IS NULL');
  const listAll = db.prepare('SELECT * FROM marketing_ads WHERE deleted_at IS NULL ORDER BY created_at DESC');
  const active = db.prepare(`SELECT * FROM marketing_ads WHERE deleted_at IS NULL AND enabled=1
    AND (starts_at IS NULL OR starts_at<=?) AND (ends_at IS NULL OR ends_at>?)
    AND id NOT IN (SELECT ad_id FROM marketing_ad_hides WHERE user_id=?)`);
  const ins = db.prepare(`INSERT INTO marketing_ads(id,kind,advertiser,title,text,media,link_url,cta,sdk_provider,sdk_slot,enabled,weight,starts_at,ends_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const upd = db.prepare(`UPDATE marketing_ads SET kind=?,advertiser=?,title=?,text=?,media=?,link_url=?,cta=?,sdk_provider=?,sdk_slot=?,enabled=?,weight=?,starts_at=?,ends_at=?,updated_at=? WHERE id=?`);
  const del = db.prepare('UPDATE marketing_ads SET deleted_at=?, enabled=0 WHERE id=?');
  const bump = {
    impression: db.prepare('UPDATE marketing_ads SET impressions=impressions+1 WHERE id=?'),
    click: db.prepare('UPDATE marketing_ads SET clicks=clicks+1 WHERE id=?'),
    hide: db.prepare('UPDATE marketing_ads SET hides=hides+1 WHERE id=?'),
  };
  const hideIns = db.prepare('INSERT OR IGNORE INTO marketing_ad_hides(user_id,ad_id,reason,created_at) VALUES(?,?,?,?)');
  const dayGet = db.prepare('SELECT n FROM marketing_ad_daily WHERE user_id=? AND day=?');
  const dayInc = db.prepare(`INSERT INTO marketing_ad_daily(user_id,day,n) VALUES(?,?,1)
    ON CONFLICT(user_id,day) DO UPDATE SET n=n+1`);
  const dayKey = () => new Date(now() + 8 * 3600e3).toISOString().slice(0, 10); // 按北京时间切日

  function settings() {
    let v = {};
    try { const r = getFlag.get('marketing.ads'); if (r) v = JSON.parse(r.value) || {}; } catch { v = {}; }
    return {
      enabled: v.enabled == null ? DEFAULTS.enabled : !!v.enabled,
      every: clampInt(v.every, 1, 100, DEFAULTS.every),
      perFeed: clampInt(v.perFeed, 0, 20, DEFAULTS.perFeed),
      dailyCap: clampInt(v.dailyCap, 0, 1000, DEFAULTS.dailyCap),
    };
  }
  function saveSettings(body = {}) {
    const cur = settings();
    const next = {
      enabled: body.enabled == null ? cur.enabled : !!body.enabled && body.enabled !== 'false' && body.enabled !== '0',
      every: body.every == null ? cur.every : clampInt(body.every, 1, 100, cur.every),
      perFeed: body.perFeed == null ? cur.perFeed : clampInt(body.perFeed, 0, 20, cur.perFeed),
      dailyCap: body.dailyCap == null ? cur.dailyCap : clampInt(body.dailyCap, 0, 1000, cur.dailyCap),
    };
    setFlag.run('marketing.ads', JSON.stringify(next), now());
    return settings();
  }

  function parseMedia(v) {
    if (v == null || v === '') return [];
    const arr = Array.isArray(v) ? v : (() => { try { return JSON.parse(v); } catch { return []; } })();
    return arr.slice(0, 9).map(m => {
      const url = typeof m === 'string' ? m : m && m.url;
      if (!isSafeMediaUrl(url)) return null;
      const kind = (m && m.kind) || (/\.(mp4|webm)(\?|$)/i.test(url) ? 'video' : 'image');
      return {url: String(url).slice(0, 500), kind: kind === 'video' ? 'video' : 'image'};
    }).filter(Boolean);
  }
  function pub(row, {admin = false} = {}) {
    if (!row) return null;
    const out = {
      id: row.id, kind: row.kind, advertiser: row.advertiser || '', title: row.title || '', text: row.text || '',
      media: parseMedia(row.media), linkUrl: row.link_url || '', cta: row.cta || '',
      sdk: row.kind === 'sdk' ? {provider: row.sdk_provider || '', slot: row.sdk_slot || ''} : null,
      badge: '推广',
    };
    if (admin) Object.assign(out, {
      enabled: !!row.enabled, weight: row.weight, startsAt: row.starts_at, endsAt: row.ends_at,
      impressions: row.impressions, clicks: row.clicks, hides: row.hides,
      ctr: row.impressions ? Math.round(row.clicks / row.impressions * 10000) / 100 : 0,
      createdAt: row.created_at, updatedAt: row.updated_at,
    });
    return out;
  }
  function fields(b, cur = {}) {
    const kind = String(b.kind != null ? b.kind : (cur.kind || 'text')).trim();
    if (!KINDS.has(kind)) throw new ApiError(400, 'BAD_KIND', '类型只能是文字、图片、视频或第三方广告位');
    const o = {
      kind,
      advertiser: b.advertiser !== undefined ? str(b.advertiser, 40) : cur.advertiser,
      title: b.title !== undefined ? str(b.title, 60) : cur.title,
      text: b.text !== undefined ? str(b.text, 1000) : cur.text,
      media: b.media !== undefined ? JSON.stringify(parseMedia(b.media)) : (cur.media || '[]'),
      link_url: b.linkUrl !== undefined ? str(b.linkUrl, 500) : cur.link_url,
      cta: b.cta !== undefined ? str(b.cta, 12) : cur.cta,
      sdk_provider: b.sdkProvider !== undefined ? str(b.sdkProvider, 20) : cur.sdk_provider,
      sdk_slot: b.sdkSlot !== undefined ? str(b.sdkSlot, 300) : cur.sdk_slot,
      enabled: b.enabled !== undefined ? (b.enabled && b.enabled !== 'false' && b.enabled !== '0' ? 1 : 0) : (cur.enabled == null ? 1 : cur.enabled),
      weight: b.weight !== undefined ? clampInt(b.weight, 1, 100, 1) : (cur.weight || 1),
      starts_at: b.startsAt !== undefined ? (b.startsAt ? Number(b.startsAt) || null : null) : (cur.starts_at || null),
      ends_at: b.endsAt !== undefined ? (b.endsAt ? Number(b.endsAt) || null : null) : (cur.ends_at || null),
    };
    for (const k of Object.keys(o)) if (o[k] === undefined) o[k] = null;
    if (o.link_url && !isHttpUrl(o.link_url)) throw new ApiError(400, 'BAD_LINK', '链接需要以 http:// 或 https:// 开头');
    const media = JSON.parse(o.media);
    if (kind === 'text' && !o.text && !o.title) throw new ApiError(400, 'BAD_TEXT', '请填写广告文字');
    if ((kind === 'image' || kind === 'video') && !media.length) throw new ApiError(400, 'BAD_MEDIA', kind === 'video' ? '请上传视频' : '请上传图片');
    if (kind === 'sdk') {
      if (!o.sdk_provider || !SDK_PROVIDERS.has(o.sdk_provider)) throw new ApiError(400, 'BAD_SDK', '请选择广告平台');
      if (!o.sdk_slot) throw new ApiError(400, 'BAD_SDK', '请填写广告位 ID 或地址');
      if (o.sdk_provider === 'revive' && !isHttpUrl(o.sdk_slot)) throw new ApiError(400, 'BAD_SDK', 'Revive 广告位请填写完整的 afr.php 地址');
    }
    if (blockwords && typeof blockwords.assertPlatform === 'function') {
      for (const t of [o.title, o.text]) if (t) blockwords.assertPlatform(t);
    }
    return o;
  }
  function create(b = {}) {
    const f = fields(b);
    const id = nid(), t = now();
    ins.run(id, f.kind, f.advertiser, f.title, f.text, f.media, f.link_url, f.cta, f.sdk_provider, f.sdk_slot, f.enabled, f.weight, f.starts_at, f.ends_at, t, t);
    return {ad: pub(byId.get(id), {admin: true})};
  }
  function update(id, b = {}) {
    const cur = byId.get(id);
    if (!cur) throw new ApiError(404, 'NOT_FOUND', '营销帖不存在');
    const f = fields(b, cur);
    upd.run(f.kind, f.advertiser, f.title, f.text, f.media, f.link_url, f.cta, f.sdk_provider, f.sdk_slot, f.enabled, f.weight, f.starts_at, f.ends_at, now(), id);
    return {ad: pub(byId.get(id), {admin: true})};
  }
  function remove(id) {
    if (!byId.get(id)) throw new ApiError(404, 'NOT_FOUND', '营销帖不存在');
    del.run(now(), id);
    return {deleted: id};
  }
  function adminList() {
    return {ads: listAll.all().map(r => pub(r, {admin: true})), settings: settings(), hideReasons: HIDE_REASONS};
  }

  // 按权重随机挑选，不放回；候选不够时重复使用（只有一条也照样按频率出现）。
  function pickFor(user) {
    const st = settings();
    if (!st.enabled || !st.perFeed || !user) return {ads: [], every: st.every};
    let want = st.perFeed;
    if (st.dailyCap) {
      const used = (dayGet.get(user.id, dayKey()) || {n: 0}).n;
      want = Math.min(want, Math.max(0, st.dailyCap - used));
    }
    // 第三方 SDK 广告位里只有 Revive（网页投放）能在网页端直接展示；其它需要原生 SDK，暂不下发。
    const pool = active.all(now(), now(), user.id).filter(r => r.kind !== 'sdk' || r.sdk_provider === 'revive');
    if (!want || !pool.length) return {ads: [], every: st.every};
    const out = [];
    let bag = pool.slice();
    while (out.length < want) {
      if (!bag.length) bag = pool.slice();
      const total = bag.reduce((a, r) => a + (r.weight || 1), 0);
      let x = Math.random() * total, i = 0;
      for (; i < bag.length - 1; i++) { x -= bag[i].weight || 1; if (x <= 0) break; }
      out.push(pub(bag[i]));
      bag.splice(i, 1);
    }
    return {ads: out, every: st.every};
  }

  function track(user, id, action, body = {}) {
    const row = byId.get(id);
    if (!row) throw new ApiError(404, 'NOT_FOUND', '营销帖不存在');
    if (action === 'impression') {
      bump.impression.run(id);
      if (user) dayInc.run(user.id, dayKey());
    } else if (action === 'click') bump.click.run(id);
    else if (action === 'hide') {
      if (!user) throw new ApiError(401, 'UNAUTHORIZED', '请先登录');
      const reason = HIDE_REASONS.includes(body.reason) ? body.reason : '不感兴趣';
      const r = hideIns.run(user.id, id, reason, now());
      if (r.changes) bump.hide.run(id);
    } else throw new ApiError(400, 'BAD_ACTION', '操作不正确');
    return {ok: true};
  }

  function saveMedia(b = {}) {
    if (!mediaDir) throw new ApiError(503, 'NO_STORAGE', '没有可用的存储目录');
    let buf;
    try { buf = Buffer.from(String(b.data || b.base64 || '').replace(/^data:[^,]*,/, '').replace(/\s/g, ''), 'base64'); }
    catch { throw new ApiError(400, 'BAD_MEDIA', '文件数据无法读取'); }
    if (!buf.length) throw new ApiError(400, 'BAD_MEDIA', '请选择要上传的文件');
    if (buf.length > MEDIA_MAX) throw new ApiError(413, 'TOO_LARGE', '文件不能超过 30 MB');
    const mime = sniff(buf);
    if (!mime) throw new ApiError(400, 'BAD_MEDIA', '只支持 JPG、PNG、WebP、GIF 图片和 MP4、WebM 视频');
    const name = 'mk_' + randomBytes(10).toString('hex') + '.' + MEDIA_MIME[mime];
    writeFileSync(join(mediaDir, name), buf);
    return {url: '/api/marketing/media/' + name, kind: mime.startsWith('video/') ? 'video' : 'image', mime, bytes: buf.length};
  }
  function mediaFile(name) {
    if (!mediaDir || !/^mk_[a-f0-9]{20}\.(jpg|png|webp|gif|mp4|webm)$/.test(name)) throw new ApiError(404, 'NOT_FOUND', '文件不存在');
    const fp = join(mediaDir, name);
    if (!existsSync(fp)) throw new ApiError(404, 'NOT_FOUND', '文件不存在');
    const ext = name.split('.').pop();
    const mime = Object.keys(MEDIA_MIME).find(k => MEDIA_MIME[k] === ext) || 'application/octet-stream';
    return {buf: readFileSync(fp), mime};
  }

  return {settings, saveSettings, create, update, remove, adminList, pickFor, track, saveMedia, mediaFile, pub, HIDE_REASONS};
}
