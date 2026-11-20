// 服务端 2.1.0：外部导入帖（V2EX / HN）的 AI 审查。管理端接口见 admin-import-review.mjs 和 docs/server-2.1.0-api.md。
// - 入库前审查：import-feed 拉到的新帖子和评论先过 AI（智谱，复用 ai-moderation 的密钥 / 模型 / 本地限速 / 429 冷却），
//   不合格的不入库，并记下外部 ID（import_review_rejects），之后不再拉取、不再审；评论逐条审，不合格的单条丢弃。
// - AI 不可用（没配密钥、限速、超时、返回不对）时按 settings.onAiDown：
//   skip（默认）= 不入库，下一轮再审；keyword = 只过平台屏蔽词和本地死亡 / 自杀词预检，通过就入库（标记为未经 AI 审）。
// - 已发布外部帖补审：后台任务审还没审过的外部帖和评论；不合格帖按管理端「隐藏」处理（deleted_at + admin_hidden），
//   不合格评论删除（deleted_at + admin_hidden，管理端「恢复」可撤销）。每条结果写进 ai_moderation_log（kind=backfill / backfill_comment）。
import {localDeathCheck} from './ai-moderation.mjs';

const FLAG_KEY = 'ai.import_review';
const DEFAULTS = {enabled: true, reviewComments: true, onAiDown: 'skip', autoBackfill: true};
const KEEP_LOG_DAYS = 30;
const SCOPES = new Set(['all', 'v2ex', 'hn']);
const AUTO_BACKFILL_PER_RUN = 10;

