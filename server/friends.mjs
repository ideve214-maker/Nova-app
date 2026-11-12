// 双向好友与拉黑。M4.3.3 先提供门槛判断；申请/同意状态机在 M4.10 补齐。
export function createFriends(db, {now} = {}) {
  const get = db.prepare('SELECT * FROM friendships WHERE user_lo=? AND user_hi=?');
  const upsert = db.prepare(`INSERT INTO friendships(user_lo,user_hi,status,created_at,updated_at) VALUES(?,?,?,?,?)
    ON CONFLICT(user_lo,user_hi) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at`);
  const del = db.prepare('DELETE FROM friendships WHERE user_lo=? AND user_hi=?');
  const blkGet = db.prepare('SELECT 1 FROM blocks WHERE blocker_id=? AND blocked_id=?');
  const insBlk = db.prepare('INSERT OR IGNORE INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)');
  const delBlk = db.prepare('DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?');

  function pair(a, b) {
    a = Number(a); b = Number(b);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a === b) return null;
    return a < b ? [a, b] : [b, a];
  }
  function areFriends(a, b) {
    const p = pair(a, b); if (!p) return false;
    const r = get.get(p[0], p[1]);
    return !!(r && r.status === 'accepted');
  }
  function setAccepted(a, b) {
    const p = pair(a, b); if (!p) return false;
    const t = now();
    upsert.run(p[0], p[1], 'accepted', t, t);
    return true;
  }
  function remove(a, b) {
    const p = pair(a, b); if (!p) return;
    del.run(p[0], p[1]);
  }
  function isBlocked(a, b) {
    a = Number(a); b = Number(b);
    return !!(blkGet.get(a, b) || blkGet.get(b, a));
  }
  function block(a, b) {
    a = Number(a); b = Number(b);
    if (a === b) return;
    insBlk.run(a, b, now());
  }
  function unblock(a, b) { delBlk.run(Number(a), Number(b)); }
  return {areFriends, setAccepted, remove, isBlocked, block, unblock, enforce: true};
}
