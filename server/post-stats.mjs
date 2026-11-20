// r10 营销管理（2）：数据调整。
// 显示数 shown = real（真人）+ ai（内部账号）+ adj（管理员调整量）。
// 保存支持新格式 {adj:{views,likes,saves,reposts}}（直接调整量），并兼容旧格式（传显示值）。
import {ApiError} from './errors.mjs';
import {createInternalHints, isInternalAccount} from './internal-account.mjs';

export function createPostStats(db, {now = Date.now, posts, comments} = {}) {
  const byId = db.prepare('SELECT * FROM posts WHERE id=? AND deleted_at IS NULL');
  const insView = db.prepare('INSERT OR IGNORE INTO post_views(post_id,user_id,at) VALUES(?,?,?)');
  const viewCnt = db.prepare('SELECT COUNT(*) n FROM post_views WHERE post_id=?');
  const saveCnt = db.prepare("SELECT COUNT(*) n FROM saved_items WHERE kind='post' AND target=?");
  const likeCnt = db.prepare('SELECT COUNT(*) n FROM post_reactions WHERE post_id=?');
  const hints = createInternalHints(db);
  const viewReal = db.prepare('SELECT COUNT(*) n FROM post_views v WHERE v.post_id=? AND ' + hints.notSql('v.user_id'));
  const viewAi = db.prepare('SELECT COUNT(*) n FROM post_views v WHERE v.post_id=? AND ' + hints.isSql('v.user_id'));
  const likeReal = db.prepare('SELECT COUNT(*) n FROM post_reactions r WHERE r.post_id=? AND ' + hints.notSql('r.user_id'));
  const likeAi = db.prepare('SELECT COUNT(*) n FROM post_reactions r WHERE r.post_id=? AND ' + hints.isSql('r.user_id'));
  const saveReal = db.prepare("SELECT COUNT(*) n FROM saved_items s WHERE s.kind='post' AND s.target=? AND " + hints.notSql('s.user_id'));
  const saveAi = db.prepare("SELECT COUNT(*) n FROM saved_items s WHERE s.kind='post' AND s.target=? AND " + hints.isSql('s.user_id'));
  let repostReal, repostAi, hasAdjReposts = false, setAdj;
  try {
    db.prepare('SELECT adj_reposts FROM posts LIMIT 1').get();
    hasAdjReposts = true;
  } catch { hasAdjReposts = false; }
  try {
    repostReal = db.prepare('SELECT COUNT(*) n FROM posts p WHERE p.repost_of=? AND p.deleted_at IS NULL AND ' + hints.notSql('p.author_id'));
    repostAi = db.prepare('SELECT COUNT(*) n FROM posts p WHERE p.repost_of=? AND p.deleted_at IS NULL AND ' + hints.isSql('p.author_id'));
  } catch {
    repostReal = null; repostAi = null;
  }
  setAdj = hasAdjReposts
    ? db.prepare('UPDATE posts SET adj_views=?, adj_likes=?, adj_saves=?, adj_reposts=? WHERE id=?')
    : db.prepare('UPDATE posts SET adj_views=?, adj_likes=?, adj_saves=? WHERE id=?');
  const userBy = db.prepare('SELECT u.id,u.username,u.badge,p.display_name FROM users u LEFT JOIN profiles p ON p.user_id=u.id WHERE u.id=?');
  const listeners = [];
  const n = (q, id) => { try { return Number((q && q.get(id) || {}).n) || 0; } catch { return 0; } };

  function split(id) {
    const real = {views: n(viewReal, id), likes: n(likeReal, id), saves: n(saveReal, id), reposts: n(repostReal, id)};
    const ai = {views: n(viewAi, id), likes: n(likeAi, id), saves: n(saveAi, id), reposts: n(repostAi, id)};
    return {real, ai};
  }
  // 旧接口：所有账号合计（不含调整）
  function real(id) {
    let likes = 0;
    try { likes = likeCnt.get(id).n; } catch { likes = 0; }
    return {views: viewCnt.get(id).n, likes, saves: saveCnt.get(id).n};
  }
  function adjOf(r) {
    return {
      views: r.adj_views || 0, likes: r.adj_likes || 0, saves: r.adj_saves || 0,
      reposts: hasAdjReposts ? (r.adj_reposts || 0) : 0,
    };
  }
  function add(a, b, c) {
    const keys = ['views', 'likes', 'saves', 'reposts'];
    const out = {};
    for (const k of keys) out[k] = Math.max(0, (a[k] || 0) + (b[k] || 0) + (c[k] || 0));
    return out;
  }
  function row2(r) {
    const {real: re, ai} = split(r.id);
    const u = userBy.get(r.author_id);
    const adj = adjOf(r);
    const shown = add(re, ai, adj);
    return {
      id: r.id, text: String(r.text || '').slice(0, 200), createdAt: r.created_at, audience: r.audience || 'public',
      author: u ? {id: u.id, username: u.username, displayName: u.display_name || u.username, badge: u.badge || null, ai: isInternalAccount(u, db)} : null,
      real: re, ai, adj, shown,
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
  function pickAdj(raw, cur) {
    if (raw == null || raw === '') return cur;
    const n0 = Math.round(Number(raw));
    if (!Number.isFinite(n0) || Math.abs(n0) > 1e9) throw new ApiError(400, 'BAD_NUMBER', '请填写 -10 亿到 10 亿之间的整数');
    return n0;
  }
  function pickShown(raw, counted, cur) {
    if (raw == null || raw === '') return cur;
    const n0 = Math.round(Number(raw));
    if (!Number.isFinite(n0) || n0 < 0 || n0 > 1e9) throw new ApiError(400, 'BAD_NUMBER', '请填写 0 到 10 亿之间的整数');
    return n0 - counted;
  }
  function setShown(id, body = {}) {
    const r = byId.get(id);
    if (!r) throw new ApiError(404, 'NOT_FOUND', '动态不存在');
    const {real: re, ai} = split(id);
    const counted = {views: re.views + ai.views, likes: re.likes + ai.likes, saves: re.saves + ai.saves, reposts: re.reposts + ai.reposts};
    const cur = adjOf(r);
    const reset = body.reset === true;
    let adj;
    if (reset) adj = {views: 0, likes: 0, saves: 0, reposts: 0};
    else if (body.adj && typeof body.adj === 'object') {
      adj = {
        views: pickAdj(body.adj.views, cur.views),
        likes: pickAdj(body.adj.likes, cur.likes),
        saves: pickAdj(body.adj.saves, cur.saves),
        reposts: pickAdj(body.adj.reposts, cur.reposts),
      };
    } else {
      adj = {
        views: pickShown(body.views, counted.views, cur.views),
        likes: pickShown(body.likes, counted.likes, cur.likes),
        saves: pickShown(body.saves, counted.saves, cur.saves),
        reposts: pickShown(body.reposts, counted.reposts, cur.reposts),
      };
    }
    if (hasAdjReposts) setAdj.run(adj.views, adj.likes, adj.saves, adj.reposts, id);
    else setAdj.run(adj.views, adj.likes, adj.saves, id);
    return {post: row2(byId.get(id))};
  }
  function view(user, id, opts = {}) {
    const r = byId.get(id);
    if (!r || (posts && !posts.canSee(r, user))) throw new ApiError(404, 'NOT_FOUND', '动态不存在');
    const countForBoost = !opts || opts.countForBoost !== false;
    const ins = insView.run(id, user.id, now());
    const fresh = !!ins.changes;
    if (fresh && countForBoost) for (const fn of listeners) { try { fn(r, user); } catch { /* ignore */ } }
    return {postId: id, counted: fresh, viewCount: Math.max(0, viewCnt.get(id).n + (r.adj_views || 0))};
  }
  function onView(fn) { listeners.push(fn); }
  return {search, setShown, view, onView, real, split};
}
