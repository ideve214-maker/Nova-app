// 管理端 2.0：编辑资料、粉丝加成、站内通知、标签、注销账号、AI 助理日报。
// 模型只用智谱 glm-4-flash；拒绝 DeepSeek。密钥只从环境变量读取，绝不打印。
import {randomBytes} from 'node:crypto';
import {ApiError} from './errors.mjs';
import {hashPassword} from './auth.mjs';

export const PRESET_TAGS = Object.freeze(['测试账号', '内部', '正式用户']);
export const DELETE_CONFIRM = '确认删除';
const MAX_TAG = 20;
const MAX_NOTIFY = 2000;
const DEFAULT_BASE = 'https://open.bigmodel.cn/api/paas/v4';
const DEFAULT_MODEL = 'glm-4-flash';

function asInt(v) {
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
}
function banned(s) { return /deepseek/i.test(String(s || '')); }
function tagName(raw) {
  const t = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!t) throw new ApiError(400, 'BAD_TAG', '请填写标签');
  if ([...t].length > MAX_TAG) throw new ApiError(400, 'BAD_TAG', `标签最多 ${MAX_TAG} 个字`);
  return t;
}

/** 按 Asia/Shanghai（UTC+8）取某一天的起止时间戳。 */
export function shanghaiDayRange(dateStr, nowFn = Date.now) {
  let y, m, d;
  if (dateStr) {
    const p = String(dateStr).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!p) throw new ApiError(400, 'BAD_DATE', '日期格式应为 YYYY-MM-DD');
    y = Number(p[1]); m = Number(p[2]); d = Number(p[3]);
  } else {
    const t = new Date((nowFn() || Date.now()) + 8 * 3600e3);
    y = t.getUTCFullYear(); m = t.getUTCMonth() + 1; d = t.getUTCDate();
  }
  if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) {
    throw new ApiError(400, 'BAD_DATE', '日期不正确');
  }
  const start = Date.UTC(y, m - 1, d) - 8 * 3600e3;
  return {date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, start, end: start + 86400e3};
}

export function localReport(stats) {
  const s = stats || {};
  const lines = [
    `【${s.date || ''} 工作日报 · 本地汇总】`,
    `今日新注册 ${s.newUsers ?? 0} 人，发帖 ${s.newPosts ?? 0} 条，评论 ${s.newComments ?? 0} 条。`,
    `待处理举报 ${s.openReports ?? 0} 条，今日已处理 ${s.decidedReports ?? 0} 条；付款待核对 ${s.pendingPayments ?? 0} 笔，今日确认 ${s.confirmedPayments ?? 0} 笔。`,
    `今日封禁 ${s.bans ?? 0} 人，注销 ${s.deletes ?? 0} 人。新社区 ${s.newCommunities ?? 0}，新技能交换 ${s.newExchange ?? 0}，新共创项目 ${s.newProjects ?? 0}，活动报名 ${s.activitySignups ?? 0} 次。`,
    s.aiChecks != null ? `AI 审查今日调用 ${s.aiChecks} 次（拦截 ${s.aiBlocks ?? 0}，标记 ${s.aiFlags ?? 0}）。` : '',
    '以上为根据后台统计自动整理的摘要。配置智谱（glm-4-flash）后可生成更完整的工作建议。',
  ];
  return lines.filter(Boolean).join('\n');
}

