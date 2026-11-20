// AI 官方内部账号（Cc）：一批公开标明身份的内部账号在社区里活动——浏览、点赞、收藏、转帖、评论、回复真人评论、
// 读新闻写自己的看法发帖、加入公开小组并在小组里聊天。
//
// ideve 定下的规则（全部在这里执行）：
// - 身份：users.badge='internal'，资料简介以「官方内部账号」开头；头像是 DiceBear CC0 插画（AI 角标由用户端叠加）。
// - 不私聊任何人、不进群聊（conversations 表完全不碰）、不创建小组；只加入 visibility='public' 的小组，私密小组一律跳过。
// - 计数：AI 的浏览 / 点赞 / 收藏 / 转帖写进和真人一样的表，用户端显示 = 真人 + 数据调整 + AI。
//   AI 浏览按真实用户算，会消耗推流曝光（ideve 确认）；保留开关 countAiViewsForBoost（默认 true）。
// - 通知：AI 对真人做的每个动作（点赞、收藏、转帖、评论、回复）都按正常方式推送通知；浏览不推（真人浏览也不推）。
// - 模型：默认 glm-4.7-flash（免费）；设置里 model 留空 = 跟全站 /api/admin/ai/model。浏览 / 点赞 / 收藏 / 转帖 / 入组不调用 AI。
// - AI 内容只过屏蔽词，不走 AI 审查。
// - 账号数量不设上限；每轮最多处理 maxActionsPerTick 个账号，只是控制服务器负担，可在管理端调大。
// 对现有代码的所有调用都经过 ai-personas-adapter.mjs。
import {readFileSync} from 'node:fs';
import {ApiError} from './errors.mjs';
import {letterAvatarData, letterOf, colorOf} from './import-feed.mjs';
import {createPersonaAdapter} from './ai-personas-adapter.mjs';
import {createPersonaFeeds, PERSONA_CATEGORIES, CATEGORY_LABEL, postCategoryOf, postMessages, commentMessages, groupMessages,
  parseAiText, scrubAiText, overlapRatio, MAX_OVERLAP, composePost, COMMENT_MAX} from './ai-personas-feeds.mjs';
import {avatarJpeg, avatarStylesWithPreview, isAvatarStyle, DEFAULT_AVATAR_STYLES} from './ai-personas-avatar.mjs';

export const PERSONA_BADGE = 'internal';
export const PERSONA_BIO_PREFIX = '官方内部账号';
export const PERSONA_MODEL = 'glm-4.7-flash';
export const SETTINGS_KEY = 'personas.settings';
export const CREATE_BATCH = 20;
export const AVATAR_ROUTE_RE = /^\/api\/admin\/ai\/personas\/accounts\/(\d+)\/avatar$/;
export const avatarPathOf = userId => `/api/admin/ai/personas/accounts/${userId}/avatar`;
const KINDS = ['browse', 'like', 'favorite', 'repost', 'comment', 'reply', 'post', 'join_group', 'group_post'];
const ONCE_KINDS = new Set(['browse', 'like', 'favorite', 'repost', 'join_group']);

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: false,
  targetCount: 0,
  model: PERSONA_MODEL,
  activeHours: {quietStart: 1, quietEnd: 7, quietFactor: 0.1},
  defaults: {postIntervalMinutes: 480, actionIntervalMinutes: 15, likeRate: 0.35, favoriteRate: 0.08, repostRate: 0.03,
    commentRate: 0.06, replyToUsersRate: 0.7, groupJoinPerDay: 1, groupPostPerDay: 2},
  categories: ['news', 'politics', 'sports', 'economy'],
  limits: {maxActionsPerTick: 60, aiConcurrency: 2, maxAiCommentsPerPost: 3},
  avatarStyles: [...DEFAULT_AVATAR_STYLES],
  countAiViewsForBoost: true,
  feedRefreshMinutes: 20,
});
const RATE_KEYS = ['likeRate', 'favoriteRate', 'repostRate', 'commentRate', 'replyToUsersRate'];
const NUM_KEYS = ['postIntervalMinutes', 'actionIntervalMinutes', 'groupJoinPerDay', 'groupPostPerDay'];

// 昵称：本地词库随机组合，不调 AI。
const NAME_A = ['北岸', '南城', '早八', '晚风', '山海', '小满', '清和', '橘子', '海盐', '青柠', '半夏', '白露', '西窗', '东篱', '野生', '慢热', '路过', '认真', '随缘', '温吞'];
const NAME_B = ['阿杰', '的猫', '小林', '老王', '一一', '同学', '观察员', '读者', '小陈', '球迷', '跑者', '看客', '阿宁', '大叔', '学姐', '小周', '酱', '君', '星', '鱼'];
const TONES = ['理性克制，喜欢摆事实', '轻松幽默，偶尔自嘲', '热情直接，爱提问题', '温和友善，喜欢鼓励别人', '冷静简洁，一针见血', '好奇心强，喜欢追问细节'];

const clampNum = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const uniq = a => [...new Set(a)];

