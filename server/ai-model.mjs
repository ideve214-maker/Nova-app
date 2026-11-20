// 服务端 2.1.0：全站 AI 模型设置（管理端 AI 接口页「模型」下拉框）。
// - 存在 app_flags 的 ai.model：{provider, model}。模型编码允许自由填写（智谱新模型不用等发版），只校验是安全的短字符串。
// - 所有智谱调用（外部帖审查、AI 审查、营销发帖 / 管理端 AI 助手、用户端 AI 助手 / 翻译、运营日报）都读这里：
//   管理端保存的模型 > .env 里原有的模型变量（AI_MODEL 等，兼容已部署的配置）> 默认 glm-4.7-flash。
// - 智谱官方模型编码（docs.bigmodel.cn 核对）：GLM-4.7-Flash = glm-4.7-flash（免费），GLM-5.3-Flash = glm-5.3-flash，
//   GLM-5.3-FlashX = glm-5.3-flashx。glm-4-flash 等旧编码仍可手动填。
// - 不使用 DeepSeek（模型名带 deepseek 一律拒绝）。
import {ApiError} from './errors.mjs';

export const DEFAULT_AI_MODEL = 'glm-4.7-flash';
export const DEFAULT_AI_PROVIDER = 'zhipu';
export const ZHIPU_MODEL_PRESETS = Object.freeze([
  {model: 'glm-5.3-flash', label: 'GLM-5.3-Flash', free: false, thinking: 'always'},
  {model: 'glm-5.3-flashx', label: 'GLM-5.3-FlashX', free: false, thinking: 'always'},
  {model: 'glm-4.7-flash', label: 'GLM-4.7-Flash（免费）', free: true, thinking: 'optional'},
  {model: 'glm-4-flash-250414', label: 'GLM-4-Flash-250414（免费）', free: true, thinking: 'none'},
]);
const FLAG = 'ai.model';
const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/\-[\]]{0,79}$/;
const SAFE_PROVIDER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const banned = s => /deepseek/i.test(String(s || ''));

/** 智谱的思考型模型：GLM-4.5 / 4.6 / 4.7 系列可以关思考（审查、翻译这种短任务关掉更快）；GLM-5.x 只能开，需要留够 token。 */
export function zhipuThinkingExtras(model, base = '') {
  const m = String(model || '').toLowerCase();
  if (base && !/bigmodel\.cn|z\.ai/.test(String(base))) return {};
  if (/^glm-4\.(5|6|7)/.test(m)) return {thinking: {type: 'disabled'}};
  return {};
}
/** 只能开思考的模型（GLM-5.x）把 max_tokens 提到至少 n，免得思考把输出挤没。 */
export function minTokensFor(model, maxTokens, n = 4096) {
  return /^glm-5/i.test(String(model || '')) ? Math.max(Number(maxTokens) || 0, n) : maxTokens;
}

export function createAiModel(db, {now = Date.now, env = {}} = {}) {
  const getFlag = db.prepare('SELECT value, updated_at FROM app_flags WHERE key=?');
  const setFlag = db.prepare(`INSERT INTO app_flags(key,value,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`);
  const delFlag = db.prepare('DELETE FROM app_flags WHERE key=?');

  /** 管理端保存的设置；没保存过返回 null。 */
  function saved() {
    try {
      const r = getFlag.get(FLAG);
      if (!r) return null;
      const v = JSON.parse(r.value) || {};
      const model = String(v.model || '').trim();
      if (!model || !SAFE_MODEL.test(model) || banned(model)) return null;
      return {provider: SAFE_PROVIDER.test(String(v.provider || '')) ? String(v.provider) : DEFAULT_AI_PROVIDER, model, updatedAt: r.updated_at};
    } catch { return null; }
  }
  /** 实际要用的模型：保存的 > envFallback（.env 原有变量）> 默认。 */
  function model(envFallback) {
    const s = saved();
    if (s) return s.model;
    const e = String(envFallback || '').trim();
    return e && !banned(e) ? e : DEFAULT_AI_MODEL;
  }
  /** 管理端显示用：实际生效的模型（保存的 > .env 的 AI_MODEL > 默认），source 说明来自哪里。 */
  function get() {
    const s = saved(), e = String((env && env.AI_MODEL) || '').trim();
    const model_ = s ? s.model : (e && !banned(e) ? e : DEFAULT_AI_MODEL);
    return {provider: s ? s.provider : DEFAULT_AI_PROVIDER, model: model_, saved: !!s, source: s ? 'admin' : (model_ === e ? 'env' : 'default'),
      default: DEFAULT_AI_MODEL, updatedAt: s ? s.updatedAt : null, presets: ZHIPU_MODEL_PRESETS};
  }
  /** body: {provider?, model} ；model 传空字符串或 null 表示清除设置，退回默认。 */
  function set(b = {}) {
    if (b.model === null || (typeof b.model === 'string' && !b.model.trim())) { delFlag.run(FLAG); return get(); }
    const model = String(b.model == null ? '' : b.model).trim();
    if (!model) throw new ApiError(400, 'BAD_MODEL', '请填写模型编码');
    if (!SAFE_MODEL.test(model)) throw new ApiError(400, 'BAD_MODEL', '模型编码只能包含字母、数字和 . _ - : / [ ]，最长 80 个字符');
    if (banned(model)) throw new ApiError(400, 'BAD_MODEL', '不使用 DeepSeek 模型');
    const provider = String(b.provider == null || b.provider === '' ? DEFAULT_AI_PROVIDER : b.provider).trim();
    if (!SAFE_PROVIDER.test(provider)) throw new ApiError(400, 'BAD_PROVIDER', '服务商名称不正确');
    if (banned(provider)) throw new ApiError(400, 'BAD_PROVIDER', '不使用 DeepSeek');
    setFlag.run(FLAG, JSON.stringify({provider, model}), now());
    return get();
  }
  return {saved, model, get, set};
}
