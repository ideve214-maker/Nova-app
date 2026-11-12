// M5.3.3 帖子草稿与定时发布：由服务端按点执行；取消与失败对用户可见。
import {randomBytes} from 'node:crypto';
import {ApiError} from './errors.mjs';

const nid = () => 'pd_' + randomBytes(12).toString('base64url');
const len = s => [...String(s)].length;
const STATUSES = new Set(['draft', 'scheduled', 'published', 'cancelled', 'failed']);

export function createSchedule(db, {now, posts, hashtags, polls, intervalMs = 5000} = {}) {
  const ins = db.prepare(`INSERT INTO post_drafts(id,author_id,text,poll_json,status,scheduled_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`);
  const byId = db.prepare('SELECT * FROM post_drafts WHERE id=?');
  const listQ = db.prepare('SELECT * FROM post_drafts WHERE author_id=? ORDER BY updated_at DESC, id DESC LIMIT 100');
  const upd = db.prepare(`UPDATE post_drafts SET text=?, poll_json=?, updated_at=? WHERE id=? AND author_id=? AND status IN ('draft','scheduled','failed')`);
  const setSched = db.prepare(`UPDATE post_drafts SET status='scheduled', scheduled_at=?, fail_reason=NULL, failed_at=NULL, cancelled_at=NULL, updated_at=? WHERE id=? AND author_id=? AND status IN ('draft','scheduled','failed')`);
  const setCancel = db.prepare(`UPDATE post_drafts SET status='cancelled', cancelled_at=?, updated_at=? WHERE id=? AND author_id=? AND status IN ('draft','scheduled','failed')`);
  const dueQ = db.prepare(`SELECT * FROM post_drafts WHERE status='scheduled' AND scheduled_at<=? ORDER BY scheduled_at, id`);
  const setPub = db.prepare(`UPDATE post_drafts SET status='published', published_post_id=?, published_at=?, fail_reason=NULL, updated_at=? WHERE id=?`);
  const setFail = db.prepare(`UPDATE post_drafts SET status='failed', fail_reason=?, failed_at=?, updated_at=? WHERE id=?`);
  const userBy = db.prepare('SELECT * FROM users WHERE id=?');

  let failNext = null;
  let timer = null;

  function pub(row) {
    if (!row) return null;
    let poll = null;
    if (row.poll_json) { try { poll = JSON.parse(row.poll_json); } catch { poll = null; } }
    return {
      id: row.id,
      text: row.text,
      poll,
      status: row.status,
      scheduledAt: row.scheduled_at || null,
      publishedPostId: row.published_post_id || null,
      failReason: row.fail_reason || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      cancelledAt: row.cancelled_at || null,
      publishedAt: row.published_at || null,
      failedAt: row.failed_at || null,
    };
  }
  function requireMine(user, id) {
    const row = byId.get(id);
    if (!row || Number(row.author_id) !== Number(user.id)) throw new ApiError(404, 'NOT_FOUND', '草稿不存在');
    return row;
  }
  function pollJson(spec) {
    if (spec == null || spec === '') return null;
    if (polls && polls.validateSpec) polls.validateSpec(spec);
    return JSON.stringify(spec);
  }
  function create(user, body = {}) {
    const text = String(body.text != null ? body.text : '');
    if (len(text) > 4000) throw new ApiError(400, 'TOO_LONG', '草稿过长');
    const id = nid(), t = now();
    let status = 'draft', scheduledAt = null;
    if (body.scheduledAt) {
      scheduledAt = Number(body.scheduledAt);
      if (!Number.isFinite(scheduledAt) || scheduledAt <= t) throw new ApiError(400, 'BAD_SCHEDULE', '定时发布时间必须是未来的时间');
      if (!String(text).trim()) throw new ApiError(400, 'BAD_TEXT', '定时发布需要正文');
      status = 'scheduled';
    }
    ins.run(id, user.id, text, pollJson(body.poll), status, scheduledAt, t, t);
    return {draft: pub(byId.get(id))};
  }
  function list(user) {
    return {drafts: listQ.all(user.id).map(pub)};
  }
  function get(user, id) {
    return {draft: pub(requireMine(user, id))};
  }
  function update(user, id, body = {}) {
    const row = requireMine(user, id);
    if (row.status === 'published' || row.status === 'cancelled') {
      throw new ApiError(409, 'NOT_EDITABLE', row.status === 'published' ? '已发布的稿件不能再改' : '已取消的稿件不能再改');
    }
    const text = body.text != null ? String(body.text) : row.text;
    if (len(text) > 4000) throw new ApiError(400, 'TOO_LONG', '草稿过长');
    const pj = body.poll !== undefined ? pollJson(body.poll) : row.poll_json;
    upd.run(text, pj, now(), id, user.id);
    return {draft: pub(byId.get(id))};
  }
  function scheduleOne(user, id, body = {}) {
    const row = requireMine(user, id);
    if (row.status === 'published' || row.status === 'cancelled') {
      throw new ApiError(409, 'NOT_SCHEDULABLE', '已发布或已取消的稿件不能再定时');
    }
    const text = body.text != null ? String(body.text) : row.text;
    if (!String(text).trim()) throw new ApiError(400, 'BAD_TEXT', '定时发布需要正文');
    if (body.text != null || body.poll !== undefined) update(user, id, body);
    const at = Number(body.scheduledAt);
    if (!Number.isFinite(at) || at <= now()) throw new ApiError(400, 'BAD_SCHEDULE', '定时发布时间必须是未来的时间');
    setSched.run(at, now(), id, user.id);
    return {draft: pub(byId.get(id))};
  }
  function cancel(user, id) {
    const row = requireMine(user, id);
    if (row.status === 'published') throw new ApiError(409, 'ALREADY_PUBLISHED', '已经发布，无法取消');
    if (row.status === 'cancelled') return {draft: pub(row), already: true};
    setCancel.run(now(), now(), id, user.id);
    return {draft: pub(byId.get(id)), already: false};
  }

  function publishRow(row) {
    const user = userBy.get(row.author_id);
    if (!user || user.status !== 'active') throw new ApiError(403, 'FORBIDDEN', '账号不可用，无法发布');
    if (failNext) { const m = failNext; failNext = null; const e = new Error(m); e.code = 'FORCED'; throw e; }
    const r = posts.create(user, {text: row.text, clientId: 'pd:' + row.id});
    if (hashtags) hashtags.syncPost(user, r.post);
    if (row.poll_json && polls) {
      let spec; try { spec = JSON.parse(row.poll_json); } catch { spec = null; }
      if (spec) {
        const pr = polls.createForPost(user, r.post.id, spec);
        r.post.poll = pr.poll;
      }
    }
    setPub.run(r.post.id, now(), now(), row.id);
    return r.post;
  }

  function tick() {
    const rows = dueQ.all(now());
    const results = [];
    for (const row of rows) {
      try {
        const post = publishRow(row);
        results.push({id: row.id, status: 'published', postId: post.id});
      } catch (e) {
        const msg = (e && e.message) || '发布失败';
        setFail.run(String(msg).slice(0, 300), now(), now(), row.id);
        results.push({id: row.id, status: 'failed', failReason: String(msg).slice(0, 300)});
      }
    }
    return {ran: rows.length, results};
  }
  function publishNow(user, id) {
    const row = requireMine(user, id);
    if (row.status === 'published') return {draft: pub(row), post: posts.get(user, row.published_post_id).post, already: true};
    if (row.status === 'cancelled') throw new ApiError(409, 'CANCELLED', '已取消的稿件不能发布');
    if (!String(row.text).trim()) throw new ApiError(400, 'BAD_TEXT', '请写下你想发布的内容');
    try {
      const post = publishRow(row);
      return {draft: pub(byId.get(id)), post, already: false};
    } catch (e) {
      setFail.run(String(e.message || '发布失败').slice(0, 300), now(), now(), id);
      throw e;
    }
  }

  function start() {
    if (timer) return;
    const ms = Math.max(500, Number(intervalMs) || 5000);
    timer = setInterval(() => { try { tick(); } catch (e) { console.error('定时发布:', e.message); } }, ms);
    if (timer.unref) timer.unref();
  }
  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
  }
  function setFailNext(msg) { failNext = msg; }

  return {create, list, get, update, scheduleOne, cancel, publishNow, tick, start, stop, setFailNext, pub};
}
