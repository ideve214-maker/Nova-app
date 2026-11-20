// 服务端 2.1.2：用户偏好、行为上报，以及「为你推荐」的本地排序（不用 LLM）。
import {ApiError} from './errors.mjs';
import {POST_CATEGORIES, normalizePostCategory} from './post-category.mjs';
import {FEED_SOURCES} from './import-sources.mjs';
import {isInternalAccount} from './internal-account.mjs';

export const FEED_ACTIONS = Object.freeze(['view', 'open', 'open_origin', 'like', 'save', 'share', 'hide']);
const ACTION_SET = new Set(FEED_ACTIONS);
const REASON_SET = new Set(['post', 'category', 'source']);
const KNOWN_SOURCES = new Set(FEED_SOURCES.map(s => s.id));
const DWELL_MAX_MS = 600_000;
const EVENTS_MAX = 100;

const ACTION_WEIGHT = Object.freeze({
  view: 0,          // view 只按停留时长计
  open: 1.5,
  open_origin: 2,
  like: 3,
  save: 3.5,
  share: 2.5,
  hide: -4,
});
const DWELL_PER_MS = 1 / 30_000; // 每停留 30 秒 +1

function envNum(env, key, fallback) {
  const n = Number(env && env[key]);
  return Number.isFinite(n) ? n : fallback;
}