export function createAiReview(db, {aiMod, blockwords = null, now = Date.now, log: logErr = (...a) => console.error(...a)} = {}) {
  const getFlag = db.prepare('SELECT value FROM app_flags WHERE key=?');
  const setFlag = db.prepare(`INSERT INTO app_flags(key,value,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`);
  const insLog = db.prepare(`INSERT INTO ai_moderation_log(kind,user_id,post_id,excerpt,verdict,category,reason,source,model,latency_ms,error,created_at,origin,origin_url,action)
    VALUES(?,NULL,?,?,?,?,?,?,?,NULL,?,?,?,?,?)`);
  const insReject = db.prepare('INSERT OR IGNORE INTO import_review_rejects(source,source_id,target,category,reason,created_at) VALUES(?,?,?,?,?,?)');
  const selReject = db.prepare('SELECT 1 FROM import_review_rejects WHERE source=? AND source_id=?');
  const prune = db.prepare("DELETE FROM ai_moderation_log WHERE created_at<? AND kind IN ('import','import_comment','backfill','backfill_comment')");
  const markPost = db.prepare('UPDATE posts SET ai_review=?, ai_reviewed_at=? WHERE id=?');
  const markCmt = db.prepare('UPDATE post_comments SET ai_review=?, ai_reviewed_at=? WHERE id=?');
  const hidePost = db.prepare("UPDATE posts SET deleted_at=COALESCE(deleted_at,?), admin_hidden=1, admin_reason=?, ai_review='block', ai_reviewed_at=? WHERE id=?");
  const removeCmt = db.prepare("UPDATE post_comments SET deleted_at=COALESCE(deleted_at,?), admin_hidden=1, admin_reason=?, ai_review='block', ai_reviewed_at=? WHERE id=?");
  const LIVE = 'source IS NOT NULL AND deleted_at IS NULL AND admin_hidden=0';
  const needPostsSql = `SELECT id FROM posts WHERE ${LIVE} AND (? = 'all' OR source = ?)
    AND (ai_review IS NULL OR (? = 1 AND id IN (SELECT post_id FROM post_comments WHERE ${LIVE} AND ai_review IS NULL)))
    ORDER BY created_at DESC`;
  const needPosts = db.prepare(needPostsSql);
  const needPostsLim = db.prepare(needPostsSql + ' LIMIT ?');
  const postById = db.prepare('SELECT * FROM posts WHERE id=?');
  const cmtsOf = db.prepare(`SELECT * FROM post_comments WHERE post_id=? AND ${LIVE} AND ai_review IS NULL ORDER BY created_at ASC LIMIT 200`);
  const qUnPosts = db.prepare(`SELECT COUNT(*) n FROM posts WHERE ${LIVE} AND ai_review IS NULL`);
  const qUnCmts = db.prepare(`SELECT COUNT(*) n FROM post_comments WHERE ${LIVE} AND ai_review IS NULL`);
  const qCount = db.prepare('SELECT COUNT(*) n FROM ai_moderation_log WHERE created_at>=? AND kind=? AND verdict=?');
  let job = null, stopFlag = false, jobSeq = 0;

  const dayStart = () => { const t = now() + 8 * 3600e3; return t - (t % 86400e3) - 8 * 3600e3; }; // 北京时间今天 0 点

  function settings() {
    let v = {};
    try { const r = getFlag.get(FLAG_KEY); if (r) v = JSON.parse(r.value) || {}; } catch { v = {}; }
    return {
      enabled: v.enabled == null ? DEFAULTS.enabled : !!v.enabled,
      reviewComments: v.reviewComments == null ? DEFAULTS.reviewComments : !!v.reviewComments,
      onAiDown: v.onAiDown === 'keyword' ? 'keyword' : 'skip',
      autoBackfill: v.autoBackfill == null ? DEFAULTS.autoBackfill : !!v.autoBackfill,
    };
  }
  const truthy = x => x === true || x === 1 || x === '1' || x === 'true';
  function saveSettings(b = {}) {
    const cur = settings();
    const next = {
      enabled: b.enabled == null ? cur.enabled : truthy(b.enabled),
      reviewComments: b.reviewComments == null ? cur.reviewComments : truthy(b.reviewComments),
      onAiDown: b.onAiDown == null ? cur.onAiDown : (b.onAiDown === 'keyword' ? 'keyword' : 'skip'),
      autoBackfill: b.autoBackfill == null ? cur.autoBackfill : truthy(b.autoBackfill),
    };
    setFlag.run(FLAG_KEY, JSON.stringify(next), now());
    return settings();
  }

  function record({kind, postId = null, text, r, origin, originUrl, action}) {
    try {
      const verdict = r.verdict === 'pending' ? 'fallback' : r.verdict;
      insLog.run(kind, postId, String(text || '').slice(0, 300), verdict, r.category || null, r.reason || null,
        r.source || 'ai', r.model || null, r.error || null, now(), origin || null, originUrl || null, action || null);
    } catch (e) { logErr('import review log', e.message || e); }
  }
  function isRejected(source, sourceId) { return !!selReject.get(String(source), String(sourceId)); }
  function reject(source, sourceId, target, r) {
    if (source && sourceId != null) insReject.run(String(source), String(sourceId), target, r.category || null, r.reason || null, now());
  }

  // AI 不可用时的关键词兜底（onAiDown=keyword）
  function keywordVerdict(text) {
    const d = localDeathCheck(text);
    if (d && d.level === 'block') return {verdict: 'block', category: '暴力 / 自杀自残', reason: '包含「' + d.term.slice(0, 12) + '」', source: 'local'};
    if (blockwords && typeof blockwords.assertPlatform === 'function') {
      try { blockwords.assertPlatform(String(text || '')); }
      catch (e) { return {verdict: 'block', category: '平台屏蔽词', reason: String(e.message || '命中屏蔽词').slice(0, 60), source: 'keyword'}; }
    }
    return {verdict: 'allow', source: 'keyword'};
  }

  // items: [{key, text}] → {ok, error, results: Map(key → {verdict: allow|block|pending, category, reason, source})}
  async function review(items) {
    const out = new Map();
    if (!items.length) return {ok: true, error: null, results: out};
    const st = settings();
    if (!st.enabled) {
      for (const it of items) out.set(it.key, {verdict: 'allow', source: 'off'});
      return {ok: true, error: null, results: out, off: true};
    }
    let r;
    if (aiMod && typeof aiMod.checkMany === 'function') r = await aiMod.checkMany(items);
    else r = {ok: false, error: 'no_ai', results: items.map(it => ({key: it.key, verdict: 'pending', source: 'fallback', error: 'no_ai'}))};
    r.results.forEach((x, i) => {
      let v = x;
      if (v.verdict === 'pending' && st.onAiDown === 'keyword') v = {...keywordVerdict(items[i].text), error: x.error};
      out.set(items[i].key, v);
    });
    const anyPending = [...out.values()].some(v => v.verdict === 'pending');
    return {ok: !anyPending, error: r.error || null, aiDown: !!r.error, results: out};
  }

  /*
   * 入库前审查一条外部帖和它的新评论（import-feed 调用）。
   * post: {source, sourceId, text} | null（帖子已在库里，只审新评论时传 null）；comments: [{source, sourceId, text}]
   * 返回 {post: 结果 | null, comments: Map(sourceId → 结果), ok, error}
   */
  async function reviewImport({post = null, comments = []} = {}) {
    const st = settings();
    const items = [];
    if (post) items.push({key: 'p:' + post.sourceId, text: post.text});
    if (st.reviewComments) for (const c of comments) items.push({key: 'c:' + c.sourceId, text: c.text});
    const r = await review(items);
    const p = post ? r.results.get('p:' + post.sourceId) : null;
    const cm = new Map();
    for (const c of comments) cm.set(String(c.sourceId), st.reviewComments ? r.results.get('c:' + c.sourceId) : {verdict: 'allow', source: 'off'});
    if (p && p.verdict === 'block') reject(post.source, post.sourceId, 'post', p);
    for (const c of comments) {
      const v = cm.get(String(c.sourceId));
      if (v && v.verdict === 'block') reject(c.source || (post && post.source), c.sourceId, 'comment', v);
    }
    return {post: p, comments: cm, ok: r.ok, error: r.error, aiDown: !!r.aiDown};
  }

  // import-feed 入库 / 拒绝后调用：标记已审并写审查记录。action: inserted | rejected | deferred
  function noteImport({target, source, sourceId, sourceUrl, refId = null, postRefId = null, result, action, text}) {
    if (!result) return;
    const reviewed = result.source && result.source !== 'off';
    if (refId && result.verdict === 'allow' && reviewed) (target === 'post' ? markPost : markCmt).run(result.source === 'keyword' ? null : 'pass', now(), refId);
    if (!reviewed) return; // 审查关着时不写记录
    record({kind: target === 'post' ? 'import' : 'import_comment', postId: target === 'post' ? refId : postRefId, text, r: result,
      origin: source, originUrl: sourceUrl, action: action === 'inserted' ? 'stored' : action === 'rejected' ? 'rejected' : null});
    void sourceId;
  }

  // 补审一条已发布的外部帖（和它没审过的评论）。返回 {passedPosts, hiddenPosts, removedComments, skipped, aiDown}
  async function backfillOne(postId) {
    const res = {passedPosts: 0, hiddenPosts: 0, removedComments: 0, skipped: 0, aiDown: false};
    const p = postById.get(postId);
    if (!p || p.deleted_at || p.admin_hidden) return res;
    const st = settings();
    const cms = st.reviewComments ? cmtsOf.all(p.id) : [];
    const items = [];
    if (!p.ai_review) items.push({key: 'p:' + p.id, text: p.text});
    for (const c of cms) items.push({key: 'c:' + c.id, text: c.text});
    if (!items.length) return res;
    const r = await review(items);
    res.aiDown = !!r.aiDown;
    const pv = !p.ai_review ? r.results.get('p:' + p.id) : null;
    if (pv) {
      if (pv.verdict === 'block') {
        hidePost.run(now(), ('AI 补审未通过：' + (pv.reason || pv.category || '')).slice(0, 200), now(), p.id);
        reject(p.source, p.source_id, 'post', pv);
        res.hiddenPosts++;
        record({kind: 'backfill', postId: p.id, text: p.text, r: pv, origin: p.source, originUrl: p.source_url, action: 'hidden'});
        return res; // 帖子已下架，评论不用再审
      }
      if (pv.verdict === 'allow') {
        if (pv.source !== 'keyword') markPost.run('pass', now(), p.id);
        res.passedPosts++;
        record({kind: 'backfill', postId: p.id, text: p.text, r: pv, origin: p.source, originUrl: p.source_url, action: null});
      } else {
        res.skipped++;
        record({kind: 'backfill', postId: p.id, text: p.text, r: pv, origin: p.source, originUrl: p.source_url, action: null});
      }
    }
    for (const c of cms) {
      const cv = r.results.get('c:' + c.id);
      if (!cv) continue;
      if (cv.verdict === 'block') {
        removeCmt.run(now(), ('AI 补审未通过：' + (cv.reason || cv.category || '')).slice(0, 200), now(), c.id);
        reject(c.source, c.source_id, 'comment', cv);
        res.removedComments++;
        record({kind: 'backfill_comment', postId: p.id, text: c.text, r: cv, origin: c.source, originUrl: c.source_url, action: 'removed'});
      } else if (cv.verdict === 'allow') {
        if (cv.source !== 'keyword') markCmt.run('pass', now(), c.id);
      } else if (!pv) res.skipped++;
    }
    return res;
  }

  function pubJob(j = job) { return j ? {...j} : null; }

  /* 启动后台补审任务。scope: all | v2ex | hn。已有任务在跑时抛 409。返回 job */
  function startBackfill({scope = 'all', actorId = null} = {}) {
    const sc = SCOPES.has(String(scope)) ? String(scope) : 'all';
    if (job && job.status === 'running') {
      const e = new Error('已有补审任务在进行'); e.status = 409; e.code = 'JOB_RUNNING'; e.job = pubJob(); throw e;
    }
    const rc = settings().reviewComments ? 1 : 0;
    const ids = needPosts.all(sc, sc, rc).map(r => r.id);
    stopFlag = false;
    job = {id: 'bf_' + now().toString(36) + '_' + (++jobSeq), status: 'running', scope: sc, total: ids.length, done: 0,
      passedPosts: 0, hiddenPosts: 0, removedComments: 0, skipped: 0, startedAt: now(), finishedAt: null, error: null, actorId};
    const mine = job;
    (async () => {
      try {
        for (const id of ids) {
          if (stopFlag) break;
          const r = await backfillOne(id);
          mine.passedPosts += r.passedPosts; mine.hiddenPosts += r.hiddenPosts; mine.removedComments += r.removedComments; mine.skipped += r.skipped;
          if (r.aiDown && !mine.error) mine.error = 'AI 暂不可用，未审的保持未审状态，可稍后再补审';
          mine.done++;
        }
        mine.status = stopFlag ? 'stopped' : 'done';
      } catch (e) {
        mine.status = 'failed'; mine.error = String(e && e.message || e).slice(0, 200);
        logErr('import backfill job', e);
      } finally { mine.finishedAt = now(); }
    })();
    return pubJob(mine);
  }
  function stopBackfill() {
    if (job && job.status === 'running') stopFlag = true;
    return pubJob();
  }
  // 等后台任务结束（测试和优雅退出用）
  async function waitJob(timeoutMs = 30000) {
    const t0 = Date.now();
    while (job && job.status === 'running' && Date.now() - t0 < timeoutMs) await new Promise(r => setTimeout(r, 10));
    return pubJob();
  }

  /* 每轮导入后顺带补审一小批（没有手动任务在跑、设置开着时）。返回汇总或 null */
  async function autoBackfill(limit = AUTO_BACKFILL_PER_RUN) {
    const st = settings();
    if (!st.enabled || !st.autoBackfill || (job && job.status === 'running')) return null;
    const ids = needPostsLim.all('all', 'all', st.reviewComments ? 1 : 0, limit).map(r => r.id);
    const sum = {scanned: 0, passedPosts: 0, hiddenPosts: 0, removedComments: 0, skipped: 0};
    for (const id of ids) {
      const r = await backfillOne(id);
      sum.scanned++; sum.passedPosts += r.passedPosts; sum.hiddenPosts += r.hiddenPosts; sum.removedComments += r.removedComments; sum.skipped += r.skipped;
      if (r.aiDown) break;
    }
    return sum;
  }

  /* 管理端卡片统计（北京时间今天）。 */
  function stats() {
    const since = dayStart();
    const c = (kind, verdict) => qCount.get(since, kind, verdict).n;
    return {
      unreviewedPosts: qUnPosts.get().n,
      unreviewedComments: qUnCmts.get().n,
      rejectedPostsToday: c('import', 'block') + c('backfill', 'block'),
      rejectedCommentsToday: c('import_comment', 'block') + c('backfill_comment', 'block'),
      passedPostsToday: c('import', 'allow') + c('backfill', 'allow'),
    };
  }
  function state() { return {settings: settings(), stats: stats(), job: pubJob()}; }
  function pruneLogs() { try { prune.run(now() - KEEP_LOG_DAYS * 86400e3); } catch { /* ignore */ } }

  return {settings, saveSettings, state, stats, isRejected, reviewImport, noteImport, backfillOne, startBackfill, stopBackfill, waitJob, autoBackfill, job: () => pubJob(), pruneLogs};
}
