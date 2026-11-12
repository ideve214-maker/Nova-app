// M3.5.1 用户提交举报；M3.5.2 管理端队列与详情（私聊仅勾选消息 + 访问审计）；M3.5.4 结论通知双方。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';

let srv, base, seq = 0, adminTok;
test.before(async () => {
  srv = createApp({adminUsername: 'ops_rep', adminPassword: 'OpsRepPass1'});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  const login = await call('POST', '/api/admin/auth/login', {username: 'ops_rep', password: 'OpsRepPass1'});
  adminTok = login.j.token;
});
test.after(() => srv.close());
const call = async (m, p, body, tok) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  return {s: r.status, j: await r.json()};
};
async function acc(n) {
  const u = n + (++seq);
  const r = await call('POST', '/api/auth/register', {agree:true, username: u, email: u + '@x.test', password: 'Passw0rd123'});
  return {tok: r.j.token, id: r.j.user.id, u};
}

test('未登录 401；缺原因 400；目标不存在 404；帖子举报成功', async () => {
  assert.equal((await call('POST', '/api/reports', {targetType: 'post', targetId: 'x', reason: 'spam'})).s, 401);
  const a = await acc('ra'), b = await acc('rb');
  assert.equal((await call('POST', '/api/reports', {targetType: 'post', targetId: 'nope', reason: 'spam'}, a.tok)).s, 404);
  assert.equal((await call('POST', '/api/reports', {targetType: 'user', targetId: String(b.id)}, a.tok)).s, 400); // no reason
  const post = await call('POST', '/api/posts', {text: '欢迎来看看我的店'}, b.tok);
  assert.equal(post.s, 200, JSON.stringify(post.j));
  const r = await call('POST', '/api/reports', {targetType: 'post', targetId: post.j.post.id, reason: '垃圾广告', detail: '像是引流'}, a.tok);
  assert.equal(r.s, 200, JSON.stringify(r.j));
  assert.equal(r.j.report.status, 'pending');
  assert.equal(r.j.report.targetType, 'post');
  assert.equal(r.j.report.targetId, post.j.post.id);
  assert.equal(r.j.report.targetUserId, b.id);
  assert.ok(String(r.j.report.id).startsWith('rp_'));
  const self = await call('POST', '/api/reports', {targetType: 'user', targetId: a.id, reason: 'abuse'}, a.tok);
  assert.equal(self.s, 400);
});

test('私聊举报只接受用户勾选的 messageIds；不能带入别人会话的消息', async () => {
  const a = await acc('rc'), b = await acc('rd'), c = await acc('re');
  srv.friends.setAccepted(a.id, b.id);
  srv.friends.setAccepted(a.id, c.id);
  const cvAb = (await call('POST', '/api/conversations', {kind: 'dm', userId: b.id}, a.tok)).j.conversation;
  const m1 = (await call('POST', '/api/conversations/' + cvAb.id + '/messages', {text: '秘密一'}, a.tok)).j.message;
  const m2 = (await call('POST', '/api/conversations/' + cvAb.id + '/messages', {text: '秘密二 请举我'}, b.tok)).j.message;
  const m3 = (await call('POST', '/api/conversations/' + cvAb.id + '/messages', {text: '秘密三 不要给管理员看'}, a.tok)).j.message;
  const cvAc = (await call('POST', '/api/conversations', {kind: 'dm', userId: c.id}, a.tok)).j.conversation;
  const mOther = (await call('POST', '/api/conversations/' + cvAc.id + '/messages', {text: '另一段对话'}, c.tok)).j.message;

  const noIds = await call('POST', '/api/reports', {targetType: 'conversation', targetId: cvAb.id, reason: '骚扰'}, a.tok);
  assert.equal(noIds.s, 400);
  assert.equal(noIds.j.error.code, 'BAD_MESSAGE_IDS');

  // 试图夹带另一会话的消息
  const sneak = await call('POST', '/api/reports', {
    targetType: 'message', targetId: m2.id, reason: '骚扰',
    messageIds: [m2.id, mOther.id],
    context: {conversationId: cvAb.id},
  }, a.tok);
  assert.ok(sneak.s === 400 || sneak.s === 403, JSON.stringify(sneak.j));

  const ok = await call('POST', '/api/reports', {
    targetType: 'message', targetId: m2.id, reason: '骚扰', detail: '只想交这一条',
    messageIds: [m2.id],
    context: {conversationId: cvAb.id},
  }, a.tok);
  assert.equal(ok.s, 200, JSON.stringify(ok.j));
  assert.deepEqual(ok.j.report.messageIds, [m2.id]);

  // 详情：只有勾选的那条，没有秘密一/三，也没有另一会话
  const detail = await call('GET', '/api/admin/reports/' + ok.j.report.id, null, adminTok);
  assert.equal(detail.s, 200, JSON.stringify(detail.j));
  const msgs = detail.j.report.messages;
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].id, m2.id);
  assert.equal(msgs[0].text, '秘密二 请举我');
  const blob = JSON.stringify(detail.j);
  assert.doesNotMatch(blob, /秘密一/);
  assert.doesNotMatch(blob, /秘密三/);
  assert.doesNotMatch(blob, /另一段对话/);

  // 访问写了审计
  const audits = srv.db.prepare("SELECT action,target,detail FROM audit_log WHERE action='admin.report.view' AND target=?").all('report:' + ok.j.report.id);
  assert.ok(audits.length >= 1);

  // 管理员列表
  const list = await call('GET', '/api/admin/reports?status=pending', null, adminTok);
  assert.equal(list.s, 200);
  assert.ok(list.j.reports.some(r => r.id === ok.j.report.id));
  assert.equal(list.j.reports.find(r => r.id === ok.j.report.id).queueStatus, 'open');
  // 列表本身不应带上未勾选的正文
  assert.doesNotMatch(JSON.stringify(list.j), /秘密三/);

  // 普通用户不能看队列
  assert.equal((await call('GET', '/api/admin/reports/' + ok.j.report.id, null, a.tok)).s, 403);
});

