// M5.3.4 屏蔽词：用户个人屏蔽只影响自己的阅读；平台规则在写入时拦截。二者分开存储与管理。
import {ApiError} from './errors.mjs';

const MAX_WORD = 40;
const MAX_PERSONAL = 100;
const HIDDEN = '【已按你的屏蔽词隐藏】';

export function normalizeWord(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
export function validWord(w) {
  const n = normalizeWord(w);
  const L = [...n].length;
  return n && L >= 1 && L <= MAX_WORD;
}

export function createBlockwords(db, {now} = {}) {
  const platAll = db.prepare('SELECT * FROM platform_blockwords ORDER BY id DESC');
  const platBy = db.prepare('SELECT * FROM platform_blockwords WHERE id=?');
  const platWord = db.prepare('SELECT * FROM platform_blockwords WHERE word=?');
  const insPlat = db.prepare('INSERT INTO platform_blockwords(word,note,created_at,created_by) VALUES(?,?,?,?)');
  const delPlat = db.prepare('DELETE FROM platform_blockwords WHERE id=?');
  const mine = db.prepare('SELECT word, created_at FROM personal_blockwords WHERE user_id=? ORDER BY created_at DESC');
  const mineN = db.prepare('SELECT COUNT(*) AS n FROM personal_blockwords WHERE user_id=?');
  const getMine = db.prepare('SELECT * FROM personal_blockwords WHERE user_id=? AND word=?');
  const insMine = db.prepare('INSERT INTO personal_blockwords(user_id,word,created_at) VALUES(?,?,?)');
  const delMine = db.prepare('DELETE FROM personal_blockwords WHERE user_id=? AND word=?');

  function pubPlat(r) {
    return {id: r.id, word: r.word, note: r.note || '', createdAt: r.created_at, createdBy: r.created_by || null, scope: 'platform'};
  }
  function hits(text, words) {
    const t = String(text || '').toLowerCase();
    if (!t) return [];
    return (words || []).filter(w => w && t.includes(w));
  }
  function platformList() {
    return platAll.all().map(r => r.word);
  }
  function platformHits(text) {
    return hits(text, platformList());
  }
  function assertPlatform(text, {label} = {}) {
    const h = platformHits(text);
    if (h.length) throw new ApiError(400, 'BLOCKED_WORD', '内容包含平台禁止的词语', {words: h, scope: 'platform'});
    return true;
  }
  function personalList(user) {
    if (!user) return [];
    return mine.all(user.id).map(r => r.word);
  }
  function personalHits(text, user) {
    return hits(text, personalList(user));
  }
  function personalFilter(text, user, authorId) {
    if (!user || (authorId != null && Number(authorId) === Number(user.id))) return null;
    const h = personalHits(text, user);
    if (!h.length) return null;
    return {text: HIDDEN, filtered: true, filteredBy: 'personal', hits: h};
  }

  function listPlatform() {
    return {blockwords: platAll.all().map(pubPlat), scope: 'platform'};
  }
  function addPlatform(admin, body = {}) {
    const word = normalizeWord(body.word);
    if (!validWord(word)) throw new ApiError(400, 'BAD_WORD', '屏蔽词为 1–40 个字');
    const exist = platWord.get(word);
    if (exist) return {blockword: pubPlat(exist), existed: true};
    const r = insPlat.run(word, String(body.note || '').slice(0, 200), now(), admin && admin.id);
    return {blockword: pubPlat(platBy.get(Number(r.lastInsertRowid))), existed: false};
  }
  function removePlatform(admin, id) {
    const row = platBy.get(Number(id));
    if (!row) throw new ApiError(404, 'NOT_FOUND', '这条平台屏蔽词不存在');
    delPlat.run(row.id);
    return {removed: pubPlat(row)};
  }

  function listPersonal(user) {
    return {blockwords: mine.all(user.id).map(r => ({word: r.word, createdAt: r.created_at, scope: 'personal'})), count: mineN.get(user.id).n, limit: MAX_PERSONAL, scope: 'personal'};
  }
  function addPersonal(user, body = {}) {
    const word = normalizeWord(body.word);
    if (!validWord(word)) throw new ApiError(400, 'BAD_WORD', '屏蔽词为 1–40 个字');
    const exist = getMine.get(user.id, word);
    if (exist) return {blockword: {word, createdAt: exist.created_at, scope: 'personal'}, existed: true, count: mineN.get(user.id).n, limit: MAX_PERSONAL};
    const n = mineN.get(user.id).n;
    if (n >= MAX_PERSONAL) throw new ApiError(403, 'QUOTA', '个人屏蔽词最多 ' + MAX_PERSONAL + ' 个');
    insMine.run(user.id, word, now());
    return {blockword: {word, createdAt: now(), scope: 'personal'}, existed: false, count: n + 1, limit: MAX_PERSONAL};
  }
  function removePersonal(user, body = {}) {
    const word = normalizeWord(body.word);
    const row = getMine.get(user.id, word);
    if (!row) throw new ApiError(404, 'NOT_FOUND', '这条屏蔽词不存在');
    delMine.run(user.id, word);
    return {removed: {word, scope: 'personal'}, count: mineN.get(user.id).n};
  }

  return {
    platformHits, assertPlatform, personalHits, personalFilter, personalList, platformList,
    listPlatform, addPlatform, removePlatform,
    listPersonal, addPersonal, removePersonal,
    HIDDEN, MAX_PERSONAL,
  };
}
