// M4.1.4 单向关注。不是好友：好友是双向申请关系，见 M4.10。
import {ApiError} from './errors.mjs';

export function createFollows(db, {profile, vip, now}) {
  const userBy = db.prepare('SELECT * FROM users WHERE id=?');
  const ins = db.prepare('INSERT INTO follows(follower_id,followee_id,created_at) VALUES(?,?,?)');
  const del = db.prepare('DELETE FROM follows WHERE follower_id=? AND followee_id=?');
  const has = db.prepare('SELECT 1 FROM follows WHERE follower_id=? AND followee_id=?');
  const following = db.prepare('SELECT followee_id AS id, created_at FROM follows WHERE follower_id=? ORDER BY created_at DESC, followee_id DESC');
  const followers = db.prepare('SELECT follower_id AS id, created_at FROM follows WHERE followee_id=? ORDER BY created_at DESC, follower_id DESC');
  const nFollowing = db.prepare('SELECT COUNT(*) AS n FROM follows WHERE follower_id=?');
  const nFollowers = db.prepare('SELECT COUNT(*) AS n FROM follows WHERE followee_id=?');

  function authorOf(id) {
    const u = userBy.get(id);
    if (!u) return null;
    const p = profile.publicOf(u);
    return {id: u.id, username: u.username, displayName: p.displayName, avatar: p.avatar, vip: !!vip.status(u).active, badge: u.badge || null};
  }
  function uid(v) {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw new ApiError(400, 'BAD_USER', '用户不正确');
    if (!userBy.get(n)) throw new ApiError(404, 'NOT_FOUND', '用户不存在');
    return n;
  }
  function add(user, body) {
    const target = uid(body && (body.userId != null ? body.userId : body.id));
    if (target === Number(user.id)) throw new ApiError(400, 'BAD_USER', '不能关注自己');
    if (has.get(user.id, target)) return {following: true, already: true, user: authorOf(target)};
    ins.run(user.id, target, now());
    return {following: true, already: false, user: authorOf(target)};
  }
  function remove(user, body) {
    const target = uid(body && (body.userId != null ? body.userId : body.id));
    del.run(user.id, target);
    return {following: false, user: authorOf(target)};
  }
  function list(user, q = {}) {
    const target = q.user === 'me' || !q.user ? Number(user.id) : uid(q.user);
    const kind = q.kind === 'followers' ? 'followers' : 'following';
    const rows = kind === 'followers' ? followers.all(target) : following.all(target);
    const me = Number(user.id);
    const items = rows.map(r => {
      const a = authorOf(r.id);
      if (!a) return null;
      return {...a, createdAt: r.created_at, followedByMe: !!has.get(me, r.id)};
    }).filter(Boolean);
    return {
      kind, userId: target,
      followingCount: nFollowing.get(target).n,
      followerCount: nFollowers.get(target).n,
      users: items,
    };
  }
  function counts(userId) {
    return {followingCount: nFollowing.get(userId).n, followerCount: nFollowers.get(userId).n};
  }
  function isFollowing(a, b) { return !!has.get(a, b); }
  function followingIds(userId) { return following.all(userId).map(r => r.id); }
  return {add, remove, list, counts, isFollowing, followingIds};
}
