// 个人收藏（M2.5.3）：只扩展用户自己的私有收藏额度，与群聊/社区公共置顶完全分开。
import {VipError} from './vip.mjs';

const KINDS = new Set(['post', 'message', 'channel']);
const kindName = {post: '动态', message: '消息', channel: '频道消息'};

export const PUBLIC_PIN_MAX = 5;  // 公共置顶名额，不受 VIP 影响，不得改大

function clip(s, n) {
  const t = [...String(s == null ? '' : s)];
  return t.slice(0, n).join('');
}

export function createSaved(db, {vip, now}) {
  const listQ = db.prepare('SELECT id, kind, target, title, excerpt, created_at FROM saved_items WHERE user_id=? ORDER BY id DESC');
  const countQ = db.prepare('SELECT COUNT(*) AS n FROM saved_items WHERE user_id=?');
  const getQ = db.prepare('SELECT * FROM saved_items WHERE user_id=? AND kind=? AND target=?');
  const getId = db.prepare('SELECT * FROM saved_items WHERE id=? AND user_id=?');
  const ins = db.prepare('INSERT INTO saved_items(user_id,kind,target,title,excerpt,created_at) VALUES(?,?,?,?,?,?)');
  const delId = db.prepare('DELETE FROM saved_items WHERE id=? AND user_id=?');
  const pub = r => ({id: r.id, kind: r.kind, target: r.target, title: r.title || '', excerpt: r.excerpt || '', createdAt: r.created_at});

  function quota(user) {
    const r = vip.requireEntitlement(user, 'personal_saved_items_plus');
    return {plan: r.plan, state: r.state, limit: r.value, count: countQ.get(user.id).n};
  }
  function list(user) {
    const q = quota(user);
    return {items: listQ.all(user.id).map(pub), count: q.count, limit: q.limit, plan: q.plan};
  }
  function add(user, {kind, target, title, excerpt}) {
    if (!KINDS.has(kind)) throw new VipError(400, 'BAD_KIND', '收藏类型不正确');
    const tgt = String(target || '').trim();
    if (!tgt || tgt.length > 80 || !/^[\w.:-]+$/.test(tgt)) throw new VipError(400, 'BAD_TARGET', '收藏对象不正确');
    const exist = getQ.get(user.id, kind, tgt);
    if (exist) { const q = quota(user); return {item: pub(exist), count: q.count, limit: q.limit, plan: q.plan, existed: true}; }
    const q = quota(user);
    vip.requireQuota(user, 'personal_saved_items_plus', {used: q.count, add: 1});
    const r = ins.run(user.id, kind, tgt, clip(title, 80) || (kindName[kind] || kind), clip(excerpt, 200), now());
    const row = getId.get(Number(r.lastInsertRowid), user.id);
    return {item: pub(row), count: q.count + 1, limit: q.limit, plan: q.plan, existed: false};
  }
  function remove(user, {id, kind, target}) {
    let row = null;
    if (id != null && id !== '') row = getId.get(Number(id), user.id);
    else if (kind && target) row = getQ.get(user.id, kind, String(target).trim());
    if (!row) throw new VipError(404, 'NOT_FOUND', '这条收藏不存在');
    delId.run(row.id, user.id);
    const q = quota(user);
    return {removed: pub(row), count: q.count, limit: q.limit, plan: q.plan};
  }
  return {list, add, remove, quota, PUBLIC_PIN_MAX};
}
