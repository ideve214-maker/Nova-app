// AI 官方内部账号 ↔ 现有服务端代码的唯一接口层（Cc）。
// ai-personas.mjs 只通过这里调用发帖、评论、表态、收藏、浏览、入组、频道发言、通知、审计和模型。
//
// 现状（2026-11-21，基于 2.1.1 e09e826）：Dift 正在把 index.mjs 里这些路由的函数体抽成公共函数（userActions），
// 并给 admin-ai 的 llm() 加 {model} 参数，都还没推。所以这里先用各模块现有函数 + 补上路由里做的那几步（屏蔽词、话题、通知、审计）。
// Dift 推上来以后：把 deps.userActions / deps.llm 传进来，并按他发的函数名改下面 DIFT 映射表即可，ai-personas.mjs 不用动。
// PENDING 列出所有还在等 Dift 的函数。
import {randomBytes} from 'node:crypto';
import {hashPassword} from './auth.mjs';

/** 帖子分类字段（Dift 2.1.2：迁移 066 的 posts.category，POST /api/posts 的 body.category）。 */
export const POST_CATEGORY_FIELD = 'category';

/** Dift 的公共函数名映射：左边是本文件用的名字，右边是 userActions 里的名字。他发了正式名字后只改右边。 */
export const DIFT = Object.freeze({
  createPost: 'createPost',       // (user, body, meta) → {post}
  repost: 'repost',               // (user, postId, meta) → {post}
  comment: 'addComment',          // (user, postId, {text, parentId}, meta) → {comment}
  react: 'react',                 // (user, postId, {index}, meta) → {...}
  favorite: 'savePost',           // (user, postId, {skipQuota}, meta) → {...}
  view: 'viewPost',               // (user, postId, {countForBoost}) → {counted}
  joinGroup: 'joinCommunity',     // (user, communityId, body, meta) → {community}
  channelMessage: 'postChannelMessage', // (user, channelId, {text}, meta) → {message}
});

/** 还在等 Dift 的函数（他推上来之前用的是临时实现）。 */
export const PENDING = Object.freeze([
  {fn: 'createPost', waitsFor: 'userActions.createPost（发帖路由抽出来：屏蔽词 → 建帖(含 category) → 话题 → 审计；AI 账号跳过 AI 审查）。分类已用 2.1.2 的 posts.create({category})'},
  {fn: 'repost', waitsFor: 'userActions.repost 或 createPost({repostOf})，含转帖通知'},
  {fn: 'comment', waitsFor: 'userActions.addComment（含评论 / 回复通知、审计）'},
  {fn: 'like', waitsFor: 'userActions.react（含表态通知）'},
  {fn: 'favorite', waitsFor: 'userActions.savePost + AI 账号免收藏额度（skipQuota）；临时实现直接写 saved_items'},
  {fn: 'view', waitsFor: 'userActions.viewPost({countForBoost})；临时实现：计入推流时调 postStats.view，不计入时直接写 post_views'},
  {fn: 'joinGroup', waitsFor: 'userActions.joinCommunity（含审计）'},
  {fn: 'channelMessage', waitsFor: 'userActions.postChannelMessage（含审计）'},
  {fn: 'llm', waitsFor: 'admin-ai 的 llm(messages, {model})：临时实现忽略 model，用当前服务商的模型'},
  {fn: 'audit', waitsFor: 'index.mjs 的 audit() 传进来；临时实现直接写 audit_log'},
]);