export function createAiPersonas(db, deps = {}) {
  const {now = Date.now, env = process.env, random = Math.random} = deps;
  const adapter = deps.adapter || createPersonaAdapter({...deps, db, now});
  const feeds = deps.feeds || createPersonaFeeds(db, {now, random, fetchImpl: deps.feedFetch || globalThis.fetch});
  feeds.seed();
  const avatarGen = deps.avatarJpeg || avatarJpeg;

  const q = {
    getSet: db.prepare('SELECT value FROM admin_ai_settings WHERE key=?'),
    setSet: db.prepare(`INSERT INTO admin_ai_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`),
    persona: db.prepare('SELECT * FROM ai_personas WHERE user_id=?'),
    insP: db.prepare('INSERT INTO ai_personas(user_id,status,persona,avatar_style,avatar_seed,next_at,next_post_at,created_at) VALUES(?,?,?,?,?,?,?,?)'),
    countBy: db.prepare('SELECT status, COUNT(*) n FROM ai_personas GROUP BY status'),
    live: db.prepare("SELECT * FROM ai_personas WHERE status IN ('active','paused') ORDER BY created_at DESC, user_id DESC"),
    due: db.prepare("SELECT * FROM ai_personas WHERE status='active' AND next_at<=? ORDER BY next_at LIMIT ?"),
    setNext: db.prepare('UPDATE ai_personas SET next_at=?, last_action_at=? WHERE user_id=?'),
    setNextPost: db.prepare('UPDATE ai_personas SET next_post_at=? WHERE user_id=?'),
    setReplied: db.prepare('UPDATE ai_personas SET replied_until=? WHERE user_id=?'),
    setStatus: db.prepare('UPDATE ai_personas SET status=?, retired_at=? WHERE user_id=?'),
    setPersona: db.prepare('UPDATE ai_personas SET persona=?, overrides=? WHERE user_id=?'),
    setAvatar: db.prepare('UPDATE ai_personas SET avatar_style=?, avatar_seed=? WHERE user_id=?'),
    pauseAll: db.prepare("UPDATE ai_personas SET status='paused' WHERE status='active'"),
    allIds: db.prepare('SELECT user_id FROM ai_personas'),
    insAct: db.prepare('INSERT OR IGNORE INTO ai_persona_actions(user_id,kind,target,ref_id,ok,error,model,tokens,at) VALUES(?,?,?,?,?,?,?,?,?)'),
    didOnce: db.prepare('SELECT 1 FROM ai_persona_actions WHERE user_id=? AND kind=? AND target=? AND ok=1'),
    todayKinds: db.prepare('SELECT kind, ok, COUNT(*) n, SUM(CASE WHEN model IS NOT NULL THEN 1 ELSE 0 END) ai, COALESCE(SUM(tokens),0) tk FROM ai_persona_actions WHERE at>=? GROUP BY kind, ok'),
    userCounts: db.prepare("SELECT kind, COUNT(*) n FROM ai_persona_actions WHERE user_id=? AND ok=1 GROUP BY kind"),
    profileOf: db.prepare('SELECT p.display_name, p.bio, p.avatar_image, u.username FROM users u LEFT JOIN profiles p ON p.user_id=u.id WHERE u.id=?'),
    // 浏览候选：48 小时内、公开、未删未隐藏、不是自己发的、自己还没看过；真人发的优先。
    browseCand: db.prepare(`SELECT p.* FROM posts p
      WHERE p.deleted_at IS NULL AND COALESCE(p.admin_hidden,0)=0 AND COALESCE(p.audience,'public')='public'
        AND p.created_at>=? AND p.author_id<>?
        AND NOT EXISTS (SELECT 1 FROM post_views v WHERE v.post_id=p.id AND v.user_id=?)
      ORDER BY (p.author_id IN (SELECT user_id FROM ai_personas)) ASC, RANDOM() LIMIT 1`),
    aiCommentsOn: db.prepare('SELECT COUNT(*) n FROM post_comments c WHERE c.post_id=? AND c.deleted_at IS NULL AND c.author_id IN (SELECT user_id FROM ai_personas)'),
    commentedAuthor: db.prepare(`SELECT 1 FROM ai_persona_actions a JOIN posts p ON a.target='post:'||p.id
      WHERE a.user_id=? AND a.kind='comment' AND a.ok=1 AND a.at>=? AND p.author_id=? LIMIT 1`),
    recentComments: db.prepare('SELECT text FROM post_comments WHERE post_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 5'),
    // 真人在我的帖子下的新评论（有文字、还没被我回复过）
    pendingReplies: db.prepare(`SELECT c.* FROM post_comments c JOIN posts p ON p.id=c.post_id
      WHERE p.author_id=? AND p.deleted_at IS NULL AND c.deleted_at IS NULL AND c.created_at>?
        AND c.author_id NOT IN (SELECT user_id FROM ai_personas) AND c.source IS NULL AND TRIM(c.text)<>''
        AND NOT EXISTS (SELECT 1 FROM post_comments r WHERE r.parent_id=c.id AND r.author_id=?)
      ORDER BY c.created_at ASC LIMIT 5`),
    postById: db.prepare('SELECT * FROM posts WHERE id=?'),
    joinCand: db.prepare(`SELECT c.* FROM communities c
      WHERE c.visibility='public' AND c.deleted_at IS NULL AND c.taken_down_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM community_members m WHERE m.community_id=c.id AND m.user_id=?)
      ORDER BY RANDOM() LIMIT 1`),
    myGroups: db.prepare(`SELECT c.* FROM communities c JOIN community_members m ON m.community_id=c.id
      WHERE m.user_id=? AND m.status='active' AND c.visibility='public' AND c.deleted_at IS NULL AND c.taken_down_at IS NULL
        AND (m.muted_until IS NULL OR m.muted_until<=?)
      ORDER BY RANDOM() LIMIT 1`),
    textChannel: db.prepare("SELECT * FROM community_channels WHERE community_id=? AND kind='text' AND deleted_at IS NULL ORDER BY is_default DESC, RANDOM() LIMIT 1"),
    channelRecent: db.prepare('SELECT author_id, text FROM community_messages WHERE channel_id=? AND deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 10'),
    // 管理端指定动作（如「手动点赞」）时：看过的帖子也可以，只排除已经做过这个动作的
    actCand: db.prepare(`SELECT p.* FROM posts p
      WHERE p.deleted_at IS NULL AND COALESCE(p.admin_hidden,0)=0 AND COALESCE(p.audience,'public')='public'
        AND p.created_at>=? AND p.author_id<>?
        AND NOT EXISTS (SELECT 1 FROM ai_persona_actions a WHERE a.user_id=? AND a.kind=? AND a.target='post:'||p.id AND a.ok=1)
      ORDER BY (p.author_id IN (SELECT user_id FROM ai_personas)) ASC, RANDOM() LIMIT 1`),
    myPosts: db.prepare('SELECT id FROM posts WHERE author_id=? AND deleted_at IS NULL'),
  };
  const hasMuted = (() => { try { db.prepare('SELECT muted_until FROM community_members LIMIT 1').get(); return true; } catch { return false; } })();
  if (!hasMuted) q.myGroups = db.prepare(`SELECT c.* FROM communities c JOIN community_members m ON m.community_id=c.id
      WHERE m.user_id=? AND m.status='active' AND c.visibility='public' AND c.deleted_at IS NULL AND c.taken_down_at IS NULL AND ?>=0 ORDER BY RANDOM() LIMIT 1`);

  // ---------- 设置 ----------
  function settings() {
    let saved = {};
    try { const r = q.getSet.get(SETTINGS_KEY); saved = r ? JSON.parse(r.value) || {} : {}; } catch { saved = {}; }
    const d = DEFAULT_SETTINGS;
    return {
      ...d, ...saved,
      activeHours: {...d.activeHours, ...(saved.activeHours || {})},
      defaults: {...d.defaults, ...(saved.defaults || {})},
      limits: {...d.limits, ...(saved.limits || {})},
      categories: Array.isArray(saved.categories) && saved.categories.length ? saved.categories : [...d.categories],
      avatarStyles: Array.isArray(saved.avatarStyles) && saved.avatarStyles.length ? saved.avatarStyles : [...d.avatarStyles],
    };
  }
  function cleanFreq(src, cur) {
    const out = {...cur};
    for (const k of RATE_KEYS) if (src[k] != null) out[k] = clampNum(src[k], 0, 1, cur[k]);
    if (src.postIntervalMinutes != null) out.postIntervalMinutes = clampNum(src.postIntervalMinutes, 5, 60 * 24 * 30, cur.postIntervalMinutes);
    if (src.actionIntervalMinutes != null) out.actionIntervalMinutes = clampNum(src.actionIntervalMinutes, 1, 60 * 24, cur.actionIntervalMinutes);
    if (src.groupJoinPerDay != null) out.groupJoinPerDay = clampNum(src.groupJoinPerDay, 0, 100, cur.groupJoinPerDay);
    if (src.groupPostPerDay != null) out.groupPostPerDay = clampNum(src.groupPostPerDay, 0, 500, cur.groupPostPerDay);
    return out;
  }
  function saveSettings(admin, body = {}, ip) {
    const cur = settings(), next = {...cur};
    if (body.enabled != null) next.enabled = !!body.enabled;
    if (body.targetCount != null) {
      const n = Number(body.targetCount);
      if (!Number.isSafeInteger(n) || n < 0) throw new ApiError(400, 'BAD_COUNT', '账号数量请填 0 或正整数');
      next.targetCount = n;   // 不设上限（ideve）
    }
    if (body.model != null) {
      const m = String(body.model).trim();
      if (m && (!/^[A-Za-z0-9][A-Za-z0-9._:/\-[\]]{0,79}$/.test(m) || /deepseek/i.test(m))) throw new ApiError(400, 'BAD_MODEL', '模型编码不正确');
      next.model = m;
    }
    if (body.activeHours) {
      const a = body.activeHours;
      next.activeHours = {
        quietStart: a.quietStart != null ? Math.round(clampNum(a.quietStart, 0, 23, cur.activeHours.quietStart)) : cur.activeHours.quietStart,
        quietEnd: a.quietEnd != null ? Math.round(clampNum(a.quietEnd, 0, 24, cur.activeHours.quietEnd)) : cur.activeHours.quietEnd,
        quietFactor: a.quietFactor != null ? clampNum(a.quietFactor, 0, 1, cur.activeHours.quietFactor) : cur.activeHours.quietFactor,
      };
    }
    if (body.defaults) next.defaults = cleanFreq(body.defaults, cur.defaults);
    if (body.categories != null) {
      const c = uniq((Array.isArray(body.categories) ? body.categories : []).map(String)).filter(x => PERSONA_CATEGORIES.includes(x));
      if (!c.length) throw new ApiError(400, 'BAD_CATEGORY', '至少选一个分类');
      next.categories = c;
    }
    if (body.limits) {
      const l = body.limits;
      next.limits = {
        maxActionsPerTick: l.maxActionsPerTick != null ? Math.round(clampNum(l.maxActionsPerTick, 1, 100000, cur.limits.maxActionsPerTick)) : cur.limits.maxActionsPerTick,
        aiConcurrency: l.aiConcurrency != null ? Math.round(clampNum(l.aiConcurrency, 1, 20, cur.limits.aiConcurrency)) : cur.limits.aiConcurrency,
        maxAiCommentsPerPost: l.maxAiCommentsPerPost != null ? Math.round(clampNum(l.maxAiCommentsPerPost, 0, 100, cur.limits.maxAiCommentsPerPost)) : cur.limits.maxAiCommentsPerPost,
      };
    }
    if (body.avatarStyles != null) {
      const s = uniq((Array.isArray(body.avatarStyles) ? body.avatarStyles : []).map(String)).filter(isAvatarStyle);
      if (!s.length) throw new ApiError(400, 'BAD_STYLE', '至少选一种头像风格');
      next.avatarStyles = s;
    }
    if (body.countAiViewsForBoost != null) next.countAiViewsForBoost = !!body.countAiViewsForBoost;
    if (body.feedRefreshMinutes != null) next.feedRefreshMinutes = Math.round(clampNum(body.feedRefreshMinutes, 5, 1440, cur.feedRefreshMinutes));
    q.setSet.run(SETTINGS_KEY, JSON.stringify(next), now());
    if (admin) adapter.audit(admin.id, 'admin.ai.personas.settings', 'personas', {changed: Object.keys(body)});
    return overview();
  }

  // ---------- 账号 ----------
  const pick = a => a[Math.floor(random() * a.length)];
  const personaOf = row => { try { return JSON.parse(row.persona || '{}') || {}; } catch { return {}; } };
  const overridesOf = row => { try { return row.overrides ? JSON.parse(row.overrides) : null; } catch { return null; } };
  const freqOf = (row, s) => ({...s.defaults, ...(overridesOf(row) || {})});
  const bioOf = interests => (PERSONA_BIO_PREFIX + ' · 关注' + interests.map(c => CATEGORY_LABEL[c] || c).join('、')).slice(0, 80);
  const jitter = mins => Math.max(30e3, mins * 60e3 * (0.5 + random()));

  function counts() {
    const out = {active: 0, paused: 0, retired: 0};
    for (const r of q.countBy.all()) out[r.status] = r.n;
    return out;
  }
  let creating = false, lastCreateError = null;
  async function createOne(s) {
    let user = null;
    for (let i = 0; i < 5 && !user; i++) {
      const username = 'vx_in_' + Math.floor(random() * 36 ** 6).toString(36).padStart(6, '0');
      try { user = adapter.createUser({username, email: username + '@ai.vexo.invalid'}); } catch (e) { if (!/UNIQUE/i.test(String(e.message))) throw e; }
    }
    if (!user) throw new Error('生成用户名失败');
    const interests = uniq([pick(s.categories), pick(s.categories)]);
    const displayName = (pick(NAME_A) + pick(NAME_B)).slice(0, 20);
    const persona = {interests, tone: pick(TONES), displayName};
    const style = pick(s.avatarStyles), seed = 'vexo-ai-' + user.id + '-' + Math.floor(random() * 1e6);
    const t = now(), f = s.defaults;
    db.exec('BEGIN');
    try {
      adapter.setBadge(user.id, PERSONA_BADGE);
      q.insP.run(user.id, 'active', JSON.stringify(persona), style, seed, t + Math.floor(random() * f.actionIntervalMinutes * 60e3), t + Math.floor(random() * f.postIntervalMinutes * 60e3), t);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    const fresh = adapter.getUser(user.id);
    adapter.saveProfile(fresh, {displayName, bio: bioOf(interests)});
    try { adapter.closeRequests(fresh); } catch { /* 隐私表在旧库可能没有 */ }
    try { await adapter.setAvatar(fresh, await avatarGen(style, seed)); }
    catch (e) { lastCreateError = '头像生成失败：' + String(e.message || e).slice(0, 120); }   // 头像失败不影响账号，管理端可以「换头像」重试
    adapter.audit(null, 'ai.personas.create', 'user:' + user.id, {style});
    return user.id;
  }
  /** 补齐 / 减少账号。每次最多新建 CREATE_BATCH 个（数量不设上限，分批创建）。 */
  async function ensureCount(s = settings()) {
    if (creating) return {created: 0, retired: 0};
    creating = true;
    try {
      const live = q.live.all();
      let created = 0, retired = 0;
      if (live.length > s.targetCount) {
        for (const r of live.slice(0, live.length - s.targetCount)) { q.setStatus.run('retired', now(), r.user_id); retired++; }
      } else {
        const need = Math.min(CREATE_BATCH, s.targetCount - live.length);
        for (let i = 0; i < need; i++) {
          try { await createOne(s); created++; } catch (e) { lastCreateError = String(e.message || e).slice(0, 200); break; }
        }
      }
      return {created, retired};
    } finally { creating = false; }
  }

  function pubAccount(row) {
    const p = personaOf(row), pr = q.profileOf.get(row.user_id) || {};
    const name = pr.display_name || p.displayName || pr.username || '';
    const c = {};
    for (const r of q.userCounts.all(row.user_id)) c[r.kind] = r.n;
    return {
      userId: row.user_id, username: pr.username || null, displayName: name, bio: pr.bio || '',
      // 形状同 2.1.0 外部帖头像 {kind,image,path,fallback,color,letter}：path 是相对地址，管理端带管理员令牌（请求头）取图；
      // 没有头像时 path 也照样可取（服务端回字母 SVG），fallback 是字母头像 data URL。mediaId 只供排查。
      avatar: {kind: pr.avatar_image ? 'image' : 'letter', image: pr.avatar_image ? avatarPathOf(row.user_id) : letterAvatarData(name), path: avatarPathOf(row.user_id),
        fallback: letterAvatarData(name), color: colorOf(name), letter: letterOf(name), mediaId: pr.avatar_image || null},
      style: row.avatar_style, status: row.status, interests: p.interests || [], tone: p.tone || '',
      overrides: overridesOf(row), lastActionAt: row.last_action_at, nextAt: row.next_at, nextPostAt: row.next_post_at, createdAt: row.created_at,
      counts: {posts: c.post || 0, comments: (c.comment || 0) + (c.reply || 0), likes: c.like || 0, favorites: c.favorite || 0, reposts: c.repost || 0, views: c.browse || 0, groupPosts: c.group_post || 0},
    };
  }
  function listAccounts(query = {}) {
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const st = ['active', 'paused', 'retired'].includes(query.status) ? query.status : null;
    const kw = String(query.q || '').trim().replace(/[%_]/g, '');
    const cursor = query.cursor != null && query.cursor !== '' ? Number(query.cursor) : null;
    const rows = db.prepare(`SELECT a.* FROM ai_personas a JOIN users u ON u.id=a.user_id LEFT JOIN profiles p ON p.user_id=a.user_id
      WHERE (? IS NULL OR a.status=?) AND (?='' OR u.username LIKE ? OR IFNULL(p.display_name,'') LIKE ?) AND (? IS NULL OR a.user_id<?)
      ORDER BY a.user_id DESC LIMIT ?`).all(st, st, kw, '%' + kw + '%', '%' + kw + '%', cursor, cursor, limit + 1);
    const more = rows.length > limit, page = rows.slice(0, limit);
    return {accounts: page.map(pubAccount), nextCursor: more ? page[page.length - 1].user_id : null};
  }
  function needPersona(userId) {
    const row = q.persona.get(Number(userId));
    if (!row) throw new ApiError(404, 'NOT_FOUND', '内部账号不存在');
    return row;
  }
  async function updateAccount(admin, userId, body = {}, ip) {
    const row = needPersona(userId);
    const p = personaOf(row);
    let ov = overridesOf(row);
    if (body.status != null) {
      if (!['active', 'paused'].includes(body.status)) throw new ApiError(400, 'BAD_STATUS', '状态只能是 active 或 paused（停用请用 retire）');
      q.setStatus.run(body.status, null, row.user_id);
    }
    const user = adapter.getUser(row.user_id);
    if (body.displayName != null) {
      const n = String(body.displayName).trim();
      if (![...n].length || [...n].length > 20) throw new ApiError(400, 'BAD_DISPLAY_NAME', '显示名需要 1 到 20 个字');
      p.displayName = n;
      adapter.saveProfile(user, {displayName: n});
    }
    if (body.interests != null) {
      const c = uniq((Array.isArray(body.interests) ? body.interests : []).map(String)).filter(x => PERSONA_CATEGORIES.includes(x));
      if (!c.length) throw new ApiError(400, 'BAD_CATEGORY', '至少选一个分类');
      p.interests = c;
      adapter.saveProfile(adapter.getUser(row.user_id), {bio: bioOf(c)});
    }
    if (body.overrides !== undefined) ov = body.overrides ? cleanFreq(body.overrides, {}) : null;
    q.setPersona.run(JSON.stringify(p), ov && Object.keys(ov).length ? JSON.stringify(ov) : null, row.user_id);
    if (body.regenerateAvatar) {
      const s = settings(), style = isAvatarStyle(body.avatarStyle) ? body.avatarStyle : pick(s.avatarStyles);
      const seed = 'vexo-ai-' + row.user_id + '-' + Math.floor(random() * 1e6);
      try { await adapter.setAvatar(adapter.getUser(row.user_id), await avatarGen(style, seed)); q.setAvatar.run(style, seed, row.user_id); }
      catch (e) { throw new ApiError(503, 'AVATAR_FAILED', '头像生成失败：' + String(e.message || e).slice(0, 120)); }
    }
    adapter.audit(admin && admin.id, 'admin.ai.personas.update', 'user:' + row.user_id, {fields: Object.keys(body)});
    return {account: pubAccount(q.persona.get(row.user_id))};
  }
  function hidePostsOf(userId) {
    const user = adapter.getUser(userId);
    let n = 0;
    for (const r of q.myPosts.all(userId)) { try { adapter.removePost(user, r.id); n++; } catch { /* ignore */ } }
    return n;
  }
  function retireAccount(admin, userId, body = {}, ip) {
    const row = needPersona(userId);
    q.setStatus.run('retired', now(), row.user_id);
    const hiddenPosts = body.hideContent ? hidePostsOf(row.user_id) : 0;
    adapter.audit(admin && admin.id, 'admin.ai.personas.retire', 'user:' + row.user_id, {hiddenPosts});
    return {account: pubAccount(q.persona.get(row.user_id)), hiddenPosts};
  }
  function stopAll(admin, body = {}, ip) {
    const s = settings();
    q.setSet.run(SETTINGS_KEY, JSON.stringify({...s, enabled: false}), now());
    const paused = Number(q.pauseAll.run().changes || 0);
    let hiddenPosts = 0, removedInteractions = 0;
    const ids = q.allIds.all().map(r => r.user_id);
    if (body.hideContent) for (const id of ids) hiddenPosts += hidePostsOf(id);
    if (body.undoInteractions && ids.length) {
      const js = JSON.stringify(ids);
      for (const sql of ["DELETE FROM post_reactions WHERE user_id IN (SELECT value FROM json_each(?))",
        "DELETE FROM saved_items WHERE kind='post' AND user_id IN (SELECT value FROM json_each(?))",
        "DELETE FROM post_views WHERE user_id IN (SELECT value FROM json_each(?))"]) removedInteractions += Number(db.prepare(sql).run(js).changes || 0);
    }
    adapter.audit(admin && admin.id, 'admin.ai.personas.stop_all', 'personas', {paused, hiddenPosts, removedInteractions});
    return {paused, hiddenPosts, removedInteractions, ...overview()};
  }

  // ---------- 动作 ----------
  function log(userId, kind, target, {refId = null, ok = true, error = null, model = null, tokens = null} = {}) {
    q.insAct.run(userId, kind, target, refId, ok ? 1 : 0, error ? String(error).slice(0, 300) : null, model, tokens, now());
  }
  const did = (userId, kind, target) => !!q.didOnce.get(userId, kind, target);
  const modelOf = s => (s.model ? s.model : undefined);   // 空 = 跟全站设置

  // AI 并发闸门
  let aiRunning = 0; const aiWaiters = [];
  async function withAi(fn, s) {
    const max = s.limits.aiConcurrency;
    if (aiRunning >= max) await new Promise(r => aiWaiters.push(r));
    aiRunning++;
    try { return await fn(); } finally { aiRunning--; const w = aiWaiters.shift(); if (w) w(); }
  }
  async function gen(messages, s, maxTokens) {
    return withAi(async () => {
      const r = await adapter.llm(messages, {model: modelOf(s), json: true, maxTokens, temperature: 0.8});
      return {text: scrubAiText(parseAiText(r.content)), model: r.model || modelOf(s) || 'default', tokens: r.tokens};
    }, s);
  }

  async function doPost(row, user, s) {
    const p = personaOf(row);
    const interests = (p.interests && p.interests.length ? p.interests : s.categories).filter(c => s.categories.includes(c));
    const item = feeds.pickItem(interests.length ? interests : s.categories);
    if (!item) { log(row.user_id, 'post', null, {ok: false, error: 'no_items'}); return {kind: 'post', ok: false, reason: 'no_items'}; }
    let g;
    try { g = await gen(postMessages({persona: {displayName: p.displayName, interestLabels: interests.map(c => CATEGORY_LABEL[c]).join('、'), tone: p.tone}, item}), s, 300); }
    catch (e) { log(row.user_id, 'post', 'feed:' + item.id, {ok: false, error: 'ai: ' + e.message}); return {kind: 'post', ok: false, reason: 'ai_error'}; }
    const ratio = overlapRatio(g.text, item.title + ' ' + (item.summary || ''));
    if ([...g.text].length < 20 || ratio > MAX_OVERLAP) {
      feeds.burn(item.id);
      log(row.user_id, 'post', 'feed:' + item.id, {ok: false, error: [...g.text].length < 20 ? 'too_short' : 'verbatim ' + ratio.toFixed(2), model: g.model});
      return {kind: 'post', ok: false, reason: 'rejected'};
    }
    const text = composePost(g.text, item.url);
    if (!text) { feeds.burn(item.id); log(row.user_id, 'post', 'feed:' + item.id, {ok: false, error: 'url_too_long', model: g.model}); return {kind: 'post', ok: false, reason: 'rejected'}; }
    try {
      const post = adapter.createPost(user, {text, category: postCategoryOf(item.category)});
      feeds.markUsed(item.id, post.id, row.user_id);
      q.setNextPost.run(now() + jitter(freqOf(row, s).postIntervalMinutes), row.user_id);
      log(row.user_id, 'post', 'feed:' + item.id, {refId: post.id, model: g.model, tokens: g.tokens});
      return {kind: 'post', ok: true, refId: post.id};
    } catch (e) {
      feeds.burn(item.id);
      log(row.user_id, 'post', 'feed:' + item.id, {ok: false, error: e.code || e.message, model: g.model});
      return {kind: 'post', ok: false, reason: e.code || 'error'};
    }
  }

  async function doReply(row, user, s, comment) {
    const p = personaOf(row);
    const post = q.postById.get(comment.post_id);
    let g;
    try { g = await gen(commentMessages({persona: p, post, replyTo: comment}), s, 120); }
    catch (e) { log(row.user_id, 'reply', 'comment:' + comment.id, {ok: false, error: 'ai: ' + e.message}); return {kind: 'reply', ok: false}; }
    const text = [...g.text].slice(0, COMMENT_MAX).join('');
    if ([...text].length < 2) { log(row.user_id, 'reply', 'comment:' + comment.id, {ok: false, error: 'empty', model: g.model}); return {kind: 'reply', ok: false}; }
    try {
      const c = adapter.comment(user, comment.post_id, {text, parentId: comment.id});
      log(row.user_id, 'reply', 'comment:' + comment.id, {refId: c.id, model: g.model, tokens: g.tokens});
      return {kind: 'reply', ok: true, refId: c.id};
    } catch (e) { log(row.user_id, 'reply', 'comment:' + comment.id, {ok: false, error: e.code || e.message, model: g.model}); return {kind: 'reply', ok: false}; }
  }

  async function doComment(row, user, s, post) {
    const target = 'post:' + post.id;
    const plain = String(post.text || '').replace(/https?:\/\/\S+/g, '').trim();
    if ([...plain].length < 10) return null;
    if (q.aiCommentsOn.get(post.id).n >= s.limits.maxAiCommentsPerPost) return null;
    if (q.commentedAuthor.get(row.user_id, now() - 86400e3, post.author_id)) return null;
    const p = personaOf(row);
    let g;
    try { g = await gen(commentMessages({persona: p, post, comments: q.recentComments.all(post.id)}), s, 120); }
    catch (e) { log(row.user_id, 'comment', target, {ok: false, error: 'ai: ' + e.message}); return {kind: 'comment', ok: false}; }
    const text = [...g.text].slice(0, COMMENT_MAX).join('');
    if ([...text].length < 2 || overlapRatio(text, post.text) > MAX_OVERLAP) { log(row.user_id, 'comment', target, {ok: false, error: 'rejected', model: g.model}); return {kind: 'comment', ok: false}; }
    try {
      const c = adapter.comment(user, post.id, {text});
      log(row.user_id, 'comment', target, {refId: c.id, model: g.model, tokens: g.tokens});
      return {kind: 'comment', ok: true, refId: c.id};
    } catch (e) { log(row.user_id, 'comment', target, {ok: false, error: e.code || e.message, model: g.model}); return {kind: 'comment', ok: false}; }
  }

  /** 浏览一条帖子，然后按概率点赞 / 收藏 / 转帖 / 评论（后三项各自独立判断）。 */
  async function doBrowse(row, user, s, f, only) {
    const since = now() - 48 * 3600e3;
    const post = only ? q.actCand.get(since, row.user_id, row.user_id, only) : q.browseCand.get(since, row.user_id, row.user_id);
    if (!post) return [{kind: 'browse', ok: false, reason: 'no_posts'}];
    const target = 'post:' + post.id, out = [];
    try {
      const seen = did(row.user_id, 'browse', target);
      adapter.view(user, post.id, {countForBoost: s.countAiViewsForBoost});
      if (!seen) { log(row.user_id, 'browse', target); out.push({kind: 'browse', ok: true, target}); }
    }
    catch (e) { log(row.user_id, 'browse', target, {ok: false, error: e.code || e.message}); return [{kind: 'browse', ok: false}]; }
    const want = k => (only ? only === k : random() < f[k + 'Rate']);
    if (want('like') && !did(row.user_id, 'like', target)) {
      try { const r = adapter.like(user, post.id, random() < 0.8 ? 0 : pick([1, 2, 5])); if (!r || !r.already) { log(row.user_id, 'like', target); out.push({kind: 'like', ok: true, target}); } }
      catch (e) { log(row.user_id, 'like', target, {ok: false, error: e.code || e.message}); }
    }
    if (want('favorite') && !did(row.user_id, 'favorite', target)) {
      try { const r = adapter.favorite(user, post.id, {title: String(post.text || '').slice(0, 40), excerpt: String(post.text || '').slice(0, 120)}); if (!r || !r.already) { log(row.user_id, 'favorite', target); out.push({kind: 'favorite', ok: true, target}); } }
      catch (e) { log(row.user_id, 'favorite', target, {ok: false, error: e.code || e.message}); }
    }
    if (want('repost') && !did(row.user_id, 'repost', target) && !post.repost_of) {
      try { const r = adapter.repost(user, post.id); log(row.user_id, 'repost', target, {refId: r.id}); out.push({kind: 'repost', ok: true, target, refId: r.id}); }
      catch (e) { log(row.user_id, 'repost', target, {ok: false, error: e.code || e.message}); }
    }
    if (want('comment')) { const r = await doComment(row, user, s, post); if (r) out.push(r); }
    return out;
  }

  function doJoin(row, user) {
    const c = q.joinCand.get(row.user_id);
    if (!c || c.visibility !== 'public') return {kind: 'join_group', ok: false, reason: 'no_groups'};   // 只加公开小组
    const target = 'community:' + c.id;
    try { adapter.joinGroup(user, c.id); log(row.user_id, 'join_group', target); return {kind: 'join_group', ok: true, target}; }
    catch (e) { log(row.user_id, 'join_group', target, {ok: false, error: e.code || e.message}); return {kind: 'join_group', ok: false}; }
  }
  async function doGroupPost(row, user, s) {
    const c = q.myGroups.get(row.user_id, now());
    if (!c) return {kind: 'group_post', ok: false, reason: 'no_groups'};
    const ch = q.textChannel.get(c.id);
    if (!ch) return {kind: 'group_post', ok: false, reason: 'no_channel'};
    const recent = q.channelRecent.all(ch.id);
    if (recent.length && adapter.isAi(recent[0].author_id)) return {kind: 'group_post', ok: false, reason: 'last_is_ai'};   // 不让 AI 之间自说自话
    const target = 'channel:' + ch.id;
    let g;
    try { g = await gen(groupMessages({persona: personaOf(row), communityName: c.name, recent: recent.slice().reverse()}), s, 120); }
    catch (e) { log(row.user_id, 'group_post', target, {ok: false, error: 'ai: ' + e.message}); return {kind: 'group_post', ok: false}; }
    const text = [...g.text].slice(0, 280).join('');
    if ([...text].length < 2) { log(row.user_id, 'group_post', target, {ok: false, error: 'empty', model: g.model}); return {kind: 'group_post', ok: false}; }
    try { const m = adapter.channelMessage(user, ch.id, text); log(row.user_id, 'group_post', target, {refId: m.id, model: g.model, tokens: g.tokens}); return {kind: 'group_post', ok: true, refId: m.id}; }
    catch (e) { log(row.user_id, 'group_post', target, {ok: false, error: e.code || e.message, model: g.model}); return {kind: 'group_post', ok: false}; }
  }

  /** 一个账号做一步。forced：管理端「手动跑一轮」指定的动作。返回动作结果数组。 */
  async function actOnce(row, s, forced) {
    const user = adapter.getUser(row.user_id);
    if (!user) return [];
    const f = freqOf(row, s);
    const perDay = Math.max(1, 1440 / f.actionIntervalMinutes);
    const res = [];
    const kind = forced || null;
    if (kind === 'post' || (!kind && now() >= row.next_post_at)) res.push(await doPost(row, user, s));
    else if (kind === 'reply' || !kind) {
      const pending = q.pendingReplies.all(row.user_id, row.replied_until || 0, row.user_id);
      if (pending.length) {
        q.setReplied.run(pending[pending.length - 1].created_at, row.user_id);
        const target = pending.find(() => kind === 'reply' || random() < f.replyToUsersRate);
        if (target) res.push(await doReply(row, user, s, target));
      }
      if (!res.length && kind !== 'reply') {
        if (kind === 'join_group' || (!kind && random() < f.groupJoinPerDay / perDay)) res.push(doJoin(row, user));
        else if (kind === 'group_post' || (!kind && random() < f.groupPostPerDay / perDay)) res.push(await doGroupPost(row, user, s));
        else res.push(...await doBrowse(row, user, s, f, null));
      }
    } else if (kind === 'join_group') res.push(doJoin(row, user));
    else if (kind === 'group_post') res.push(await doGroupPost(row, user, s));
    else res.push(...await doBrowse(row, user, s, f, ['like', 'favorite', 'repost', 'comment'].includes(kind) ? kind : null));
    q.setNext.run(now() + jitter(f.actionIntervalMinutes), now(), row.user_id);
    return res.map(r => ({userId: row.user_id, ...r}));
  }

  function shanghaiHour() { return new Date(now() + 8 * 3600e3).getUTCHours(); }
  function inQuiet(s) {
    const {quietStart: a, quietEnd: b} = s.activeHours, h = shanghaiHour();
    return a === b ? false : a < b ? (h >= a && h < b) : (h >= a || h < b);
  }

  let lastFeedAt = 0, lastTickAt = null, lastError = null, ticking = false;
  /** 一轮。opts.force：管理端手动跑（开关关着也跑一轮，但不建号）；opts.kind / opts.userId：只做指定动作 / 指定账号。 */
  async function tick(opts = {}) {
    const s = settings();
    if (!s.enabled && !opts.force) return {skipped: 'disabled', actions: []};
    if (ticking && !opts.force) return {skipped: 'busy', actions: []};
    ticking = true;
    try {
      lastTickAt = now();
      if (!opts.skipFeeds && now() - lastFeedAt >= s.feedRefreshMinutes * 60e3) { lastFeedAt = now(); try { await feeds.refreshAll(); } catch (e) { lastError = 'RSS: ' + e.message; } }
      const accounts = s.enabled && !opts.force ? await ensureCount(s) : {created: 0, retired: 0};
      let rows;
      if (opts.userId) { const r = q.persona.get(Number(opts.userId)); rows = r && r.status !== 'retired' ? [r] : []; }
      else rows = q.due.all(opts.force ? Number.MAX_SAFE_INTEGER : now(), s.limits.maxActionsPerTick);
      const actions = [];
      const quiet = inQuiet(s);
      let i = 0;
      const worker = async () => {
        while (i < rows.length) {
          const row = rows[i++];
          if (!opts.force && !settings().enabled) return;            // 紧急停止：下一个动作前停下
          if (!opts.force && quiet && random() > s.activeHours.quietFactor) { q.setNext.run(now() + jitter(s.defaults.actionIntervalMinutes), row.last_action_at, row.user_id); continue; }
          try { actions.push(...await actOnce(row, s, opts.kind)); }
          catch (e) { lastError = String(e.message || e).slice(0, 200); q.setNext.run(now() + jitter(s.defaults.actionIntervalMinutes), now(), row.user_id); }
        }
      };
      await Promise.all(Array.from({length: Math.min(s.limits.aiConcurrency, Math.max(1, rows.length))}, worker));
      return {accounts, actions};
    } finally { ticking = false; }
  }

  // ---------- 总览 / 日志 ----------
  function dayStart() { const t = now() + 8 * 3600e3; return t - (t % 86400e3) - 8 * 3600e3; }
  function today() {
    const out = Object.fromEntries(KINDS.map(k => [k, 0]));
    let aiCalls = 0, aiTokens = 0, aiFailures = 0;
    for (const r of q.todayKinds.all(dayStart())) {
      if (r.ok) out[r.kind] = (out[r.kind] || 0) + r.n; else aiFailures += r.ai;
      aiCalls += r.ai; aiTokens += r.tk;
    }
    return {...out, aiCalls, aiTokens, aiFailures};
  }
  function status() {
    const s = settings(), c = counts();
    return {envEnabled: env.AI_PERSONAS === '1', running: !!timer, lastTickAt, model: s.model || null, modelSource: s.model ? 'personas' : 'admin',
      accounts: {...c, creating: s.enabled ? Math.max(0, s.targetCount - c.active - c.paused) : 0}, aiReady: !!(deps.llm || (deps.adminAi && deps.adminAi.llm)),
      lastError: lastError || lastCreateError, adapter: {usingDift: adapter.usingDift}};
  }
  function overview() { return {settings: settings(), status: status(), today: today(), sources: feeds.stats()}; }
  function actionLog(query = {}) {
    const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 500);
    const kind = KINDS.includes(query.kind) ? query.kind : null;
    const uid = query.userId != null && query.userId !== '' ? Number(query.userId) : null;
    const before = query.before != null && query.before !== '' ? Number(query.before) : null;   // 上一页最后一条的 id（和 Agen 约定）
    const rows = db.prepare(`SELECT a.*, p.display_name FROM ai_persona_actions a LEFT JOIN profiles p ON p.user_id=a.user_id
      WHERE (? IS NULL OR a.kind=?) AND (? IS NULL OR a.user_id=?) AND (? IS NULL OR a.id<?) ORDER BY a.id DESC LIMIT ?`)
      .all(kind, kind, uid, uid, before, before, limit + 1);
    const more = rows.length > limit, page = rows.slice(0, limit);
    return {log: page.map(r => ({id: r.id, at: r.at, userId: r.user_id, displayName: r.display_name || null, kind: r.kind, target: r.target, refId: r.ref_id,
      ok: !!r.ok, error: r.error, model: r.model, tokens: r.tokens})), nextBefore: more ? page[page.length - 1].id : null};
  }

  // ---------- 头像文件（管理端用管理员令牌取图） ----------
  function avatarFile(userId) {
    const row = q.persona.get(Number(userId));
    if (!row) return null;
    const pr = q.profileOf.get(row.user_id) || {};
    if (!pr.avatar_image || !deps.media) return null;
    try { return deps.media.fileOf(adapter.getUser(row.user_id), pr.avatar_image); } catch { return null; }
  }
  /** 给 Dift 在 index.mjs 的 http 处理里挂：GET /api/admin/ai/personas/accounts/:userId/avatar（需要管理员令牌）。
   *  用法：const m = AVATAR_ROUTE_RE.exec(path); if (m) return personas.serveAvatar(req, res, m[1], {adminAuth, headers: corsHeaders(req), sendError: e => send(e.s, …)}); */
  function serveAvatar(req, res, userId, {adminAuth, headers = {}, readFile, sendError} = {}) {
    try { adminAuth(req); } catch (e) { if (sendError) return sendError(e); res.writeHead(401, headers); return res.end(); }
    const f = avatarFile(userId);
    const row = q.persona.get(Number(userId));
    if (!f) {
      const name = row ? (q.profileOf.get(row.user_id) || {}).display_name || '' : '';
      const svg = decodeURIComponent(letterAvatarData(name).replace(/^data:image\/svg\+xml;utf8,/, ''));
      res.writeHead(row ? 200 : 404, {...headers, 'Content-Type': 'image/svg+xml', 'Cache-Control': 'private, max-age=60', 'X-Content-Type-Options': 'nosniff'});
      return res.end(row ? svg : '');
    }
    const buf = (readFile || readFileSync)(f.path);
    res.writeHead(200, {...headers, 'Content-Type': f.mime, 'Content-Length': buf.length, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff'});
    return res.end(req.method === 'HEAD' ? undefined : buf);
  }

  // ---------- 管理端路由（交给 Dift 挂：Object.assign(routes, personas.routes({adminAuth, ip}))） ----------
  const feedErr = e => { if (e instanceof ApiError) return e; const code = e.code || 'BAD_REQUEST'; return new ApiError(code === 'NOT_FOUND' ? 404 : code === 'EXISTS' ? 409 : 400, code, e.message); };
  function routes({adminAuth, ip = () => null}) {
    const A = req => adminAuth(req);
    return {
      'GET /api/admin/ai/personas'(req) { A(req); return overview(); },
      'POST /api/admin/ai/personas/settings'(req, b) { const {admin} = A(req); return saveSettings(admin, b || {}, ip(req)); },
      'GET /api/admin/ai/personas/accounts'(req) { A(req); return listAccounts(req.query || {}); },
      async 'POST /api/admin/ai/personas/accounts/:userId'(req, b) { const {admin} = A(req); return updateAccount(admin, req.params.userId, b || {}, ip(req)); },
      'POST /api/admin/ai/personas/accounts/:userId/retire'(req, b) { const {admin} = A(req); return retireAccount(admin, req.params.userId, b || {}, ip(req)); },
      'POST /api/admin/ai/personas/stop-all'(req, b) { const {admin} = A(req); return stopAll(admin, b || {}, ip(req)); },
      async 'POST /api/admin/ai/personas/run'(req, b) {
        const {admin} = A(req); const body = b || {};
        if (body.kind != null && !KINDS.includes(body.kind)) throw new ApiError(400, 'BAD_KIND', '动作类型不正确');
        const r = await tick({force: true, kind: body.kind || null, userId: body.userId || null, skipFeeds: !!body.skipFeeds});
        adapter.audit(admin.id, 'admin.ai.personas.run', 'personas', {kind: body.kind || null, actions: r.actions.length});
        return {result: r, ...overview()};
      },
      'GET /api/admin/ai/personas/sources'(req) { A(req); return {sources: feeds.list()}; },
      async 'POST /api/admin/ai/personas/sources'(req, b) { const {admin} = A(req); try { const s = await feeds.add(b || {}); adapter.audit(admin.id, 'admin.ai.personas.source_add', 'source:' + s.id, {url: s.url}); return {source: s}; } catch (e) { throw feedErr(e); } },
      'POST /api/admin/ai/personas/sources/:id'(req, b) { const {admin} = A(req); try { const s = feeds.update(req.params.id, b || {}); adapter.audit(admin.id, 'admin.ai.personas.source_update', 'source:' + s.id, b || {}); return {source: s}; } catch (e) { throw feedErr(e); } },
      'POST /api/admin/ai/personas/sources/:id/delete'(req) { const {admin} = A(req); try { const r = feeds.remove(req.params.id); adapter.audit(admin.id, 'admin.ai.personas.source_delete', 'source:' + r.deleted, null); return r; } catch (e) { throw feedErr(e); } },
      async 'POST /api/admin/ai/personas/sources/:id/test'(req) {
        A(req); const s = feeds.byId(req.params.id);
        if (!s) throw new ApiError(404, 'NOT_FOUND', '来源不存在');
        try { return await feeds.test(s.url, {convert: s.convert}); } catch (e) { return {ok: false, items: [], error: String(e.message || e).slice(0, 200)}; }
      },
      'GET /api/admin/ai/personas/log'(req) { A(req); return actionLog(req.query || {}); },
      async 'GET /api/admin/ai/personas/avatar-styles'(req) { A(req); return {styles: await avatarStylesWithPreview()}; },
    };
  }

  let timer = null;
  /** 定时器：环境变量 AI_PERSONAS=1 才启动（和 ADMIN_AI_AUTO_ADS 一样的保险）；还要管理端开关打开才会真的动。 */
  function start(intervalMs = 30e3) {
    if (timer || env.AI_PERSONAS !== '1') return false;
    timer = setInterval(() => { tick().catch(e => { lastError = String(e.message || e).slice(0, 200); }); }, intervalMs);
    if (timer.unref) timer.unref();
    return true;
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }

  return {settings, saveSettings, ensureCount, listAccounts, updateAccount, retireAccount, stopAll, tick, actOnce, overview, status, today,
    actionLog, avatarFile, serveAvatar, routes, start, stop, feeds, adapter, isPersona: id => !!q.persona.get(Number(id))};
}
