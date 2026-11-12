// 管理端用户、内容、公告与统计。路径对齐 Agen nova-admin 的 DEFAULT_ENDPOINT_MAP。
import {randomBytes} from 'node:crypto';
import {ApiError} from './errors.mjs';
import {hashPassword} from './auth.mjs';

function asInt(v) {
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
}

export function createAdminOps(db, {now, vip, profile, pay, audit} = {}) {
  const nowFn = now || Date.now;

  function userRow(u) {
    if (!u) return null;
    const p = profile ? profile.publicOf(u) : {};
    const st = vip ? vip.status(u) : {active: !!(u.vip_until && u.vip_until > nowFn()), until: u.vip_until};
    const posts = db.prepare('SELECT COUNT(*) n FROM posts WHERE author_id=? AND deleted_at IS NULL').get(u.id).n;
    const name = (p && p.displayName) || u.username;
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
    const where = [], args = [];
    if (status === 'banned' || status === 'active') { where.push('u.status=?'); args.push(status); }
    else if (status === 'vip') { where.push('u.vip_until IS NOT NULL AND u.vip_until>?'); args.push(nowFn()); }
    if (search) {
      where.push('(u.username LIKE ? OR u.email LIKE ? OR IFNULL(p.display_name,"") LIKE ?)');
      const like = '%' + search.replace(/%/g, '') + '%';
      args.push(like, like, like);
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
      author: u ? {id: u.id, username: u.username, displayName: (p && p.displayName) || u.username} : null,
      createdAt: row.created_at,
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
  function addAnnouncement(admin, body = {}, ip = null) {
    const title = String(body.title || '').trim();
    const text = String(body.body || body.content || '').trim();
    if (!title) throw new ApiError(400, 'BAD_TITLE', '请填写公告标题');
    if (!text) throw new ApiError(400, 'BAD_BODY', '请填写公告内容');
    const at = nowFn();
    const r = db.prepare('INSERT INTO announcements(title,body,created_at,published,author_admin_id) VALUES(?,?,?,?,?)')
      .run(title.slice(0, 120), text.slice(0, 8000), at, body.published === false ? 0 : 1, admin.id);
    if (audit) audit(admin.id, 'admin.announcement.create', 'announcement:' + r.lastInsertRowid, ip, {title, adminUsername: admin.username});
    return listAnnouncements();
  }
  function pubAnn(r) {
    return {
      id: r.id, title: r.title, body: r.body, published: !!r.published,
      createdAt: r.created_at, updatedAt: r.updated_at || null, authorAdminId: r.author_admin_id,
      withdrawn: !r.published,
    };
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
    let published = row.published;
    if (body.published != null) published = body.published ? 1 : 0;
    db.prepare('UPDATE announcements SET title=?, body=?, published=?, updated_at=? WHERE id=?')
      .run(title.slice(0, 120), text.slice(0, 8000), published, nowFn(), row.id);
    if (audit) audit(admin.id, 'admin.announcement.edit', 'announcement:' + row.id, ip, {title, published: !!published, adminUsername: admin.username});
    return {announcement: pubAnn(db.prepare('SELECT * FROM announcements WHERE id=?').get(row.id))};
  }
  function withdrawAnnouncement(admin, id, ip = null) {
    const row = db.prepare('SELECT * FROM announcements WHERE id=?').get(asInt(id));
    if (!row) throw new ApiError(404, 'NOT_FOUND', '公告不存在');
    if (!row.published) return {announcement: pubAnn(row), already: true};
    db.prepare('UPDATE announcements SET published=0, updated_at=? WHERE id=?').run(nowFn(), row.id);
    if (audit) audit(admin.id, 'admin.announcement.withdraw', 'announcement:' + row.id, ip, {adminUsername: admin.username});
    return {announcement: pubAnn(db.prepare('SELECT * FROM announcements WHERE id=?').get(row.id)), already: false};
  }

  function listCommunities(q = {}) {
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 100);
    const rows = db.prepare(`SELECT * FROM communities WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT ?`).all(limit);
    const nMem = db.prepare("SELECT COUNT(*) AS n FROM community_members WHERE community_id=? AND status='active'");
    return {communities: rows.map(r => ({
      id: r.id, name: r.name, description: r.description, visibility: r.visibility,
      ownerId: r.owner_id, memberCount: nMem.get(r.id).n, createdAt: r.created_at,
    }))};
  }
  function getCommunity(id) {
    const row = db.prepare('SELECT * FROM communities WHERE id=?').get(id);
    if (!row || row.deleted_at) throw new ApiError(404, 'NOT_FOUND', '社区不存在');
    const nMem = db.prepare("SELECT COUNT(*) AS n FROM community_members WHERE community_id=? AND status='active'").get(row.id).n;
    const members = db.prepare("SELECT * FROM community_members WHERE community_id=? AND status='active' ORDER BY joined_at").all(row.id).map(m => {
      const u = db.prepare('SELECT * FROM users WHERE id=?').get(m.user_id);
      return {userId: m.user_id, username: u && u.username, role: m.role, status: m.status, joinedAt: m.joined_at};
    });
    const chs = db.prepare("SELECT * FROM community_channels WHERE community_id=? AND deleted_at IS NULL ORDER BY created_at").all(row.id);
    const nMsg = db.prepare("SELECT COUNT(*) AS n FROM community_messages WHERE channel_id=?");
    const channels = chs.map(ch => ({
      id: ch.id, name: ch.name, kind: ch.kind, isDefault: !!ch.is_default,
      messageCount: nMsg.get(ch.id).n,
    }));
    return {community: {id: row.id, name: row.name, description: row.description, visibility: row.visibility, ownerId: row.owner_id, memberCount: nMem, createdAt: row.created_at, members, channels}};
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
          author: u ? {id: u.id, username: u.username, displayName: u.display_name} : null,
          text: r.text, createdAt: r.created_at, createdAtUtc: new Date(r.created_at).toISOString(),
        };
      })};
  }

  return {
    listUsers, oneUser, ban, unban, resetPassword, grantVip, revokeVip,
    listContent, getContent, hideContent, restoreContent,
    stats, listAnnouncements, addAnnouncement, removeAnnouncement, editAnnouncement, withdrawAnnouncement,
    listCommunities, getCommunity, listChannelMessages, userRow,
  };
}