function parseJsonArr(s) {
  try {
    const v = JSON.parse(String(s || '[]'));
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

function uniq(arr) {
  const out = [], seen = new Set();
  for (const x of arr) {
    const k = String(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

export function isRecQuery(q = {}) {
  if (q.author || q.authors) return false;
  const f = q.feed == null ? '' : String(q.feed);
  return f === '' || f === 'rec' || f === 'recommended';
}

function hash32(s) {
  let h = 2166136261;
  for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function createFeedPersonalize(db, {now = Date.now, env = process.env} = {}) {
  const getInt = db.prepare('SELECT * FROM user_interests WHERE user_id=?');
  const upsertInt = db.prepare(`INSERT INTO user_interests(user_id,like_json,dislike_json,hidden_sources_json,onboarded,updated_at)
    VALUES(?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET like_json=excluded.like_json, dislike_json=excluded.dislike_json,
      hidden_sources_json=excluded.hidden_sources_json, onboarded=excluded.onboarded, updated_at=excluded.updated_at`);
  const hidePostIns = db.prepare('INSERT OR IGNORE INTO user_hidden_posts(user_id,post_id,created_at) VALUES(?,?,?)');
  const hiddenPostsOf = db.prepare('SELECT post_id FROM user_hidden_posts WHERE user_id=?');
  const postById = db.prepare('SELECT * FROM posts WHERE id=?');
  const insSig = db.prepare('INSERT INTO feed_signals(user_id,post_id,action,dwell_ms,at,created_at) VALUES(?,?,?,?,?,?)');
  const pruneSig = db.prepare('DELETE FROM feed_signals WHERE created_at<?');
  const getScore = db.prepare('SELECT score, updated_at FROM user_category_scores WHERE user_id=? AND category=?');
  const upsertScore = db.prepare(`INSERT INTO user_category_scores(user_id,category,score,updated_at) VALUES(?,?,?,?)
    ON CONFLICT(user_id,category) DO UPDATE SET score=excluded.score, updated_at=excluded.updated_at`);
  const scoresOf = db.prepare('SELECT category, score, updated_at FROM user_category_scores WHERE user_id=?');

  const halfLifeMs = Math.max(1, envNum(env, 'FEED_SCORE_HALFLIFE_DAYS', 7)) * 864e5;
  const keepMs = Math.max(1, envNum(env, 'FEED_SIGNAL_KEEP_DAYS', 30)) * 864e5;
  const freshnessHalfLifeMs = Math.max(1, envNum(env, 'FEED_FRESHNESS_HALFLIFE_HOURS', 72)) * 3600e3;
  const likeBonus = envNum(env, 'FEED_LIKE_BONUS', 2.5);
  const dislikePenalty = envNum(env, 'FEED_DISLIKE_PENALTY', 8);
  const learnedWeight = envNum(env, 'FEED_LEARNED_WEIGHT', 1);
  const freshnessWeight = envNum(env, 'FEED_FRESHNESS_WEIGHT', 2);
  const exploreRatio = Math.min(0.5, Math.max(0, envNum(env, 'FEED_EXPLORE_RATIO', 0.2)));
  const poolSize = Math.min(1000, Math.max(50, envNum(env, 'FEED_CANDIDATE_POOL', 300)));
  const sigRpm = Math.max(1, envNum(env, 'FEED_SIGNALS_RPM', 30));
  const sigEventsRpm = Math.max(1, envNum(env, 'FEED_SIGNALS_EVENTS_RPM', 2000));
  const hideRpm = Math.max(1, envNum(env, 'FEED_HIDE_RPM', 60));

  const hits = new Map(); // key -> [ts, ...]
  function rateOk(key, max, windowMs = 60e3) {
    const t = now();
    let a = hits.get(key) || [];
    a = a.filter(x => t - x < windowMs);
    if (a.length >= max) {
      hits.set(key, a);
      const retryAfter = Math.max(1, Math.ceil((a[0] + windowMs - t) / 1000));
      throw new ApiError(429, 'RATE_LIMIT', '请求过于频繁，请稍后再试', {retryAfter});
    }
    a.push(t);
    if (hits.size > 5000) {
      const first = hits.keys().next().value;
      hits.delete(first);
    }
    hits.set(key, a);
  }

  function emptyInterests() {
    return {like: [], dislike: [], hiddenSources: [], onboarded: false};
  }

  function pubInterests(row) {
    if (!row) return emptyInterests();
    return {
      like: parseJsonArr(row.like_json).map(normalizePostCategory).filter(Boolean),
      dislike: parseJsonArr(row.dislike_json).map(normalizePostCategory).filter(Boolean),
      hiddenSources: parseJsonArr(row.hidden_sources_json).filter(s => KNOWN_SOURCES.has(String(s))),
      onboarded: !!row.onboarded,
    };
  }

  function getInterests(user) {
    return pubInterests(getInt.get(Number(user.id)));
  }

  function validateCategories(arr, field) {
    if (arr == null) return null;
    if (!Array.isArray(arr)) throw new ApiError(400, 'BAD_INTERESTS', field + ' 必须是数组');
    const out = [];
    for (const v of arr) {
      const c = normalizePostCategory(v);
      if (!c) throw new ApiError(400, 'BAD_CATEGORY', 'category 只能是 ' + POST_CATEGORIES.join('、'));
      out.push(c);
    }
    return uniq(out);
  }

  function validateSources(arr) {
    if (arr == null) return null;
    if (!Array.isArray(arr)) throw new ApiError(400, 'BAD_INTERESTS', 'hiddenSources 必须是数组');
    const out = [];
    for (const v of arr) {
      const s = String(v == null ? '' : v).trim();
      if (!KNOWN_SOURCES.has(s)) throw new ApiError(400, 'BAD_SOURCE', '未知的来源：' + s);
      out.push(s);
    }
    return uniq(out);
  }

  function writeInterests(user, next) {
    // 同一分类同时出现在喜欢和不喜欢里时，不喜欢优先，从喜欢里去掉。
    const like = next.like.filter(c => !next.dislike.includes(c));
    upsertInt.run(Number(user.id), JSON.stringify(like), JSON.stringify(next.dislike),
      JSON.stringify(next.hiddenSources), next.onboarded ? 1 : 0, now());
    return getInterests(user);
  }

  function putInterests(user, body) {
    const cur = getInterests(user);
    const like = body.like !== undefined ? validateCategories(body.like, 'like') : cur.like;
    const dislike = body.dislike !== undefined ? validateCategories(body.dislike, 'dislike') : cur.dislike;
    const hiddenSources = body.hiddenSources !== undefined ? validateSources(body.hiddenSources) : cur.hiddenSources;
    return writeInterests(user, {like, dislike, hiddenSources, onboarded: true});
  }

  function notInterested(user, body) {
    rateOk('hide:' + user.id, hideRpm);
    const postId = String((body && body.postId) || '').trim();
    const reason = String((body && body.reason) || '').trim();
    if (!postId) throw new ApiError(400, 'BAD_POST_ID', '请指定帖子');
    if (!REASON_SET.has(reason)) throw new ApiError(400, 'BAD_REASON', "reason 只能是 post、category 或 source");
    const post = postById.get(postId);
    if (!post || post.deleted_at) throw new ApiError(404, 'NOT_FOUND', '动态不存在');
    const cur = getInterests(user);
    if (reason === 'post') {
      hidePostIns.run(Number(user.id), postId, now());
    } else if (reason === 'category') {
      const cat = normalizePostCategory(post.category);
      if (!cat) throw new ApiError(400, 'NO_CATEGORY', '这条帖子还没有分类');
      if (!cur.dislike.includes(cat)) cur.dislike.push(cat);
      cur.like = cur.like.filter(c => c !== cat);
      writeInterests(user, {...cur, onboarded: cur.onboarded});
    } else if (reason === 'source') {
      const src = String(post.source || '').trim();
      if (!src || !KNOWN_SOURCES.has(src)) throw new ApiError(400, 'NO_SOURCE', '这条帖子没有可屏蔽的来源');
      if (!cur.hiddenSources.includes(src)) cur.hiddenSources.push(src);
      writeInterests(user, {...cur, onboarded: cur.onboarded});
    }
    return {ok: true, interests: getInterests(user)};
  }

  function decayedScore(raw, updatedAt, t) {
    const age = Math.max(0, t - (Number(updatedAt) || t));
    return Number(raw) * Math.pow(0.5, age / halfLifeMs);
  }

  function addScore(userId, category, delta, t) {
    const cat = normalizePostCategory(category) || 'other';
    const row = getScore.get(userId, cat);
    const prev = row ? decayedScore(row.score, row.updated_at, t) : 0;
    upsertScore.run(userId, cat, prev + delta, t);
  }

  function learnedMap(userId, t) {
    const out = new Map();
    for (const r of scoresOf.all(userId)) out.set(r.category, decayedScore(r.score, r.updated_at, t));
    return out;
  }

  function ingestSignals(user, body) {
    const events = body && body.events;
    if (!Array.isArray(events)) throw new ApiError(400, 'BAD_EVENTS', 'events 必须是数组');
    if (events.length > EVENTS_MAX) throw new ApiError(400, 'TOO_MANY_EVENTS', '每批最多 ' + EVENTS_MAX + ' 条');
    rateOk('sig:' + user.id, sigRpm);
    const evKey = 'sigE:' + user.id;
    const tRate = now();
    let evHits = (hits.get(evKey) || []).filter(x => tRate - x < 60e3);
    if (evHits.length + events.length > sigEventsRpm) {
      hits.set(evKey, evHits);
      const retryAfter = Math.max(1, Math.ceil((evHits[0] ? evHits[0] + 60e3 - tRate : 60e3) / 1000));
      throw new ApiError(429, 'RATE_LIMIT', '请求过于频繁，请稍后再试', {retryAfter});
    }
    for (let i = 0; i < events.length; i++) evHits.push(tRate);
    hits.set(evKey, evHits);

    // 非法 action 先全部校验完再写库，避免半批入库。
    for (const ev of events) {
      const action = String((ev && ev.action) || '').trim();
      if (!ACTION_SET.has(action)) throw new ApiError(400, 'BAD_ACTION', 'action 只能是 ' + FEED_ACTIONS.join('、'));
    }
    const learn = !isInternalAccount(user);
    const t = now();
    let accepted = 0;
    db.exec('BEGIN');
    try {
      pruneSig.run(t - keepMs);
      for (const ev of events) {
        const action = String((ev && ev.action) || '').trim();
        const postId = String((ev && ev.postId) || '').trim();
        if (!postId) continue;
        const post = postById.get(postId);
        if (!post) continue;
        let dwell = Number(ev && ev.dwellMs);
        if (!Number.isFinite(dwell)) dwell = 0;
        dwell = Math.max(0, Math.min(DWELL_MAX_MS, Math.round(dwell)));
        let at = Number(ev && ev.at);
        if (!Number.isFinite(at) || at <= 0) at = t;
        insSig.run(Number(user.id), postId, action, dwell, at, t);
        accepted++;
        if (learn) {
          let delta = ACTION_WEIGHT[action] || 0;
          if (action === 'view' || dwell > 0) delta += dwell * DWELL_PER_MS;
          if (delta) addScore(Number(user.id), post.category, delta, t);
        }
      }
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch {}
      throw e;
    }
    return {ok: true, accepted};
  }

  function catOf(row) {
    return normalizePostCategory(row && row.category) || 'other';
  }

  function scorePost(row, ints, learned, t) {
    const cat = catOf(row);
    let s = 0;
    const learnedScore = learned.get(cat) || 0;
    s += learnedScore * learnedWeight;
    if (ints.like.includes(cat)) s += likeBonus;
    if (ints.dislike.includes(cat)) s -= dislikePenalty;
    const age = Math.max(0, t - (Number(row.created_at) || t));
    s += Math.exp(-age / freshnessHalfLifeMs) * freshnessWeight;
    return s;
  }

  function topInterestSet(ints, learned) {
    if (ints.like.length) return new Set(ints.like);
    const ranked = [...learned.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    if (!ranked.length) return new Set();
    return new Set(ranked.slice(0, 3).map(([c]) => c));
  }

  function interleave(primary, explore, ratio) {
    if (!explore.length || ratio <= 0) return primary.concat(explore);
    const out = [];
    let ei = 0;
    const every = Math.max(2, Math.round(1 / ratio));
    for (let i = 0; i < primary.length; i++) {
      if (ei < explore.length && (out.length + 1) % every === 0) out.push(explore[ei++]);
      out.push(primary[i]);
    }
    while (ei < explore.length) out.push(explore[ei++]);
    return out;
  }

  function recommend(user, q, posts) {
    const limit = Math.min(Math.max(+(q.limit) || 20, 1), 50);
    if (q.cursor) {
      const cur = posts.byId.get(String(q.cursor));
      if (!cur) throw new ApiError(400, 'BAD_CURSOR', '分页游标不正确');
    }
    const t = now();
    const ints = getInterests(user);
    const hiddenPost = new Set(hiddenPostsOf.all(Number(user.id)).map(r => r.post_id));
    const hiddenSrc = new Set(ints.hiddenSources);
    const learned = learnedMap(Number(user.id), t);
    const hasData = ints.like.length || ints.dislike.length || learned.size > 0;

    const pool = posts.candidates(user, {limit: poolSize});
    const visible = pool.filter(r => !hiddenPost.has(r.id) && !(r.source && hiddenSrc.has(r.source)));

    let ordered;
    if (!hasData) {
      // 新用户 / 没有偏好和兴趣分：保持现在的时间倒序，也不做探索打散。
      ordered = visible;
    } else {
      const scored = visible.map(r => ({r, s: scorePost(r, ints, learned, t)}));
      scored.sort((a, b) => b.s - a.s || (b.r.created_at - a.r.created_at) || (a.r.id < b.r.id ? 1 : -1));
      const top = topInterestSet(ints, learned);
      const primary = [], explore = [];
      for (const x of scored) {
        if (top.size && !top.has(catOf(x.r))) explore.push(x.r);
        else primary.push(x.r);
      }
      explore.sort((a, b) => hash32(user.id + ':' + a.id) - hash32(user.id + ':' + b.id) || (a.id < b.id ? -1 : 1));
      ordered = interleave(primary, explore, exploreRatio);
    }

    let start = 0;
    if (q.cursor) {
      const idx = ordered.findIndex(r => r.id === String(q.cursor));
      start = idx >= 0 ? idx + 1 : ordered.length; // 游标已被过滤时，避免从头重复推
      // 若游标在池里但被隐藏，仍向后翻：用时间倒序里它的位置兜底
      if (idx < 0) {
        const cur = posts.byId.get(String(q.cursor));
        if (cur) {
          const byTime = ordered.findIndex(r => r.created_at < cur.created_at || (r.created_at === cur.created_at && r.id < cur.id));
          start = byTime >= 0 ? byTime : ordered.length;
        }
      }
    }
    const slice = ordered.slice(start, start + limit);
    const more = start + slice.length < ordered.length;
    const last = slice[slice.length - 1];
    return {posts: slice.map(r => posts.pub(r, user)), nextCursor: more && last ? last.id : null};
  }

  return {getInterests, putInterests, notInterested, ingestSignals, recommend, isRecQuery, isInternalAccount};
}
