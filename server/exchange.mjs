// VEXO 2.0 技能交换：写下「我会什么 / 我想要什么」，按分类和搜索浏览；「咨询」直接打开与发布者的加密私聊。
// 没有申请/确认流程；发布者可以编辑或关闭。默认不公开联系方式、只做免费交换。
import {randomBytes} from 'node:crypto';
import {ApiError} from './errors.mjs';

export const EXCHANGE_CATEGORIES = Object.freeze([
  {key: 'lang', label: '语言'}, {key: 'dev', label: '编程开发'}, {key: 'design', label: '设计'}, {key: 'music', label: '音乐'},
  {key: 'sport', label: '运动健身'}, {key: 'photo', label: '摄影视频'}, {key: 'study', label: '学业辅导'}, {key: 'life', label: '生活技能'},
  {key: 'career', label: '职场商务'}, {key: 'craft', label: '手工艺'}, {key: 'other', label: '其他'},
]);
const CAT = new Set(EXCHANGE_CATEGORIES.map(c => c.key));
const nid = () => 'ex_' + randomBytes(12).toString('base64url');
const len = s => [...String(s == null ? '' : s)].length;
const MAX_OPEN = 10;

export function createExchange(db, {now, authorOf, friends, chats}) {
  const ins = db.prepare('INSERT INTO exchange_posts(id,user_id,category,offers,wants,note,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)');
  const byId = db.prepare('SELECT * FROM exchange_posts WHERE id=?');
  const nOpen = db.prepare("SELECT COUNT(*) AS n FROM exchange_posts WHERE user_id=? AND status='open'");
  const upd = db.prepare('UPDATE exchange_posts SET category=?, offers=?, wants=?, note=?, updated_at=? WHERE id=?');
  const setSt = db.prepare('UPDATE exchange_posts SET status=?, updated_at=?, removed_reason=? WHERE id=?');
  const listQ = db.prepare(`SELECT e.* FROM exchange_posts e JOIN users u ON u.id=e.user_id AND u.status='active'
    WHERE e.status='open' AND (? = '' OR e.category = ?)
      AND (? = '' OR e.offers LIKE ? OR e.wants LIKE ? OR e.note LIKE ?)
      AND (? IS NULL OR e.updated_at < ?)
    ORDER BY e.updated_at DESC LIMIT ?`);
  const mineQ = db.prepare("SELECT * FROM exchange_posts WHERE user_id=? AND status IN ('open','closed') ORDER BY updated_at DESC LIMIT 50");
  const admQ = db.prepare(`SELECT e.*, u.username FROM exchange_posts e LEFT JOIN users u ON u.id=e.user_id
    WHERE (? = '' OR e.offers LIKE ? OR e.wants LIKE ? OR e.note LIKE ? OR u.username LIKE ?) AND (? = 'all' OR e.status = ?)
    ORDER BY e.updated_at DESC LIMIT ? OFFSET ?`);

  function norm(b = {}) {
    const category = String(b.category || '');
    if (!CAT.has(category)) throw new ApiError(400, 'BAD_CATEGORY', '请选择一个分类');
    const offers = String(b.offers || '').trim(), wants = String(b.wants || '').trim(), note = String(b.note || '').trim();
    if (!len(offers) || len(offers) > 200) throw new ApiError(400, 'BAD_OFFERS', '「我会什么」请填 1–200 字');
    if (!len(wants) || len(wants) > 200) throw new ApiError(400, 'BAD_WANTS', '「我想要什么」请填 1–200 字');
    if (len(note) > 500) throw new ApiError(400, 'BAD_NOTE', '补充说明最多 500 字');
    return {category, offers, wants, note};
  }
  const textOf = b => [b && b.offers, b && b.wants, b && b.note].filter(x => typeof x === 'string' && x.trim()).join('\n');
  function pub(r, me) {
    if (!r) return null;
    const cat = EXCHANGE_CATEGORIES.find(c => c.key === r.category);
    return {id: r.id, author: authorOf(r.user_id), category: r.category, categoryLabel: cat ? cat.label : r.category,
      offers: r.offers, wants: r.wants, note: r.note || '', status: r.status, createdAt: r.created_at, updatedAt: r.updated_at,
      mine: !!(me && Number(me.id) === Number(r.user_id))};
  }
  function blockedEither(a, b) { try { return !!(friends && friends.isBlocked && (friends.isBlocked(a, b) || friends.isBlocked(b, a))); } catch { return false; } }
  function need(id, user, {owner = false} = {}) {
    const r = byId.get(id);
    if (!r || r.status === 'removed') throw new ApiError(404, 'NOT_FOUND', '这条技能交换不存在或已被移除');
    if (owner && Number(r.user_id) !== Number(user.id)) throw new ApiError(403, 'FORBIDDEN', '只能修改自己发布的技能交换');
    if (!owner && user && r.status !== 'open' && Number(r.user_id) !== Number(user.id)) throw new ApiError(404, 'NOT_FOUND', '这条技能交换已关闭');
    return r;
  }
  function create(user, body) {
    const v = norm(body);
    if (nOpen.get(Number(user.id)).n >= MAX_OPEN) throw new ApiError(429, 'TOO_MANY', '同时最多开放 ' + MAX_OPEN + ' 条技能交换，请先关闭旧的');
    const id = nid(), t = now();
    ins.run(id, Number(user.id), v.category, v.offers, v.wants, v.note, 'open', t, t);
    return {post: pub(byId.get(id), user)};
  }
  function list(user, q = {}) {
    if (q.mine === '1' || q.mine === 'true') return {posts: mineQ.all(Number(user.id)).map(r => pub(r, user)), categories: EXCHANGE_CATEGORIES};
    const cat = CAT.has(String(q.category || '')) ? String(q.category) : '';
    const term = String(q.q || '').trim().slice(0, 40), like = '%' + term + '%';
    const before = q.before != null && q.before !== '' && Number.isFinite(Number(q.before)) ? Number(q.before) : null;
    const limit = Math.min(Math.max(Number(q.limit) || 20, 1), 50);
    const rows = listQ.all(cat, cat, term, like, like, like, before, before, limit + 1).filter(r => !blockedEither(user.id, r.user_id));
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    return {posts: page.map(r => pub(r, user)), nextBefore: more ? page[page.length - 1].updated_at : null, categories: EXCHANGE_CATEGORIES};
  }
  function get(user, id) {
    const r = need(id, user);
    if (blockedEither(user.id, r.user_id)) throw new ApiError(404, 'NOT_FOUND', '这条技能交换不存在');
    return {post: pub(r, user)};
  }
  function edit(user, id, body) {
    const r = need(id, user, {owner: true});
    const v = norm({category: r.category, offers: r.offers, wants: r.wants, note: r.note, ...(body || {})});
    upd.run(v.category, v.offers, v.wants, v.note, now(), id);
    return {post: pub(byId.get(id), user)};
  }
  function setOpen(user, id, open) {
    const r = need(id, user, {owner: true});
    if (open && r.status !== 'open' && nOpen.get(Number(user.id)).n >= MAX_OPEN) throw new ApiError(429, 'TOO_MANY', '同时最多开放 ' + MAX_OPEN + ' 条技能交换');
    setSt.run(open ? 'open' : 'closed', now(), null, id);
    return {post: pub(byId.get(id), user)};
  }
  // 咨询：授予两人私聊许可，然后打开（或复用）加密私聊会话
  function consult(user, id) {
    const r = need(id, user);
    if (r.status !== 'open') throw new ApiError(403, 'CLOSED', '这条技能交换已关闭');
    if (Number(r.user_id) === Number(user.id)) throw new ApiError(400, 'SELF', '这是你自己发布的技能交换');
    if (blockedEither(user.id, r.user_id)) throw new ApiError(403, 'BLOCKED', '因拉黑无法私聊');
    chats.grantDm(user.id, r.user_id, 'exchange', id);
    const out = chats.openDm(user, r.user_id);
    return {...out, post: pub(r, user)};
  }
  function adminRow(r) { return {...pub(r, null), author: authorOf(r.user_id), username: r.username || null, removedReason: r.removed_reason || null}; }
  function adminList(q = {}) {
    const term = String(q.q || '').trim().slice(0, 80), like = '%' + term + '%';
    const st = ['all', 'open', 'closed', 'removed'].includes(q.status) ? q.status : 'all';
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200), offset = Math.max(Number(q.offset) || 0, 0);
    return {posts: admQ.all(term, like, like, like, like, st, st, limit, offset).map(adminRow), categories: EXCHANGE_CATEGORIES};
  }
  function adminRemove(id, reason) {
    const r = byId.get(id);
    if (!r) throw new ApiError(404, 'NOT_FOUND', '技能交换不存在');
    setSt.run('removed', now(), String(reason || '').slice(0, 200) || null, id);
    return {post: adminRow(byId.get(id))};
  }
  function adminRestore(id) {
    const r = byId.get(id);
    if (!r) throw new ApiError(404, 'NOT_FOUND', '技能交换不存在');
    setSt.run('closed', now(), null, id);
    return {post: adminRow(byId.get(id))};
  }
  return {norm, textOf, create, list, get, edit, setOpen, consult, adminList, adminRemove, adminRestore, CATEGORIES: EXCHANGE_CATEGORIES};
}
