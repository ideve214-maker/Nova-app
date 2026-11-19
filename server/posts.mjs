// M4.1 动态：发帖入库，权限在服务端校验。显示成功必须等服务端确认。
// M7：audience（public/followers/friends/self）在列表与详情上做服务端过滤。
import {randomBytes} from 'node:crypto';
import {ApiError} from './errors.mjs';

const nid = () => 'po_' + randomBytes(12).toString('base64url');
const len = s => [...String(s)].length;
const AUDIENCES = new Set(['public', 'followers', 'friends', 'self']);
const AUD_LABEL = {public: '公开', followers: '仅粉丝', friends: '仅好友', self: '仅自己'};
function normAud(v) {
  const s = String(v == null ? 'public' : v).trim().toLowerCase();
  return AUDIENCES.has(s) ? s : 'public';
}
function normText(v, max) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (!s) return null;
  if ([...s].length > max) throw new ApiError(400, 'BAD_FIELD', '字段过长');
  return s;
}
function normTagged(v) {
  if (v == null || v === '') return null;
  const arr = Array.isArray(v) ? v : (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return []; } })() : []);
  const ids = [...new Set(arr.map(Number).filter(n => Number.isInteger(n) && n > 0))].slice(0, 20);
  return ids.length ? JSON.stringify(ids) : null;
}
function normMedia(v) {
  if (v == null || v === '') return null;
  const arr = Array.isArray(v) ? v : (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return []; } })() : []);
  const items = arr.slice(0, 9).map(it => {
    if (typeof it === 'string') return {id: it.slice(0, 80)};
    const o = {id: String(it.id || it.mediaId || '').slice(0, 80)};
    if (it.url) o.url = String(it.url).slice(0, 500);
    if (it.kind) o.kind = String(it.kind).slice(0, 20);
    return o.id || o.url ? o : null;
  }).filter(Boolean);
  return items.length ? JSON.stringify(items) : null;
}

