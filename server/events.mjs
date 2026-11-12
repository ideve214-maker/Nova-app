// M4.3.4 SSE 推送。鉴权只用 Authorization 头，禁止把令牌放在 URL。
import {ApiError} from './errors.mjs';

export function createEvents(db, {now, maxPerUser = 4, heartbeatMs = 15000} = {}) {
  const ins = db.prepare('INSERT INTO chat_events(user_id,type,payload,created_at) VALUES(?,?,?,?)');
  const after = db.prepare('SELECT * FROM chat_events WHERE user_id=? AND id>? ORDER BY id ASC LIMIT ?');
  const clients = new Map();

  function write(res, id, type, payload) {
    try {
      res.write('id: ' + id + '\nevent: ' + type + '\ndata: ' + JSON.stringify(payload) + '\n\n');
    } catch { /* 连接已断 */ }
  }

  function publish(userIds, type, payload) {
    const t = now();
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const ids = [...new Set((userIds || []).map(Number).filter(n => Number.isInteger(n) && n > 0))];
    for (const uid of ids) {
      const r = ins.run(uid, type, data, t);
      const eid = Number(r.lastInsertRowid);
      const set = clients.get(uid);
      if (set) {
        const obj = typeof payload === 'string' ? JSON.parse(payload) : payload;
        for (const c of set) write(c.res, eid, type, obj);
      }
    }
  }

  function publishLive(userIds, type, payload) {
    // 仅推给当前在线连接，不写入 chat_events，因此重连不会重放。
    const ids = [...new Set((userIds || []).map(Number).filter(n => Number.isInteger(n) && n > 0))];
    const obj = typeof payload === 'string' ? (() => { try { return JSON.parse(payload); } catch { return {raw: payload}; } })() : payload;
    for (const uid of ids) {
      const set = clients.get(uid);
      if (!set) continue;
      for (const c of set) write(c.res, 'live', type, obj);
    }
  }

  function connectionCount(user) {
    const set = clients.get(Number(user.id));
    return set ? set.size : 0;
  }
  function assertCanSubscribe(user) {
    if (connectionCount(user) >= maxPerUser) {
      throw new ApiError(429, 'TOO_MANY_CONNECTIONS', '实时连接过多');
    }
  }
  function subscribe(user, res, {lastId} = {}) {
    const uid = Number(user.id);
    assertCanSubscribe(user);
    const set = clients.get(uid) || new Set();
    if (lastId) {
      const missed = after.all(uid, Number(lastId) || 0, 200);
      for (const e of missed) {
        let obj; try { obj = JSON.parse(e.payload); } catch { obj = {raw: e.payload}; }
        write(res, e.id, e.type, obj);
      }
    }
    function cleanup() {
      if (conn.dead) return;
      conn.dead = true;
      clearInterval(hb);
      set.delete(conn);
      if (!set.size) clients.delete(uid);
    }
    const conn = {res, cleanup, dead: false};
    set.add(conn);
    clients.set(uid, set);
    const hb = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { cleanup(); }
    }, heartbeatMs);
    res.on('close', cleanup);
    if (res.socket) res.socket.on('close', cleanup);
    return cleanup;
  }

  function closeAll() {
    for (const set of [...clients.values()]) {
      for (const c of [...set]) {
        try { c.cleanup && c.cleanup(); } catch {}
        try { c.res.end(); } catch {}
      }
    }
    clients.clear();
  }

  return {publish, publishLive, subscribe, closeAll, clients, maxPerUser, heartbeatMs, connectionCount, assertCanSubscribe};
}
