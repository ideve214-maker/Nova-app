// 发帖 / 评论 / 表态 / 收藏 / 浏览 / 入组 / 频道发言的公共函数。
// HTTP 路由和 AI 内部账号（ai-personas-adapter 的 DIFT 表）都走这里，避免两套逻辑。
import {isInternalAccount} from './internal-account.mjs';

export function createUserActions(deps = {}) {
  const {
    db, posts, comments, saved, postStats, communities, blockwords, hashtags,
    notifications, audit, polls, activities, aiMod,
    assertPollText, assertV2Text, postAuthor,
    now = Date.now,
  } = deps;

  const commentRow = db && db.prepare('SELECT author_id, post_id FROM post_comments WHERE id=?');
  const viewIns = db && db.prepare('INSERT OR IGNORE INTO post_views(post_id,user_id,at) VALUES(?,?,?)');
  const userById = db && db.prepare('SELECT * FROM users WHERE id=?');

  function ipOf(meta) { return meta && meta.ip != null ? meta.ip : null; }
  function detailOf(meta, extra) {
    const d = {...(extra || {})};
    if (meta && meta.via) d.via = meta.via;
    return Object.keys(d).length ? d : undefined;
  }
  function notify(toUserId, payload) {
    if (!notifications || toUserId == null || typeof notifications.push !== 'function') return;
    // 收件人是 AI 内部账号时不发：没人看，只会堆数据。
    try {
      const to = userById && userById.get(Number(toUserId));
      if (to && isInternalAccount(to, db)) return;
    } catch { /* ignore */ }
    try { notifications.push(toUserId, payload); } catch { /* ignore */ }
  }

  // (user, body, meta) → {post}
  // body.skipAiReview / meta.skipAiReview：跳过 AI 审查（AI 账号发帖只用屏蔽词）。这时同步返回，方便 adapter 直接调用。
  function createPost(user, body = {}, meta = {}) {
    const skipAi = !!(body.skipAiReview || (meta && meta.skipAiReview));
    const work = (ai) => {
      if (body.poll && polls) {
        polls.assertCanCreate(user);
        polls.validateSpec(body.poll);
        if (!body.activity && !String(body.text || '').trim()) body.text = String(body.poll.question || '').trim();
      }
      if (body.activity && activities) {
        activities.assertCanCreate(user);
        activities.validateSpec(body.activity, user);
        if (assertV2Text) assertV2Text(activities.textOf(body.activity));
        if (!String(body.text || '').trim()) body.text = String(body.activity.title || '').trim();
      }
      if (body.text && blockwords) blockwords.assertPlatform(body.text);
      if (body.poll && assertPollText) assertPollText(body.poll);
      const r = posts.create(user, body);
      if (ai && aiMod && typeof aiMod.linkPost === 'function') aiMod.linkPost(ai, r.post.id);
      if (body.poll && polls && !r.idempotent) {
        const pr = polls.createForPost(user, r.post.id, body.poll);
        r.post.poll = pr.poll;
      }
      if (body.activity && activities && !r.idempotent) {
        r.post.activity = activities.createForPost(user, r.post.id, body.activity).activity;
      }
      if (hashtags) {
        try { r.post.hashtags = hashtags.syncPost(user, r.post); } catch { /* 旧库可能没有话题表 */ }
      }
      if (audit) audit(user.id, 'post.create', 'post:' + r.post.id, ipOf(meta), detailOf(meta, body.repostOf ? {repostOf: body.repostOf} : (body.category ? {category: body.category} : undefined)));
      return r;
    };
    if (skipAi || !aiMod || typeof aiMod.enforce !== 'function') return work(null);
    const aiText = [body.text, body.poll && body.poll.question, ...((body.poll && body.poll.options) || []).map(o => (o && o.text) || o), body.activity && activities && activities.textOf(body.activity)].filter(x => typeof x === 'string' && x.trim()).join('\n');
    return Promise.resolve(aiMod.enforce(aiText, {user, kind: 'post'})).then(ai => work(ai));
  }

  // (user, postId, meta) → {post}
  function repost(user, postId, meta = {}) {
    const r = createPost(user, {repostOf: postId, skipAiReview: true}, meta);
    if (r && !r.idempotent && postAuthor) {
      const authorId = postAuthor(postId);
      if (authorId != null) notify(authorId, {
        kind: 'repost', title: '有人转发了你的动态', body: '',
        refType: 'post', refId: postId, actorId: user.id, dedupeKey: 'repost:' + postId + ':' + user.id,
      });
    }
    return r;
  }

  // (user, postId, {text, parentId}, meta) → {comment}
  function addComment(user, postId, body = {}, meta = {}) {
    if (body && body.text && blockwords) blockwords.assertPlatform(body.text);
    const r = comments.add(user, postId, body);
    if (audit) audit(user.id, 'post.comment', 'comment:' + r.comment.id, ipOf(meta), detailOf(meta));
    const text = String((r.comment && r.comment.text) || body.text || '');
    if (postAuthor) {
      const authorId = postAuthor(postId);
      if (authorId != null) notify(authorId, {
        kind: 'comment', title: '有人评论了你的动态', body: text.slice(0, 120),
        refType: 'post', refId: postId, actorId: user.id, dedupeKey: 'comment:' + r.comment.id,
      });
    }
    if (body.parentId && commentRow && meta && meta.via === 'ai-persona') {
      const p = commentRow.get(body.parentId);
      const postAuth = postAuthor ? postAuthor(postId) : null;
      if (p && (postAuth == null || Number(p.author_id) !== Number(postAuth))) notify(p.author_id, {
        kind: 'reply', title: '有人回复了你的评论', body: text.slice(0, 120),
        refType: 'post', refId: postId, actorId: user.id, dedupeKey: 'reply:' + r.comment.id,
      });
    }
    return r;
  }

  // (user, postId, {index}, meta) → {...}
  function react(user, postId, body = {}, meta = {}) {
    const r = comments.react(user, postId, body);
    if (r && (r.myReaction != null && r.myReaction >= 0 || r.reacted) && postAuthor) {
      const authorId = postAuthor(postId);
      if (authorId != null) notify(authorId, {
        kind: 'react', title: '有人对你的动态表态', body: '',
        refType: 'post', refId: postId, actorId: user.id, dedupeKey: 'react:' + postId + ':' + user.id,
      });
    }
    return r;
  }

  // (user, postId, {skipQuota, title, excerpt}, meta) → {...}
  function savePost(user, postId, opts = {}, meta = {}) {
    const r = saved.add(user, {kind: 'post', target: postId, title: opts.title, excerpt: opts.excerpt, skipQuota: opts.skipQuota});
    if (audit) audit(user.id, 'saved.add', 'saved:' + (r.item && r.item.id), ipOf(meta), detailOf(meta));
    if (meta && meta.via === 'ai-persona' && r && !r.existed && !r.already && postAuthor) {
      const authorId = postAuthor(postId);
      if (authorId != null) notify(authorId, {
        kind: 'save', title: '有人收藏了你的动态', body: '',
        refType: 'post', refId: postId, actorId: user.id, dedupeKey: 'save:' + postId + ':' + user.id,
      });
    }
    return r;
  }

  // (user, postId, {countForBoost}) → {counted}
  // countForBoost 默认 true：计入推流加热。false 时只记浏览，不触发 boost.onView。
  function viewPost(user, postId, opts = {}) {
    const countForBoost = opts.countForBoost !== false;
    return postStats.view(user, postId, {countForBoost});
  }

  // (user, communityId, body, meta) → {community}
  function joinCommunity(user, communityId, body = {}, meta = {}) {
    const r = communities.join(user, communityId, body);
    if (audit) audit(user.id, 'community.join', 'community:' + communityId, ipOf(meta), detailOf(meta));
    return r;
  }

  // (user, channelId, {text}, meta) → {message}
  function postChannelMessage(user, channelId, body = {}, meta = {}) {
    const r = communities.postMessage(user, channelId, body);
    if (audit) audit(user.id, 'community.message', 'channel:' + channelId, ipOf(meta), detailOf(meta));
    return r;
  }

  return {createPost, repost, addComment, react, savePost, viewPost, joinCommunity, postChannelMessage};
}
