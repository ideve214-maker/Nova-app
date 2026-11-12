// 楼中楼管理端、UTC 时间、真实成员数、收据 HEAD、操作审计 IP、公告编辑撤回。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';

let srv, base, seq = 0, adminTok;
test.before(async () => {
  srv = createApp({adminUsername: 'ops_fu', adminPassword: 'OpsFuPass1', scheduleAuto: false});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  const login = await call('POST', '/api/admin/auth/login', {username: 'ops_fu', password: 'OpsFuPass1'});
  adminTok = login.j.token;
});
test.after(() => srv.close());

function jpeg1() {
  return Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4uTk5OXl5+jp6Onq6err7O3s7ezt7u/v8PD//8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsLCwsLCwsPDx8PHx8fP0NHS09TV1tfY2drb3N3e3+Dh5OXm5+jp6Onq6err7Ozt7u/v8PHy8/T19vf4+fr7/9oADAMBAAIRAxEAPwDz+iiivlD+gD//2Q==',
    'base64');
}

const call = async (m, p, body, tok, {raw, headers} = {}) => {
  const payload = raw !== undefined ? raw : (body ? JSON.stringify(body) : undefined);
  const r = await fetch(base + p, {
    method: m,
    headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {}), ...(headers || {})},
    body: payload,
    redirect: 'manual',
  });
  const ct = r.headers.get('content-type') || '';
  const text = await r.text();
  const j = ct.includes('json') && text ? JSON.parse(text) : (text ? null : null);
  return {r, j, text, buf: Buffer.from(text || '', 'utf8'), status: r.status};
};

async function user(name) {
  seq += 1;
  const un = (name || 'fu') + seq + Date.now().toString(36);
  const r = await call('POST', '/api/auth/register', {username: un, email: un + '@x.test', password: 'Passw0rd123'});
  assert.equal(r.status, 200, text(r));
  return {tok: r.j.token, id: r.j.user.id, username: r.j.user.username};
}
function text(r) { return r.text || JSON.stringify(r.j); }

test('UTC：帖子、评论、消息带 epoch createdAt 与 ISO createdAtUtc', async () => {
  const a = await user('ta');
  const b = await user('tb');
  const p = await call('POST', '/api/posts', {text: 'utc-post'}, a.tok);
  assert.equal(p.status, 200, text(p));
  const post = p.j.post || p.j;
  assert.equal(typeof post.createdAt, 'number');
  assert.match(post.createdAtUtc, /Z$/);
  const before = Date.now() + 5000;
  assert.ok(post.createdAt <= before);
  const c = await call('POST', '/api/posts/' + post.id + '/comments', {text: 'utc-c'}, a.tok);
  const cm = c.j.comment || c.j;
  assert.equal(typeof cm.createdAt, 'number');
  assert.match(cm.createdAtUtc, /Z$/);
  srv.friends.setAccepted(a.id, b.id);
  const dm = await call('POST', '/api/conversations', {kind: 'dm', userId: b.id}, a.tok);
  const cid = (dm.j.conversation || dm.j).id;
  const m = await call('POST', '/api/conversations/' + cid + '/messages', {text: 'utc-m'}, a.tok);
  const msg = m.j.message || m.j;
  assert.equal(typeof msg.createdAt, 'number');
  assert.match(msg.createdAtUtc, /Z$/);
});

test('楼中楼：管理端内容接口能看到父评、层级与回复数', async () => {
  const a = await user('cm');
  const p = await call('POST', '/api/posts', {text: 'thread'}, a.tok);
  const pid = (p.j.post || p.j).id;
  const c1 = (await call('POST', '/api/posts/' + pid + '/comments', {text: '一层'}, a.tok)).j.comment;
  const c2 = (await call('POST', '/api/posts/' + pid + '/comments', {text: '二层', parentId: c1.id}, a.tok)).j.comment;
  const c3 = (await call('POST', '/api/posts/' + pid + '/comments', {text: '三层', parentId: c2.id}, a.tok)).j.comment;
  assert.equal(c3.depth, 2);
  assert.equal(c3.rootId, c1.id);
  assert.equal(c3.replyTo.id, c2.id);
  const got = await call('GET', '/api/admin/content/comment/' + c3.id, null, adminTok);
  assert.equal(got.status, 200, text(got));
  const item = got.j.item;
  assert.equal(item.parentId, c2.id);
  assert.equal(item.rootId, c1.id);
  assert.equal(item.depth, 2);
  assert.equal(item.replyTo.id, c2.id);
  assert.match(item.createdAtUtc, /Z$/);
  const p1 = await call('GET', '/api/admin/content/comment/' + c1.id, null, adminTok);
  assert.ok(p1.j.item.replyCount >= 1);
});