export function createPosts(db, {vip, profile, now}) {
  const ins = db.prepare(`INSERT INTO posts(id,author_id,text,created_at,updated_at,client_id,audience,mood,location,tagged,media) VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
  // 2.0.3 转帖（迁移 056）。旧库没有这一列时转帖接口返回 503，其他功能不受影响。
  const hasRepost = (() => { try { db.prepare('SELECT repost_of FROM posts LIMIT 1').get(); return true; } catch { return false; } })();
  const setRepost = hasRepost ? db.prepare('UPDATE posts SET repost_of=? WHERE id=?') : null;
  const repostCnt = hasRepost ? db.prepare('SELECT COUNT(*) n FROM posts WHERE repost_of=? AND deleted_at IS NULL') : null;
  const myPlainRepost = hasRepost ? db.prepare("SELECT id FROM posts WHERE repost_of=? AND author_id=? AND deleted_at IS NULL AND COALESCE(text,'')='' ORDER BY created_at DESC LIMIT 1") : null;
  const byId = db.prepare('SELECT * FROM posts WHERE id=?');
  const byClient = db.prepare('SELECT * FROM posts WHERE author_id=? AND client_id=?');
  const upd = db.prepare('UPDATE posts SET text=?, updated_at=?, audience=COALESCE(?,audience), mood=COALESCE(?,mood), location=COALESCE(?,location), tagged=COALESCE(?,tagged), media=COALESCE(?,media) WHERE id=? AND author_id=? AND deleted_at IS NULL');
  const del = db.prepare('UPDATE posts SET deleted_at=? WHERE id=? AND author_id=? AND deleted_at IS NULL');
  const userBy = db.prepare('SELECT * FROM users WHERE id=?');
  const viewCnt = db.prepare('SELECT COUNT(*) n FROM post_views WHERE post_id=?');
  const saveCnt = db.prepare("SELECT COUNT(*) n FROM saved_items WHERE kind='post' AND target=?");
  // vis: 作者本人；公开；关注者（查看者关注了作者）；好友（已接受的双向好友）。仅自己只走作者分支。
  const vis = `AND (
    author_id = ?
    OR COALESCE(audience,'public') = 'public'
    OR (audience = 'followers' AND EXISTS (SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = author_id))
    OR (audience = 'friends' AND EXISTS (
      SELECT 1 FROM friendships
      WHERE status='accepted'
        AND user_lo = MIN(author_id, ?)
        AND user_hi = MAX(author_id, ?)
    ))
  )`;
  const listSql = db.prepare(`SELECT * FROM posts WHERE deleted_at IS NULL
    AND (? IS NULL OR author_id=?)
    ${vis}
    AND (created_at < ? OR (created_at = ? AND id < ?))
    ORDER BY created_at DESC, id DESC LIMIT ?`);
  const newest = db.prepare(`SELECT * FROM posts WHERE deleted_at IS NULL
    AND (? IS NULL OR author_id=?)
    ${vis}
    ORDER BY created_at DESC, id DESC LIMIT ?`);
  const newestIn = db.prepare(`SELECT * FROM posts WHERE deleted_at IS NULL
    AND author_id IN (SELECT value FROM json_each(?))
    ${vis}
    ORDER BY created_at DESC, id DESC LIMIT ?`);
  const listIn = db.prepare(`SELECT * FROM posts WHERE deleted_at IS NULL
    AND author_id IN (SELECT value FROM json_each(?))
    ${vis}
    AND (created_at < ? OR (created_at = ? AND id < ?))
    ORDER BY created_at DESC, id DESC LIMIT ?`);
  const newestTopic = db.prepare(`SELECT * FROM posts WHERE deleted_at IS NULL
    AND (text LIKE '%#%' OR id IN (SELECT post_id FROM post_hashtags))
    ${vis}
    ORDER BY created_at DESC, id DESC LIMIT ?`);
  const listTopic = db.prepare(`SELECT * FROM posts WHERE deleted_at IS NULL
    AND (text LIKE '%#%' OR id IN (SELECT post_id FROM post_hashtags))
    ${vis}
    AND (created_at < ? OR (created_at = ? AND id < ?))
    ORDER BY created_at DESC, id DESC LIMIT ?`);

  function visArgs(me) {
    const id = Number(me && me.id);
    return [id, id, id, id];
  }
  function authorOf(id) {
    const u = userBy.get(id);
    if (!u) return {id, username: 'unknown', displayName: 'unknown', avatar: null, vip: false};
    const p = profile.publicOf(u);
    const v = vip.status(u);
    return {id: u.id, username: u.username, displayName: p.displayName, avatar: p.avatar, vip: !!v.active, badge: u.badge || null};
  }
  let extras = null;
  function attach(ex) { extras = Object.assign(extras || {}, ex); }
  function canSee(row, me) {
    if (!row || row.deleted_at) return false;
    const aud = normAud(row.audience);
    const mid = me && Number(me.id);
    if (mid && Number(row.author_id) === mid) return true;
    if (aud === 'public') return true;
    if (!mid) return false;
    if (aud === 'self') return false;
    if (aud === 'followers') {
      const r = db.prepare('SELECT 1 FROM follows WHERE follower_id=? AND followee_id=?').get(mid, row.author_id);
      return !!r;
    }
    if (aud === 'friends') {
      const lo = Math.min(mid, Number(row.author_id)), hi = Math.max(mid, Number(row.author_id));
      const r = db.prepare("SELECT 1 FROM friendships WHERE status='accepted' AND user_lo=? AND user_hi=?").get(lo, hi);
      return !!r;
    }
    return false;
  }
  function parseJson(s) {
    if (!s) return undefined;
    try { return JSON.parse(s); } catch { return undefined; }
  }
  // 2.0.3 之前的转帖只是一条文字帖：「🔁 转帖 @某人：摘要\n<链接>/#/post/<id>」，引用时前面还有自己的话。
  // 读出时按这个格式还原成转帖，旧数据不用迁移。
  const LEGACY_RT = /(?:^|\n\n)🔁 转帖 @[^\n]*\n\S*(?:#\/post\/|:\/\/post\/)([A-Za-z0-9_-]+)\s*$/;
  function repostInfo(row) {
    if (row.repost_of) return {of: String(row.repost_of), text: row.text || ''};
    const m = LEGACY_RT.exec(row.text || '');
    if (!m || m[1] === row.id) return null;
    return {of: m[1], text: (row.text || '').slice(0, m.index).trim()};
  }
  function embedOf(origId, me) {
    const o = byId.get(origId);
    if (!o || o.deleted_at || !canSee(o, me)) return {id: origId, deleted: true};
    const e = pub(o, me, true);
    return e ? Object.assign(e, {deleted: false}) : {id: origId, deleted: true};
  }
  function pub(row, me, embedded) {
    if (!row || row.deleted_at) return null;
    const out = {
      id: row.id,
      author: authorOf(row.author_id),
      text: row.text,
      createdAt: row.created_at,
      createdAtUtc: new Date(row.created_at).toISOString(),
      updatedAt: row.updated_at,
      edited: row.updated_at > row.created_at,
      mine: !!(me && Number(me.id) === Number(row.author_id)),
      audience: normAud(row.audience),
      audienceLabel: AUD_LABEL[normAud(row.audience)],
      isPublic: normAud(row.audience) === 'public',
      reactions: [0, 0, 0, 0, 0, 0],
      myReaction: -1,
      commentCount: 0,
      viewCount: Math.max(0, viewCnt.get(row.id).n + (row.adj_views || 0)),
      bookmarkCount: Math.max(0, saveCnt.get(row.id).n + (row.adj_saves || 0)),
    };
    if (repostCnt) out.repostCount = repostCnt.get(row.id).n;
    if (myPlainRepost && me && me.id) { const mr = myPlainRepost.get(row.id, Number(me.id)); out.myRepost = mr ? mr.id : null; }
    if (!embedded) {
      const ri = repostInfo(row);
      if (ri) { out.text = ri.text; out.repostOf = embedOf(ri.of, me); }
    }
    if (row.mood) out.mood = row.mood;
    if (row.location) out.location = row.location;
    const tagged = parseJson(row.tagged);
    if (tagged) out.tagged = tagged;
    const media = parseJson(row.media);
    if (media) out.media = media;
    if (extras) {
      const rx = extras.reactOf(row.id, me);
      out.reactions = rx.reactions;
      out.myReaction = rx.myReaction;
      out.commentCount = extras.commentCount(row.id);
      if (extras.pollOf) out.poll = extras.pollOf(row.id, me);
      if (extras.activityOf) { const ac = extras.activityOf(row.id, me); if (ac) out.activity = ac; }
      if (extras.hashtagsOf) out.hashtags = extras.hashtagsOf(row.id);
      if (extras.boostOf && out.mine) { const bb = extras.boostOf(row.id, me); if (bb) out.boost = bb; }
      if (extras.personalFilter && me) {
        const f = extras.personalFilter(out.text, me, row.author_id);
        if (f) { out.text = f.text; out.filtered = true; out.filteredBy = f.filteredBy; }
      }
    }
    return out;
  }
  function fields(body) {
    return {
      audience: normAud(body && body.audience),
      mood: normText(body && body.mood, 40),
      location: normText(body && body.location, 80),
      tagged: normTagged(body && (body.tagged != null ? body.tagged : body.taggedIds)),
      media: normMedia(body && (body.media != null ? body.media : body.mediaIds)),
    };
  }
  // 转帖目标：必须存在、看得见；转的是转帖时指向它的原帖（不套娃）。
  function repostTarget(user, raw) {
    if (raw == null || raw === '') return null;
    if (!hasRepost) throw new ApiError(503, 'NO_REPOST', '转帖功能尚未就绪');
    let row = byId.get(String(raw).slice(0, 80));
    if (!row || row.deleted_at || !canSee(row, user)) throw new ApiError(404, 'NOT_FOUND', '原帖不存在或已删除');
    const ri = repostInfo(row);
    if (ri) {
      const o = byId.get(ri.of);
      if (!o || o.deleted_at || !canSee(o, user)) throw new ApiError(404, 'NOT_FOUND', '原帖不存在或已删除');
      row = o;
    }
    return row;
  }
  function create(user, body) {
    const text = String((body && body.text) != null ? body.text : '').trim();
    const f0 = fields(body);
    const target = repostTarget(user, body && body.repostOf);
    if (len(text) && extras && typeof extras.assertPlatform === 'function') extras.assertPlatform(text);
    if (target && !len(text) && !f0.media) {
      // 直接转帖：同一个人对同一条原帖只保留一条，重复点返回已有的那条
      const mine = myPlainRepost.get(target.id, Number(user.id));
      if (mine) return {post: pub(byId.get(mine.id), user), idempotent: true};
    }
    if (!target && !len(text) && !f0.media) throw new ApiError(400, 'BAD_TEXT', '请写下你想发布的内容');
    if (len(text)) vip.requireTextLength(user, 'post', text);
    let clientId = body && body.clientId != null ? String(body.clientId).trim() : '';
    if (clientId) {
      if (clientId.length > 80) throw new ApiError(400, 'BAD_CLIENT_ID', 'clientId 过长');
      const existed = byClient.get(user.id, clientId);
      if (existed) {
        if (existed.deleted_at) throw new ApiError(409, 'GONE', '这条动态已被删除');
        return {post: pub(existed, user), idempotent: true};
      }
    } else clientId = null;
    const f = fields(body);
    const id = nid(), t = now();
    try { ins.run(id, user.id, text, t, t, clientId, f.audience, f.mood, f.location, f.tagged, f.media); if (target) setRepost.run(target.id, id); }
    catch (e) {
      if (clientId && /UNIQUE/i.test(String(e.message))) {
        const existed = byClient.get(user.id, clientId);
        if (existed && !existed.deleted_at) return {post: pub(existed, user), idempotent: true};
      }
      throw e;
    }
    return {post: pub(byId.get(id), user), idempotent: false};
  }
  function get(user, id) {
    const row = byId.get(id);
    if (!row || row.deleted_at) throw new ApiError(404, 'NOT_FOUND', '动态不存在');
    if (!canSee(row, user)) throw new ApiError(404, 'NOT_FOUND', '动态不存在');
    return {post: pub(row, user)};
  }
  function edit(user, id, body) {
    const row = byId.get(id);
    if (!row || row.deleted_at) throw new ApiError(404, 'NOT_FOUND', '动态不存在');
    if (Number(row.author_id) !== Number(user.id)) throw new ApiError(403, 'FORBIDDEN', '只能编辑自己的动态');
    const text = String((body && body.text) != null ? body.text : row.text).trim();
    if (len(text) && extras && typeof extras.assertPlatform === 'function') extras.assertPlatform(text);
    if (!len(text)) throw new ApiError(400, 'BAD_TEXT', '请写下你想发布的内容');
    vip.requireTextLength(user, 'post', text);
    const f = fields(body || {});
    const aud = body && body.audience != null ? f.audience : null;
    const mood = body && 'mood' in body ? f.mood : null;
    const loc = body && 'location' in body ? f.location : null;
    const tagged = body && (body.tagged != null || body.taggedIds != null) ? f.tagged : null;
    const media = body && (body.media != null || body.mediaIds != null) ? f.media : null;
    upd.run(text, now(), aud, mood, loc, tagged, media, id, user.id);
    return {post: pub(byId.get(id), user)};
  }
  function remove(user, id) {
    const row = byId.get(id);
    if (!row || row.deleted_at) throw new ApiError(404, 'NOT_FOUND', '动态不存在');
    if (Number(row.author_id) !== Number(user.id)) throw new ApiError(403, 'FORBIDDEN', '只能删除自己的动态');
    del.run(now(), id, user.id);
    return {deleted: id};
  }
  function list(user, q = {}) {
    const limit = Math.min(Math.max(+(q.limit) || 20, 1), 50);
    const author = q.author === 'me' && user ? user.id : (q.author || null);
    const take = limit + 1;
    const authors = q.authors || null;
    const va = visArgs(user);
    const topic = q.feed === 'topic' || q.topic;
    let rows;
    try {
      if (topic) {
        if (q.cursor) {
          const cur = byId.get(String(q.cursor));
          if (!cur) throw new ApiError(400, 'BAD_CURSOR', '分页游标不正确');
          rows = listTopic.all(...va, cur.created_at, cur.created_at, cur.id, take);
        } else rows = newestTopic.all(...va, take);
      } else if (authors) {
        const js = JSON.stringify(authors.map(Number));
        if (q.cursor) {
          const cur = byId.get(String(q.cursor));
          if (!cur) throw new ApiError(400, 'BAD_CURSOR', '分页游标不正确');
          rows = listIn.all(js, ...va, cur.created_at, cur.created_at, cur.id, take);
        } else rows = newestIn.all(js, ...va, take);
      } else if (q.cursor) {
        const cur = byId.get(String(q.cursor));
        if (!cur) throw new ApiError(400, 'BAD_CURSOR', '分页游标不正确');
        rows = listSql.all(author, author, ...va, cur.created_at, cur.created_at, cur.id, take);
      } else {
        rows = newest.all(author, author, ...va, take);
      }
    } catch (e) {
      // post_hashtags 表在极旧库可能不存在，话题流退化为带 # 的文本过滤已在 SQL 中 OR。
      if (topic && /no such table/i.test(String(e.message))) {
        const fbNew = db.prepare(`SELECT * FROM posts WHERE deleted_at IS NULL AND text LIKE '%#%' ${vis} ORDER BY created_at DESC, id DESC LIMIT ?`);
        rows = fbNew.all(...va, take);
      } else throw e;
    }
    const more = rows.length > limit;
    if (more) rows = rows.slice(0, limit);
    const last = rows[rows.length - 1];
    return {posts: rows.map(r => pub(r, user)), nextCursor: more && last ? last.id : null};
  }
  return {create, get, edit, remove, list, pub, byId, attach, canSee, normAud};
}
