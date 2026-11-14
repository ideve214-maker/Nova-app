// 管理端用户、内容、公告与统计。路径对齐 Agen nova-admin 的 DEFAULT_ENDPOINT_MAP。
import {randomBytes} from 'node:crypto';
import {ApiError} from './errors.mjs';
import {hashPassword} from './auth.mjs';

function asInt(v) {
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
}

export function createAdminOps(db, {now, vip, profile, pay, audit, notifications} = {}) {
  const nowFn = now || Date.now;

  function userRow(u) {
    if (!u) return null;
    const p = profile ? profile.publicOf(u) : {};
    const st = vip ? vip.status(u) : {active: !!(u.vip_until && u.vip_until > nowFn()), until: u.vip_until};
    const posts = db.prepare('SELECT COUNT(*) n FROM posts WHERE author_id=? AND deleted_at IS NULL').get(u.id).n;
    const name = (p && p.displayName) || u.username;
    let followerCountReal = 0, tags = [];
    try { followerCountReal = db.prepare('SELECT COUNT(*) AS n FROM follows WHERE followee_id=?').get(u.id).n; } catch {}
    try { tags = db.prepare('SELECT tag FROM user_tags WHERE user_id=? ORDER BY tag').all(u.id).map(r => r.tag); } catch {}
    const followerBonus = Number(u.follower_bonus) || 0;
    return {
      id: u.id,
      userId: u.id,
      username: u.username,
      name,
      displayName: name,
      display_name: name,
      email: u.email,
      status: u.status || 'active',
      banned: u.status === 'banned',
      vip: !!st.active,
      badge: u.badge || null,
      badgeAt: u.badge_at || null,
      isVip: !!st.active,
      vipUntil: st.active ? st.until : (u.vip_until || null),
      vip_until: st.active ? st.until : (u.vip_until || null),
      vipSource: u.vip_source || null,
      createdAt: u.created_at,
      joinedAt: u.created_at,
      lastLoginAt: u.last_login_at || null,
      lastLogin: u.last_login_at || null,
      role: u.role,
      mustChangePw: !!u.must_change_pw,
      avatar: p && p.avatar ? p.avatar : '',
      bio: (p && p.bio) || '',
      posts,
      canPost: u.status === 'active',
      canComment: u.status === 'active',
      followerBonus,
      follower_bonus: followerBonus,
      followerCountReal,
      followerCount: followerCountReal + followerBonus,
      tags,
      deletedAt: u.deleted_at || null,
    };
  }

  function getUser(id) {
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(asInt(id));
    if (!u) throw new ApiError(404, 'NOT_FOUND', '用户不存在');
    return u;
  }

  function listUsers(q = {}) {
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 100);
    const cursor = q.cursor != null && q.cursor !== '' ? asInt(q.cursor) : null;
    const status = String(q.status || '').trim();
    const search = String(q.q || q.query || q.search || '').trim();
    const tag = String(q.tag || '').trim();
    const where = [], args = [];
    if (status === 'deleted') { where.push("(u.status='deleted' OR u.deleted_at IS NOT NULL)"); }
    else if (status === 'banned' || status === 'active') { where.push('u.status=?'); args.push(status); where.push('u.deleted_at IS NULL'); }
    else if (status === 'vip') { where.push('u.vip_until IS NOT NULL AND u.vip_until>? AND u.status!=\'deleted\' AND u.deleted_at IS NULL'); args.push(nowFn()); }
    else if (q.includeDeleted !== '1' && q.includeDeleted !== 1 && q.includeDeleted !== true) {
      where.push("u.status!='deleted' AND u.deleted_at IS NULL");
    }
    if (search) {
      where.push('(u.username LIKE ? OR u.email LIKE ? OR IFNULL(p.display_name,"") LIKE ?)');
      const like = '%' + search.replace(/%/g, '') + '%';
      args.push(like, like, like);
    }
    if (tag) {
      where.push('EXISTS (SELECT 1 FROM user_tags ut WHERE ut.user_id=u.id AND ut.tag=?)');
      args.push(tag);
    }
    if (cursor != null && Number.isFinite(cursor)) { where.push('u.id<?'); args.push(cursor); }
    const sql = `SELECT u.* FROM users u LEFT JOIN profiles p ON p.user_id=u.id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY u.id DESC LIMIT ?`;
    const rows = db.prepare(sql).all(...args, limit + 1);
    const more = rows.length > limit;
    const slice = more ? rows.slice(0, limit) : rows;
    return {users: slice.map(userRow), members: slice.map(userRow), nextCursor: more ? slice[slice.length - 1].id : null};
  }

  function oneUser(id) {
    return {user: userRow(getUser(id))};
  }

  function ban(admin, id, body = {}, ip = null) {
    const u = getUser(id);
    if (u.status === 'banned') return {user: userRow(u), already: true};
    const reason = String(body.reason || body.note || '').trim().slice(0, 500);
    db.prepare("UPDATE users SET status='banned' WHERE id=?").run(u.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
    if (audit) audit(admin.id, 'admin.user.ban', 'user:' + u.id, ip, {reason, username: u.username, adminUsername: admin.username});
    return {user: userRow(getUser(u.id)), already: false};
  }

  function unban(admin, id, body = {}, ip = null) {
    const u = getUser(id);
    if (u.status !== 'banned') return {user: userRow(u), already: true};
    const reason = String(body.reason || body.note || '').trim().slice(0, 500);
    db.prepare("UPDATE users SET status='active' WHERE id=?").run(u.id);
    if (audit) audit(admin.id, 'admin.user.unban', 'user:' + u.id, ip, {reason, username: u.username, adminUsername: admin.username});
    return {user: userRow(getUser(u.id)), already: false};
  }

  function resetPassword(admin, id, body = {}, ip = null) {
    const u = getUser(id);
    let pw = String(body.password || body.temporaryPassword || '').trim();
    if (pw) {
      if (!(pw.length >= 8 && pw.length <= 128 && /[A-Za-z]/.test(pw) && /\d/.test(pw))) {
        throw new ApiError(400, 'WEAK_PASSWORD', '指定密码需 8–128 位且同时包含字母和数字');
      }
    } else {
      pw = 'Tmp' + randomBytes(6).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x') + '1a';
    }
    db.prepare('UPDATE users SET password_hash=?, must_change_pw=1 WHERE id=?').run(hashPassword(pw), u.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
    if (audit) audit(admin.id, 'admin.user.reset_password', 'user:' + u.id, ip, {username: u.username, adminUsername: admin.username});
    return {user: userRow(getUser(u.id)), temporaryPassword: pw, mustChangePw: true};
  }

  function grantVip(admin, body = {}, ip = null) {
    const id = body.userId || body.user_id || body.id;
    const u = getUser(id);
    if (u.status === 'banned') throw new ApiError(409, 'BANNED', '封禁账号不能开通会员');
    const days = Number(body.days);
    if (!(Number.isInteger(days) && days > 0)) throw new ApiError(400, 'BAD_DAYS', '请填写开通天数');
    const reason = String(body.reason || body.note || '').trim();
    if (!reason) throw new ApiError(400, 'BAD_REASON', '请填写原因');
    const updated = vip.grant(u.id, {days, source: 'admin', actorId: admin.id, note: reason.slice(0, 500)});
    if (audit) audit(admin.id, 'admin.vip.grant', 'user:' + u.id, ip, {days, reason: reason.slice(0, 200), adminUsername: admin.username});
    return {user: userRow(updated)};
  }

  function revokeVip(admin, body = {}, ip = null) {
    const id = body.userId || body.user_id || body.id;
    const u = getUser(id);
    const reason = String(body.reason || body.note || '').trim();
    if (!reason) throw new ApiError(400, 'BAD_REASON', '请填写原因');
    const updated = vip.revoke(u.id, {source: 'admin', actorId: admin.id, note: reason.slice(0, 500)});
    if (audit) audit(admin.id, 'admin.vip.revoke', 'user:' + u.id, ip, {reason: reason.slice(0, 200), adminUsername: admin.username});
    return {user: userRow(updated)};
  }

  function pubPost(row) {
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(row.author_id);
    const p = u && profile ? profile.publicOf(u) : {};
    return {
      id: row.id,
      type: 'post',
      text: row.text,
      title: String(row.text || '').slice(0, 40),
      authorId: row.author_id,
      author: u ? {id: u.id, username: u.username, displayName: ((p && p.displayName && String(p.displayName).trim()) || u.username)} : null,
      createdAt: row.created_at,
      createdAtUtc: new Date(row.created_at).toISOString(),
      updatedAt: row.updated_at || null,
      deleted: !!row.deleted_at,
      deletedAt: row.deleted_at || null,
      status: row.deleted_at ? 'removed' : 'approved',
      adminHidden: !!row.admin_hidden,
      adminReason: row.admin_reason || null,
      adminActorId: row.admin_actor_id || null,
    };
  }
  function commentThread(row) {
    let depth = 0, rootId = row.id, walk = row, replyTo = null, guard = 0;
    const by = db.prepare('SELECT * FROM post_comments WHERE id=?');
    if (row.parent_id) {
      const p = by.get(row.parent_id);
      if (p) {
        const pu = db.prepare('SELECT * FROM users WHERE id=?').get(p.author_id);
        const pp = pu && profile ? profile.publicOf(pu) : {};
        replyTo = {
          id: p.id,
          deleted: !!p.deleted_at,
          author: pu ? {id: pu.id, username: pu.username, displayName: (pp && pp.displayName) || pu.username} : null,
          text: p.deleted_at ? '' : String(p.text || '').slice(0, 80),
        };
      } else {
        replyTo = {id: row.parent_id, deleted: true, missing: true, author: null, text: ''};
      }
    }
    while (walk && walk.parent_id && guard++ < 30) {
      const p = by.get(walk.parent_id);
      if (!p) break;
      depth++;
      rootId = p.parent_id ? rootId : p.id;
      if (!p.parent_id) rootId = p.id;
      walk = p;
    }
    if (row.parent_id && depth === 0) depth = 1;
    // recompute root properly
    walk = row; rootId = row.id; depth = 0; guard = 0;
    while (walk && walk.parent_id && guard++ < 30) {
      const p = by.get(walk.parent_id);
      if (!p) break;
      depth++;
      rootId = p.id;
      walk = p;
    }
    const replyCount = db.prepare('SELECT COUNT(*) AS n FROM post_comments WHERE parent_id=? AND deleted_at IS NULL').get(row.id).n;
    return {depth, rootId, replyTo, replyCount, parentId: row.parent_id || null};
  }
  function pubComment(row) {
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(row.author_id);
    const p = u && profile ? profile.publicOf(u) : {};
    const th = commentThread(row);
    return {
      id: row.id,
      type: 'comment',
      text: row.text,
      title: String(row.text || '').slice(0, 40),
      postId: row.post_id,
      parentId: th.parentId,
      rootId: th.rootId,
      depth: th.depth,
      replyTo: th.replyTo,
      replyCount: th.replyCount,
      authorId: row.author_id,
      author: u ? {id: u.id, username: u.username, displayName: (p && p.displayName) || u.username} : null,
      createdAt: row.created_at,
      createdAtUtc: new Date(row.created_at).toISOString(),
      deleted: !!row.deleted_at,
      deletedAt: row.deleted_at || null,
      status: row.deleted_at ? 'removed' : 'approved',
      adminHidden: !!row.admin_hidden,
      adminReason: row.admin_reason || null,
      adminActorId: row.admin_actor_id || null,
    };
  }

  function listContent(q = {}) {
    const type = String(q.type || 'post').trim() || 'post';
    const status = String(q.status || 'all').trim();
    const search = String(q.q || q.query || '').trim();
    const limit = Math.min(Math.max(Number(q.limit) || 30, 1), 100);
    const cursor = q.cursor != null && q.cursor !== '' ? String(q.cursor) : null;
    if (type !== 'post' && type !== 'comment') throw new ApiError(400, 'BAD_TYPE', 'type 须为 post 或 comment');
    const table = type === 'post' ? 'posts' : 'post_comments';
    const where = [], args = [];
    if (status === 'removed' || status === 'deleted') where.push('deleted_at IS NOT NULL');
    else if (status === 'visible' || status === 'approved') where.push('deleted_at IS NULL');
    if (search) { where.push('text LIKE ?'); args.push('%' + search.replace(/%/g, '') + '%'); }
    if (cursor) { where.push('created_at<?'); args.push(Number(cursor) || 0); }
    const sql = `SELECT * FROM ${table} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`;
    const rows = db.prepare(sql).all(...args, limit + 1);
    const more = rows.length > limit;
    const slice = more ? rows.slice(0, limit) : rows;
    const items = slice.map(r => type === 'post' ? pubPost(r) : pubComment(r));
    return {items, posts: type === 'post' ? items : undefined, comments: type === 'comment' ? items : undefined, nextCursor: more ? String(slice[slice.length - 1].created_at) : null};
  }

  function getContent(type, id) {
    if (type === 'post') {
      const row = db.prepare('SELECT * FROM posts WHERE id=?').get(id);
      if (!row) throw new ApiError(404, 'NOT_FOUND', '动态不存在');
      return {item: pubPost(row)};
    }
    if (type === 'comment') {
      const row = db.prepare('SELECT * FROM post_comments WHERE id=?').get(id);
      if (!row) throw new ApiError(404, 'NOT_FOUND', '评论不存在');
      return {item: pubComment(row)};
    }
    throw new ApiError(400, 'BAD_TYPE', 'type 须为 post 或 comment');
  }

  function hideContent(admin, type, id, body = {}, ip = null) {
    const reason = String(body.reason || body.note || '').trim().slice(0, 500);
    const at = nowFn();
    if (type === 'post') {
      const row = db.prepare('SELECT * FROM posts WHERE id=?').get(id);
      if (!row) throw new ApiError(404, 'NOT_FOUND', '动态不存在');
      if (row.deleted_at && row.admin_hidden) {
        return {item: pubPost(row), already: true};
      }
      db.prepare('UPDATE posts SET deleted_at=COALESCE(deleted_at,?), admin_hidden=1, admin_reason=?, admin_actor_id=? WHERE id=?')
        .run(at, reason, admin.id, id);
      if (audit) audit(admin.id, 'admin.content.delete', 'post:' + id, ip, {reason, adminUsername: admin.username});
      return {item: pubPost(db.prepare('SELECT * FROM posts WHERE id=?').get(id)), already: false};
    }
    if (type === 'comment') {
      const row = db.prepare('SELECT * FROM post_comments WHERE id=?').get(id);
      if (!row) throw new ApiError(404, 'NOT_FOUND', '评论不存在');
      if (row.deleted_at && row.admin_hidden) return {item: pubComment(row), already: true};
      db.prepare('UPDATE post_comments SET deleted_at=COALESCE(deleted_at,?), admin_hidden=1, admin_reason=?, admin_actor_id=? WHERE id=?')
        .run(at, reason, admin.id, id);
      if (audit) audit(admin.id, 'admin.content.delete', 'comment:' + id, ip, {reason, adminUsername: admin.username});
      return {item: pubComment(db.prepare('SELECT * FROM post_comments WHERE id=?').get(id)), already: false};
    }
    throw new ApiError(400, 'BAD_TYPE', 'type 须为 post 或 comment');
  }

  function restoreContent(admin, type, id, body = {}, ip = null) {
    if (type === 'post') {
      const row = db.prepare('SELECT * FROM posts WHERE id=?').get(id);
      if (!row) throw new ApiError(404, 'NOT_FOUND', '动态不存在');
      if (!row.deleted_at) return {item: pubPost(row), already: true};
      db.prepare('UPDATE posts SET deleted_at=NULL, admin_hidden=0, admin_reason=NULL, admin_actor_id=? WHERE id=?').run(admin.id, id);
      if (audit) audit(admin.id, 'admin.content.restore', 'post:' + id, ip, {adminUsername: admin.username});
      return {item: pubPost(db.prepare('SELECT * FROM posts WHERE id=?').get(id)), already: false};
    }
    if (type === 'comment') {
      const row = db.prepare('SELECT * FROM post_comments WHERE id=?').get(id);
      if (!row) throw new ApiError(404, 'NOT_FOUND', '评论不存在');
      if (!row.deleted_at) return {item: pubComment(row), already: true};
      db.prepare('UPDATE post_comments SET deleted_at=NULL, admin_hidden=0, admin_reason=NULL, admin_actor_id=? WHERE id=?').run(admin.id, id);
      if (audit) audit(admin.id, 'admin.content.restore', 'comment:' + id, ip, {adminUsername: admin.username});
      return {item: pubComment(db.prepare('SELECT * FROM post_comments WHERE id=?').get(id)), already: false};
    }
    throw new ApiError(400, 'BAD_TYPE', 'type 须为 post 或 comment');
  }

  function stats() {
    const users = db.prepare('SELECT COUNT(*) n FROM users').get().n;
    const banned = db.prepare("SELECT COUNT(*) n FROM users WHERE status='banned'").get().n;
    const vipN = db.prepare('SELECT COUNT(*) n FROM users WHERE vip_until IS NOT NULL AND vip_until>?').get(nowFn()).n;
    const postsVis = db.prepare('SELECT COUNT(*) n FROM posts WHERE deleted_at IS NULL').get().n;
    const postsHid = db.prepare('SELECT COUNT(*) n FROM posts WHERE deleted_at IS NOT NULL').get().n;
    const commentsVis = db.prepare('SELECT COUNT(*) n FROM post_comments WHERE deleted_at IS NULL').get().n;
    const reportsPending = (() => {
      try { return db.prepare("SELECT COUNT(*) n FROM reports WHERE status='pending'").get().n; }
      catch { return 0; }
    })();
    let payPending = 0, payReview = 0;
    if (pay) {
      pay.expire();
      payPending = db.prepare("SELECT COUNT(*) n FROM pay_orders WHERE status='pending'").get().n;
      payReview = db.prepare("SELECT COUNT(*) n FROM pay_orders WHERE status='awaiting_review'").get().n;
    }
    return {
      users: {total: users, active: users - banned, banned, vip: vipN},
      posts: {visible: postsVis, removed: postsHid},
      comments: {visible: commentsVis},
      reports: {pending: reportsPending},
      payments: {pending: payPending, awaitingReview: payReview},
    };
  }

  function listAnnouncements(q = {}) {
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 100);
    const rows = db.prepare('SELECT * FROM announcements ORDER BY created_at DESC LIMIT ?').all(limit);
    return {announcements: rows.map(pubAnn)};
  }
  // r7：同一时间只允许一条公告发布中；发布（含新建默认发布）时把其他发布中的下线，返回被下线的 ID。
  function withdrawOthers(keepId, at) {
    const rows = db.prepare('SELECT id FROM announcements WHERE published=1 AND id<>?').all(keepId);
    if (rows.length) db.prepare('UPDATE announcements SET published=0, updated_at=? WHERE published=1 AND id<>?').run(at, keepId);
    return rows.map(r => r.id);
  }
  function addAnnouncement(admin, body = {}, ip = null) {
    const title = String(body.title || '').trim();
    const text = String(body.body || body.content || '').trim();
    if (!title) throw new ApiError(400, 'BAD_TITLE', '请填写公告标题');
    if (!text) throw new ApiError(400, 'BAD_BODY', '请填写公告内容');
    const at = nowFn();
    // 不传 published 时默认发布（兼容旧版管理端）；新版管理端显式传 published:false 存草稿。
    const pub = body.published === false ? 0 : 1;
    const r = db.prepare('INSERT INTO announcements(title,body,created_at,published,published_at,author_admin_id) VALUES(?,?,?,?,?,?)')
      .run(title.slice(0, 120), text.slice(0, 8000), at, pub, pub ? at : null, admin.id);
    const id = Number(r.lastInsertRowid);
    const withdrawnIds = pub ? withdrawOthers(id, at) : [];
    if (audit) audit(admin.id, 'admin.announcement.create', 'announcement:' + id, ip, {title, published: !!pub, withdrawnIds, adminUsername: admin.username});
    return {...listAnnouncements(), announcement: pubAnn(db.prepare('SELECT * FROM announcements WHERE id=?').get(id)), withdrawnIds};
  }
  function annVersion(r) {
    const t = Math.max(Number(r.published_at) || 0, Number(r.updated_at) || 0, Number(r.created_at) || 0);
    return r.id + '-' + t;
  }
  function pubAnn(r) {
    const status = r.published ? 'published' : (r.published_at ? 'withdrawn' : 'draft');
    return {
      id: r.id, title: r.title, body: r.body, published: !!r.published,
      status,
      createdAt: r.created_at,
      createdAtUtc: r.created_at != null ? new Date(r.created_at).toISOString() : null,
      updatedAt: r.updated_at || null,
      updatedAtUtc: r.updated_at ? new Date(r.updated_at).toISOString() : null,
      publishedAt: r.published_at || null,
      publishedAtUtc: r.published_at ? new Date(r.published_at).toISOString() : null,
      authorAdminId: r.author_admin_id,
      withdrawn: status === 'withdrawn',
      version: annVersion(r),
    };
  }
  // 用户端：当前发布中的公告（只给用户需要的字段）
  function currentAnnouncement() {
    const r = db.prepare('SELECT * FROM announcements WHERE published=1 ORDER BY published_at DESC, id DESC LIMIT 1').get();
    if (!r) return {announcement: null};
    return {announcement: {
      id: r.id, title: r.title, body: r.body,
      publishedAt: r.published_at || r.created_at,
      publishedAtUtc: new Date(r.published_at || r.created_at).toISOString(),
      updatedAt: r.updated_at || null,
      version: annVersion(r),
    }};
  }
  function removeAnnouncement(admin, id, ip = null) {
    const row = db.prepare('SELECT * FROM announcements WHERE id=?').get(asInt(id));
    if (!row) throw new ApiError(404, 'NOT_FOUND', '公告不存在');
    db.prepare('DELETE FROM announcements WHERE id=?').run(row.id);
    if (audit) audit(admin.id, 'admin.announcement.delete', 'announcement:' + row.id, ip, {adminUsername: admin.username});
    return {deleted: row.id};
  }
  function editAnnouncement(admin, id, body = {}, ip = null) {
    const row = db.prepare('SELECT * FROM announcements WHERE id=?').get(asInt(id));
    if (!row) throw new ApiError(404, 'NOT_FOUND', '公告不存在');
    const title = body.title != null ? String(body.title).trim() : row.title;
    const text = body.body != null || body.content != null ? String(body.body || body.content).trim() : row.body;
    if (!title) throw new ApiError(400, 'BAD_TITLE', '请填写公告标题');
    if (!text) throw new ApiError(400, 'BAD_BODY', '请填写公告内容');
    const t = title.slice(0, 120), x = text.slice(0, 8000);
    const at = nowFn();
    // 只有标题或内容真的变了才更新 updated_at（version 跟着变，用户会再看到一次弹窗）
    const changed = t !== row.title || x !== row.body;
    let published = row.published, publishedAt = row.published_at;
    let withdrawnIds = [];
    if (body.published != null) {
      const want = body.published ? 1 : 0;
      if (want && !row.published) publishedAt = at;
      published = want;
    }
    db.prepare('UPDATE announcements SET title=?, body=?, published=?, published_at=?, updated_at=? WHERE id=?')
      .run(t, x, published, publishedAt, changed || published !== row.published ? at : row.updated_at, row.id);
    if (published && !row.published) withdrawnIds = withdrawOthers(row.id, at);
    if (audit) audit(admin.id, 'admin.announcement.edit', 'announcement:' + row.id, ip, {title, published: !!published, changed, withdrawnIds, adminUsername: admin.username});
    return {announcement: pubAnn(db.prepare('SELECT * FROM announcements WHERE id=?').get(row.id)), withdrawnIds};
  }
  function publishAnnouncement(admin, id, ip = null) {
    const row = db.prepare('SELECT * FROM announcements WHERE id=?').get(asInt(id));
    if (!row) throw new ApiError(404, 'NOT_FOUND', '公告不存在');
    if (row.published) return {announcement: pubAnn(row), already: true, withdrawnIds: []};
    const at = nowFn();
    db.prepare('UPDATE announcements SET published=1, published_at=?, updated_at=? WHERE id=?').run(at, at, row.id);
    const withdrawnIds = withdrawOthers(row.id, at);
    if (audit) audit(admin.id, 'admin.announcement.publish', 'announcement:' + row.id, ip, {withdrawnIds, adminUsername: admin.username});
    return {announcement: pubAnn(db.prepare('SELECT * FROM announcements WHERE id=?').get(row.id)), already: false, withdrawnIds};
  }
  function withdrawAnnouncement(admin, id, ip = null) {
    const row = db.prepare('SELECT * FROM announcements WHERE id=?').get(asInt(id));
    if (!row) throw new ApiError(404, 'NOT_FOUND', '公告不存在');
    if (!row.published) return {announcement: pubAnn(row), already: true};
    db.prepare('UPDATE announcements SET published=0, updated_at=? WHERE id=?').run(nowFn(), row.id);
    if (audit) audit(admin.id, 'admin.announcement.withdraw', 'announcement:' + row.id, ip, {adminUsername: admin.username});
    return {announcement: pubAnn(db.prepare('SELECT * FROM announcements WHERE id=?').get(row.id)), already: false};
  }

  function cmStatus(r) { return r.deleted_at ? 'deleted' : r.taken_down_at ? 'taken_down' : 'active'; }
  function cmModFields(r) {
    return {status: cmStatus(r), takenDownAt: r.taken_down_at || null, takedownReason: r.takedown_reason || null};
  }
  function listCommunities(q = {}) {
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 100);
    const rows = db.prepare(`SELECT * FROM communities WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT ?`).all(limit);
    const nMem = db.prepare("SELECT COUNT(*) AS n FROM community_members WHERE community_id=? AND status='active'");
    return {communities: rows.map(r => ({
      id: r.id, name: r.name, description: r.description, visibility: r.visibility,
      ownerId: r.owner_id, memberCount: nMem.get(r.id).n, createdAt: r.created_at, ...cmModFields(r), cover: r.cover || null,
    }))};
  }
  function getCommunity(id) {
    const row = db.prepare('SELECT * FROM communities WHERE id=?').get(id);
    if (!row || row.deleted_at) throw new ApiError(404, 'NOT_FOUND', '社区不存在');
    const nMem = db.prepare("SELECT COUNT(*) AS n FROM community_members WHERE community_id=? AND status='active'").get(row.id).n;
    const t = nowFn();
    const members = db.prepare("SELECT * FROM community_members WHERE community_id=? AND status='active' ORDER BY joined_at").all(row.id).map(m => {
      const u = db.prepare('SELECT * FROM users WHERE id=?').get(m.user_id);
      const muted = !!(m.muted_until && m.muted_until > t);
      return {userId: m.user_id, username: u && u.username, role: m.role, status: m.status, joinedAt: m.joined_at,
        muted, mutedUntil: muted ? m.muted_until : null};
    });
    const chs = db.prepare("SELECT * FROM community_channels WHERE community_id=? AND deleted_at IS NULL ORDER BY created_at").all(row.id);
    const nMsg = db.prepare("SELECT COUNT(*) AS n FROM community_messages WHERE channel_id=?");
    const channels = chs.map(ch => ({
      id: ch.id, name: ch.name, kind: ch.kind, isDefault: !!ch.is_default,
      messageCount: nMsg.get(ch.id).n,
    }));
    return {community: {id: row.id, name: row.name, description: row.description, visibility: row.visibility, ownerId: row.owner_id, memberCount: nMem, createdAt: row.created_at, ...cmModFields(row), cover: row.cover || null, members, channels}};
  }

  // ---- 社区管理（管理端）：下架/恢复/警告/删除、移除成员、禁言 ----
  function needReason(body) {
    const reason = String((body && (body.reason || body.note)) || '').trim().slice(0, 200);
    if (!reason) throw new ApiError(400, 'REASON_REQUIRED', '请填写原因');
    return reason;
  }
  function cmRow(id) {
    const row = db.prepare('SELECT * FROM communities WHERE id=?').get(String(id));
    if (!row || row.deleted_at) throw new ApiError(404, 'NOT_FOUND', '社区不存在');
    return row;
  }
  function notifyUser(uid, title, body, cmId, key, {kind = 'community_moderation', data = null} = {}) {
    if (!notifications || typeof notifications.push !== 'function' || uid == null) return false;
    notifications.push(Number(uid), {kind, title, body, refType: 'community', refId: cmId, actorId: null, dedupeKey: key, data});
    return true;
  }
  function takedownCommunity(admin, id, body = {}, ip = null) {
    const row = cmRow(id);
    const reason = needReason(body);
    if (row.taken_down_at) return {community: getCommunity(row.id).community, already: true, notified: false};
    const at = nowFn();
    db.prepare('UPDATE communities SET taken_down_at=?, takedown_reason=?, taken_down_by=? WHERE id=?').run(at, reason, admin.id, row.id);
    if (audit) audit(admin.id, 'admin.community.takedown', 'community:' + row.id, ip, {reason, adminUsername: admin.username, name: row.name});
    const notified = body.notify === false ? false : notifyUser(row.owner_id, '社区已被下架',
      `你的社区「${row.name}」因存在问题已被下架（原因：${reason}），如有疑问请联系管理员或提交申诉。`, row.id, 'community:' + row.id + ':takedown:' + at,
      {kind: 'community_takedown', data: {type: 'community_takedown', communityId: row.id, communityName: row.name, reason, takenDownAt: at,
        appealable: true, appeal: {method: 'POST', path: '/api/appeals', kind: 'community', related: row.id}}});
    return {community: getCommunity(row.id).community, already: false, notified};
  }
  function restoreCommunity(admin, id, body = {}, ip = null) {
    const row = cmRow(id);
    const reason = String((body && (body.reason || body.note)) || '').trim().slice(0, 200);
    if (!row.taken_down_at) return {community: getCommunity(row.id).community, already: true, notified: false};
    const at = nowFn();
    db.prepare('UPDATE communities SET taken_down_at=NULL, takedown_reason=NULL, taken_down_by=NULL WHERE id=?').run(row.id);
    if (audit) audit(admin.id, 'admin.community.restore', 'community:' + row.id, ip, {reason, adminUsername: admin.username, name: row.name});
    const notified = body.notify === false ? false : notifyUser(row.owner_id, '社区已恢复',
      `你的社区「${row.name}」已恢复上架` + (reason ? `（${reason}）` : '') + '。', row.id, 'community:' + row.id + ':restore:' + at,
      {kind: 'community_restored', data: {type: 'community_restored', communityId: row.id, communityName: row.name}});
    return {community: getCommunity(row.id).community, already: false, notified};
  }
  function warnCommunity(admin, id, body = {}, ip = null) {
    const row = cmRow(id);
    const reason = needReason(body);
    const at = nowFn();
    if (audit) audit(admin.id, 'admin.community.warn', 'community:' + row.id, ip, {reason, adminUsername: admin.username, name: row.name});
    const notified = notifyUser(row.owner_id, '社区警告',
      `你的社区「${row.name}」收到管理员警告：${reason}。请整改并遵守社区规范，否则社区可能被下架。`, row.id, 'community:' + row.id + ':warn:' + at,
      {kind: 'community_warning', data: {type: 'community_warning', communityId: row.id, communityName: row.name, reason}});
    return {community: getCommunity(row.id).community, warned: true, notified};
  }
  function deleteCommunity(admin, id, body = {}, ip = null) {
    const row = cmRow(id);
    const reason = needReason(body);
    if (body.confirm !== true && body.confirm !== row.id) throw new ApiError(400, 'CONFIRM_REQUIRED', '删除社区需要二次确认');
    const at = nowFn();
    db.prepare('UPDATE communities SET deleted_at=?, takedown_reason=COALESCE(takedown_reason, ?), taken_down_by=COALESCE(taken_down_by, ?) WHERE id=?').run(at, reason, admin.id, row.id);
    if (audit) audit(admin.id, 'admin.community.delete', 'community:' + row.id, ip, {reason, adminUsername: admin.username, name: row.name});
    const notified = notifyUser(row.owner_id, '社区已被删除',
      `你的社区「${row.name}」因「${reason}」已被管理员删除。如有疑问请联系管理员。`, row.id, 'community:' + row.id + ':delete',
      {kind: 'community_deleted', data: {type: 'community_deleted', communityId: row.id, communityName: row.name, reason}});
    return {deleted: row.id, notified};
  }
  function memberRow(cmId, userId) {
    const m = db.prepare("SELECT * FROM community_members WHERE community_id=? AND user_id=? AND status='active'").get(cmId, Number(userId));
    if (!m) throw new ApiError(404, 'NOT_FOUND', '成员不存在');
    return m;
  }
  function removeMember(admin, id, userId, body = {}, ip = null) {
    const row = cmRow(id);
    const reason = needReason(body);
    const m = memberRow(row.id, userId);
    if (m.role === 'owner') throw new ApiError(400, 'OWNER', '不能移除社区所有者，请改为下架或删除社区');
    const ban = !!body.ban;
    db.prepare('UPDATE community_members SET status=? WHERE community_id=? AND user_id=?').run(ban ? 'banned' : 'left', row.id, m.user_id);
    if (audit) audit(admin.id, 'admin.community.member_remove', 'community:' + row.id, ip, {userId: m.user_id, ban, reason, adminUsername: admin.username});
    const at = nowFn();
    notifyUser(m.user_id, '你已被移出社区', `你已被管理员移出社区「${row.name}」` + (ban ? '，且不能再加入' : '') + `。原因：${reason}。`, row.id, 'community:' + row.id + ':rm:' + m.user_id + ':' + at);
    notifyUser(row.owner_id, '社区成员被移除', `管理员已将一名成员移出你的社区「${row.name}」。原因：${reason}。`, row.id, 'community:' + row.id + ':rmo:' + m.user_id + ':' + at);
    return {community: getCommunity(row.id).community, removed: m.user_id, banned: ban};
  }
  function muteMember(admin, id, userId, body = {}, ip = null) {
    const row = cmRow(id);
    const reason = needReason(body);
    const m = memberRow(row.id, userId);
    const hours = Math.min(Math.max(Number(body.hours) || 24, 1), 24 * 365);
    const until = nowFn() + hours * 3600e3;
    db.prepare('UPDATE community_members SET muted_until=?, muted_reason=? WHERE community_id=? AND user_id=?').run(until, reason, row.id, m.user_id);
    if (audit) audit(admin.id, 'admin.community.member_mute', 'community:' + row.id, ip, {userId: m.user_id, hours, reason, adminUsername: admin.username});
    notifyUser(m.user_id, '你在社区被禁言', `你在社区「${row.name}」被管理员禁言 ${hours} 小时。原因：${reason}。`, row.id, 'community:' + row.id + ':mute:' + m.user_id + ':' + until);
    return {community: getCommunity(row.id).community, muted: m.user_id, mutedUntil: until};
  }
  function unmuteMember(admin, id, userId, body = {}, ip = null) {
    const row = cmRow(id);
    const m = memberRow(row.id, userId);
    db.prepare('UPDATE community_members SET muted_until=NULL, muted_reason=NULL WHERE community_id=? AND user_id=?').run(row.id, m.user_id);
    if (audit) audit(admin.id, 'admin.community.member_unmute', 'community:' + row.id, ip, {userId: m.user_id, adminUsername: admin.username});
    return {community: getCommunity(row.id).community, unmuted: m.user_id};
  }
  function listChannelMessages(chId, q = {}) {
    const ch = db.prepare('SELECT * FROM community_channels WHERE id=?').get(chId);
    if (!ch || ch.deleted_at) throw new ApiError(404, 'NOT_FOUND', '频道不存在');
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
    const rows = db.prepare('SELECT * FROM community_messages WHERE channel_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ?').all(ch.id, limit);
    return {channel: {id: ch.id, name: ch.name, communityId: ch.community_id, kind: ch.kind},
      messages: rows.reverse().map(r => {
        const u = db.prepare('SELECT * FROM users WHERE id=?').get(r.author_id);
        return {
          id: r.id, channelId: ch.id, authorId: r.author_id,
          author: u ? {id: u.id, username: u.username, displayName: (profile && profile.publicOf ? (String((profile.publicOf(u).displayName||'')).trim() || u.username) : u.username)} : null,
          text: r.text, createdAt: r.created_at, createdAtUtc: new Date(r.created_at).toISOString(),
        };
      })};
  }

  return {
    listUsers, oneUser, ban, unban, resetPassword, grantVip, revokeVip,
    listContent, getContent, hideContent, restoreContent,
    stats, listAnnouncements, addAnnouncement, removeAnnouncement, editAnnouncement, withdrawAnnouncement,
    publishAnnouncement, currentAnnouncement, pubPost,
    listCommunities, getCommunity, listChannelMessages, userRow,
    takedownCommunity, restoreCommunity, warnCommunity, deleteCommunity, removeMember, muteMember, unmuteMember,
  };
}
