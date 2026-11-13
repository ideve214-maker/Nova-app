// r7 热门话题：管理员在管理端挑选帖子并排序；用户端“热门话题”栏按这个顺序显示。
// 用户端：GET /api/hot-posts
// 管理端：GET/POST /api/admin/hot-posts、POST /api/admin/hot-posts/:postId/delete、POST /api/admin/hot-posts/order
// 接口约定见 /workspace/r7-api-contract.md（与 A 的管理端草案对齐）。
import {ApiError} from './errors.mjs';

export const HOT_MAX = 20;

export function createFeatured(db, {now, posts, pubPost, audit} = {}) {
  const nowFn = now || Date.now;
  const q = {
    all: db.prepare('SELECT * FROM hot_posts ORDER BY position ASC, added_at ASC'),
    one: db.prepare('SELECT * FROM hot_posts WHERE post_id=?'),
    count: db.prepare('SELECT COUNT(*) n FROM hot_posts'),
    maxPos: db.prepare('SELECT COALESCE(MAX(position), 0) m FROM hot_posts'),
    ins: db.prepare('INSERT INTO hot_posts(post_id, position, added_at, added_by_admin_id) VALUES(?,?,?,?)'),
    del: db.prepare('DELETE FROM hot_posts WHERE post_id=?'),
    pos: db.prepare('UPDATE hot_posts SET position=? WHERE post_id=?'),
    post: db.prepare('SELECT * FROM posts WHERE id=?'),
  };
  const tx = fn => (...a) => { db.exec('BEGIN'); try { const r = fn(...a); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const pid = v => String(v == null ? '' : v).trim();
  const writeOrder = ids => ids.forEach((id, i) => q.pos.run(i + 1, id));
  const renumber = () => writeOrder(q.all.all().map(h => h.post_id));

  // ---------- 用户端 ----------
  // 结构与 GET /api/posts 相同；已删除/被隐藏/看不到的跳过；不翻页。
  function forUser(user, query = {}) {
    const limit = Math.min(Math.max(Number(query.limit) || HOT_MAX, 1), HOT_MAX);
    const out = [];
    for (const h of q.all.all()) {
      if (out.length >= limit) break;
      const row = posts.byId.get(h.post_id);
      if (!row || row.deleted_at || row.admin_hidden || !posts.canSee(row, user)) continue;
      const p = posts.pub(row, user);
      if (!p) continue;
      p.hotPosition = out.length + 1;
      out.push(p);
    }
    return {posts: out, nextCursor: null, picked: q.count.get().n};
  }

  // ---------- 管理端 ----------
  function item(h) {
    const r = q.post.get(h.post_id);
    return {
      postId: h.post_id,
      position: h.position,
      addedAt: h.added_at,
      addedAtUtc: new Date(h.added_at).toISOString(),
      addedByAdminId: h.added_by_admin_id || null,
      available: !!(r && !r.deleted_at && !r.admin_hidden && (r.audience || 'public') === 'public'),
      post: r ? pubPost(r) : null,
    };
  }
  function list() { return {items: q.all.all().map(item), max: HOT_MAX}; }

  const add = tx((admin, body = {}, ip = null) => {
    const id = pid(body.postId != null ? body.postId : body.post_id);
    if (!id) throw new ApiError(400, 'BAD_POST_ID', '请选择帖子');
    const r = q.post.get(id);
    if (!r) throw new ApiError(404, 'NOT_FOUND', '动态不存在');
    if (q.one.get(id)) return {...list(), already: true};
    if (r.deleted_at || r.admin_hidden) throw new ApiError(409, 'POST_REMOVED', '这条动态已被删除，不能设为热门');
    if ((r.audience || 'public') !== 'public') throw new ApiError(409, 'POST_NOT_PUBLIC', '只有公开的动态才能设为热门');
    if (q.count.get().n >= HOT_MAX) throw new ApiError(409, 'HOT_FULL', '热门最多 ' + HOT_MAX + ' 条，请先移出一些', {max: HOT_MAX});
    q.ins.run(id, q.maxPos.get().m + 1, nowFn(), admin.id);
    const pos = Number(body.position);
    const ids = q.all.all().map(h => h.post_id).filter(x => x !== id);
    if (Number.isInteger(pos) && pos >= 1 && pos <= ids.length) ids.splice(pos - 1, 0, id); else ids.push(id);
    writeOrder(ids);
    if (audit) audit(admin.id, 'admin.hot.add', 'post:' + id, ip, {adminUsername: admin.username});
    return {...list(), already: false};
  });
  const remove = tx((admin, id, ip = null) => {
    id = pid(id);
    if (!q.one.get(id)) return {...list(), already: true};
    q.del.run(id);
    renumber();
    if (audit) audit(admin.id, 'admin.hot.remove', 'post:' + id, ip, {adminUsername: admin.username});
    return {...list(), already: false};
  });
  const order = tx((admin, body = {}, ip = null) => {
    const raw = body.postIds;
    if (!Array.isArray(raw)) throw new ApiError(400, 'BAD_ORDER', '顺序数据不正确');
    const want = raw.map(pid);
    if (want.some(x => !x) || new Set(want).size !== want.length) throw new ApiError(400, 'BAD_ORDER', '顺序数据不正确');
    const cur = q.all.all().map(h => h.post_id);
    if (want.length !== cur.length || !want.every(x => cur.includes(x)))
      throw new ApiError(409, 'ORDER_CONFLICT', '热门列表已被其他人修改，请刷新后再排', {items: list().items});
    writeOrder(want);
    if (audit) audit(admin.id, 'admin.hot.reorder', 'hot_posts', ip, {adminUsername: admin.username, postIds: want});
    return list();
  });
  // 管理端搜索结果标注“已在热门”用
  function marks() { const m = new Map(); for (const h of q.all.all()) m.set(h.post_id, h.position); return m; }

  return {forUser, list, add, remove, order, marks, HOT_MAX};
}