export function createAdminV2(db, {
  now, profile, audit, notifications, adminOps, env = process.env, fetchImpl,
} = {}) {
  const nowFn = now || Date.now;
  const doFetch = fetchImpl || fetch;
  const getUser = (id) => {
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(asInt(id));
    if (!u) throw new ApiError(404, 'NOT_FOUND', '用户不存在');
    return u;
  };
  const tagsOf = (uid) => db.prepare('SELECT tag FROM user_tags WHERE user_id=? ORDER BY tag').all(uid).map((r) => r.tag);
  const one = (id) => {
    const out = adminOps.oneUser(id);
    if (out && out.user) out.user.tags = tagsOf(id);
    return out;
  };

  function editProfile(admin, id, body = {}, ip = null) {
    const u = getUser(id);
    if (u.status === 'deleted' || u.deleted_at) throw new ApiError(404, 'NOT_FOUND', '用户不存在');
    const patch = {};
    if (body.displayName !== undefined || body.name !== undefined) patch.displayName = body.displayName !== undefined ? body.displayName : body.name;
    if (body.bio !== undefined) patch.bio = body.bio;
    if (!Object.keys(patch).length) throw new ApiError(400, 'BAD_PROFILE', '请填写要修改的昵称或简介');
    profile.save(u, patch);
    if (audit) audit(admin.id, 'admin.user.edit_profile', 'user:' + u.id, ip, {fields: Object.keys(patch), adminUsername: admin.username});
    return one(u.id);
  }

  function setFollowerBonus(admin, id, body = {}, ip = null) {
    const u = getUser(id);
    if (u.status === 'deleted' || u.deleted_at) throw new ApiError(404, 'NOT_FOUND', '用户不存在');
    const n = body.bonus != null ? Number(body.bonus) : Number(body.followerBonus ?? body.follower_bonus);
    if (!Number.isInteger(n) || n < 0 || n > 100000000) throw new ApiError(400, 'BAD_BONUS', '增加粉丝数须为 0 或正整数');
    db.prepare('UPDATE users SET follower_bonus=? WHERE id=?').run(n, u.id);
    if (audit) audit(admin.id, 'admin.user.follower_bonus', 'user:' + u.id, ip, {bonus: n, before: u.follower_bonus || 0, adminUsername: admin.username});
    return one(u.id);
  }

  function addTag(admin, id, body = {}, ip = null) {
    const u = getUser(id);
    if (u.status === 'deleted' || u.deleted_at) throw new ApiError(404, 'NOT_FOUND', '用户不存在');
    const tag = tagName(body.tag);
    db.prepare('INSERT OR IGNORE INTO user_tags(user_id, tag, created_at, created_by) VALUES(?,?,?,?)').run(u.id, tag, nowFn(), admin.id);
    if (audit) audit(admin.id, 'admin.user.tag_add', 'user:' + u.id, ip, {tag, adminUsername: admin.username});
    return one(u.id);
  }

  function removeTag(admin, id, body = {}, ip = null) {
    const u = getUser(id);
    const tag = tagName(body.tag);
    db.prepare('DELETE FROM user_tags WHERE user_id=? AND tag=?').run(u.id, tag);
    if (audit) audit(admin.id, 'admin.user.tag_remove', 'user:' + u.id, ip, {tag, adminUsername: admin.username});
    return one(u.id);
  }

  function setTags(admin, id, body = {}, ip = null) {
    const u = getUser(id);
    if (u.status === 'deleted' || u.deleted_at) throw new ApiError(404, 'NOT_FOUND', '用户不存在');
    const raw = Array.isArray(body.tags) ? body.tags : [];
    if (raw.length > 20) throw new ApiError(400, 'BAD_TAG', '每个用户最多 20 个标签');
    const tags = [...new Set(raw.map(tagName))];
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM user_tags WHERE user_id=?').run(u.id);
      const ins = db.prepare('INSERT INTO user_tags(user_id, tag, created_at, created_by) VALUES(?,?,?,?)');
      for (const t of tags) ins.run(u.id, t, nowFn(), admin.id);
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch {}
      throw e;
    }
    if (audit) audit(admin.id, 'admin.user.tags_set', 'user:' + u.id, ip, {tags, adminUsername: admin.username});
    return one(u.id);
  }

  function listTags() {
    const rows = db.prepare('SELECT tag, COUNT(*) AS n FROM user_tags GROUP BY tag ORDER BY n DESC, tag').all();
    const known = new Set(rows.map((r) => r.tag));
    const presets = PRESET_TAGS.map((tag) => ({tag, count: (rows.find((r) => r.tag === tag) || {n: 0}).n, preset: true}));
    const extra = rows.filter((r) => !PRESET_TAGS.includes(r.tag)).map((r) => ({tag: r.tag, count: r.n, preset: false}));
    return {tags: [...presets, ...extra], presets: PRESET_TAGS, known: [...known]};
  }

  function bulkDeleteTag(admin, body = {}, ip = null) {
    const tag = tagName(body.tag);
    const ids = Array.isArray(body.userIds) ? body.userIds.map(asInt).filter(Number.isInteger) : null;
    let info;
    if (ids && ids.length) {
      const del = db.prepare('DELETE FROM user_tags WHERE tag=? AND user_id=?');
      let n = 0;
      for (const id of ids.slice(0, 500)) n += del.run(tag, id).changes;
      info = {tag, removed: n, userIds: ids.slice(0, 500)};
    } else {
      info = {tag, removed: db.prepare('DELETE FROM user_tags WHERE tag=?').run(tag).changes};
    }
    if (audit) audit(admin.id, 'admin.tag.bulk_delete', 'tag:' + tag, ip, {removed: info.removed, adminUsername: admin.username});
    return {...listTags(), ...info};
  }

  function notifyOne(admin, id, body = {}, ip = null) {
    const u = getUser(id);
    if (u.status === 'deleted' || u.status === 'banned' || u.deleted_at) throw new ApiError(409, 'NOT_ACTIVE', '不能向已封禁或已注销的账号发通知');
    const title = String(body.title || '平台通知').trim().slice(0, 40) || '平台通知';
    const text = String(body.body || body.text || body.message || '').trim();
    if ([...text].length < 2 || [...text].length > MAX_NOTIFY) throw new ApiError(400, 'BAD_BODY', '通知内容需要 2–2000 字');
    if (!notifications || typeof notifications.push !== 'function') throw new ApiError(503, 'UNAVAILABLE', '通知服务不可用');
    notifications.push(u.id, {kind: 'admin', title, body: text, refType: 'admin', refId: 'admin:' + admin.id, actorId: null, dedupeKey: 'admin-notify:' + u.id + ':' + nowFn()});
    if (audit) audit(admin.id, 'admin.notify', 'user:' + u.id, ip, {title, adminUsername: admin.username});
    return {ok: true, sent: 1, userId: u.id};
  }

  function notifyMany(admin, body = {}, ip = null) {
    const title = String(body.title || '平台通知').trim().slice(0, 40) || '平台通知';
    const text = String(body.body || body.text || body.message || '').trim();
    if ([...text].length < 2 || [...text].length > MAX_NOTIFY) throw new ApiError(400, 'BAD_BODY', '通知内容需要 2–2000 字');
    if (!notifications || typeof notifications.push !== 'function') throw new ApiError(503, 'UNAVAILABLE', '通知服务不可用');
    let ids;
    if (Array.isArray(body.userIds) && body.userIds.length) {
      ids = [...new Set(body.userIds.map(asInt).filter(Number.isInteger))];
    } else {
      ids = db.prepare("SELECT id FROM users WHERE status='active' AND deleted_at IS NULL").all().map((r) => r.id);
    }
    if (ids.length > 20000) throw new ApiError(400, 'TOO_MANY', '一次最多发给 20000 人');
    let sent = 0;
    const key = 'admin-broadcast:' + nowFn();
    for (const uid of ids) {
      const u = db.prepare('SELECT id, status, deleted_at FROM users WHERE id=?').get(uid);
      if (!u || u.status !== 'active' || u.deleted_at) continue;
      notifications.push(uid, {kind: 'admin', title, body: text, refType: 'admin', refId: 'admin:' + admin.id, actorId: null, dedupeKey: key + ':' + uid});
      sent++;
    }
    if (audit) audit(admin.id, 'admin.notify_broadcast', 'users', ip, {title, sent, requested: ids.length, adminUsername: admin.username});
    return {ok: true, sent, requested: ids.length};
  }

  function deleteUser(admin, id, body = {}, ip = null) {
    const u = getUser(id);
    if (u.status === 'deleted' || u.deleted_at) throw new ApiError(409, 'ALREADY_DELETED', '该账号已经注销');
    const phrase = String(body.confirm || body.phrase || '').trim();
    if (phrase !== DELETE_CONFIRM) throw new ApiError(400, 'CONFIRM_REQUIRED', `请再次确认，并输入「${DELETE_CONFIRM}」`);
    const who = String(body.confirmUsername || body.username || '').trim();
    if (who && who.toLowerCase() !== String(u.username || '').toLowerCase() && who.toLowerCase() !== String(u.email || '').toLowerCase()) {
      throw new ApiError(400, 'CONFIRM_USERNAME', '请输入该用户的用户名或邮箱以确认注销');
    }
    if (!who) throw new ApiError(400, 'CONFIRM_USERNAME', '请输入该用户的用户名或邮箱以确认注销');
    const un = 'deleted_' + u.id;
    const em = 'deleted_' + u.id + '@invalid.invalid';
    const pw = hashPassword(randomBytes(24).toString('base64url'));
    const t = nowFn();
    db.exec('BEGIN');
    try {
      db.prepare(`UPDATE users SET username=?, email=?, password_hash=?, status='deleted', must_change_pw=0, vip_until=NULL, deleted_at=?, badge=NULL, follower_bonus=0 WHERE id=?`).run(un, em, pw, t, u.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
      try { db.prepare('UPDATE posts SET deleted_at=? WHERE author_id=? AND deleted_at IS NULL').run(t, u.id); } catch {}
      try { db.prepare("UPDATE post_comments SET deleted_at=?, text='（已注销）' WHERE author_id=? AND deleted_at IS NULL").run(t, u.id); } catch {}
      try { db.prepare('DELETE FROM e2ee_devices WHERE user_id=?').run(u.id); } catch {}
      try { db.prepare('DELETE FROM e2ee_one_time_keys WHERE user_id=?').run(u.id); } catch {}
      try { db.prepare('DELETE FROM follows WHERE follower_id=? OR followee_id=?').run(u.id, u.id); } catch {}
      try { db.prepare("UPDATE friend_requests SET status='cancelled' WHERE from_id=? OR to_id=?").run(u.id, u.id); } catch {}
      try { db.prepare('DELETE FROM friends WHERE user_a=? OR user_b=?').run(u.id, u.id); } catch {}
      try { db.prepare('DELETE FROM user_tags WHERE user_id=?').run(u.id); } catch {}
      if (profile && typeof profile.clearFor === 'function') profile.clearFor(u.id);
      else {
        try { db.prepare("UPDATE profiles SET display_name='已注销用户', bio='', birthday=NULL, gender=NULL WHERE user_id=?").run(u.id); } catch {}
      }
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch {}
      throw e;
    }
    if (audit) audit(admin.id, 'admin.user.delete', 'user:' + u.id, ip, {username: u.username, adminUsername: admin.username});
    return {deleted: true, userId: u.id, user: one(u.id).user};
  }

  function countSafe(sql, ...args) {
    try { return db.prepare(sql).get(...args).n || 0; } catch { return 0; }
  }

  function collectStats(dateStr) {
    const {date, start, end} = shanghaiDayRange(dateStr, nowFn);
    const between = (col, table, extra = '') => countSafe(`SELECT COUNT(*) n FROM ${table} WHERE ${col}>=? AND ${col}<? ${extra}`, start, end);
    return {
      date, start, end, timezone: 'Asia/Shanghai',
      newUsers: between('created_at', 'users'),
      newPosts: countSafe('SELECT COUNT(*) n FROM posts WHERE created_at>=? AND created_at<? AND deleted_at IS NULL', start, end),
      newComments: countSafe('SELECT COUNT(*) n FROM post_comments WHERE created_at>=? AND created_at<? AND deleted_at IS NULL', start, end),
      openReports: countSafe("SELECT COUNT(*) n FROM reports WHERE status='pending' OR status='open'"),
      decidedReports: countSafe('SELECT COUNT(*) n FROM reports WHERE decided_at>=? AND decided_at<?', start, end),
      pendingPayments: countSafe("SELECT COUNT(*) n FROM payments WHERE status='pending' OR status='submitted'"),
      confirmedPayments: countSafe("SELECT COUNT(*) n FROM payments WHERE confirmed_at>=? AND confirmed_at<?", start, end),
      bans: countSafe("SELECT COUNT(*) n FROM audit_log WHERE action='admin.user.ban' AND at>=? AND at<?", start, end),
      deletes: countSafe("SELECT COUNT(*) n FROM audit_log WHERE action IN ('admin.user.delete','user.delete') AND at>=? AND at<?", start, end),
      newCommunities: between('created_at', 'communities'),
      newExchange: between('created_at', 'exchange_posts'),
      newProjects: between('created_at', 'projects'),
      activitySignups: countSafe('SELECT COUNT(*) n FROM activity_signups WHERE created_at>=? AND created_at<? AND cancelled_at IS NULL', start, end),
      aiChecks: countSafe('SELECT COUNT(*) n FROM ai_moderation_log WHERE created_at>=? AND created_at<?', start, end),
      aiBlocks: countSafe("SELECT COUNT(*) n FROM ai_moderation_log WHERE created_at>=? AND created_at<? AND verdict='block'", start, end),
      aiFlags: countSafe("SELECT COUNT(*) n FROM ai_moderation_log WHERE created_at>=? AND created_at<? AND verdict='flag'", start, end),
      usersTotal: countSafe("SELECT COUNT(*) n FROM users WHERE status!='deleted' AND deleted_at IS NULL"),
    };
  }

  function aiConfig() {
    const e = env || process.env;
    const base = String(e.AI_API_BASE || e.ZHIPU_API_BASE || DEFAULT_BASE).replace(/\/+$/, '');
    const model = String(e.AI_MODEL || e.ZHIPU_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
    const key = String(e.AI_API_KEY || e.ZHIPU_API_KEY || '').trim();
    return {base, model, keyConfigured: !!key, key, provider: /bigmodel\.cn/.test(base) ? 'zhipu' : 'openai-compatible', providerLabel: /bigmodel\.cn/.test(base) ? '智谱' : '兼容接口'};
  }

  async function generateReport(admin, body = {}, ip = null) {
    const stats = collectStats(body.date || (body.query && body.query.date));
    const cfg = aiConfig();
    let report = localReport(stats);
    let source = 'local';
    let error = null;
    if (banned(cfg.base) || banned(cfg.model)) {
      error = 'provider_not_allowed';
    } else if (!cfg.keyConfigured) {
      error = 'no_key';
    } else {
      const sys = '你是 VEXO 社区管理端的「AI 助理」。根据当日后台统计，用简体中文写一份给运营同事看的工作日报。要求：分「今日概况」「需要关注」「建议」三段，语气克制、具体，不要编造统计里没有的数字，不要输出密钥或内部地址，全文不超过 600 字。';
      const user = '统计（Asia/Shanghai）：\n' + JSON.stringify(stats, null, 2);
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 12000);
      try {
        const res = await doFetch(cfg.base + '/chat/completions', {
          method: 'POST', signal: ctl.signal,
          headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key},
          body: JSON.stringify({model: cfg.model, temperature: 0.3, max_tokens: 800, messages: [{role: 'system', content: sys}, {role: 'user', content: user}]}),
        });
        if (!res.ok) {
          let t = ''; try { t = (await res.text()).slice(0, 160); } catch {}
          throw new Error('http_' + res.status);
        }
        const j = await res.json();
        const content = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        const text = String(content || '').trim();
        if (text) { report = text; source = 'zhipu'; }
        else throw new Error('empty');
      } catch (e) {
        error = e && e.name === 'AbortError' ? 'timeout' : String(e && e.message || e).slice(0, 80);
      } finally {
        clearTimeout(timer);
      }
    }
    if (audit) audit(admin.id, 'admin.ai_assistant.report', 'ai-assistant', ip, {date: stats.date, source, adminUsername: admin.username});
    return {
      stats, report, source, error,
      model: cfg.model,
      provider: cfg.provider,
      providerLabel: cfg.providerLabel,
      keyConfigured: cfg.keyConfigured,
    };
  }

  return {
    editProfile, setFollowerBonus, addTag, removeTag, setTags, listTags, bulkDeleteTag,
    notifyOne, notifyMany, deleteUser, collectStats, generateReport, tagsOf, PRESET_TAGS, DELETE_CONFIRM,
  };
}