test('群聊与社区成员数：加入/退出后是真实 COUNT', async () => {
  const a = await user('ga');
  const b = await user('gb');
  const c = await user('gc');
  srv.friends.setAccepted(a.id, b.id);
  srv.friends.setAccepted(a.id, c.id);
  const g = await call('POST', '/api/conversations', {kind: 'group', name: '组', userIds: [b.id]}, a.tok);
  assert.equal(g.status, 200, text(g));
  const cv = g.j.conversation || g.j;
  assert.equal(cv.memberCount, 2);
  const add = await call('POST', '/api/conversations/' + cv.id + '/members', {userId: c.id}, a.tok);
  assert.equal(add.status, 200, text(add));
  const after = await call('GET', '/api/conversations/' + cv.id, null, a.tok);
  assert.equal((after.j.conversation || after.j).memberCount, 3);
  const leave = await call('POST', '/api/conversations/' + cv.id + '/leave', {}, c.tok);
  assert.equal(leave.status, 200, text(leave));
  const got = await call('GET', '/api/conversations/' + cv.id, null, a.tok);
  assert.equal((got.j.conversation || got.j).memberCount, 2);

  const comm = await call('POST', '/api/communities', {name: '社' + Date.now(), visibility: 'public'}, a.tok);
  const com = comm.j.community || comm.j;
  assert.equal(com.memberCount, 1);
  const jn = await call('POST', '/api/communities/' + com.id + '/join', {}, b.tok);
  assert.equal((jn.j.community || jn.j).memberCount, 2);
  const lv = await call('POST', '/api/communities/' + com.id + '/leave', {}, b.tok);
  // owner view
  const nowc = await call('GET', '/api/communities/' + com.id, null, a.tok);
  assert.equal((nowc.j.community || nowc.j).memberCount, 1);

  const adminList = await call('GET', '/api/admin/communities', null, adminTok);
  assert.equal(adminList.status, 200, text(adminList));
  const found = (adminList.j.communities || []).find(x => x.id === com.id);
  assert.ok(found, 'admin sees community');
  assert.equal(found.memberCount, 1);
  const one = await call('GET', '/api/admin/communities/' + com.id, null, adminTok);
  assert.equal(one.j.community.memberCount, 1);
  assert.equal(one.j.community.members.length, 1);
  assert.ok(Array.isArray(one.j.community.channels));
  const hall = (one.j.community.channels || [])[0];
  if (hall) {
    const chm = await call('POST', '/api/channels/' + hall.id + '/messages', {text: '频道实信'}, a.tok);
    assert.equal(chm.status, 200, text(chm));
    assert.match((chm.j.message || {}).createdAtUtc || '', /Z$/);
    const adminCh = await call('GET', '/api/admin/channels/' + hall.id + '/messages', null, adminTok);
    assert.equal(adminCh.status, 200, text(adminCh));
    assert.ok((adminCh.j.messages || []).some(m => m.text === '频道实信'));
  }
});