export function createPersonaAdapter(deps = {}) {
  const {db, now = Date.now, posts, comments, saved, postStats, communities, notifications, profile, media, blockwords, hashtags, adminAi} = deps;
  const ua = deps.userActions || null;
  const has = k => !!(ua && typeof ua[DIFT[k]] === 'function');
  const meta = {via: 'ai-persona'};

  const userBy = db.prepare('SELECT * FROM users WHERE id=?');
  const isAiQ = (() => { try { return db.prepare("SELECT 1 FROM ai_personas WHERE user_id=?"); } catch { return null; } })();
  const isAi = id => !!(isAiQ && isAiQ.get(Number(id)));
  const postAuthor = db.prepare('SELECT author_id FROM posts WHERE id=? AND deleted_at IS NULL');
  const commentRow = db.prepare('SELECT author_id, post_id FROM post_comments WHERE id=?');
  const auditIns = db.prepare('INSERT INTO audit_log(at,actor_id,action,target,ip,detail) VALUES(?,?,?,?,?,?)');

  function audit(actorId, action, target, detail) {
    if (typeof deps.audit === 'function') return deps.audit(actorId, action, target, null, detail);
    auditIns.run(now(), actorId, action, target, null, detail ? JSON.stringify(detail) : null);
  }
  /** 通知：只发给真人（AI 账号之间不发）。dedupeKey 和现有路由一致，同一动作不重复推。 */
  function notify(toUserId, payload) {
    if (!notifications || toUserId == null || isAi(toUserId)) return null;
    try { return notifications.push(toUserId, payload); } catch { return null; }
  }

  // ---------- 账号 ----------
  function createUser({username, email}) {
    const pw = hashPassword('x' + randomBytes(32).toString('base64url'));   // 随机密码，登录由 Dift 在登录接口里拒绝
    const r = db.prepare('INSERT INTO users(username,email,password_hash,role,status,created_at) VALUES(?,?,?,?,?,?)').run(username, email, pw, 'user', 'active', now());
    return userBy.get(Number(r.lastInsertRowid));
  }
  function setBadge(userId, badge) { db.prepare('UPDATE users SET badge=?, badge_at=? WHERE id=?').run(badge, now(), userId); }
  function getUser(id) { return userBy.get(Number(id)); }
  function saveProfile(user, {displayName, bio}) { return profile.save(user, {displayName, bio}); }
  function closeRequests(user) { return profile.savePrivacy(user, {friendRequests: 'nobody'}); }
  async function setAvatar(user, buffer) {
    const r = await media.upload(user, {buffer, mime: 'image/jpeg', name: 'avatar.jpg'});
    profile.saveLook(user, {avatarImage: r.media.id});
    return r.media.id;
  }

  // ---------- 内容 ----------
  function assertText(text) { if (text && blockwords) blockwords.assertPlatform(String(text)); }

  function createPost(user, {text, category}) {
    let r;
    // 2.1.2 起 posts.create / POST /api/posts 直接接受 category（迁移 066），非法值抛 400 BAD_CATEGORY。
    if (has('createPost')) r = ua[DIFT.createPost](user, {text, category, skipAiReview: true}, meta);
    else {
      assertText(text);                       // ideve：AI 内容只过屏蔽词，不走 AI 审查
      r = posts.create(user, {text, category});
      try { if (hashtags) r.post.hashtags = hashtags.syncPost(user, r.post); } catch { /* 话题表在旧库可能没有 */ }
      audit(user.id, 'post.create', 'post:' + r.post.id, {via: 'ai-persona', category: category || null});
    }
    return r.post;
  }
  function repost(user, postId) {
    let r;
    if (has('repost')) r = ua[DIFT.repost](user, postId, meta);
    else {
      r = posts.create(user, {repostOf: postId});
      audit(user.id, 'post.create', 'post:' + r.post.id, {via: 'ai-persona', repostOf: postId});
      const a = postAuthor.get(postId);
      if (a && !r.idempotent) notify(a.author_id, {kind: 'repost', title: '有人转发了你的动态', body: '', refType: 'post', refId: postId, actorId: user.id, dedupeKey: 'repost:' + postId + ':' + user.id});
    }
    return r.post;
  }
  function comment(user, postId, {text, parentId = null}) {
    if (has('comment')) return ua[DIFT.comment](user, postId, {text, parentId}, meta).comment;
    assertText(text);
    const r = comments.add(user, postId, {text, parentId});
    audit(user.id, 'post.comment', 'comment:' + r.comment.id, {via: 'ai-persona'});
    const a = postAuthor.get(postId);
    if (a) notify(a.author_id, {kind: 'comment', title: '有人评论了你的动态', body: String(text).slice(0, 120), refType: 'post', refId: postId, actorId: user.id, dedupeKey: 'comment:' + r.comment.id});
    if (parentId) {
      const p = commentRow.get(parentId);
      if (p && (!a || Number(p.author_id) !== Number(a.author_id))) notify(p.author_id, {kind: 'reply', title: '有人回复了你的评论', body: String(text).slice(0, 120), refType: 'post', refId: postId, actorId: user.id, dedupeKey: 'reply:' + r.comment.id});
    }
    return r.comment;
  }
  const myRx = db.prepare('SELECT emoji_idx FROM post_reactions WHERE post_id=? AND user_id=?');
  function like(user, postId, index = 0) {
    if (myRx.get(postId, user.id)) return {already: true};   // comments.react 对同一表态是「取消」，所以先查
    if (has('react')) return ua[DIFT.react](user, postId, {index}, meta);
    const r = comments.react(user, postId, {index});
    const a = postAuthor.get(postId);
    if (a) notify(a.author_id, {kind: 'react', title: '有人对你的动态表态', body: '', refType: 'post', refId: postId, actorId: user.id, dedupeKey: 'react:' + postId + ':' + user.id});
    return r;
  }
  const savedIns = db.prepare("INSERT OR IGNORE INTO saved_items(user_id,kind,target,title,excerpt,created_at) VALUES(?,'post',?,?,?,?)");
  function favorite(user, postId, {title = '', excerpt = ''} = {}) {
    if (has('favorite')) {
      const r = ua[DIFT.favorite](user, postId, {skipQuota: true, title, excerpt}, meta);
      return r && r.existed ? {...r, already: true} : r;   // userActions.savePost 用 existed 表示「早就收藏过」
    }
    // 临时：AI 账号不受普通账号 20 条收藏上限限制（saved.add 会按 VIP 额度拒绝），直接写表。
    const r = savedIns.run(user.id, postId, String(title).slice(0, 80) || '动态', String(excerpt).slice(0, 200), now());
    if (!r.changes) return {already: true};
    audit(user.id, 'saved.add', 'post:' + postId, {via: 'ai-persona'});
    const a = postAuthor.get(postId);
    if (a) notify(a.author_id, {kind: 'save', title: '有人收藏了你的动态', body: '', refType: 'post', refId: postId, actorId: user.id, dedupeKey: 'save:' + postId + ':' + user.id});
    return {saved: true};
  }
  const viewIns = db.prepare('INSERT OR IGNORE INTO post_views(post_id,user_id,at) VALUES(?,?,?)');
  function view(user, postId, {countForBoost = true} = {}) {
    if (has('view')) return ua[DIFT.view](user, postId, {countForBoost});
    if (countForBoost) return postStats.view(user, postId);          // 会触发 boost.onView，消耗推流曝光
    return {postId, counted: !!viewIns.run(postId, user.id, now()).changes};   // 不触发监听器，不算推流
  }
  function joinGroup(user, communityId) {
    if (has('joinGroup')) return ua[DIFT.joinGroup](user, communityId, {}, meta).community;
    const r = communities.join(user, communityId, {});
    audit(user.id, 'community.join', 'community:' + communityId, {via: 'ai-persona'});
    return r.community;
  }
  function channelMessage(user, channelId, text) {
    if (has('channelMessage')) return ua[DIFT.channelMessage](user, channelId, {text}, meta).message;
    const r = communities.postMessage(user, channelId, {text});        // 内部已经检查屏蔽词、禁言、成员身份
    audit(user.id, 'community.message', 'channel:' + channelId, {via: 'ai-persona'});
    return r.message;
  }
  function removePost(user, postId) { return posts.remove(user, postId); }

  // ---------- 模型 ----------
  /** 返回 {content, model, tokens}。model 由 ai-personas 传入（默认 glm-4.7-flash）。 */
  async function llm(messages, {model, json = true, maxTokens = 300, temperature = 0.8} = {}) {
    const fn = typeof deps.llm === 'function' ? deps.llm : (adminAi && adminAi.llm);
    if (!fn) { const e = new Error('AI 没有配置'); e.code = 'AI_NOT_CONFIGURED'; throw e; }
    const msg = await fn(messages, {model, json, maxTokens, temperature});
    return {content: typeof msg.content === 'string' ? msg.content : '', model: model || null, tokens: null};
  }

  return {audit, notify, isAi, createUser, setBadge, getUser, saveProfile, closeRequests, setAvatar,
    createPost, repost, comment, like, favorite, view, joinGroup, channelMessage, removePost, llm,
    get usingDift() { return !!ua; }};
}
