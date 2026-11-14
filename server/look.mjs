// r10：头像/封面/背景图片的统一校验。
// 允许：留空或 'default'（恢复官方默认）、内置样板 assets/*.jpg|png|webp|svg、
// 自己上传的图片媒体 md_xxx、以及旧版 1.0.x 直接提交的小 jpeg data URL。
import {ApiError} from './errors.mjs';

const ASSET = /^assets\/[a-z0-9_\-/]{1,120}\.(jpg|jpeg|png|webp|svg)$/i;
const MEDIA = /^md_[A-Za-z0-9_-]{8,80}$/;
const DATA_PREFIX = 'data:image/jpeg;base64,';

export function createLook(db) {
  const mediaBy = db.prepare('SELECT * FROM media WHERE id=? AND deleted_at IS NULL');
  // 被用作头像/封面的媒体对所有登录用户可见（否则别人只能看到默认图）。
  const refs = [
    db.prepare('SELECT 1 AS n FROM profiles WHERE avatar_image=? OR cover_image=? LIMIT 1'),
    db.prepare('SELECT 1 AS n FROM communities WHERE (cover=? OR avatar=?) AND deleted_at IS NULL LIMIT 1'),
    db.prepare('SELECT 1 AS n FROM conversations WHERE (avatar=? OR avatar=?) AND deleted_at IS NULL LIMIT 1'),
  ];
  /** 返回 undefined 表示没传；'' 表示恢复默认；否则返回规范化后的值。 */
  function norm(v, user, {code = 'BAD_IMAGE', label = '图片'} = {}) {
    if (v === undefined) return undefined;
    if (v === null) return '';
    const s = String(v).trim();
    if (!s || s === 'default') return '';
    if (s.length < 200 && ASSET.test(s) && !s.includes('..')) return s;
    if (MEDIA.test(s)) {
      const m = mediaBy.get(s);
      if (!m || m.kind !== 'image') throw new ApiError(400, code, label + '不存在或不是图片');
      if (m.scan_status === 'blocked') throw new ApiError(400, code, label + '未通过安全检查');
      if (user && Number(m.owner_id) !== Number(user.id)) throw new ApiError(403, code, '只能使用自己上传的' + label);
      return s;
    }
    if (s.startsWith(DATA_PREFIX)) {
      if (s.length > 450000) throw new ApiError(400, code, label + '太大，请换一张小一点的');
      const body = s.slice(DATA_PREFIX.length).replace(/\s+/g, '');
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) throw new ApiError(400, code, label + '格式不正确');
      return DATA_PREFIX + body;
    }
    throw new ApiError(400, code, label + '格式不正确');
  }
  function isLookMedia(id) {
    if (!MEDIA.test(String(id || ''))) return false;
    try { return refs.some(q => !!q.get(id, id)); } catch { return false; }
  }
  return {norm, isLookMedia};
}
