// M2.6 个人资料、颜色文字头像、隐私设置。每项都有默认值；写入服务端校验。
import {ApiError} from './errors.mjs';
import {randomBytes} from 'node:crypto';
import {createLook} from './look.mjs';

export const AVATAR_COLORS = Object.freeze(['#2F6F5E', '#5C4A3A', '#243044', '#6B3A4A', '#3A465C', '#6A5A3C', '#3A3F46', '#C8A96A']);
const GENDERS = new Set(['男', '女', '其他', '']);
const VIS = new Set(['everyone', 'friends', 'private']);
const FREQ = new Set(['everyone', 'nobody']);
export const PRIVACY_DEFAULTS = Object.freeze({
  profileVisibility: 'everyone',
  friendRequests: 'everyone',
  showBirthday: true,
  showAge: true,
  showGender: true,
  searchable: true,
});

const len = s => [...String(s)].length;
const letterOf = s => ([...String(s || '')][0] || '我');
const colorOf = s => AVATAR_COLORS[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];

function ageOf(b) {
  const d = new Date(b), n = new Date();
  if (isNaN(d)) return null;
  let a = n.getFullYear() - d.getFullYear();
  if (n < new Date(n.getFullYear(), d.getMonth(), d.getDate())) a--;
  return a;
}

export function createProfile(db, {now}) {
  const look = createLook(db);
  const setLook = db.prepare(`INSERT INTO profiles(user_id,display_name,avatar_image,cover_image,updated_at) VALUES(?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET avatar_image=excluded.avatar_image, cover_image=excluded.cover_image, updated_at=excluded.updated_at`);
  const getP = db.prepare('SELECT * FROM profiles WHERE user_id=?');
  const upsP = db.prepare(`INSERT INTO profiles(user_id,display_name,bio,gender,birthday,avatar_kind,avatar_color,avatar_letter,updated_at)
    VALUES(@user_id,@display_name,@bio,@gender,@birthday,@avatar_kind,@avatar_color,@avatar_letter,@updated_at)
    ON CONFLICT(user_id) DO UPDATE SET display_name=@display_name,bio=@bio,gender=@gender,birthday=@birthday,
      avatar_kind=@avatar_kind,avatar_color=@avatar_color,avatar_letter=@avatar_letter,updated_at=@updated_at`);
  const getPriv = db.prepare('SELECT * FROM privacy WHERE user_id=?');
  const upsPriv = db.prepare(`INSERT INTO privacy(user_id,profile_visibility,friend_requests,show_birthday,show_age,show_gender,searchable,updated_at)
    VALUES(@user_id,@profile_visibility,@friend_requests,@show_birthday,@show_age,@show_gender,@searchable,@updated_at)
    ON CONFLICT(user_id) DO UPDATE SET profile_visibility=@profile_visibility,friend_requests=@friend_requests,
      show_birthday=@show_birthday,show_age=@show_age,show_gender=@show_gender,searchable=@searchable,updated_at=@updated_at`);

  function defaults(user) {
    const name = user.username;
    return {
      displayName: name, bio: '', gender: '', birthday: '',
      avatar: {kind: 'default', image: null, color: colorOf(name), letter: letterOf(name)},
      cover: null,
    };
  }
  function publicOf(user) {
    const d = defaults(user), r = getP.get(user.id);
    if (!r) return d;
    return {
      displayName: r.display_name || d.displayName,
      bio: r.bio || '',
      gender: r.gender || '',
      birthday: r.birthday || '',
      avatar: {
        // r10：图片头像（媒体 id / 内置样板）。没有图片时 kind=default，新版客户端显示官方默认头像；
        // color/letter 只为兼容旧版客户端保留。
        kind: r.avatar_image ? 'image' : (r.avatar_kind === 'color' ? 'default' : (r.avatar_kind || 'default')),
        image: r.avatar_image || null,
        color: r.avatar_color || d.avatar.color,
        letter: r.avatar_letter || letterOf(r.display_name || d.displayName),
      },
      cover: r.cover_image || null,
    };
  }
  /** r10：保存图片头像 / 背景。body.avatar 或 body.avatarImage、body.cover；空串恢复默认。 */
  function saveLook(user, body = {}) {
    const r = getP.get(user.id) || {};
    let av = r.avatar_image || '', cv = r.cover_image || '';
    const rawAv = body.avatarImage !== undefined ? body.avatarImage
      : (body.avatar && typeof body.avatar === 'object' ? (body.avatar.kind === 'image' ? body.avatar.image : (body.avatar.kind === 'default' ? '' : undefined)) : body.avatar);
    const nAv = look.norm(rawAv, user, {code: 'BAD_AVATAR', label: '头像'});
    if (nAv !== undefined) av = nAv;
    const nCv = look.norm(body.cover !== undefined ? body.cover : body.bg, user, {code: 'BAD_COVER', label: '背景'});
    if (nCv !== undefined) cv = nCv;
    setLook.run(user.id, r.display_name || user.username, av || null, cv || null, now());
    return publicOf(user);
  }
  function validateProfile(b, user, cur) {
    const out = {...cur};
    if (b.displayName !== undefined) {
      const n = String(b.displayName || '').trim();
      if (len(n) < 1 || len(n) > 20) throw new ApiError(400, 'BAD_DISPLAY_NAME', '显示名需要 1 到 20 个字');
      out.displayName = n;
      if (!b.avatar || !b.avatar.letter) out.avatar = {...out.avatar, letter: letterOf(n)};
    }
    if (b.bio !== undefined) {
      const bio = String(b.bio || '');
      if (len(bio) > 80) throw new ApiError(400, 'BAD_BIO', '简介最多 80 字');
      out.bio = bio;
    }
    if (b.gender !== undefined) {
      const g = String(b.gender || '');
      if (!GENDERS.has(g)) throw new ApiError(400, 'BAD_GENDER', '性别选项不正确');
      out.gender = g;
    }
    if (b.birthday !== undefined) {
      const bd = String(b.birthday || '');
      if (bd) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(bd) || isNaN(new Date(bd))) throw new ApiError(400, 'BAD_BIRTHDAY', '生日不正确');
        if (new Date(bd) > new Date()) throw new ApiError(400, 'BAD_BIRTHDAY', '生日不能是未来');
        const a = ageOf(bd); if (a == null || a > 120) throw new ApiError(400, 'BAD_BIRTHDAY', '生日不正确');
      }
      out.birthday = bd;
    }
    if (b.avatar && (b.avatar.kind === 'image' || b.avatar.kind === 'default')) {
      // 图片头像走 saveLook，这里只保留旧的颜色字段不变。
    } else if (b.avatar) {
      if (b.avatar.kind && b.avatar.kind !== 'color') throw new ApiError(400, 'AVATAR_IMAGE_PENDING', '图片头像将在后续版本提供（需完成媒体上传）。现在请使用颜色和文字头像。');
      const color = String((b.avatar.color || out.avatar.color) || '').toUpperCase();
      if (!/^#[0-9A-F]{6}$/.test(color)) throw new ApiError(400, 'BAD_AVATAR_COLOR', '头像颜色不正确');
      const letter = b.avatar.letter != null ? String(b.avatar.letter) : out.avatar.letter;
      if (len(letter) !== 1) throw new ApiError(400, 'BAD_AVATAR_LETTER', '头像文字需要恰好 1 个字');
      out.avatar = {kind: 'color', color, letter};
    }
    return out;
  }
  function save(user, body) {
    const cur = publicOf(user);
    const next = validateProfile(body || {}, user, cur);
    upsP.run({
      user_id: user.id, display_name: next.displayName, bio: next.bio, gender: next.gender, birthday: next.birthday,
      avatar_kind: 'color', avatar_color: next.avatar.color, avatar_letter: next.avatar.letter, updated_at: now(),
    });
    return publicOf(user);
  }
  function privacyOf(user) {
    const r = getPriv.get(user.id), d = PRIVACY_DEFAULTS;
    if (!r) return {...d};
    return {
      profileVisibility: VIS.has(r.profile_visibility) ? r.profile_visibility : d.profileVisibility,
      friendRequests: FREQ.has(r.friend_requests) ? r.friend_requests : d.friendRequests,
      showBirthday: !!r.show_birthday, showAge: !!r.show_age, showGender: !!r.show_gender, searchable: !!r.searchable,
    };
  }
  function savePrivacy(user, body) {
    const cur = privacyOf(user), b = body || {};
    const next = {
      profileVisibility: b.profileVisibility !== undefined ? String(b.profileVisibility) : cur.profileVisibility,
      friendRequests: b.friendRequests !== undefined ? String(b.friendRequests) : cur.friendRequests,
      showBirthday: b.showBirthday !== undefined ? !!b.showBirthday : cur.showBirthday,
      showAge: b.showAge !== undefined ? !!b.showAge : cur.showAge,
      showGender: b.showGender !== undefined ? !!b.showGender : cur.showGender,
      searchable: b.searchable !== undefined ? !!b.searchable : cur.searchable,
    };
    if (!VIS.has(next.profileVisibility)) throw new ApiError(400, 'BAD_PRIVACY', '资料可见范围不正确');
    if (!FREQ.has(next.friendRequests)) throw new ApiError(400, 'BAD_PRIVACY', '好友请求设置不正确');
    upsPriv.run({
      user_id: user.id, profile_visibility: next.profileVisibility, friend_requests: next.friendRequests,
      show_birthday: next.showBirthday ? 1 : 0, show_age: next.showAge ? 1 : 0,
      show_gender: next.showGender ? 1 : 0, searchable: next.searchable ? 1 : 0, updated_at: now(),
    });
    return privacyOf(user);
  }
  let friends = null;
  function attach(deps = {}) { if (deps.friends) friends = deps.friends; }

  function ageYears(birthday, at = now()) {
    const m = String(birthday || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const t = new Date(at);
    let age = t.getUTCFullYear() - Number(m[1]);
    const md = (t.getUTCMonth() + 1) * 100 + t.getUTCDate();
    if (md < Number(m[2]) * 100 + Number(m[3])) age--;
    return age >= 0 && age < 150 ? age : null;
  }

  // 按资料可见范围与字段开关，组装给「别人」看的用户卡。自己始终看完整。
  function viewFor(viewer, target) {
    if (!target || target.status !== 'active') {
      throw new ApiError(404, 'NOT_FOUND', '用户不存在');
    }
    const self = viewer && Number(viewer.id) === Number(target.id);
    const priv = privacyOf(target);
    const vis = priv.profileVisibility || 'everyone';
    if (!self) {
      if (vis === 'private') throw new ApiError(404, 'NOT_FOUND', '用户不存在');
      if (vis === 'friends') {
        const ok = viewer && friends && friends.areFriends(viewer.id, target.id);
        if (!ok) throw new ApiError(403, 'PROFILE_PRIVATE', '该用户资料仅好友可见');
      }
    }
    const p = publicOf(target);
    const isFriend = !!(viewer && friends && friends.areFriends(viewer.id, target.id));
    const card = {
      id: target.id,
      username: target.username,
      displayName: p.displayName,
      bio: p.bio || '',
      avatar: p.avatar,
      cover: p.cover || null,
      badge: target.badge || null,
      vip: !!(target.vip_until && target.vip_until > now()),
      isFriend,
      isSelf: !!self,
      risky: false,
      riskNotice: '',
    };
    if (!self) {
      try {
        const row = db.prepare(`SELECT COUNT(DISTINCT reporter_id) AS n FROM reports WHERE target_user_id=? AND status='pending'`).get(target.id);
        if (row && Number(row.n) >= 2) {
          card.risky = true;
          card.riskNotice = '这个账号近期被多人举报。请核实对方身份，不要轻信转账、投资或私下链接。';
        }
      } catch {}
    }
    if (self || priv.showGender) card.gender = p.gender || '';
    else card.gender = '';
    if (self || priv.showBirthday) card.birthday = p.birthday || '';
    else card.birthday = '';
    if (self || priv.showAge) card.age = ageYears(p.birthday);
    else card.age = null;
    return {user: card};
  }

  return {publicOf, save, saveLook, defaults, privacyOf, savePrivacy, PRIVACY_DEFAULTS, AVATAR_COLORS, attach, viewFor, ageYears};
}

export function newSessionId() { return 'ss_' + randomBytes(16).toString('base64url'); }
export function maskIp(ip) {
  const s = String(ip || '');
  if (!s) return '';
  const v4 = s.match(/(?:^|:)(\d+\.\d+\.\d+)\.\d+$/);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(s)) return s.replace(/\d+$/, '*');
  if (/::ffff:\d+\.\d+\.\d+\.\d+$/i.test(s)) return s.replace(/\d+$/, '*');
  if (s.includes(':')) { const parts = s.split(':').filter((p, i, a) => true); return parts.slice(0, Math.min(3, parts.length)).join(':') + ':*'; }
  return '*';
}
export function deviceOf(ua) {
  const s = String(ua || '');
  if (/iPhone/.test(s)) return 'iPhone';
  if (/iPad/.test(s)) return 'iPad';
  if (/Android/.test(s)) return 'Android';
  if (/Macintosh|Mac OS/.test(s)) return 'Mac';
  if (/Windows/.test(s)) return 'Windows';
  if (/Linux/.test(s)) return 'Linux';
  return '未知设备';
}