test('处理结论通知双方；同一 dedupeKey 不重复；审计接口可查', async () => {
  const a = await acc('rf'), b = await acc('rg');
  const sub = await call('POST', '/api/reports', {targetType: 'user', targetId: b.id, reason: '人身攻击', detail: '多次辱骂'}, a.tok);
  assert.equal(sub.s, 200, JSON.stringify(sub.j));
  const id = sub.j.report.id;
  const dec = await call('POST', '/api/admin/reports/' + id + '/decision', {action: 'resolve', note: '已警告对方', notify: true}, adminTok);
  assert.equal(dec.s, 200, JSON.stringify(dec.j));
  assert.equal(dec.j.report.status, 'resolved');
  assert.equal(dec.j.report.queueStatus, 'done');

  const na = await call('GET', '/api/notifications', null, a.tok);
  const nb = await call('GET', '/api/notifications', null, b.tok);
  const itemsA = na.j.notifications || [];
  const itemsB = nb.j.notifications || [];
  const ra = itemsA.find(n => n.kind === 'report_result' && n.refId === id);
  const rb = itemsB.find(n => n.kind === 'report_result' && n.refId === id);
  assert.ok(ra, '举报人应收到通知: ' + JSON.stringify(na.j).slice(0, 400));
  assert.ok(rb, '被举报人应收到通知: ' + JSON.stringify(nb.j).slice(0, 400));
  assert.equal(rb.refType, 'report');
  const drow = srv.db.prepare('SELECT dedupe_key FROM notifications WHERE ref_id=? AND user_id=?').get(id, a.id);
  assert.equal(drow.dedupe_key, 'report:' + id + ':result');
  assert.match(ra.body, /申诉|再次举报|联系/);
  assert.match(rb.body, /申诉|联系/);

  const countBefore = srv.db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE dedupe_key=?').get('report:' + id + ':result').n;
  await call('POST', '/api/admin/reports/' + id + '/decision', {action: 'resolve', note: '再发一次', notify: true}, adminTok);
  const countAfter = srv.db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE dedupe_key=?').get('report:' + id + ':result').n;
  assert.equal(countAfter, countBefore, '同一 dedupeKey 不应再插入');

  const rejUser = await acc('rh');
  const sub2 = await call('POST', '/api/reports', {targetType: 'user', targetId: rejUser.id, reason: '垃圾广告'}, a.tok);
  const rej = await call('POST', '/api/admin/reports/' + sub2.j.report.id + '/decision', {action: 'reject', note: '证据不足'}, adminTok);
  assert.equal(rej.j.report.status, 'rejected');

  const aud = await call('GET', '/api/admin/audit', null, adminTok);
  assert.equal(aud.s, 200);
  assert.ok(Array.isArray(aud.j.audits));
  assert.ok(aud.j.audits.some(x => x.action === 'admin.report.decision'));
  assert.ok(aud.j.audits.some(x => x.action === 'admin.report.view' || x.action === 'admin.login'));
  assert.equal((await call('GET', '/api/admin/audit', null, a.tok)).s, 403);
});
