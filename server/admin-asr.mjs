// 管理端 AI 助手 · 语音转文字（可插拔）。
// ASR_PROVIDER 可写一个或多个（逗号分隔，按顺序尝试）：zhipu、dashscope。默认 zhipu。
// - zhipu：智谱 GLM-ASR（复用 AI_API_KEY / ZHIPU_API_KEY，不需要新密钥）。
//   文档：https://docs.bigmodel.cn/cn/guide/models/sound-and-video/glm-asr-2512
//   旧版 glm-asr 页面写明支持 8 种官话方言（含山东境内的冀鲁官话、胶辽官话、中原官话），
//   但当前接口只列 glm-asr-2512，其页面只点名四川话、粤语、闽南语、吴语，没有点名“山东话”。
// - dashscope：阿里云百炼 qwen-audio-3.1-asr-flash（同步 HTTP，可传 base64），
//   官方语言列表明确写到“山东”地区官话口音；需要新密钥 DASHSCOPE_API_KEY。
//   文档：https://help.aliyun.com/zh/model-studio/asr-model/ 、
//        https://platform.qianwenai.com/docs/api-reference/speech-recognition/qwen-audio-asr/http-api
// 密钥只从环境变量读取，绝不打印、不写日志。
import {ApiError} from './errors.mjs';

const ZHIPU_BASE = 'https://open.bigmodel.cn/api/paas/v4';
const DASHSCOPE_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
export const ASR_MAX_BYTES = 2 * 1024 * 1024;

export function asrConfig(env = process.env) {
  const list = String(env.ASR_PROVIDER || 'zhipu').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const zhipuKey = () => String(env.AI_API_KEY || env.ZHIPU_API_KEY || '').trim();
  const dashKey = () => String(env.DASHSCOPE_API_KEY || '').trim();
  const providers = list.filter(p => p === 'zhipu' || p === 'dashscope');
  return {
    providers: providers.length ? providers : ['zhipu'],
    zhipu: {key: zhipuKey, base: String(env.AI_API_BASE || ZHIPU_BASE).trim().replace(/\/+$/, ''), model: String(env.ZHIPU_ASR_MODEL || 'glm-asr-2512').trim()},
    dashscope: {key: dashKey, url: String(env.DASHSCOPE_ASR_URL || DASHSCOPE_URL).trim(), model: String(env.DASHSCOPE_ASR_MODEL || 'qwen-audio-3.1-asr-flash').trim()},
  };
}

export function asrStatus(env = process.env) {
  const c = asrConfig(env);
  return c.providers.map(p => ({
    provider: p,
    model: c[p].model,
    ready: !!c[p].key(),
    shandong: p === 'dashscope' ? 'listed' : 'mandarin-groups',
    note: p === 'dashscope'
      ? '阿里云百炼官方语言列表明确包含山东地区官话口音'
      : '智谱 GLM-ASR 文档列出冀鲁、胶辽、中原官话（覆盖山东大部分方言区），未单独点名“山东话”',
  }));
}

/** 把 base64 / data URI 解成 Buffer，并做大小与格式检查（只收 16k 单声道 wav 或 mp3）。 */
export function decodeAudio(body = {}) {
  let raw = String(body.audio || '').trim();
  let mime = String(body.mime || '').toLowerCase();
  const m = /^data:([^;,]+);base64,/.exec(raw);
  if (m) { mime = mime || m[1].toLowerCase(); raw = raw.slice(m[0].length); }
  if (!raw) throw new ApiError(400, 'BAD_AUDIO', '没有收到录音');
  const buf = Buffer.from(raw, 'base64');
  if (!buf.length) throw new ApiError(400, 'BAD_AUDIO', '录音为空');
  if (buf.length > ASR_MAX_BYTES) throw new ApiError(413, 'TOO_LARGE', '录音太长了，请控制在 25 秒以内');
  const isWav = buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WAVE';
  const isMp3 = buf.slice(0, 3).toString('ascii') === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0);
  if (!isWav && !isMp3) throw new ApiError(400, 'BAD_AUDIO', '录音格式不支持（需要 wav 或 mp3）');
  return {buf, format: isWav ? 'wav' : 'mp3', mime: isWav ? 'audio/wav' : 'audio/mpeg'};
}

export function createAsr({env = process.env, fetchImpl} = {}) {
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  async function viaZhipu(c, audio, hot) {
    const fd = new FormData();
    fd.append('model', c.model);
    fd.append('stream', 'false');
    fd.append('file', new Blob([audio.buf], {type: audio.mime}), 'speech.' + audio.format);
    if (hot) fd.append('prompt', hot);
    const res = await doFetch(c.base + '/audio/transcriptions', {method: 'POST', headers: {Authorization: 'Bearer ' + c.key()}, body: fd, signal: AbortSignal.timeout(20000)});
    if (!res.ok) throw new Error('zhipu_http_' + res.status);
    const j = await res.json().catch(() => null);
    const t = j && (j.text || (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content));
    if (typeof t !== 'string') throw new Error('zhipu_empty');
    return t.trim();
  }
  async function viaDashscope(c, audio) {
    const res = await doFetch(c.url, {
      method: 'POST', signal: AbortSignal.timeout(20000),
      headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + c.key(), 'X-DashScope-SSE': 'disable'},
      body: JSON.stringify({
        model: c.model,
        input: {messages: [{role: 'user', content: [{type: 'input_audio', input_audio: {data: 'data:' + audio.mime + ';base64,' + audio.buf.toString('base64')}}]}]},
        parameters: {format: audio.format, ...(audio.format === 'wav' ? {sample_rate: '16000'} : {}), language_hints: ['zh']},
      }),
    });
    if (!res.ok) throw new Error('dashscope_http_' + res.status);
    const j = await res.json().catch(() => null);
    const o = j && j.output;
    let t = o && typeof o.text === 'string' ? o.text : null;
    if (t == null && o && o.choices && o.choices[0] && o.choices[0].message) {
      const ct = o.choices[0].message.content;
      t = Array.isArray(ct) ? ct.map(x => (x && x.text) || '').join('') : (typeof ct === 'string' ? ct : null);
    }
    if (typeof t !== 'string') throw new Error('dashscope_empty');
    return t.trim();
  }
  async function transcribe(body = {}) {
    const audio = decodeAudio(body);
    const c = asrConfig(env);
    const tried = [];
    for (const p of c.providers) {
      if (!c[p].key()) { tried.push(p + ':no_key'); continue; }
      try {
        const text = p === 'dashscope' ? await viaDashscope(c.dashscope, audio) : await viaZhipu(c.zhipu, audio, '');
        return {text, provider: p, model: c[p].model};
      } catch (e) { tried.push(p + ':' + String(e && e.message || 'error').slice(0, 40)); }
    }
    const noKey = tried.length && tried.every(x => x.endsWith(':no_key'));
    throw new ApiError(503, noKey ? 'ASR_NOT_CONFIGURED' : 'ASR_UNAVAILABLE', noKey ? '语音识别还没有配置密钥' : '语音识别暂时不可用，请稍后再试或改用文字', {tried});
  }
  return {transcribe, status: () => asrStatus(env)};
}
