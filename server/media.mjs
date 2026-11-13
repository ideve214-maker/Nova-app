// M4.5 媒体：本地磁盘存储，元数据与消息分离。访问须鉴权，URL 不可猜。
import {randomBytes, createHmac, createHash, timingSafeEqual} from 'node:crypto';
import {mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync, rmSync, statSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {ApiError} from './errors.mjs';
import {assertMagic} from './security.mjs';
import {processUploadImage} from './image-pipeline.mjs';

const nid = () => 'md_' + randomBytes(18).toString('base64url');
const TICKET_MS = 5 * 60 * 1000;
const FFMPEG = process.env.NOVA_FFMPEG || 'ffmpeg';
const FFPROBE = process.env.NOVA_FFPROBE || 'ffprobe';

// 单文件上限（字节）与格式白名单。VIP 更高。额度（总量）在 M4.5.6 执行。
export const MEDIA_LIMITS = Object.freeze({
  image: Object.freeze({
    mime: Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
    ext: Object.freeze(['jpg', 'jpeg', 'png', 'webp', 'gif']),
    basic: 10 * 1024 * 1024, vip: 20 * 1024 * 1024,
  }),
  video: Object.freeze({
    mime: Object.freeze(['video/mp4', 'video/webm']),
    ext: Object.freeze(['mp4', 'webm']),
    basic: 50 * 1024 * 1024, vip: 100 * 1024 * 1024,
    maxDurationMs: 3 * 60 * 1000, vipDurationMs: 5 * 60 * 1000,
  }),
  audio: Object.freeze({
    mime: Object.freeze(['audio/mpeg', 'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/webm;codecs=opus']),
    ext: Object.freeze(['mp3', 'webm', 'ogg', 'm4a', 'wav']),
    basic: 10 * 1024 * 1024, vip: 20 * 1024 * 1024,
    maxDurationMs: 2 * 60 * 1000, vipDurationMs: 5 * 60 * 1000,
  }),
  file: Object.freeze({
    mime: Object.freeze(['application/pdf', 'application/zip', 'text/plain', 'application/json',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
    ext: Object.freeze(['pdf', 'zip', 'txt', 'json', 'doc', 'docx']),
    basic: 20 * 1024 * 1024, vip: 50 * 1024 * 1024,
  }),
});
// 总量额度（暂定，M4.5.6）：免费 200MB，VIP 2GB。已上传在到期后保留，超额不能新上传。
export const MEDIA_QUOTA = Object.freeze({basic: 200 * 1024 * 1024, vip: 2 * 1024 * 1024 * 1024});

function mimeKind(mime, name = '') {
  const m = String(mime || '').toLowerCase().split(';')[0].trim();
  const ext = String(name).split('.').pop().toLowerCase();
  for (const [k, v] of Object.entries(MEDIA_LIMITS)) {
    if (v.mime.some(x => x.split(';')[0] === m) || v.ext.includes(ext)) return k;
  }
  return null;
}

function ffprobe(path) {
  const r = spawnSync(FFPROBE, ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', path], {encoding: 'utf8', timeout: 15000});
  if (r.status !== 0) return null;
  try { return JSON.parse(r.stdout || '{}'); } catch { return null; }
}

function ffmpegPreview(src, dest, kind) {
  const args = kind === 'video'
    ? ['-y', '-ss', '00:00:01', '-i', src, '-frames:v', '1', '-vf', "scale='min(480,iw)':-2", dest]
    : ['-y', '-i', src, '-vf', "scale='min(480,iw)':-2", '-q:v', '4', dest];
  const r = spawnSync(FFMPEG, args, {encoding: 'utf8', timeout: 20000});
  return r.status === 0 && existsSync(dest);
}

function ffmpegCompressImage(src, dest) {
  const r = spawnSync(FFMPEG, ['-y', '-i', src, '-vf', "scale='min(1920,iw)':-2", '-q:v', '3', dest], {encoding: 'utf8', timeout: 20000});
  return r.status === 0 && existsSync(dest);
}

/** 风险扫描接口位：默认不假装已扫描通过。接入真实扫描器时注入 scanImpl。 */
export function defaultScan() {
  return {status: 'pending', skipped: true, reason: '未配置文件扫描器'};
}

export function createMedia(db, {now, vip, profile, secret, mediaDir, scanImpl} = {}) {
  const root = mediaDir || join(dirname(fileURLToPath(import.meta.url)), '../data/media');
  mkdirSync(root, {recursive: true});
  const ticketKey = secret || randomBytes(32);
  const scan = typeof scanImpl === 'function' ? scanImpl : defaultScan;

  const ins = db.prepare(`INSERT INTO media(id,owner_id,kind,mime,name,size,width,height,duration,path,preview_path,sha256,created_at,conversation_id,message_id,scan_status,scan_detail)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const byId = db.prepare('SELECT * FROM media WHERE id=?');
  const used = db.prepare('SELECT COALESCE(SUM(size),0) AS n FROM media WHERE owner_id=? AND deleted_at IS NULL');
  const setDel = db.prepare('UPDATE media SET deleted_at=? WHERE id=? AND owner_id=? AND deleted_at IS NULL');
  const setLink = db.prepare('UPDATE media SET conversation_id=?, message_id=? WHERE id=?');
  const setScan = db.prepare('UPDATE media SET scan_status=?, scan_detail=? WHERE id=?');
  const userBy = db.prepare('SELECT * FROM users WHERE id=?');
  const mem = db.prepare('SELECT * FROM conversation_members WHERE conversation_id=? AND user_id=? AND left_at IS NULL');

  function diskPath(name) { return join(root, name); }
  function isVip(user) { return !!(vip && vip.status(user).active); }
  function quotaOf(user) { return isVip(user) ? MEDIA_QUOTA.vip : MEDIA_QUOTA.basic; }
  function usageOf(user) { return used.get(Number(user.id)).n || 0; }

  function pub(row, {includePath} = {}) {
    if (!row || row.deleted_at) return null;
    const out = {
      id: row.id, kind: row.kind, mime: row.mime, name: row.name, size: row.size,
      width: row.width || undefined, height: row.height || undefined, duration: row.duration || undefined,
      createdAt: row.created_at, ownerId: row.owner_id,
      hasPreview: !!row.preview_path,
      scanStatus: row.scan_status,
      conversationId: row.conversation_id || undefined,
      messageId: row.message_id || undefined,
    };
    if (includePath) out.path = row.path; // 仅测试/内部
    return out;
  }

  function canAccess(user, row) {
    if (!row || row.deleted_at) return false;
    if (Number(row.owner_id) === Number(user.id)) return true;
    if (row.conversation_id) {
      const m = mem.get(row.conversation_id, Number(user.id));
      if (m) return true;
    }
    return false;
  }

  function signTicket(mediaId, userId, exp) {
    const payload = mediaId + '.' + userId + '.' + exp;
    const sig = createHmac('sha256', ticketKey).update(payload).digest('base64url');
    return payload + '.' + sig;
  }
  function verifyTicket(ticket) {
    const parts = String(ticket || '').split('.');
    if (parts.length !== 4) return null;
    const [mediaId, userId, exp, sig] = parts;
    if (Number(exp) < now()) return null;
    const expect = createHmac('sha256', ticketKey).update(mediaId + '.' + userId + '.' + exp).digest('base64url');
    const a = Buffer.from(sig), b = Buffer.from(expect);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return {mediaId, userId: Number(userId), exp: Number(exp)};
  }

  async function upload(user, {buffer, mime, name, kind: forceKind}) {
    if (!buffer || !Buffer.isBuffer(buffer) || !buffer.length) throw new ApiError(400, 'NO_FILE', '请选择要上传的文件');
    const name0 = String(name || 'file').slice(0, 120);
    const kind = forceKind || mimeKind(mime, name0);
    if (!kind) throw new ApiError(400, 'BAD_TYPE', '不支持的文件类型');
    const lim = MEDIA_LIMITS[kind];
    const max = isVip(user) ? lim.vip : lim.basic;
    if (buffer.length > max) throw new ApiError(400, 'TOO_LARGE', `文件过大，最多 ${Math.round(max / 1024 / 1024)} MB`, {max, kind});
    // 魔数校验：不能只靠扩展名或客户端声明的 MIME
    assertMagic(buffer, kind, mime);
    const q = quotaOf(user), usedN = usageOf(user);
    if (usedN + buffer.length > q) throw new ApiError(403, 'QUOTA', '媒体存储额度已满', {used: usedN, quota: q});

    const id = nid();
    const sha = createHash('sha256').update(buffer).digest('hex');
    let width = null, height = null, duration = null;
    let storePath = id + '.bin', storeSize = buffer.length, storeMime = String(mime || 'application/octet-stream').split(';')[0];
    let preview = null;
    let scanBuffer = null;

    if (kind === 'image') {
      let processed;
      try { processed = await processUploadImage(buffer); }
      catch { throw new ApiError(400, 'IMAGE_PROCESS', '图片无法安全处理，已拒绝保存原文件'); }
      storePath = id + '.jpg';
      storeSize = processed.main.length;
      storeMime = 'image/jpeg';
      width = processed.width;
      height = processed.height;
      scanBuffer = processed.main;
      writeFileSync(diskPath(storePath), processed.main);
      writeFileSync(diskPath(id + '_p.jpg'), processed.preview);
      preview = id + '_p.jpg';
    } else {
      writeFileSync(diskPath(storePath), buffer);
    }

    if (kind === 'video' || kind === 'audio') {
      const rawPath = diskPath(storePath);
      const info = ffprobe(rawPath);
      if (info) {
        const vs = (info.streams || []).find(s => s.codec_type === 'video');
        const as_ = (info.streams || []).find(s => s.codec_type === 'audio');
        if (vs) { width = +vs.width || null; height = +vs.height || null; }
        const dur = parseFloat((info.format && info.format.duration) || (vs && vs.duration) || (as_ && as_.duration) || 0);
        if (dur) duration = Math.round(dur * 1000);
      }
      if (lim.maxDurationMs && duration) {
        const maxD = isVip(user) ? lim.vipDurationMs : lim.maxDurationMs;
        if (duration > maxD) {
          try { unlinkSync(rawPath); } catch {}
          throw new ApiError(400, 'TOO_LONG', `时长超过限制（最多 ${Math.round(maxD / 1000)} 秒）`);
        }
      }
      if (kind === 'video') {
        const pv = diskPath(id + '_p.jpg');
        if (ffmpegPreview(diskPath(storePath), pv, 'video')) preview = id + '_p.jpg';
      }
    }

    const scanRes = await Promise.resolve(scan({id, kind, mime: storeMime, path: diskPath(storePath), size: storeSize, sha256: sha, buffer: scanBuffer})) || defaultScan();
    const scanStatus = scanRes.status || 'pending';
    const scanDetail = scanRes.reason || scanRes.detail || null;
    if (scanStatus === 'blocked') {
      try { unlinkSync(diskPath(storePath)); } catch {}
      if (preview) try { unlinkSync(diskPath(preview)); } catch {}
      throw new ApiError(400, 'BLOCKED_FILE', '文件未通过安全扫描');
    }
    ins.run(id, Number(user.id), kind, storeMime, name0, storeSize, width, height, duration,
      storePath, preview, sha, now(), null, null, scanStatus, scanDetail);
    return {media: pub(byId.get(id))};
  }

  function get(user, id) {
    const row = byId.get(id);
    if (!row || row.deleted_at) throw new ApiError(404, 'NOT_FOUND', '找不到这个文件');
    if (!canAccess(user, row)) throw new ApiError(404, 'NOT_FOUND', '找不到这个文件');
    return {media: pub(row)};
  }

  function ticket(user, id) {
    const row = byId.get(id);
    if (!row || row.deleted_at) throw new ApiError(404, 'NOT_FOUND', '找不到这个文件');
    if (!canAccess(user, row)) throw new ApiError(404, 'NOT_FOUND', '找不到这个文件');
    const exp = now() + TICKET_MS;
    return {ticket: signTicket(id, user.id, exp), expiresAt: exp};
  }

  function fileOf(userOrTicket, id, {preview} = {}) {
    let user = userOrTicket, via = 'auth';
    if (userOrTicket && userOrTicket.ticket) {
      const v = verifyTicket(userOrTicket.ticket);
      if (!v || v.mediaId !== id) throw new ApiError(403, 'BAD_TICKET', '访问凭证无效或已过期', 403);
      const u = userBy.get(v.userId);
      if (!u) throw new ApiError(403, 'BAD_TICKET', '访问凭证无效或已过期');
      user = u; via = 'ticket';
    }
    const row = byId.get(id);
    if (!row || row.deleted_at) throw new ApiError(404, 'NOT_FOUND', '找不到这个文件');
    if (!canAccess(user, row)) throw new ApiError(404, 'NOT_FOUND', '找不到这个文件');
    if (row.scan_status === 'blocked') throw new ApiError(403, 'BLOCKED_FILE', '文件不可用');
    const rel = preview ? row.preview_path : row.path;
    if (preview && !rel) throw new ApiError(404, 'NO_PREVIEW', '没有预览图');
    const fp = diskPath(rel);
    if (!existsSync(fp)) throw new ApiError(404, 'NOT_FOUND', '文件不存在');
    const mime = preview ? 'image/jpeg' : row.mime;
    return {path: fp, mime, name: row.name, size: statSync(fp).size, via};
  }

  function remove(user, id) {
    const row = byId.get(id);
    if (!row || row.deleted_at) throw new ApiError(404, 'NOT_FOUND', '找不到这个文件');
    if (Number(row.owner_id) !== Number(user.id)) throw new ApiError(403, 'FORBIDDEN', '只能删除自己上传的文件');
    setDel.run(now(), id, Number(user.id));
    // 策略：软删除记录；文件在清理任务中删除（purge）
    return {deleted: true};
  }

  function purgeDeleted() {
    const rows = db.prepare('SELECT * FROM media WHERE deleted_at IS NOT NULL').all();
    let n = 0;
    for (const r of rows) {
      try { if (r.path) unlinkSync(diskPath(r.path)); } catch {}
      try { if (r.preview_path) unlinkSync(diskPath(r.preview_path)); } catch {}
      db.prepare('DELETE FROM media WHERE id=?').run(r.id);
      n++;
    }
    return {purged: n};
  }

  function attachToMessage(mediaId, conversationId, messageId) {
    const row = byId.get(mediaId);
    if (!row || row.deleted_at) throw new ApiError(404, 'NOT_FOUND', '找不到这个文件');
    setLink.run(conversationId || null, messageId || null, mediaId);
    return pub(byId.get(mediaId));
  }

  function usage(user) {
    const u = usageOf(user), q = quotaOf(user);
    return {used: u, quota: q, remain: Math.max(0, q - u), vip: isVip(user)};
  }

  return {
    upload, get, ticket, fileOf, remove, purgeDeleted, attachToMessage, usage,
    canAccess, pub, verifyTicket, signTicket, quotaOf, usageOf,
    root, MEDIA_LIMITS, MEDIA_QUOTA, TICKET_MS, defaultScan,
    _byId: byId,
  };
}
