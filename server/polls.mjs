// M5.3.1 社区/动态投票：权限、截止时间、防重复投票。
import {randomBytes} from 'node:crypto';
import {ApiError} from './errors.mjs';

const nid = (p = 'pl_') => p + randomBytes(12).toString('base64url');
const len = s => [...String(s)].length;
const PERMS = new Set(['anyone', 'followers', 'community']);

export function createPolls(db, {now, posts, follows, communities}) {
  const insP = db.prepare('INSERT INTO polls(id,post_id,community_id,author_id,question,allow_multiple,vote_perm,closes_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)');
  const byId = db.prepare('SELECT * FROM polls WHERE id=?');
  const byPost = db.prepare('SELECT * FROM polls WHERE post_id=? ORDER BY created_at');
  const byCm = db.prepare('SELECT * FROM polls WHERE community_id=? ORDER BY created_at DESC');
  const insO = db.prepare('INSERT INTO poll_options(id,poll_id,text,position) VALUES(?,?,?,?)');
  const opts = db.prepare('SELECT * FROM poll_options WHERE poll_id=? ORDER BY position, id');
  const optBy = db.prepare('SELECT * FROM poll_options WHERE id=?');
  const insV = db.prepare('INSERT INTO poll_votes(poll_id,option_id,user_id,created_at) VALUES(?,?,?,?)');
  const votesOf = db.prepare('SELECT option_id, COUNT(*) AS n FROM poll_votes WHERE poll_id=? GROUP BY option_id');
  const mineV = db.prepare('SELECT option_id FROM poll_votes WHERE poll_id=? AND user_id=?');
  const anyV = db.prepare('SELECT 1 FROM poll_votes WHERE poll_id=? AND user_id=? LIMIT 1');
  const postBy = db.prepare('SELECT * FROM posts WHERE id=?');
  const userBy = db.prepare('SELECT * FROM users WHERE id=?');
  const cmMem = db.prepare("SELECT m.* FROM community_members m JOIN communities c ON c.id=m.community_id AND c.deleted_at IS NULL AND c.taken_down_at IS NULL WHERE m.community_id=? AND m.user_id=? AND m.status='active'");

  function validateSpec(spec = {}) {
    const question = String(spec.question || '').trim();
    if (!len(question) || len(question) > 200) throw new ApiError(400, 'BAD_QUESTION', '请填写 1–200 字的投票问题');
    const raw = Array.isArray(spec.options) ? spec.options : [];
    const options = raw.map(x => String(typeof x === 'string' ? x : (x && x.text) || '').trim()).filter(Boolean);
    if (options.length < 2 || options.length > 10) throw new ApiError(400, 'BAD_OPTIONS', '投票需要 2–10 个选项');
    for (const o of options) if (len(o) > 80) throw new ApiError(400, 'BAD_OPTIONS', '选项最多 80 字');
    const allowMultiple = !!spec.allowMultiple;
    const votePerm = String(spec.votePerm || 'anyone');
    if (!PERMS.has(votePerm)) throw new ApiError(400, 'BAD_PERM', '投票权限不正确（anyone / followers / community）');
    let closesAt = spec.closesAt == null || spec.closesAt === '' ? null : Number(spec.closesAt);
    if (closesAt != null && (!Number.isFinite(closesAt) || closesAt <= now())) {
      throw new ApiError(400, 'BAD_DEADLINE', '截止时间必须是未来的时间');
    }
    return {question, options, allowMultiple, votePerm, closesAt};
  }

  function isClosed(row) {
    return !!(row.closes_at && now() >= row.closes_at);
  }
  function isMember(cmId, userId) {
    return !!(cmId && userId && cmMem.get(cmId, userId));
  }
  function canCreateCommunity(user, communityId) {
    if (!isMember(communityId, user.id)) throw new ApiError(403, 'FORBIDDEN', '只有社区成员才能发起投票');
  }
  function canSee(row, user) {
    if (!user) return false;
    if (row.community_id) return isMember(row.community_id, user.id) || Number(row.author_id) === Number(user.id);
    return true;
  }
  function canVote(row, user) {
    if (!user) throw new ApiError(401, 'UNAUTHORIZED', '请先登录');
    if (isClosed(row)) throw new ApiError(403, 'POLL_CLOSED', '投票已截止');
    if (!canSee(row, user)) throw new ApiError(403, 'FORBIDDEN', '无权参与此投票');
    const perm = row.vote_perm || 'anyone';
    if (perm === 'community') {
      if (!row.community_id || !isMember(row.community_id, user.id)) {
        throw new ApiError(403, 'FORBIDDEN', '只有社区成员才能投票');
      }
    } else if (perm === 'followers') {
      const author = row.author_id;
      if (Number(author) !== Number(user.id) && !(follows && follows.isFollowing(user.id, author))) {
        throw new ApiError(403, 'FORBIDDEN', '只有作者的关注者才能投票');
      }
    }
    return true;
  }

  function pub(row, me) {
    if (!row) return null;
    const options = opts.all(row.id);
    const counts = Object.fromEntries(votesOf.all(row.id).map(r => [r.option_id, r.n]));
    const mine = me ? mineV.all(row.id, Number(me.id)).map(r => r.option_id) : [];
    const closed = isClosed(row);
    const showCounts = closed || mine.length > 0 || (me && Number(me.id) === Number(row.author_id));
    return {
      id: row.id,
      postId: row.post_id || null,
      communityId: row.community_id || null,
      authorId: row.author_id,
      question: row.question,
      allowMultiple: !!row.allow_multiple,
      votePerm: row.vote_perm,
      closesAt: row.closes_at || null,
      closed,
      createdAt: row.created_at,
      options: options.map(o => ({
        id: o.id,
        text: o.text,
        position: o.position,
        votes: showCounts ? (counts[o.id] || 0) : null,
        voted: mine.includes(o.id),
      })),
      myOptionIds: mine,
      voted: mine.length > 0,
      totalVotes: showCounts ? Object.values(counts).reduce((a, b) => a + b, 0) : null,
    };
  }

  function insert(user, {postId, communityId, spec}) {
    const v = validateSpec(spec);
    if (v.votePerm === 'community' && !communityId) {
      throw new ApiError(400, 'BAD_PERM', '社区投票需要指定社区');
    }
    const id = nid(), t = now();
    insP.run(id, postId || null, communityId || null, user.id, v.question, v.allowMultiple ? 1 : 0, v.votePerm, v.closesAt, t);
    v.options.forEach((text, i) => insO.run(nid('po_'), id, text, i));
    return pub(byId.get(id), user);
  }

  function createForPost(user, postId, spec) {
    const post = postBy.get(postId);
    if (!post || post.deleted_at) throw new ApiError(404, 'NOT_FOUND', '动态不存在');
    if (Number(post.author_id) !== Number(user.id)) throw new ApiError(403, 'FORBIDDEN', '只能给自己的动态添加投票');
    if (byPost.get(postId)) throw new ApiError(409, 'EXISTS', '这条动态已经有投票了');
    return {poll: insert(user, {postId, communityId: spec && spec.communityId, spec})};
  }
  function createForCommunity(user, communityId, spec) {
    canCreateCommunity(user, communityId);
    const s = {...(spec || {}), votePerm: (spec && spec.votePerm) || 'community'};
    return {poll: insert(user, {communityId, spec: s})};
  }
  function ofPost(postId, me) {
    const row = byPost.get(postId);
    return row ? pub(row, me) : null;
  }
  function get(user, id) {
    const row = byId.get(id);
    if (!row) throw new ApiError(404, 'NOT_FOUND', '投票不存在');
    if (!canSee(row, user)) throw new ApiError(403, 'FORBIDDEN', '无权查看此投票');
    return {poll: pub(row, user)};
  }
  function listCommunity(user, communityId) {
    if (!isMember(communityId, user.id)) throw new ApiError(403, 'FORBIDDEN', '只有社区成员才能查看投票');
    return {polls: byCm.all(communityId).map(r => pub(r, user))};
  }

  function vote(user, id, body = {}) {
    const row = byId.get(id);
    if (!row) throw new ApiError(404, 'NOT_FOUND', '投票不存在');
    canVote(row, user);
    const raw = body.optionIds != null ? body.optionIds : (body.optionId != null ? [body.optionId] : []);
    const ids = [...new Set((Array.isArray(raw) ? raw : [raw]).map(String))];
    if (!ids.length) throw new ApiError(400, 'BAD_OPTIONS', '请选择选项');
    if (!row.allow_multiple && ids.length > 1) throw new ApiError(400, 'BAD_OPTIONS', '此投票只能选一项');
    const valid = new Set(opts.all(row.id).map(o => o.id));
    for (const oid of ids) if (!valid.has(oid)) throw new ApiError(400, 'BAD_OPTIONS', '选项不存在');
    const existing = mineV.all(row.id, Number(user.id)).map(r => r.option_id).sort();
    const next = [...ids].sort();
    if (existing.length) {
      const same = existing.length === next.length && existing.every((x, i) => x === next[i]);
      if (same) return {poll: pub(row, user), already: true};
      throw new ApiError(409, 'ALREADY_VOTED', '你已经投过票，不能重复投票');
    }
    const t = now();
    for (const oid of ids) insV.run(row.id, oid, Number(user.id), t);
    return {poll: pub(byId.get(row.id), user), already: false};
  }

  return {validateSpec, createForPost, createForCommunity, ofPost, get, listCommunity, vote, pub};
}
