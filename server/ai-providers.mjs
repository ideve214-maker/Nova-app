// 2.0.7 管理端 AI 服务商：可以在管理端添加 / 修改 / 删除各家 AI 接口，并选一家作为“当前使用”。
// AI 助手、广告文案、AI 自动发帖都走“当前使用”的这一家；联网搜索只有智谱支持，当前这家不支持时自动改用智谱。
//
// 安全规则：
// 1. 密钥只存在服务端：AES-256-GCM 加密后存 ai_providers.key_enc。加密用的密钥优先取环境变量 ADMIN_AI_KEY_SECRET，
//    没有就在数据库同一目录生成 ai-keys.secret（权限 600）；内存数据库（测试）用进程内随机密钥。
// 2. 任何接口都只返回打码后的密钥（sk-…abcd），永远不返回完整密钥；也不写进日志和审计。
// 3. 服务器 .env 里原来的智谱密钥（AI_API_KEY / ZHIPU_API_KEY + AI_API_BASE）作为固定的“服务器默认”服务商（id = env），
//    不能在管理端删除；没选别家或别家不可用时一律退回它，所以部署后原有功能不受影响。
// 4. 按之前的决定不使用 DeepSeek：类型列表里保留（余额接口已写好），但不能添加或设为当前使用。
// 5. 这里没有任何付款、退款、充值相关能力；这些接口也不允许 AI 助手代调（见 ai-quota.mjs 的路由）。
import {createCipheriv, createDecipheriv, createHash, randomBytes} from 'node:crypto';
import {existsSync, readFileSync, writeFileSync, chmodSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {ApiError} from './errors.mjs';
import {DEFAULT_AI_MODEL} from './ai-model.mjs';

export const ZHIPU_BASE = 'https://open.bigmodel.cn/api/paas/v4';
export const ENV_ID = 'env';

/** 支持的服务商类型。balance = 有没有官方 / 控制台余额接口（见 ai-quota.mjs 的 BALANCE_ADAPTERS）。 */
export const PROVIDER_TYPES = [
  {type: 'zhipu', name: '智谱 AI', base: ZHIPU_BASE, model: DEFAULT_AI_MODEL, search: true, balance: true, currency: 'CNY', note: '支持联网搜索；余额来自智谱控制台接口'},
  {type: 'moonshot', name: 'Kimi（月之暗面）', base: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', search: false, balance: true, currency: 'CNY', note: '官方余额接口'},
  {type: 'siliconflow', name: '硅基流动', base: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-7B-Instruct', search: false, balance: true, currency: 'CNY', note: '余额接口（官方可能已停用，失败时改为估算）'},
  {type: 'openrouter', name: 'OpenRouter', base: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini', search: false, balance: true, currency: 'USD', note: '官方 Credits / Key 额度接口'},
  {type: 'dashscope', name: '阿里云百炼（通义千问）', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-turbo', search: false, balance: false, currency: 'CNY', note: 'API Key 查不到余额，按本地用量估算'},
  {type: 'openai', name: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-4o-mini', search: false, balance: false, currency: 'USD', note: 'API Key 查不到余额，按本地用量估算'},
  {type: 'custom', name: '其他 OpenAI 兼容接口', base: '', model: '', search: false, balance: false, currency: 'CNY', note: '按本地用量估算'},
  {type: 'deepseek', name: 'DeepSeek', base: 'https://api.deepseek.com', model: 'deepseek-chat', search: false, balance: true, currency: 'CNY', blocked: true, note: '按之前的决定暂不使用 DeepSeek'},
];
const TYPE = new Map(PROVIDER_TYPES.map(t => [t.type, t]));
export const typeInfo = t => TYPE.get(t) || TYPE.get('custom');
const banned = s => /deepseek/i.test(String(s || ''));

/** 打码：只露前 3 位和后 4 位，例如 sk-…abcd；太短的只显示 ****。 */
export function maskKey(k) {
  const s = String(k || '');
  if (!s) return '';
  if (s.length < 10) return '****';
  return s.slice(0, 3) + '…' + s.slice(-4);
}

/** 加解密：v1:<iv>.<tag>.<密文>（base64url）。 */
export function createKeyBox({secret, dbPath} = {}) {
  let key;
  if (secret) key = createHash('sha256').update(String(secret)).digest();
  else if (dbPath && dbPath !== ':memory:') {
    const f = join(dirname(dbPath), 'ai-keys.secret');
    if (existsSync(f)) key = Buffer.from(readFileSync(f, 'utf8').trim(), 'base64');
    if (!key || key.length !== 32) {
      key = randomBytes(32);
      writeFileSync(f, key.toString('base64') + '\n', {mode: 0o600});
      try { chmodSync(f, 0o600); } catch {}
    }
  } else key = randomBytes(32);
  return {
    seal(plain) {
      const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv);
      const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
      return 'v1:' + [iv, c.getAuthTag(), ct].map(b => b.toString('base64url')).join('.');
    },
    open(sealed) {
      const m = /^v1:([^.]+)\.([^.]+)\.(.+)$/.exec(String(sealed || ''));
      if (!m) return null;
      try {
        const d = createDecipheriv('aes-256-gcm', key, Buffer.from(m[1], 'base64url'));
        d.setAuthTag(Buffer.from(m[2], 'base64url'));
        return Buffer.concat([d.update(Buffer.from(m[3], 'base64url')), d.final()]).toString('utf8');
      } catch { return null; }
    },
  };
}

const clip = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, '').trim().slice(0, n);
const normBase = s => String(s || '').trim().replace(/\/+$/, '');
function checkBase(raw) {
  let u;
  try { u = new URL(normBase(raw)); } catch { throw new ApiError(400, 'BAD_BASE_URL', '接口地址格式不对，例如 https://api.example.com/v1'); }
  if (u.protocol !== 'https:') throw new ApiError(400, 'BAD_BASE_URL', '接口地址必须是 https:// 开头');
  if (u.username || u.password) throw new ApiError(400, 'BAD_BASE_URL', '接口地址里不能带账号密码');
  if (u.search || u.hash) throw new ApiError(400, 'BAD_BASE_URL', '接口地址里不能带 ? 或 # 参数');
  return normBase(u.href);
}

export function createAiProviders(db, {env = process.env, now = Date.now, dbPath, aiModel = null} = {}) {
  const box = createKeyBox({secret: env.ADMIN_AI_KEY_SECRET, dbPath});
  const q = {
    all: db.prepare('SELECT * FROM ai_providers ORDER BY created_at, rowid'),
    get: db.prepare('SELECT * FROM ai_providers WHERE id=?'),
    ins: db.prepare('INSERT INTO ai_providers(id,type,name,base_url,key_enc,key_hint,model,search,enabled,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)'),
    upd: db.prepare('UPDATE ai_providers SET name=?, base_url=?, key_enc=?, key_hint=?, model=?, search=?, enabled=?, updated_at=? WHERE id=?'),
    del: db.prepare('DELETE FROM ai_providers WHERE id=?'),
    getSet: db.prepare('SELECT value FROM admin_ai_settings WHERE key=?'),
    setSet: db.prepare('INSERT INTO admin_ai_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at'),
    delSet: db.prepare('DELETE FROM admin_ai_settings WHERE key=?'),
  };

  // ---- 服务器默认（.env 里的智谱）
  function envProvider() {
    const key = String(env.AI_API_KEY || env.ZHIPU_API_KEY || '').trim();
    const base = normBase(env.AI_API_BASE || ZHIPU_BASE);
    // 2.1.0：服务器默认（智谱）的模型读管理端「AI 模型」设置；没设置时用 .env 原有变量，再没有用 glm-4.7-flash
    const model = aiModel ? aiModel.model(env.ADMIN_AI_MODEL || env.AI_MODEL) : (String(env.ADMIN_AI_MODEL || env.AI_MODEL || '').trim() || DEFAULT_AI_MODEL);
    return {id: ENV_ID, type: 'zhipu', name: '智谱（服务器默认）', base, model, key, search: true, enabled: true, builtin: true,
      usable: !!key && !banned(base) && !banned(model), keyBroken: false};
  }
  function fromRow(r) {
    const key = r.key_enc ? box.open(r.key_enc) : '';
    const t = typeInfo(r.type);
    return {id: r.id, type: r.type, name: r.name, base: r.base_url, model: r.model, key: key || '', search: t.search && !!r.search,
      enabled: !!r.enabled, builtin: false, keyHint: r.key_hint || '', keyBroken: !!r.key_enc && !key,
      usable: !!r.enabled && !!key && !t.blocked && !banned(r.base_url) && !banned(r.model), createdAt: r.created_at, updatedAt: r.updated_at};
  }
  /** 全部服务商（含密钥，只给服务端内部用）。 */
  const list = () => [envProvider(), ...q.all.all().map(fromRow)];
  const find = id => (id === ENV_ID ? envProvider() : (r => (r ? fromRow(r) : null))(q.get.get(String(id || ''))));
  const activeId = () => { const r = q.getSet.get('ai.activeProvider'); return r ? r.value : ENV_ID; };

  /** 先后顺序（自动切换用）：排第一的永远是“当前使用”（选中的那家），其余按管理员调整的顺序，没排过的按添加时间排在后面。 */
  function order() {
    let ids = [];
    try { const r = q.getSet.get('ai.providerOrder'); ids = r ? JSON.parse(r.value) : []; } catch { ids = []; }
    const all = list(), known = new Set(all.map(p => p.id));
    return [...new Set([activeId(), ...(Array.isArray(ids) ? ids : []), ...all.map(p => p.id)].map(String).filter(id => known.has(id)))];
  }
  const ordered = () => { const all = new Map(list().map(p => [p.id, p])); return order().map(id => all.get(id)).filter(Boolean); };
  /** 调整顺序：第一个就成为“当前使用”。 */
  function setOrder(ids) {
    const all = new Map(list().map(p => [p.id, p]));
    const seq = [...new Set((Array.isArray(ids) ? ids : []).map(String))].filter(id => all.has(id));
    if (!seq.length) throw new ApiError(400, 'BAD_ORDER', '顺序不对');
    const first = all.get(seq[0]);
    if (typeInfo(first.type).blocked || !first.usable) throw new ApiError(400, 'NOT_READY', '排第一的接口必须已启用且有可用密钥');
    const before = order();
    q.setSet.run('ai.providerOrder', JSON.stringify(seq), now());
    if (first.id === ENV_ID) q.delSet.run('ai.activeProvider'); else q.setSet.run('ai.activeProvider', first.id, now());
    return {before, after: order()};
  }

  /** 当前使用的服务商：选中的那家不可用时退回服务器默认智谱；都不可用返回 null。 */
  function active() {
    const p = find(activeId());
    if (p && p.usable) return p;
    const e = envProvider();
    return e.usable ? e : null;
  }
  /** 联网搜索用的服务商：当前这家支持就用它，否则用服务器默认智谱，再否则用第一家可用的智谱。 */
  function searchProvider() {
    const a = active();
    if (a && a.search) return a;
    const e = envProvider();
    if (e.usable) return e;
    return list().find(p => p.usable && p.search) || null;
  }
  /** 按请求网址找是哪一家（用量统计用）。 */
  function attribute(url) {
    const u = String(url || '');
    let best = null;
    for (const p of list()) if (p.base && u.startsWith(p.base + '/') && (!best || p.base.length > best.base.length || (p.base === best.base && p.id === activeId()))) best = p;
    if (best) return best.id;
    try { return 'host:' + new URL(u).hostname; } catch { return 'unknown'; }
  }

  /** 给前端的公开信息：绝不含完整密钥。 */
  function pub(p) {
    const t = typeInfo(p.type);
    return {id: p.id, type: p.type, typeName: t.name, name: p.name, baseUrl: p.base, model: p.model,
      keyMasked: p.builtin ? (p.key ? maskKey(p.key) : '') : (p.keyHint || ''), hasKey: !!p.key || (!p.builtin && !!p.keyHint),
      keyBroken: !!p.keyBroken, search: !!p.search, searchCapable: !!t.search, enabled: !!p.enabled, builtin: !!p.builtin, usable: !!p.usable,
      balanceApi: !!t.balance, blocked: !!t.blocked, active: false};
  }
  function overview() {
    const a = active(), aid = activeId();
    const s = searchProvider();
    return {
      providers: ordered().map((p, i) => ({...pub(p), active: !!a && a.id === p.id, selected: p.id === aid, priority: i + 1})),
      order: order(),
      activeId: a ? a.id : null, selectedId: aid, fallback: !!a && a.id !== aid,
      searchProviderId: s ? s.id : null,
      types: PROVIDER_TYPES.map(t => ({type: t.type, name: t.name, baseUrl: t.base, model: t.type === 'zhipu' ? envProvider().model : t.model, searchCapable: t.search, balanceApi: t.balance, blocked: !!t.blocked, note: t.note})),
      keyStorage: env.ADMIN_AI_KEY_SECRET ? 'env_secret' : (dbPath && dbPath !== ':memory:' ? 'secret_file' : 'memory'),
    };
  }

  function save(admin, body = {}, id) {
    const old = id ? q.get.get(String(id)) : null;
    if (id === ENV_ID) throw new ApiError(400, 'BUILTIN', '服务器默认的智谱在服务器 .env 里配置，不能在这里修改');
    if (id && !old) throw new ApiError(404, 'NOT_FOUND', '没有找到这个服务商');
    const type = old ? old.type : String(body.type || '').trim();
    const t = TYPE.get(type);
    if (!t) throw new ApiError(400, 'BAD_TYPE', '请选择服务商类型');
    if (t.blocked) throw new ApiError(400, 'BLOCKED_PROVIDER', '按之前的决定暂不使用 DeepSeek');
    const name = clip(body.name != null ? body.name : (old ? old.name : t.name), 30) || t.name;
    const base = checkBase(body.baseUrl != null && String(body.baseUrl).trim() ? body.baseUrl : (old ? old.base_url : t.base));
    const model = clip(body.model != null && String(body.model).trim() ? body.model : (old ? old.model : t.model), 80);
    if (!model) throw new ApiError(400, 'BAD_MODEL', '请填写模型名');
    if (banned(base) || banned(model)) throw new ApiError(400, 'BLOCKED_PROVIDER', '按之前的决定暂不使用 DeepSeek');
    const rawKey = body.apiKey != null ? String(body.apiKey).trim() : '';
    if (rawKey && (rawKey.length < 8 || rawKey.length > 400 || /\s/.test(rawKey))) throw new ApiError(400, 'BAD_KEY', '密钥格式不对');
    if (!old && !rawKey) throw new ApiError(400, 'BAD_KEY', '请填写 API 密钥');
    const keyEnc = rawKey ? box.seal(rawKey) : old.key_enc;
    const keyHint = rawKey ? maskKey(rawKey) : old.key_hint;
    const search = t.search ? (body.search != null ? (body.search ? 1 : 0) : (old ? old.search : 1)) : 0;
    const enabled = body.enabled != null ? (body.enabled ? 1 : 0) : (old ? old.enabled : 1);
    const ts = now();
    let pid = old ? old.id : '';
    if (old) q.upd.run(name, base, keyEnc, keyHint, model, search, enabled, ts, old.id);
    else { pid = 'aiprov_' + randomBytes(6).toString('hex'); q.ins.run(pid, type, name, base, keyEnc, keyHint, model, search, enabled, admin ? admin.id : null, ts, ts); }
    const changed = old ? ['name', 'base', 'model', 'search', 'enabled'].filter((k, i) => [old.name, old.base_url, old.model, old.search, old.enabled][i] !== [name, base, model, search, enabled][i]) : [];
    if (rawKey && old) changed.push('apiKey');
    return {id: pid, created: !old, changed, detail: {type, name, baseUrl: base, model, search: !!search, enabled: !!enabled, keyMasked: keyHint}};
  }
  function remove(id) {
    if (id === ENV_ID) throw new ApiError(400, 'BUILTIN', '服务器默认的智谱不能删除');
    const r = q.get.get(String(id || ''));
    if (!r) throw new ApiError(404, 'NOT_FOUND', '没有找到这个服务商');
    q.del.run(r.id);
    const wasSelected = activeId() === r.id;
    if (wasSelected) q.delSet.run('ai.activeProvider');
    return {id: r.id, name: r.name, type: r.type, wasSelected};
  }
  function setActive(id) {
    const p = find(id);
    if (!p) throw new ApiError(404, 'NOT_FOUND', '没有找到这个服务商');
    if (typeInfo(p.type).blocked) throw new ApiError(400, 'BLOCKED_PROVIDER', '按之前的决定暂不使用 DeepSeek');
    if (!p.enabled) throw new ApiError(400, 'DISABLED', '这个服务商已停用，先启用再切换');
    if (!p.usable) throw new ApiError(400, 'NOT_READY', p.keyBroken ? '这个服务商的密钥无法解密，请重新填写密钥' : '这个服务商还没有可用的密钥');
    const from = activeId();
    if (p.id === ENV_ID) q.delSet.run('ai.activeProvider'); else q.setSet.run('ai.activeProvider', p.id, now());
    q.setSet.run('ai.providerOrder', JSON.stringify([p.id, ...order().filter(id => id !== p.id)]), now());
    return {from, to: p.id, name: p.name};
  }

  return {list, find, active, activeId, searchProvider, attribute, pub, overview, save, remove, setActive, envProvider, order, ordered, setOrder};
}
