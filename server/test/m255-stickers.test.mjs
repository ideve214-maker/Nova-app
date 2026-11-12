// M2.5.5 专属表情包：VIP 可选用；Basic 403；免费用户仍能看到目录并使用基础包；到期失效；未审核/未知贴纸拒绝。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';
import {STICKER_PACKS, findSticker} from '../stickers.mjs';

const DAY = 864e5, T0 = Date.UTC(2026, 10, 12, 14, 0, 0);
let T = T0, srv, base;
test.before(async () => { srv = createApp({clock: () => T}); await new Promise(r => srv.listen(0, r)); base = 'http://127.0.0.1:' + srv.address().port; });
test.after(() => srv.close());
const call = async (m, p, body, tok) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  return {s: r.status, j: await r.json()};
};
let n = 0;
const mk = async () => { const u = 'stk_' + (++n); const r = await call('POST', '/api/auth/register', {username: u, email: u + '@x.com', password: 'Passw0rd123'}); return {id: r.j.user.id, tok: r.j.token}; };
const setVip = (id, until) => srv.db.prepare('UPDATE users SET vip_until=?, vip_since=?, vip_source=? WHERE id=?').run(until, T0, 'admin', id);

test('目录公开：未登录也能看全部包（含专属包内容），专属包 usable=false；基础包人人可用', async () => {
  const r = await call('GET', '/api/stickers');
  assert.equal(r.s, 200);
  const ids = r.j.packs.map(p => p.id);
  assert.deepEqual(ids, ['basic', 'nova_gold']);
  const gold = r.j.packs.find(p => p.id === 'nova_gold');
  assert.equal(gold.premium, true); assert.equal(gold.usable, false);
  assert.equal(gold.items.length, 8); assert.ok(gold.items.every(i => i.glyph && i.name));
  assert.ok(gold.review.includes('白名单'));
  const basic = r.j.packs.find(p => p.id === 'basic');
  assert.equal(basic.usable, true); assert.equal(basic.premium, false);
  assert.match(r.j.policy, /所有人都能看到/);
});

test('选用：需要登录；基础包 Basic 可用；专属包 Basic 403 ENTITLEMENT_REQUIRED；VIP 可用；未知贴纸 404', async () => {
  assert.equal((await call('POST', '/api/stickers/use', {pack: 'basic', id: 'smile'})).s, 401);
  const {id, tok} = await mk();
  const b = await call('POST', '/api/stickers/use', {pack: 'basic', id: 'smile'}, tok);
  assert.equal(b.s, 200); assert.equal(b.j.sticker.glyph, '😊'); assert.equal(b.j.sticker.premium, false);
  const deny = await call('POST', '/api/stickers/use', {pack: 'nova_gold', id: 'gold_star'}, tok);
  assert.equal(deny.s, 403); assert.equal(deny.j.error.code, 'ENTITLEMENT_REQUIRED');
  assert.match(deny.j.error.message, /专属表情包/); assert.equal(deny.j.error.upgrade, true);
  // 目录对登录 Basic：专属仍不可用
  const cat = await call('GET', '/api/stickers', null, tok);
  assert.equal(cat.j.packs.find(p => p.id === 'nova_gold').usable, false);
  setVip(id, T0 + 5 * DAY);
  const catV = await call('GET', '/api/stickers', null, tok);
  assert.equal(catV.j.packs.find(p => p.id === 'nova_gold').usable, true);
  const ok = await call('POST', '/api/stickers/use', {pack: 'nova_gold', id: 'gold_cheers'}, tok);
  assert.equal(ok.s, 200); assert.equal(ok.j.sticker.glyph, '🥂'); assert.equal(ok.j.sticker.premium, true); assert.equal(ok.j.sticker.name, '香槟');
  assert.equal((await call('POST', '/api/stickers/use', {pack: 'nova_gold', id: 'not_real'}, tok)).s, 404);
  assert.equal((await call('POST', '/api/stickers/use', {pack: 'pirate', id: 'gold_star'}, tok)).j.error.code, 'STICKER_NOT_FOUND');
  // 只允许白名单：findSticker 不知道的组合不存在
  assert.equal(findSticker('nova_gold', 'gold_star').item.glyph, '🌟');
  assert.equal(findSticker('nova_gold', '../../x'), null);
});

test('到期后专属包立即不可用；基础包仍可用；夹带别人身份无效', async () => {
  T = T0;
  const a = await mk(), b = await mk();
  setVip(a.id, T0 + DAY);
  assert.equal((await call('POST', '/api/stickers/use', {pack: 'nova_gold', id: 'gold_moon'}, a.tok)).s, 200);
  T = T0 + DAY;
  const exp = await call('POST', '/api/stickers/use', {pack: 'nova_gold', id: 'gold_moon'}, a.tok);
  assert.equal(exp.s, 403); assert.equal(exp.j.error.code, 'ENTITLEMENT_REQUIRED'); assert.equal(exp.j.error.state, 'expired');
  assert.equal((await call('POST', '/api/stickers/use', {pack: 'basic', id: 'fire'}, a.tok)).s, 200, '到期后基础包仍可交流');
  const sneak = await call('POST', '/api/stickers/use', {pack: 'nova_gold', id: 'gold_star', userId: a.id}, b.tok);
  assert.equal(sneak.s, 403);
  T = T0;
  assert.equal(STICKER_PACKS[1].items.length, 8);
});

test('贴纸可作为消息入库：双方都看见对象；Basic 不能发专属包；撤回后不返回贴纸明文', async () => {
  const a = await mk(), b = await mk();
  srv.friends.setAccepted(a.id, b.id);
  const cv = (await call('POST', '/api/conversations', {kind: 'dm', userId: b.id}, a.tok)).j.conversation;
  const empty = await call('POST', '/api/conversations/' + cv.id + '/messages', {sticker: {pack: 'basic', id: 'smile'}}, a.tok);
  assert.equal(empty.s, 200, JSON.stringify(empty.j));
  assert.equal(empty.j.message.sticker.pack, 'basic');
  assert.equal(empty.j.message.sticker.id, 'smile');
  assert.equal(empty.j.message.sticker.glyph, '😊');
  assert.equal(empty.j.message.text, '😊');
  const asB = await call('GET', '/api/conversations/' + cv.id + '/messages', null, b.tok);
  assert.equal(asB.j.messages[0].sticker.glyph, '😊');
  const deny = await call('POST', '/api/conversations/' + cv.id + '/messages', {sticker: {pack: 'nova_gold', id: 'gold_cheers'}}, a.tok);
  assert.equal(deny.s, 403);
  assert.equal(deny.j.error.code, 'ENTITLEMENT_REQUIRED');
  const rec = await call('POST', '/api/messages/' + empty.j.message.id + '/recall', {}, a.tok);
  assert.equal(rec.s, 200, JSON.stringify(rec.j));
  assert.equal(rec.j.message.deleted, true);
  assert.equal(rec.j.message.text, '');
  assert.equal(rec.j.message.sticker, undefined);
});
