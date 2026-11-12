// M5.4.3 多设备同步：会话、已读、草稿按策略同步；设备撤销安全；考虑 E2EE 设备列表。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';

let srv, base, seq = 0;
test.before(async () => { srv = createApp(); await new Promise(r => srv.listen(0, '127.0.0.1', r)); base = 'http://127.0.0.1:' + srv.address().port; });
test.after(() => srv.close());
const call = async (m, p, body, tok) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  return {s: r.status, j: await r.json()};
};
async function acc(n) {
  const u = n + (++seq);
  const r = await call('POST', '/api/auth/register', {agree:true, username: u, email: u + '@x.test', password: 'Passw0rd123'});
  return {tok: r.j.token, id: r.j.user.id, u, pw: 'Passw0rd123'};
}

test('同步策略公开；草稿写入会通知同一用户；撤销当前设备被拒绝，撤销不影响 E2EE 设备列表约定', async () => {
  const a = await acc('sya'), b = await acc('syb');
  const pol = await call('GET', '/api/me/sync-policy', null, a.tok);
  assert.equal(pol.s, 200, JSON.stringify(pol.j));
  assert.ok(pol.j.policy.sessions && pol.j.policy.readState && pol.j.policy.drafts && pol.j.policy.e2eeDevices);
  assert.match(pol.j.policy.e2eeDevices, /pickle|私钥|不会自动撤销/);
  assert.match(pol.j.policy.drafts, /端到端/);
  // 第二台设备登录
  const login2 = await call('POST', '/api/auth/login', {account: a.u, password: a.pw});
  assert.equal(login2.s, 200);
  const tok2 = login2.j.token;
  const sess = await call('GET', '/api/me/sessions', null, a.tok);
  assert.ok(sess.j.sessions.length >= 2);
  assert.ok(Array.isArray(sess.j.e2eeDevices));
  assert.match(sess.j.e2eeNote || '', /不会自动撤销/);
  const cur = sess.j.sessions.find(s => s.current);
  assert.equal((await call('POST', '/api/me/sessions/revoke', {id: cur.id}, a.tok)).j.error.code, 'CURRENT_SESSION');
  // 草稿同步事件入库（同一用户的其他设备可经 SSE 收到）
  srv.friends.setAccepted(a.id, b.id);
  const cv = (await call('POST', '/api/conversations', {kind: 'dm', userId: b.id}, a.tok)).j.conversation;
  const d = await call('PUT', '/api/conversations/' + cv.id + '/draft', {text: '第二台也能看到的草稿'}, a.tok);
  assert.equal(d.s, 200);
  const ev = srv.db.prepare("SELECT * FROM chat_events WHERE user_id=? AND type='draft.sync' ORDER BY id DESC LIMIT 1").get(a.id);
  assert.ok(ev, '应有 draft.sync');
  const payload = JSON.parse(ev.payload);
  assert.equal(payload.draft.text, '第二台也能看到的草稿');
  const as2 = await call('GET', '/api/conversations/' + cv.id + '/draft', null, tok2);
  assert.equal(as2.j.draft.text, '第二台也能看到的草稿');
  // 撤销另一设备后其令牌失效，当前仍可用
  const other = sess.j.sessions.find(s => !s.current);
  const rv = await call('POST', '/api/me/sessions/revoke', {id: other.id}, a.tok);
  assert.equal(rv.s, 200);
  assert.equal((await call('GET', '/api/me', null, tok2)).s, 401);
  assert.equal((await call('GET', '/api/me', null, a.tok)).s, 200);
});
