// 账号注销（删除个人数据）与申诉。
import {randomBytes} from 'node:crypto';
import {ApiError} from './errors.mjs';

function nid(p) { return p + '_' + randomBytes(8).toString('hex'); }

export function createAccount(db, {now = Date.now, profile, hashPassword, verifyPassword, audit} = {}) {
  const userBy = db.prepare('SELECT * FROM users WHERE id=?');
  const userByLogin = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE OR email = ?');
  const setDeletedSafe = db.prepare(`UPDATE users SET username=?, email=?, password_hash=?, status='deleted', must_change_pw=0, vip_until=NULL WHERE id=?`);
  const delSess = db.prepare('DELETE FROM sessions WHERE user_id=?');
  const softPosts = db.prepare('UPDATE posts SET deleted_at=? WHERE author_id=? AND deleted_at IS NULL');
  const insAppeal = db.prepare(`INSERT INTO appeals(id,user_id,kind,body,related,status,created_at) VALUES(?,?,?,?,?,'pending',?)`);
  const appealBy = db.prepare('SELECT * FROM appeals WHERE id=?');
  const appealsByUser = db.prepare('SELECT * FROM appeals WHERE user_id=? ORDER BY created_at DESC LIMIT ?');
  const appealsList = db.prepare(`SELECT * FROM appeals WHERE (? IS NULL OR status=?) ORDER BY created_at DESC LIMIT ?`);
  const decide = db.prepare('UPDATE appeals SET status=?, decided_at=?, decided_by=?, decision_note=? WHERE id=?');
  const hooks = {};
  function attach(ex) { if (ex) Object.assign(hooks, ex); }
  function communityOf(id) {
    const cm = hooks.communities;
    if (!cm || !id || typeof cm.peek !== 'function') return null;
    return cm.peek(String(id));
  }

  function deleteAccount(user, body = {}) {
    if (!verifyPassword(String(body.password || ''), user.password_hash)) {
      throw new ApiError(401, 'BAD_CREDENTIALS', '密码不正确');
    }
    const confirm = body.confirm === true || body.confirm === 'yes' || body.confirm === '删除';
    if (!confirm) throw new ApiError(400, 'CONFIRM_REQUIRED', '请确认要注销账号（confirm=true）。建议先导出数据。');
    const u = userBy.get(user.id);
    if (!u || u.status === 'deleted') throw new ApiError(404, 'NOT_FOUND', '账号不存在');
    const un = 'deleted_' + u.id;
    const em = 'deleted_' + u.id + '@invalid.invalid';
    const pw = hashPassword(randomBytes(24).toString('base64url'));
    const t = now();
    db.exec('BEGIN');
    try {
      setDeletedSafe.run(un, em, pw, u.id);
      delSess.run(u.id);
      softPosts.run(t, u.id);
      try {
        db.prepare("UPDATE post_comments SET deleted_at=?, text='（已注销）' WHERE author_id=? AND deleted_at IS NULL").run(t, u.id);
      } catch {
        try { db.prepare("UPDATE post_comments SET deleted_at=?, text='（已注销）' WHERE user_id=? AND deleted_at IS NULL").run(t, u.id); } catch {}
      }
      try { db.prepare('DELETE FROM e2ee_devices WHERE user_id=?').run(u.id); } catch {}
      try { db.prepare('DELETE FROM e2ee_one_time_keys WHERE user_id=?').run(u.id); } catch {}
      try { db.prepare('DELETE FROM follows WHERE follower_id=? OR followee_id=?').run(u.id, u.id); } catch {}
      try { db.prepare("UPDATE friend_requests SET status='cancelled' WHERE from_id=? OR to_id=?").run(u.id, u.id); } catch {}
      try { db.prepare('DELETE FROM friends WHERE user_a=? OR user_b=?').run(u.id, u.id); } catch {}
      try { db.prepare('DELETE FROM personal_blockwords WHERE user_id=?').run(u.id); } catch {}
      try { db.prepare('DELETE FROM message_drafts WHERE user_id=?').run(u.id); } catch {}
      try { db.prepare('DELETE FROM saved_items WHERE user_id=?').run(u.id); } catch {}
      if (profile && typeof profile.clearFor === 'function') profile.clearFor(u.id);
      else {
        try { db.prepare("UPDATE profiles SET display_name='已注销用户', bio='', birthday=NULL, gender=NULL WHERE user_id=?").run(u.id); } catch {}
      }
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch {}
      throw e;
    }
    if (audit) audit(u.id, 'user.delete', 'user:' + u.id, body._ip || null, {username: u.username});
    return {deleted: true, userId: u.id};
  }

  function submitAppeal(user, body = {}) {
    const text = String(body.body || body.reason || body.text || '').trim();
    if ([...text].length < 4 || [...text].length > 4000) throw new ApiError(400, 'BAD_BODY', '请填写 4–4000 字的申诉说明');
    const kind = String(body.kind || 'other').slice(0, 32);
    let related = body.related || body.reportId || body.target || null;
    if (kind === 'community') {
      const cid = String(related || '').trim();
      if (!cid) throw new ApiError(400, 'BAD_RELATED', '请指定要申诉的社区');
      const info = communityOf(cid);
      if (!info) throw new ApiError(404, 'NOT_FOUND', '社区不存在');
      if (hooks.communities && typeof hooks.communities.canAppeal === 'function' && !hooks.communities.canAppeal(user, cid)) {
        throw new ApiError(403, 'FORBIDDEN', '只有这个社区的成员可以申诉');
      }
      related = cid;
    }
    const id = nid('ap');
    insAppeal.run(id, user.id, kind, text, related && String(related).slice(0, 80), now());
    if (audit) audit(user.id, 'user.appeal', 'appeal:' + id, body._ip || null, {kind});
    return {appeal: decorate(pub(appealBy.get(id)))};
  }

  function submitAppealWithPassword(body, {ip} = {}) {
    const id = String(body.account || body.username || body.email || '').trim().toLowerCase();
    const pw = String(body.password || '');
    if (!id || !pw) throw new ApiError(400, 'BAD_REQUEST', '请输入账号和密码');
    const u = userByLogin.get(id, id);
    if (!u || !verifyPassword(pw, u.password_hash)) throw new ApiError(401, 'BAD_CREDENTIALS', '账号或密码错误');
    if (u.status === 'deleted') throw new ApiError(404, 'NOT_FOUND', '账号不存在');
    return submitAppeal(u, {...body, _ip: ip});
  }

  function decorate(appeal) {
    if (!appeal) return appeal;
    if (appeal.kind === 'community' && appeal.related) {
      const info = communityOf(appeal.related);
      if (info) {
        appeal.community = {
          id: info.id, name: info.name, status: info.status || 'active',
          takedownReason: info.takedownReason || '', takenDownAt: info.takenDownAt || null,
        };
      }
    }
    return appeal;
  }
  function pub(r) {
    if (!r) return null;
    return {
      id: r.id, userId: r.user_id, kind: r.kind, body: r.body, related: r.related,
      status: r.status, createdAt: r.created_at, decidedAt: r.decided_at,
      decisionNote: r.decision_note || null,
    };
  }

  function listMine(user, q = {}) {
    const limit = Math.min(Math.max(Number(q.limit) || 30, 1), 100);
    return {appeals: appealsByUser.all(user.id, limit).map(r => decorate(pub(r)))};
  }

  function listAll(q = {}) {
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
    const status = q.status ? String(q.status) : null;
    return {appeals: appealsList.all(status, status, limit).map(r => decorate(pub(r)))};
  }

  function decideAppeal(admin, id, body = {}, ip = null) {
    const row = appealBy.get(id);
    if (!row) throw new ApiError(404, 'NOT_FOUND', '申诉不存在');
    const action = String(body.action || body.status || '').trim();
    if (action !== 'accept' && action !== 'reject' && action !== 'accepted' && action !== 'rejected') {
      throw new ApiError(400, 'BAD_ACTION', 'action 须为 accept 或 reject');
    }
    const status = (action === 'accept' || action === 'accepted') ? 'accepted' : 'rejected';
    const note = String(body.note || body.reason || '').trim().slice(0, 2000);
    decide.run(status, now(), admin.id, note || null, row.id);
    if (status === 'accepted' && (row.kind === 'ban' || body.unban)) {
      try { db.prepare("UPDATE users SET status='active' WHERE id=? AND status='banned'").run(row.user_id); } catch {}
    }
    if (status === 'accepted' && row.kind === 'community' && hooks.communities && row.related && typeof hooks.communities.restore === 'function') {
      try { hooks.communities.restore(String(row.related)); }
      catch (e) { if (!(e && (e.code === 'NOT_FOUND' || e.s === 404))) throw e; }
    }
    if (audit) audit(admin.id, 'admin.appeal.' + status, 'appeal:' + row.id, ip, {userId: row.user_id, note, adminUsername: admin.username});
    return {appeal: decorate(pub(appealBy.get(row.id)))};
  }

  function get(id) {
    const row = appealBy.get(id);
    if (!row) throw new ApiError(404, 'NOT_FOUND', '申诉不存在');
    return {appeal: decorate(pub(row))};
  }

  return {deleteAccount, submitAppeal, submitAppealWithPassword, listMine, listAll, decideAppeal, get, pub, attach};
}
