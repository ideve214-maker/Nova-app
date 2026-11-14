// r10 营销管理（2）：数据调整。
// - 用户端：POST /api/posts/:id/view 每人每帖记一次真实阅读。
// - 管理端：按关键词或用户名搜帖子，修改「显示的」阅读 / 点赞 / 收藏数。只存与真实数的差值，真实记录不动，随时可以恢复。
import {ApiError} from './errors.mjs';

export function createPostStats(db, {now = Date.now, posts, comments} = {}) {
  const byId = db.prepare('SELECT * FROM posts WHERE id=? AND deleted_at IS NULL');
  const insView = db.prepare('INSERT OR IGNORE INTO post_views(post_id,user_id,at) VALUES(?,?,?)');
  const viewCnt = db.prepare('SELECT COUNT(*) n FROM post_views WHERE post_id=?');
  const saveCnt = db.prepare("SELECT COUNT(*) n FROM saved_items WHERE kind='post' AND target=?");
  const likeCnt = db.prepare('SELECT COUNT(*) n FROM post_reactions WHERE post_id=?');
  const setAdj = db.prepare('UPDATE posts SET adj_views=?, adj_likes=?, adj_saves=? WHERE id=?');
  const userBy = db.prepare('SELECT u.id,u.username,p.display_name FROM users u LEFT JOIN profiles p ON p.user_id=u.id WHERE u.id=?');
  const listeners = [];

  function real(id) {
    let likes = 0;
    try { likes = likeCnt.get(id).n; } catch { likes = 0; }
    return {views: viewCnt.get(id).n, likes, saves: saveCnt.get(id).n};
  }
  function row2(r) {
    const re = real(r.id);
    const u = userBy.get(r.author_id);
    const adj = {views: r.adj_views || 0, likes: r.adj_likes || 0, saves: r.adj_saves || 0};
    return {
      id: r.id, text: String(r.text || '').slice(0, 200), createdAt: r.created_at, audience: r.audience || 'public',
      author: u ? {id: u.id, username: u.username, displayName: u.display_name || u.username} : null,
      real: re, adj,
      shown: {views: Math.max(0, re.views + adj.views), likes: Math.max(0, re.likes + adj.likes), saves: Math.max(0, re.saves + adj.saves)},
    };
  }
  function search(q = {}) {
    const kw = String(q.q || '').trim().replace(/[%_]/g, '');
    const limit = Math.min(Math.max(Number(q.limit) || 30, 1), 100);
    let rows;
    if (!kw) rows = db.prepare('SELECT * FROM posts WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT ?').all(limit);
    else {
      const like = '%' + kw + '%';
      const user = kw.replace(/^@/, '');
      rows = db.prepare(`SELECT p.* FROM posts p JOIN users u ON u.id=p.author_id LEFT JOIN profiles pr ON pr.user_id=u.id
        WHERE p.deleted_at IS NULL AND (p.text LIKE ? OR u.username LIKE ? OR IFNULL(pr.display_name,'') LIKE ? OR p.id=?)
        ORDER BY p.created_at DESC LIMIT ?`).all(like, '%' + user + '%', like, kw, limit);
    }
    return {posts: rows.map(row2)};
  }
  function setShown(id, body = {}) {
    const r = byId.get(id);
    if (!r) throw new ApiError(404, 'NOT_FOUND', '动态不存在');
    const re = real(id);
    const pick = (k, cur) => {
      if (body[k] == null || body[k] === '') return cur;
      const n = Math.round(Number(body[k]));
      if (!Number.isFinite(n) || n < 0 || n > 1e9) throw new ApiError(400, 'BAD_NUMBER', '请填写 0 到 10 亿之间的整数');
      return n - re[k];
    };
    const reset = body.reset === true;
    const adj = reset ? {views: 0, likes: 0, saves: 0} : {
      views: pick('views', r.adj_views || 0), likes: pick('likes', r.adj_likes || 0), saves: pick('saves', r.adj_saves || 0),
    };
    setAdj.run(adj.views, adj.likes, adj.saves, id);
    return {post: row2(byId.get(id))};
  }
  function view(user, id) {
    const r = byId.get(id);
    if (!r || (posts && !posts.canSee(r, user))) throw new ApiError(404, 'NOT_FOUND', '动态不存在');
    const ins = insView.run(id, user.id, now());
    const fresh = !!ins.changes;
    if (fresh) for (const fn of listeners) { try { fn(r, user); } catch { /* ignore */ } }
    return {postId: id, counted: fresh, viewCount: Math.max(0, viewCnt.get(id).n + (r.adj_views || 0))};
  }
  function onView(fn) { listeners.push(fn); }
  return {search, setShown, view, onView, real};
}
