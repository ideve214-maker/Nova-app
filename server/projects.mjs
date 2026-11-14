// VEXO 2.0 共创项目（Sparks）：发起项目（目标、需要的技能），别人申请、负责人审批。
// 成员共享：项目群聊（复用群聊）、任务清单（添加/指派/完成/进度）、公告、共享链接和文件；完成后展示成果。
// 外部链接只做卡片（GitHub / 飞书 / 腾讯文档等），在系统浏览器里打开；不公开联系方式。
import {randomBytes} from 'node:crypto';
import {ApiError} from './errors.mjs';

const nid = p => p + randomBytes(12).toString('base64url');
const len = s => [...String(s == null ? '' : s)].length;
const MEDIA = /^md_[\w-]{6,80}$/;
const URL_RE = /^https?:\/\/[^\s<>"']{3,500}$/i;
const VISIBLE = new Set(['recruiting', 'active', 'completed']);

export function linkInfo(url) {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { return {provider: 'link', label: '链接', host: ''}; }
  const is = d => host === d || host.endsWith('.' + d);
  if (is('github.com')) return {provider: 'github', label: 'GitHub', host};
  if (is('gitee.com')) return {provider: 'gitee', label: 'Gitee', host};
  if (is('feishu.cn') || is('larksuite.com') || is('feishu.net')) return {provider: 'feishu', label: '飞书', host};
  if (is('docs.qq.com')) return {provider: 'tencent-docs', label: '腾讯文档', host};
  if (is('yuque.com')) return {provider: 'yuque', label: '语雀', host};
  if (is('notion.so') || is('notion.site')) return {provider: 'notion', label: 'Notion', host};
  if (is('figma.com')) return {provider: 'figma', label: 'Figma', host};
  return {provider: 'link', label: '链接', host};
}

export function createProjects(db, {now, authorOf, chats, notifications}) {
  const insP = db.prepare(`INSERT INTO projects(id,owner_id,title,goal,description,skills,category,capacity,status,conversation_id,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
  const byId = db.prepare('SELECT * FROM projects WHERE id=?');
  const updP = db.prepare('UPDATE projects SET title=?, goal=?, description=?, skills=?, category=?, capacity=?, updated_at=? WHERE id=?');
  const setSt = db.prepare('UPDATE projects SET status=?, updated_at=?, removed_reason=COALESCE(?,removed_reason) WHERE id=?');
  const setDone = db.prepare("UPDATE projects SET status='completed', showcase=?, completed_at=?, updated_at=? WHERE id=?");
  const memOf = db.prepare('SELECT * FROM project_members WHERE project_id=? AND user_id=?');
  const insM = db.prepare('INSERT INTO project_members(project_id,user_id,role,status,message,created_at,updated_at) VALUES(?,?,?,?,?,?,?)');
  const updM = db.prepare('UPDATE project_members SET status=?, message=COALESCE(?,message), updated_at=? WHERE project_id=? AND user_id=?');
  const setPRole = db.prepare("UPDATE project_members SET role=?, updated_at=? WHERE project_id=? AND user_id=? AND role<>'owner'");
  const byConv = db.prepare("SELECT * FROM projects WHERE conversation_id=? AND status<>'removed'");
  const members = db.prepare("SELECT * FROM project_members WHERE project_id=? AND status='active' ORDER BY role='owner' DESC, role='lead' DESC, created_at");
  const requests = db.prepare("SELECT * FROM project_members WHERE project_id=? AND status='requested' ORDER BY created_at");
  const nActive = db.prepare("SELECT COUNT(*) AS n FROM project_members WHERE project_id=? AND status='active'");
  const insT = db.prepare('INSERT INTO project_tasks(id,project_id,title,assignee_id,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)');
  const taskBy = db.prepare('SELECT * FROM project_tasks WHERE id=? AND deleted_at IS NULL');
  const tasks = db.prepare('SELECT * FROM project_tasks WHERE project_id=? AND deleted_at IS NULL ORDER BY status=\'done\', created_at');
  const updT = db.prepare('UPDATE project_tasks SET title=?, assignee_id=?, status=?, updated_at=?, done_at=? WHERE id=?');
  const delT = db.prepare('UPDATE project_tasks SET deleted_at=? WHERE id=?');
  const insPP = db.prepare('INSERT INTO project_posts(id,project_id,author_id,kind,title,body,url,media_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)');
  const ppBy = db.prepare('SELECT * FROM project_posts WHERE id=? AND deleted_at IS NULL');
  const pps = db.prepare('SELECT * FROM project_posts WHERE project_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 200');
  const delPP = db.prepare('UPDATE project_posts SET deleted_at=? WHERE id=?');
  const mediaBy = db.prepare('SELECT * FROM media WHERE id=?');
  const fileOfMember = db.prepare(`SELECT 1 FROM project_posts pp JOIN project_members m ON m.project_id=pp.project_id AND m.user_id=? AND m.status='active'
    JOIN projects p ON p.id=pp.project_id AND p.status!='removed' WHERE pp.media_id=? AND pp.deleted_at IS NULL LIMIT 1`);
  const listQ = db.prepare(`SELECT p.* FROM projects p JOIN users u ON u.id=p.owner_id AND u.status='active'
    WHERE p.status IN ('recruiting','active','completed') AND (? = '' OR p.status = ?)
      AND (? = '' OR p.title LIKE ? OR p.goal LIKE ? OR p.skills LIKE ? OR p.description LIKE ?)
      AND (? IS NULL OR p.updated_at < ?)
      -- 2.0.1：满员的项目不出现在共创列表 / 搜索里（成员在「我的」里照常能看到；有人退出后自动回来）
      AND (p.status = 'completed' OR (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id=p.id AND pm.status='active') < p.capacity)
    ORDER BY p.status='completed', p.updated_at DESC LIMIT ?`);
  const mineQ = db.prepare(`SELECT p.*, m.status AS my_status, m.role AS my_role FROM projects p JOIN project_members m ON m.project_id=p.id AND m.user_id=?
    WHERE m.status IN ('active','requested') AND p.status!='removed' ORDER BY p.updated_at DESC LIMIT 100`);
  const admQ = db.prepare(`SELECT p.*, u.username, (SELECT COUNT(*) FROM project_members m WHERE m.project_id=p.id AND m.status='active') AS n
    FROM projects p LEFT JOIN users u ON u.id=p.owner_id
    WHERE (? = '' OR p.title LIKE ? OR p.goal LIKE ? OR u.username LIKE ?) AND (? = 'all' OR p.status = ?)
    ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`);
  const tx = fn => { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

  function notify(uid, kind, title, body, id, actor) {
    if (!notifications) return;
    try { notifications.push(uid, {kind, title, body, refType: 'project', refId: id, actorId: actor, dedupeKey: kind + ':' + id + ':' + uid + ':' + now()}); } catch {}
  }
  function norm(b = {}, cur = null) {
    const g = k => (b[k] != null ? b[k] : cur ? cur[k] : undefined);
    const title = String(g('title') || '').trim(), goal = String(g('goal') || '').trim(), description = String(g('description') || '').trim();
    if (!len(title) || len(title) > 40) throw new ApiError(400, 'BAD_TITLE', '项目名称请填 1–40 字');
    if (!len(goal) || len(goal) > 200) throw new ApiError(400, 'BAD_GOAL', '项目目标请填 1–200 字');
    if (len(description) > 2000) throw new ApiError(400, 'BAD_DESC', '项目介绍最多 2000 字');
    let skills = g('skills');
    if (typeof skills === 'string') { try { skills = JSON.parse(skills); } catch { skills = skills.split(/[,，、\s]+/); } }
    skills = [...new Set((Array.isArray(skills) ? skills : []).map(x => String(x).trim()).filter(Boolean))];
    if (skills.length > 8) throw new ApiError(400, 'BAD_SKILLS', '需要的技能最多 8 个');
    for (const k of skills) if (len(k) > 20) throw new ApiError(400, 'BAD_SKILLS', '每个技能最多 20 字');
    const category = g('category') ? String(g('category')).slice(0, 20) : null;
    const capacity = g('capacity') == null || g('capacity') === '' ? 10 : Number(g('capacity'));
    if (!Number.isInteger(capacity) || capacity < 2 || capacity > 50) throw new ApiError(400, 'BAD_CAPACITY', '项目人数需为 2–50 人');
    return {title, goal, description, skills, category, capacity};
  }
  const textOf = b => [b && b.title, b && b.goal, b && b.description, ...((b && Array.isArray(b.skills)) ? b.skills : [])].filter(x => typeof x === 'string' && x.trim()).join('\n');
  function need(id) {
    const r = byId.get(id);
    if (!r || r.status === 'removed') throw new ApiError(404, 'NOT_FOUND', '项目不存在或已被移除');
    return r;
  }
  function activeMember(r, user) { const m = user && memOf.get(r.id, Number(user.id)); return m && m.status === 'active' ? m : null; }
  function requireMember(r, user) { const m = activeMember(r, user); if (!m) throw new ApiError(403, 'NOT_MEMBER', '只有项目成员可以操作'); return m; }
  function requireOwner(r, user) { if (Number(r.owner_id) !== Number(user.id)) throw new ApiError(403, 'NOT_OWNER', '只有项目负责人可以操作'); }
  function requireOpen(r) { if (r.status === 'completed' || r.status === 'cancelled') throw new ApiError(403, 'PROJECT_CLOSED', '项目已结束'); }
  function progress(id) {
    const all = tasks.all(id), done = all.filter(t => t.status === 'done').length;
    return {total: all.length, done, percent: all.length ? Math.round(done * 100 / all.length) : 0};
  }
  function pubTask(t) { return {id: t.id, title: t.title, status: t.status, assignee: t.assignee_id ? authorOf(t.assignee_id) : null, createdBy: t.created_by, createdAt: t.created_at, doneAt: t.done_at || null}; }
  function pubPost(pp) {
    const out = {id: pp.id, kind: pp.kind, title: pp.title || '', body: pp.body || '', author: authorOf(pp.author_id), createdAt: pp.created_at};
    if (pp.url) { out.url = pp.url; out.link = linkInfo(pp.url); }
    if (pp.media_id) { const m = mediaBy.get(pp.media_id); out.media = m && !m.deleted_at ? {id: m.id, kind: m.kind, name: m.name, size: m.size, mime: m.mime} : null; }
    return out;
  }
  function pub(r, me, {full = false} = {}) {
    if (!r) return null;
    let skills = []; try { skills = JSON.parse(r.skills || '[]'); } catch {}
    let showcase = null; try { showcase = r.showcase ? JSON.parse(r.showcase) : null; } catch {}
    const my = me ? memOf.get(r.id, Number(me.id)) : null;
    const isMember = !!(my && my.status === 'active');
    const out = {
      id: r.id, title: r.title, goal: r.goal, description: r.description || '', skills, category: r.category || null,
      capacity: r.capacity, memberCount: nActive.get(r.id).n, full: nActive.get(r.id).n >= r.capacity, status: r.status, owner: authorOf(r.owner_id),
      createdAt: r.created_at, updatedAt: r.updated_at, completedAt: r.completed_at || null, showcase,
      myStatus: my ? my.status : null, myRole: my ? my.role : null, isOwner: !!(me && Number(me.id) === Number(r.owner_id)),
      progress: progress(r.id),
    };
    if (full) {
      out.members = members.all(r.id).map(m => ({...authorOf(m.user_id), role: m.role, joinedAt: m.updated_at}));
      if (isMember) {
        out.conversationId = r.conversation_id || null;
        out.tasks = tasks.all(r.id).map(pubTask);
        const posts = pps.all(r.id).map(pubPost);
        out.notices = posts.filter(p => p.kind === 'notice');
        out.links = posts.filter(p => p.kind === 'link');
        out.files = posts.filter(p => p.kind === 'file');
      }
      if (out.isOwner) out.requests = requests.all(r.id).map(m => ({user: authorOf(m.user_id), message: m.message || '', at: m.created_at}));
    }
    return out;
  }

  function create(user, body) {
    const v = norm(body);
    const id = nid('pj_'), t = now();
    return tx(() => {
      const cv = chats.systemGroup(user.id, v.title);
      insP.run(id, Number(user.id), v.title, v.goal, v.description, JSON.stringify(v.skills), v.category, v.capacity, 'recruiting', cv, t, t);
      insM.run(id, Number(user.id), 'owner', 'active', '', t, t);
      return {project: pub(byId.get(id), user, {full: true})};
    });
  }
  function list(user, q = {}) {
    if (q.mine === '1' || q.mine === 'true') return {projects: mineQ.all(Number(user.id)).map(r => pub(r, user))};
    const st = VISIBLE.has(String(q.status || '')) ? String(q.status) : '';
    const term = String(q.q || '').trim().slice(0, 40), like = '%' + term + '%';
    const before = q.before != null && q.before !== '' && Number.isFinite(Number(q.before)) ? Number(q.before) : null;
    const limit = Math.min(Math.max(Number(q.limit) || 20, 1), 50);
    const rows = listQ.all(st, st, term, like, like, like, like, before, before, limit + 1);
    const more = rows.length > limit, page = rows.slice(0, limit);
    return {projects: page.map(r => pub(r, user)), nextBefore: more ? page[page.length - 1].updated_at : null};
  }
  function get(user, id) {
    const r = need(id);
    if (r.status === 'cancelled' && !activeMember(r, user)) throw new ApiError(404, 'NOT_FOUND', '项目不存在');
    return {project: pub(r, user, {full: true})};
  }
  function edit(user, id, body) {
    const r = need(id); requireOwner(r, user);
    const cur = {...r, skills: (() => { try { return JSON.parse(r.skills); } catch { return []; } })()};
    const v = norm(body || {}, cur);
    if (v.capacity < nActive.get(id).n) throw new ApiError(400, 'BAD_CAPACITY', '人数上限不能少于现有成员数');
    updP.run(v.title, v.goal, v.description, JSON.stringify(v.skills), v.category, v.capacity, now(), id);
    if (body && body.status && ['recruiting', 'active'].includes(body.status)) { requireOpen(r); setSt.run(body.status, now(), null, id); }
    return {project: pub(byId.get(id), user, {full: true})};
  }
  function apply(user, id, body = {}) {
    const r = need(id);
    if (r.status !== 'recruiting') throw new ApiError(403, 'NOT_RECRUITING', '项目当前不招募成员');
    const message = String(body.message || '').trim();
    if (len(message) > 200) throw new ApiError(400, 'BAD_MESSAGE', '申请留言最多 200 字');
    const m = memOf.get(id, Number(user.id));
    if (m && m.status === 'active') return {project: pub(r, user), already: true};
    if (m && m.status === 'requested') return {project: pub(r, user), already: true};
    if (m && m.status === 'removed') throw new ApiError(403, 'REMOVED', '你已被移出这个项目');
    if (nActive.get(id).n >= r.capacity) throw new ApiError(409, 'FULL', '项目成员已满');
    const t = now();
    if (m) updM.run('requested', message, t, id, Number(user.id)); else insM.run(id, Number(user.id), 'member', 'requested', message, t, t);
    const who = authorOf(user.id);
    notify(r.owner_id, 'project_apply', '有人申请加入项目', (who.displayName || who.username) + ' 申请加入「' + r.title + '」', id, user.id);
    return {project: pub(byId.get(id), user), already: false};
  }
  function decide(user, id, uid, approve) {
    const r = need(id); requireOwner(r, user); requireOpen(r);
    const m = memOf.get(id, Number(uid));
    if (!m || m.status !== 'requested') throw new ApiError(404, 'NOT_FOUND', '没有这条申请');
    if (approve) {
      if (nActive.get(id).n >= r.capacity) throw new ApiError(409, 'FULL', '项目成员已满');
      tx(() => {
        updM.run('active', null, now(), id, Number(uid));
        if (r.conversation_id) chats.systemAdd(r.conversation_id, uid);
      });
      notify(uid, 'project_decision', '项目申请已通过', '你已加入「' + r.title + '」，可以在项目群里打招呼了', id, user.id);
    } else {
      updM.run('rejected', null, now(), id, Number(uid));
      notify(uid, 'project_decision', '项目申请未通过', '「' + r.title + '」暂时没有通过你的申请', id, user.id);
    }
    return {project: pub(byId.get(id), user, {full: true})};
  }
  function leave(user, id) {
    const r = need(id);
    const m = requireMember(r, user);
    if (m.role === 'owner') throw new ApiError(400, 'OWNER_LEAVE', '发起人不能退出项目，可以结束或取消项目');
    updM.run('left', null, now(), id, Number(user.id));
    setPRole.run('member', now(), id, Number(user.id));
    if (r.conversation_id) chats.systemRemove(r.conversation_id, user.id);
    return {left: true};
  }
  function removeMember(user, id, uid) {
    const r = need(id); requireOwner(r, user);
    if (Number(uid) === Number(r.owner_id)) throw new ApiError(400, 'BAD_USER', '不能移出发起人');
    const m = memOf.get(id, Number(uid));
    if (!m || m.status !== 'active') throw new ApiError(404, 'NOT_FOUND', '对方不是项目成员');
    updM.run('removed', null, now(), id, Number(uid));
    setPRole.run('member', now(), id, Number(uid));
    if (r.conversation_id) chats.systemRemove(r.conversation_id, uid);
    return {project: pub(byId.get(id), user, {full: true})};
  }
  /* 2.0.1 负责人 = 项目群聊管理员（双向同步）：发起人在项目页设 / 取消负责人 → 同步群聊管理员；
     群主在项目群聊里设 / 取消管理员 → 同步项目负责人（syncFromChat，由 chats 的回调调用） */
  function setLead(user, id, uid, on) {
    const r = need(id); requireOwner(r, user);
    const n = Number(uid);
    if (n === Number(r.owner_id)) throw new ApiError(400, 'BAD_USER', '发起人不需要设为负责人');
    const m = memOf.get(id, n);
    if (!m || m.status !== 'active') throw new ApiError(404, 'NOT_FOUND', '对方不是项目成员');
    setPRole.run(on ? 'lead' : 'member', now(), id, n);
    if (r.conversation_id) { try { chats.systemSetRole(r.conversation_id, n, on ? 'admin' : 'member'); } catch {} }
    if (on) notify(n, 'project_lead', '你成为了项目负责人', '「' + r.title + '」的发起人把你设为负责人', id, user.id);
    return {project: pub(byId.get(id), user, {full: true})};
  }
  function syncFromChat(cvId, uid, chatRole) {
    const r = byConv.get(cvId);
    if (!r) return false;
    const m = memOf.get(r.id, Number(uid));
    if (!m || m.status !== 'active' || m.role === 'owner') return false;
    setPRole.run(chatRole === 'admin' ? 'lead' : 'member', now(), r.id, Number(uid));
    return true;
  }
  function memberId(r, v) {
    if (v == null || v === '') return null;
    const n = Number(v);
    const m = memOf.get(r.id, n);
    if (!m || m.status !== 'active') throw new ApiError(400, 'BAD_ASSIGNEE', '只能指派给项目成员');
    return n;
  }
  function addTask(user, id, body = {}) {
    const r = need(id); requireMember(r, user); requireOpen(r);
    const title = String(body.title || '').trim();
    if (!len(title) || len(title) > 80) throw new ApiError(400, 'BAD_TITLE', '任务请填 1–80 字');
    const assignee = memberId(r, body.assigneeId);
    const tid = nid('pt_'), t = now();
    insT.run(tid, id, title, assignee, 'todo', Number(user.id), t, t);
    if (assignee && assignee !== Number(user.id)) notify(assignee, 'project_task', '你有新的项目任务', '「' + r.title + '」：' + title, id, user.id);
    return {task: pubTask(taskBy.get(tid)), progress: progress(id)};
  }
  function updateTask(user, id, tid, body = {}) {
    const r = need(id); requireMember(r, user); requireOpen(r);
    const tk = taskBy.get(tid);
    if (!tk || tk.project_id !== id) throw new ApiError(404, 'NOT_FOUND', '任务不存在');
    const title = body.title != null ? String(body.title).trim() : tk.title;
    if (!len(title) || len(title) > 80) throw new ApiError(400, 'BAD_TITLE', '任务请填 1–80 字');
    const assignee = body.assigneeId !== undefined ? memberId(r, body.assigneeId) : tk.assignee_id;
    const status = body.status != null ? (body.status === 'done' ? 'done' : 'todo') : tk.status;
    updT.run(title, assignee, status, now(), status === 'done' ? (tk.done_at || now()) : null, tid);
    if (assignee && assignee !== tk.assignee_id && assignee !== Number(user.id)) notify(assignee, 'project_task', '你有新的项目任务', '「' + r.title + '」：' + title, id, user.id);
    return {task: pubTask(taskBy.get(tid)), progress: progress(id)};
  }
  function deleteTask(user, id, tid) {
    const r = need(id); requireMember(r, user);
    const tk = taskBy.get(tid);
    if (!tk || tk.project_id !== id) throw new ApiError(404, 'NOT_FOUND', '任务不存在');
    if (Number(tk.created_by) !== Number(user.id) && Number(r.owner_id) !== Number(user.id)) throw new ApiError(403, 'FORBIDDEN', '只有任务创建人或负责人能删除');
    delT.run(now(), tid);
    return {deleted: true, progress: progress(id)};
  }
  function addPost(user, id, body = {}) {
    const r = need(id); requireMember(r, user);
    const kind = String(body.kind || '');
    if (!['notice', 'link', 'file'].includes(kind)) throw new ApiError(400, 'BAD_KIND', '类型不正确');
    if (kind === 'notice') requireOwner(r, user);
    const title = String(body.title || '').trim(), text = String(body.body || '').trim();
    if (len(title) > 60) throw new ApiError(400, 'BAD_TITLE', '标题最多 60 字');
    if (len(text) > 2000) throw new ApiError(400, 'BAD_BODY', '内容最多 2000 字');
    let url = null, mediaId = null;
    if (kind === 'notice' && !len(text)) throw new ApiError(400, 'BAD_BODY', '请填写公告内容');
    if (kind === 'link') {
      url = String(body.url || '').trim();
      if (!URL_RE.test(url)) throw new ApiError(400, 'BAD_URL', '链接需以 http:// 或 https:// 开头');
    }
    if (kind === 'file') {
      mediaId = String(body.mediaId || '');
      const m = MEDIA.test(mediaId) && mediaBy.get(mediaId);
      if (!m || m.deleted_at) throw new ApiError(400, 'BAD_FILE', '文件不存在');
      if (Number(m.owner_id) !== Number(user.id)) throw new ApiError(403, 'BAD_FILE', '只能分享自己上传的文件');
    }
    const pid = nid('pp_');
    insPP.run(pid, id, Number(user.id), kind, title || (kind === 'link' ? linkInfo(url).label : ''), text, url, mediaId, now());
    if (kind === 'notice') for (const m of members.all(id)) if (Number(m.user_id) !== Number(user.id)) notify(m.user_id, 'project_notice', '项目公告', '「' + r.title + '」：' + (title || text).slice(0, 60), id, user.id);
    return {post: pubPost(ppBy.get(pid))};
  }
  function deletePost(user, id, pid) {
    const r = need(id); requireMember(r, user);
    const pp = ppBy.get(pid);
    if (!pp || pp.project_id !== id) throw new ApiError(404, 'NOT_FOUND', '内容不存在');
    if (Number(pp.author_id) !== Number(user.id) && Number(r.owner_id) !== Number(user.id)) throw new ApiError(403, 'FORBIDDEN', '只有发布人或负责人能删除');
    delPP.run(now(), pid);
    return {deleted: true};
  }
  function complete(user, id, body = {}) {
    const r = need(id); requireOwner(r, user); requireOpen(r);
    const summary = String(body.summary || '').trim();
    if (!len(summary) || len(summary) > 1000) throw new ApiError(400, 'BAD_SUMMARY', '成果介绍请填 1–1000 字');
    const links = (Array.isArray(body.links) ? body.links : []).slice(0, 6).map(l => {
      const url = String((l && l.url) || l || '').trim();
      if (!URL_RE.test(url)) throw new ApiError(400, 'BAD_URL', '成果链接需以 http:// 或 https:// 开头');
      return {url, title: String((l && l.title) || '').trim().slice(0, 40) || linkInfo(url).label, link: linkInfo(url)};
    });
    const show = {summary, links, at: now()};
    setDone.run(JSON.stringify(show), now(), now(), id);
    for (const m of members.all(id)) if (Number(m.user_id) !== Number(user.id)) notify(m.user_id, 'project_complete', '项目已完成', '「' + r.title + '」已完成，来看看成果吧', id, user.id);
    return {project: pub(byId.get(id), user, {full: true})};
  }
  function cancel(user, id) {
    const r = need(id); requireOwner(r, user); requireOpen(r);
    setSt.run('cancelled', now(), null, id);
    return {project: pub(byId.get(id), user)};
  }
  function canAccessMedia(user, mediaId) { try { return !!fileOfMember.get(Number(user.id), mediaId); } catch { return false; } }

  function adminRow(r) { return {...pub(r, null), owner: authorOf(r.owner_id), username: r.username || null, memberCount: r.n != null ? r.n : nActive.get(r.id).n, removedReason: r.removed_reason || null}; }
  function adminList(q = {}) {
    const term = String(q.q || '').trim().slice(0, 80), like = '%' + term + '%';
    const st = ['all', 'recruiting', 'active', 'completed', 'cancelled', 'removed'].includes(q.status) ? q.status : 'all';
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200), offset = Math.max(Number(q.offset) || 0, 0);
    return {projects: admQ.all(term, like, like, like, st, st, limit, offset).map(adminRow)};
  }
  function adminGet(id) {
    const r = byId.get(id);
    if (!r) throw new ApiError(404, 'NOT_FOUND', '项目不存在');
    return {project: {...adminRow(r), members: members.all(id).map(m => ({...authorOf(m.user_id), role: m.role})), tasks: tasks.all(id).map(pubTask), posts: pps.all(id).map(pubPost)}};
  }
  function adminRemove(id, reason) {
    const r = byId.get(id);
    if (!r) throw new ApiError(404, 'NOT_FOUND', '项目不存在');
    setSt.run('removed', now(), String(reason || '').slice(0, 200) || null, id);
    return {project: adminRow(byId.get(id))};
  }
  function adminRestore(id) {
    const r = byId.get(id);
    if (!r) throw new ApiError(404, 'NOT_FOUND', '项目不存在');
    setSt.run(r.completed_at ? 'completed' : 'active', now(), null, id);
    return {project: adminRow(byId.get(id))};
  }
  /* 2.0.1 公开落地页（/p/<id>）：只给标题、目标、介绍、技能、状态和人数；不含成员、任务、文件、群聊 */
  function publicCard(id) {
    const r = byId.get(String(id || ''));
    if (!r || r.status === 'removed') return null;
    let skills = []; try { skills = JSON.parse(r.skills || '[]'); } catch {}
    let showcase = null; try { showcase = r.showcase ? JSON.parse(r.showcase) : null; } catch {}
    return {id: r.id, title: r.title, goal: r.goal, description: String(r.description || '').slice(0, 600), skills: skills.slice(0, 8),
      status: r.status, memberCount: nActive.get(r.id).n, capacity: r.capacity,
      showcase: r.status === 'completed' && showcase ? String(showcase.summary || '').slice(0, 300) : ''};
  }
  return {setLead, syncFromChat, publicCard, norm, textOf, create, list, get, edit, apply, decide, leave, removeMember, addTask, updateTask, deleteTask, addPost, deletePost,
    complete, cancel, canAccessMedia, adminList, adminGet, adminRemove, adminRestore, linkInfo};
}