test('GET 与 HEAD /api/admin/payments/:id/receipt 均可用', async () => {
  const a = await user('pay');
  const o = await call('POST', '/api/pay/orders', {period: 'month', method: 'wechat'}, a.tok);
  assert.equal(o.status, 200, text(o));
  const oid = o.j.order.id;
  const jpeg = jpeg1();
  const up = await call('POST', '/api/pay/orders/' + oid + '/paid', {
    receipt: {mime: 'image/jpeg', name: 'shot.jpg', data: jpeg.toString('base64')},
  }, a.tok);
  assert.ok(up.status < 300, text(up));
  const get = await call('GET', '/api/admin/payments/' + oid + '/receipt', null, adminTok);
  assert.equal(get.status, 200, text(get));
  const clen = get.r.headers.get('content-length');
  const ctype = get.r.headers.get('content-type');
  const head = await fetch(base + '/api/admin/payments/' + oid + '/receipt', {
    method: 'HEAD',
    headers: {Authorization: 'Bearer ' + adminTok},
  });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-type'), ctype);
  assert.equal(head.headers.get('content-length'), clen);
  const body = Buffer.from(await head.arrayBuffer());
  assert.equal(body.length, 0);
});

test('管理操作审计记录请求 IP（非 null）', async () => {
  const a = await user('banme');
  const ban = await call('POST', '/api/admin/users/' + a.id + '/ban', {reason: 'test'}, adminTok);
  assert.equal(ban.status, 200, text(ban));
  const au = await call('GET', '/api/admin/audit?action=admin.user.ban&limit=5', null, adminTok);
  assert.equal(au.status, 200, text(au));
  const row = (au.j.audits || []).find(x => x.target && String(x.target).includes(a.id));
  assert.ok(row, 'ban audit present');
  assert.ok(row.ip && row.ip !== 'null' && String(row.ip).length > 0, 'ip=' + JSON.stringify(row.ip));
});

test('公告可编辑与撤回；撤回后 published=false', async () => {
  const add = await call('POST', '/api/admin/announcements', {title: '第一版', body: 'hello'}, adminTok);
  assert.equal(add.status, 200, text(add));
  const id = (add.j.announcement || add.j).id || (await call('GET', '/api/admin/announcements', null, adminTok)).j.announcements[0].id;
  const ed = await call('PATCH', '/api/admin/announcements/' + id, {title: '改了', body: '新正文'}, adminTok);
  assert.equal(ed.status, 200, text(ed));
  assert.equal(ed.j.announcement.title, '改了');
  assert.equal(ed.j.announcement.body, '新正文');
  assert.equal(ed.j.announcement.published, true);
  const wd = await call('POST', '/api/admin/announcements/' + id + '/withdraw', {}, adminTok);
  assert.equal(wd.status, 200, text(wd));
  assert.equal(wd.j.announcement.published, false);
  const again = await call('POST', '/api/admin/announcements/' + id + '/withdraw', {}, adminTok);
  assert.equal(again.status, 200);
  assert.equal(again.j.already, true);
  const au = await call('GET', '/api/admin/audit?action=admin.announcement&limit=10', null, adminTok);
  const ips = (au.j.audits || []).filter(x => /announcement/.test(x.action));
  assert.ok(ips.length >= 2);
  assert.ok(ips.every(x => x.ip && String(x.ip).length > 0));
});

test('退款撤销 VIP 时 vipRevoked 为 true（含幂等第二次）', async () => {
  const a = await user('vipr');
  const o = await call('POST', '/api/pay/orders', {period: 'month', method: 'wechat'}, a.tok);
  const oid = o.j.order.id;
  const jpeg = jpeg1();
  await call('POST', '/api/pay/orders/' + oid + '/paid', {
    receipt: {mime: 'image/jpeg', name: 'shot.jpg', data: jpeg.toString('base64')},
  }, a.tok);
  const ok = await call('POST', '/api/admin/payments/' + oid + '/confirm', {note: 'ok'}, adminTok);
  assert.equal(ok.status, 200, text(ok));
  const rf = await call('POST', '/api/admin/payments/' + oid + '/refund', {reason: 'test'}, adminTok);
  assert.equal(rf.status, 200, text(rf));
  assert.equal(rf.j.vipRevoked, true, JSON.stringify(rf.j));
  const rf2 = await call('POST', '/api/admin/payments/' + oid + '/refund', {reason: 'again'}, adminTok);
  assert.equal(rf2.status, 200, text(rf2));
  assert.equal(rf2.j.vipRevoked, true);
});
