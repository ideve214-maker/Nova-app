// 服务端 2.1.0：外部导入帖（V2EX / HN）的 AI 审查。
// - 入库前审查：import-feed 拉到的新帖子和评论先过 AI（智谱，复用 ai-moderation 的密钥 / 模型 / 限速），
//   不合格的不入库，并记下外部 ID，之后不再拉取、不再审；评论单独审，不合格的单条丢弃。
// - AI 不可用（没配密钥、限速、超时、返回不对）时：不入库，下次导入再审（安全默认，不放未审内容进库）。
// - 已发布外部帖补审：backfill() 审还没审过的外部帖和评论，不合格的按管理端「隐藏」同样的方式下架（deleted_at + admin_hidden），
//   管理端原有的「恢复」可撤销；每条结果都写进 import_review_log 留痕。
// - 管理端（server/admin*.mjs，Agen 负责）调用这里导出的函数，本文件不注册路由。
const FLAG_KEY = 'ai.import_review';
const DEFAULTS = {enabled: true, autoBackfill: true, backfillBatch: 20};
const KEEP_LOG_DAYS = 30;

export function createAiReview(db, {aiMod, now = Date.now, log: logErr = (...a) => console.error(...a)} = {}) {
  const getFlag = db.prepare('SELECT value FROM app_flags WHERE key=?');
  const setFlag = db.prepare(`INSERT INTO app_flags(key,value,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`);
  const insLog = db.prepare(`INSERT INTO import_review_log(phase,target,source,source_id,ref_id,post_ref_id,verdict,action,category,reason,ai_source,excerpt,actor_id,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insReject = db.prepare(`INSERT OR IGNORE INTO import_review_rejects(source,source_id,target,category,reason,created_at) VALUES(?,?,?,?,?,?)`);
  const selReject = db.prepare('SELECT 1 FROM import_review_rejects WHERE source=? AND source_id=?');
  const prune = db.prepare('DELETE FROM import_review_log WHERE created_at<?');
  const markPost = db.prepare('UPDATE posts SET ai_review=?, ai_reviewed_at=? WHERE id=?');
  const markCmt = db.prepare('UPDATE post_comments SET ai_review=?, ai_reviewed_at=? WHERE id=?');
  const hidePost = db.prepare('UPDATE posts SET deleted_at=COALESCE(deleted_at,?), admin_hidden=1, admin_reason=?, ai_review=\'block\', ai_reviewed_at=? WHERE id=?');
  const hideCmt = db.prepare('UPDATE post_comments SET deleted_at=COALESCE(deleted_at,?), admin_hidden=1, admin_reason=?, ai_review=\'block\', ai_reviewed_at=? WHERE id=?');
  const pendingPosts = db.prepare(`SELECT * FROM posts WHERE source IS NOT NULL AND deleted_at IS NULL AND admin_hidden=0
    AND (ai_review IS NULL OR id IN (SELECT post_id FROM post_comments WHERE source IS NOT NULL AND deleted_at IS NULL AND admin_hidden=0 AND ai_review IS NULL))
    ORDER BY created_at DESC LIMIT ?`);
  const pendingCmts = db.prepare(`SELECT * FROM post_comments WHERE post_id=? AND source IS NOT NULL AND deleted_at IS NULL AND admin_hidden=0 AND ai_review IS NULL
    ORDER BY created_at ASC LIMIT 200`);
  const cnt = sql => db.prepare(sql);
  const qUnreviewedPosts = cnt('SELECT COUNT(*) n FROM posts WHERE source IS NOT NULL AND deleted_at IS NULL AND admin_hidden=0 AND ai_review IS NULL');
  const qUnreviewedCmts = cnt('SELECT COUNT(*) n FROM post_comments WHERE source IS NOT NULL AND deleted_at IS NULL AND admin_hidden=0 AND ai_review IS NULL');
  const qGroup = cnt(`SELECT phase, target, verdict, action, COUNT(*) n FROM import_review_log WHERE created_at>=? GROUP BY phase, target, verdict, action`);
  const qLogs = cnt(`SELECT * FROM import_review_log WHERE (?='' OR phase=?) AND (?='' OR verdict=?) AND (?='' OR target=?) AND (? IS NULL OR id<?)
    ORDER BY id DESC LIMIT ?`);
  const qRejects = cnt('SELECT COUNT(*) n FROM import_review_rejects');
  let lastBackfill = null, backfilling = false;

  function settings() {
    let v = {};
    try { const r = getFlag.get(FLAG_KEY); if (r) v = JSON.parse(r.value) || {}; } catch { v = {}; }
    const n = Math.round(Number(v.backfillBatch));
    return {
      enabled: v.enabled == null ? DEFAULTS.enabled : !!v.enabled,
      autoBackfill: v.autoBackfill == null ? DEFAULTS.autoBackfill : !!v.autoBackfill,
      backfillBatch: Number.isFinite(n) && n >= 1 ? Math.min(100, n) : DEFAULTS.backfillBatch,
    };
  }
  const truthy = x => !!x && x !== 'false' && x !== '0';
  function saveSettings(b = {}) {
    const cur = settings();
    const next = {
      enabled: b.enabled == null ? cur.enabled : truthy(b.enabled),
      autoBackfill: b.autoBackfill == null ? cur.autoBackfill : truthy(b.autoBackfill),
      backfillBatch: b.backfillBatch == null ? cur.backfillBatch : Number(b.backfillBatch) || cur.backfillBatch,
    };
    setFlag.run(FLAG_KEY, JSON.stringify(next), now());
    return settings();
  }

  function record(e) {
    try {
      insLog.run(e.phase, e.target, e.source || null, e.sourceId == null ? null : String(e.sourceId), e.refId || null, e.postRefId || null,
        e.verdict, e.action || null, e.category || null, e.reason || null, e.aiSource || null,
        e.verdict === 'block' ? String(e.text || '').slice(0, 300) : null, e.actorId || null, now());
    } catch (err) { logErr('import review log', err.message || err); }
  }

  function isRejected(source, sourceId) { return !!selReject.get(String(source), String(sourceId)); }
  function reject(source, sourceId, target, r) {
    insReject.run(String(source), String(sourceId), target, r.category || null, r.reason || null, now());
  }

  // items: [{key, text}] → Map key → {verdict: allow|block|pending, category, reason, source}
  async function review(items, {kind = 'import'} = {}) {
    const out = new Map();
    if (!items.length) return {ok: true, error: null, results: out};
    if (!settings().enabled) {
      for (const it of items) out.set(it.key, {verdict: 'allow', source: 'off'});
      return {ok: true, error: null, results: out, off: true};
    }
    if (!aiMod || typeof aiMod.checkMany !== 'function') {
      for (const it of items) out.set(it.key, {verdict: 'pending', source: 'fallback', error: 'no_ai'});
      return {ok: false, error: 'no_ai', results: out};
    }
    const r = await aiMod.checkMany(items, {kind});
    r.results.forEach((x, i) => out.set(items[i].key, x));
    return {ok: r.ok, error: r.error, results: out};
  }

  /*
   * 入库前审查一条外部帖和它的评论。
   * post: {source, sourceId, text} | null（帖子已在库里，只审新评论时传 null）
   * comments: [{sourceId, text, ...}]
   * 返回 {post: {verdict, category, reason, source} | null, comments: Map(sourceId → verdict 对象), off, ok, error}
   * 被拦的帖子 / 评论会写进 import_review_rejects（以后不再拉取）。
   */
  async function reviewImport({post = null, comments = []} = {}) {
    const items = [];
    if (post) items.push({key: 'p:' + post.sourceId, text: post.text});
    for (const c of comments) items.push({key: 'c:' + c.sourceId, text: c.text});
    const r = await review(items, {kind: 'import'});
    const p = post ? r.results.get('p:' + post.sourceId) : null;
    const cm = new Map();
    for (const c of comments) cm.set(String(c.sourceId), r.results.get('c:' + c.sourceId));
    if (post && p) {
      if (p.verdict === 'block') { reject(post.source, post.sourceId, 'post', p); }
    }
    for (const c of comments) {
      const v = cm.get(String(c.sourceId));
      if (v && v.verdict === 'block') reject(c.source || (post && post.source), c.sourceId, 'comment', v);
    }
    return {post: p, comments: cm, off: !!r.off, ok: r.ok, error: r.error};
  }

  // import-feed 入库后标记已审，并写流水。
  function noteImport({target, source, sourceId, refId = null, postRefId = null, result, action, text}) {
    if (!result) return;
    if (refId && result.verdict === 'allow' && result.source !== 'off') {
      (target === 'post' ? markPost : markCmt).run('pass', now(), refId);
    }
    record({phase: 'import', target, source, sourceId, refId, postRefId, verdict: result.verdict, action,
      category: result.category, reason: result.reason, aiSource: result.source, text});
  }

  /*
   * 补审已发布的外部帖（含评论）。opts: {limit, actorId}
   * 返回 {scanned, postsPassed, postsHidden, postsPending, commentsPassed, commentsHidden, commentsPending, error, remaining, at}
   */
  async function backfill({limit, actorId = null} = {}) {
    if (backfilling) return {busy: true, ...(lastBackfill || {})};
    backfilling = true;
    const st = settings();
    const lim = Math.max(1, Math.min(100, Number(limit) || st.backfillBatch));
    const res = {scanned: 0, postsPassed: 0, postsHidden: 0, postsPending: 0, commentsPassed: 0, commentsHidden: 0, commentsPending: 0, error: null, remaining: 0, at: now(), actorId};
    try {
      if (!st.enabled) { res.error = 'review_disabled'; return res; }
      const rows = pendingPosts.all(lim);
      for (const p of rows) {
        res.scanned++;
        const cms = pendingCmts.all(p.id);
        const items = [];
        if (!p.ai_review) items.push({key: 'p:' + p.id, text: p.text});
        for (const c of cms) items.push({key: 'c:' + c.id, text: c.text});
        const r = await review(items, {kind: 'backfill'});
        if (r.error) res.error = r.error;
        const pv = !p.ai_review ? r.results.get('p:' + p.id) : null;
        if (pv) {
          if (pv.verdict === 'block') {
            hidePost.run(now(), ('AI 补审未通过：' + (pv.reason || pv.category || '')).slice(0, 200), now(), p.id);
            reject(p.source, p.source_id, 'post', pv);
            res.postsHidden++;
            record({phase: 'backfill', target: 'post', source: p.source, sourceId: p.source_id, refId: p.id, verdict: 'block', action: 'hidden',
              category: pv.category, reason: pv.reason, aiSource: pv.source, text: p.text, actorId});
            continue; // 帖子下架后评论不用再审
          }
          if (pv.verdict === 'allow') {
            markPost.run('pass', now(), p.id); res.postsPassed++;
            record({phase: 'backfill', target: 'post', source: p.source, sourceId: p.source_id, refId: p.id, verdict: 'allow', action: 'passed', aiSource: pv.source, actorId});
          } else {
            res.postsPending++;
            record({phase: 'backfill', target: 'post', source: p.source, sourceId: p.source_id, refId: p.id, verdict: 'pending', action: 'deferred', reason: pv.error, aiSource: pv.source, actorId});
          }
        }
        for (const c of cms) {
          const cv = r.results.get('c:' + c.id);
          if (!cv) continue;
          if (cv.verdict === 'block') {
            hideCmt.run(now(), ('AI 补审未通过：' + (cv.reason || cv.category || '')).slice(0, 200), now(), c.id);
            if (c.source_id) reject(c.source, c.source_id, 'comment', cv);
            res.commentsHidden++;
            record({phase: 'backfill', target: 'comment', source: c.source, sourceId: c.source_id, refId: c.id, postRefId: p.id, verdict: 'block', action: 'hidden',
              category: cv.category, reason: cv.reason, aiSource: cv.source, text: c.text, actorId});
          } else if (cv.verdict === 'allow') {
            markCmt.run('pass', now(), c.id); res.commentsPassed++;
          } else res.commentsPending++;
        }
        if (r.error && !r.ok) break; // AI 不可用：这批先停，下次再补
      }
      res.remaining = qUnreviewedPosts.get().n;
      return res;
    } finally {
      backfilling = false;
      lastBackfill = res;
    }
  }

  /* 统计：sinceMs 起（默认最近 24 小时）各阶段的数量。 */
  function stats({sinceMs} = {}) {
    const since = Number(sinceMs) > 0 ? Number(sinceMs) : now() - 24 * 3600e3;
    const z = () => ({allow: 0, block: 0, pending: 0});
    const out = {since, import: {posts: z(), comments: z()}, backfill: {posts: z(), comments: z()}};
    for (const r of qGroup.all(since)) {
      const ph = out[r.phase]; if (!ph) continue;
      const t = ph[r.target === 'post' ? 'posts' : 'comments'];
      if (t && t[r.verdict] != null) t[r.verdict] += r.n;
    }
    return {
      settings: settings(), ...out,
      unreviewed: {posts: qUnreviewedPosts.get().n, comments: qUnreviewedCmts.get().n},
      rejectedTotal: qRejects.get().n,
      lastBackfill,
      ai: aiMod && aiMod.status ? (({keyConfigured, usedLastMinute, usedToday, rpm, rpd, cooldownUntil, lastError}) => ({keyConfigured, usedLastMinute, usedToday, rpm, rpd, cooldownUntil, lastError}))(aiMod.status()) : null,
    };
  }

  /* 流水：{phase, verdict, target, before, limit} */
  function logs(q = {}) {
    const ph = String(q.phase || ''), v = String(q.verdict || ''), t = String(q.target || '');
    const before = Number(q.before) > 0 ? Number(q.before) : null;
    const lim = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
    return qLogs.all(ph, ph, v, v, t, t, before, before, lim).map(x => ({
      id: x.id, phase: x.phase, target: x.target, source: x.source, sourceId: x.source_id, refId: x.ref_id, postRefId: x.post_ref_id,
      verdict: x.verdict, action: x.action, category: x.category, reason: x.reason, aiSource: x.ai_source, excerpt: x.excerpt,
      actorId: x.actor_id, createdAt: x.created_at,
    }));
  }

  function pruneLogs() { try { prune.run(now() - KEEP_LOG_DAYS * 24 * 3600e3); } catch { /* ignore */ } }

  return {settings, saveSettings, isRejected, reviewImport, noteImport, backfill, stats, logs, pruneLogs, lastBackfill: () => lastBackfill};
}
