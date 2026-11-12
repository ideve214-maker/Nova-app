// M4.7 搜索：用户/帖子/社区/消息。范围受权限约束。E2EE 私聊明文不建服务端索引（目前私聊尚未加密，只搜用户可见的已有明文；M4.11 接入后密文不得进入此索引）。
import {ApiError} from './errors.mjs';

const lim = (q, d = 20) => Math.min(Math.max(Number(q) || d, 1), 50);

export function createSearch(db, {profile, vip, now} = {}) {
  const userBy = db.prepare('SELECT * FROM users WHERE id=?');
  const usersQ = db.prepare(`
    SELECT u.id FROM users u
    LEFT JOIN profiles p ON p.user_id=u.id
    LEFT JOIN privacy r ON r.user_id=u.id
    WHERE u.status='active'
      AND (r.searchable IS NULL OR r.searchable=1)
      AND (u.username LIKE ? COLLATE NOCASE OR IFNULL(p.display_name,'') LIKE ? COLLATE NOCASE)
    LIMIT ?`);
  const postsQ = db.prepare(`
    SELECT * FROM posts WHERE deleted_at IS NULL AND text LIKE ? ESCAPE '\\'
    ORDER BY created_at DESC, id DESC LIMIT ?`);
  const cmQ = db.prepare(`
    SELECT c.* FROM communities c
    LEFT JOIN community_members m ON m.community_id=c.id AND m.user_id=? AND m.status='active'
    WHERE c.deleted_at IS NULL
      AND (c.visibility='public' OR m.user_id IS NOT NULL)
      AND (c.name LIKE ? ESCAPE '\\' OR c.description LIKE ? ESCAPE '\\')
    ORDER BY c.created_at DESC LIMIT ?`);
  const msgQ = db.prepare(`
    SELECT msg.* FROM messages msg
    JOIN conversation_members cm ON cm.conversation_id=msg.conversation_id AND cm.user_id=? AND cm.left_at IS NULL
    JOIN conversations cv ON cv.id=msg.conversation_id AND cv.deleted_at IS NULL
    WHERE msg.deleted_at IS NULL AND msg.text LIKE ? ESCAPE '\\' AND IFNULL(msg.text,'')<>'' AND IFNULL(msg.encrypted,0)=0
    ORDER BY msg.created_at DESC, msg.id DESC LIMIT ?`);

  function authorOf(id) {
    const u = userBy.get(Number(id));
    if (!u) return {id: Number(id), username: 'unknown', displayName: 'unknown'};
    const p = profile.publicOf(u);
    return {id: u.id, username: u.username, displayName: p.displayName, avatar: p.avatar, vip: !!(vip && vip.status(u).active)};
  }
  function like(q) {
    const s = String(q).replace(/([\\%_])/g, '\\$1');
    return '%' + s + '%';
  }

  function search(user, q = {}) {
    const raw = String(q.q || q.query || '').trim();
    if ([...raw].length < 1) return {q: raw, users: [], posts: [], communities: [], messages: []};
    if ([...raw].length > 40) throw new ApiError(400, 'QUERY_TOO_LONG', '搜索词过长');
    const pat = like(raw);
    const type = String(q.type || q.scope || 'all');
    const n = lim(q.limit);
    const out = {q: raw, users: [], posts: [], communities: [], messages: []};
    if (type === 'all' || type === 'user' || type === 'users') {
      out.users = usersQ.all(pat, pat, n).map(r => authorOf(r.id));
    }
    if (type === 'all' || type === 'post' || type === 'posts') {
      out.posts = postsQ.all(pat, n).map(r => ({
        id: r.id, text: r.text, createdAt: r.created_at, author: authorOf(r.author_id),
      }));
    }
    if (type === 'all' || type === 'community' || type === 'communities') {
      out.communities = cmQ.all(Number(user.id), pat, pat, n).map(r => ({
        id: r.id, name: r.name, description: r.description, visibility: r.visibility, createdAt: r.created_at,
      }));
    }
    if (type === 'all' || type === 'message' || type === 'messages') {
      // 只搜当前用户所在会话中、未撤回的明文。不为 E2EE 密文建索引。
      out.messages = msgQ.all(Number(user.id), pat, n).map(r => ({
        id: r.id, conversationId: r.conversation_id, text: r.text, createdAt: r.created_at, author: authorOf(r.author_id),
      }));
    }
    return out;
  }
  return {search};
}
