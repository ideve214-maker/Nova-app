// 命令速查：从 tldr-pages 官方发布包拉索引和页面，缓存在内存里。不写数据库，也不把密钥或页面打进客户端。
// 官方索引：https://github.com/tldr-pages/tldr/releases/latest/download/index.json（client spec v2.2+）
// 单页回退：raw.githubusercontent.com、cdn.jsdelivr.net。许可 CC BY 4.0，界面必须署名并链到原文。

export const TLDR_INDEX_URL = 'https://github.com/tldr-pages/tldr/releases/latest/download/index.json';
export const TLDR_REPO = 'https://github.com/tldr-pages/tldr';
export const TLDR_SITE = 'https://tldr.sh';
export const TLDR_LICENSE = 'CC BY 4.0';
export const PLATFORMS = ['common', 'linux', 'osx'];
export const LANGS = ['zh', 'en'];
export const POPULAR = ['ls', 'git', 'curl', 'tar', 'ssh', 'grep', 'find', 'docker', 'npm', 'chmod', 'cd', 'cp'];
const CMD_RE = /^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,63}$/;
const UA = 'VEXO-tldr (+https://github.com/ideve214-maker/VEXOold)';
const DEFAULT_TTL = 12 * 3600 * 1000;

export class TldrError extends Error {
  constructor(s, code, message) { super(message); this.s = s; this.code = code; }
}

export function attribution(pagePath) {
  return {
    text: '内容来自 tldr-pages，按 CC BY 4.0 许可使用。',
    license: TLDR_LICENSE,
    licenseUrl: 'https://github.com/tldr-pages/tldr/blob/main/LICENSE.md',
    url: TLDR_REPO,
    site: TLDR_SITE,
    pageUrl: pagePath ? (TLDR_REPO + '/blob/main/' + pagePath) : TLDR_REPO,
  };
}

export function normalizeCmd(raw) {
  const s = String(raw || '').trim().toLowerCase();
  return CMD_RE.test(s) ? s : '';
}

export function parseTldrMd(md) {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  let title = '', description = '';
  const examples = [];
  let pending = null;
  const flush = () => { if (pending) { examples.push(pending); pending = null; } };
  for (const line of lines) {
    if (line.startsWith('# ')) { title = line.slice(2).trim(); continue; }
    if (line.startsWith('> ')) {
      description += (description ? ' ' : '') + line.slice(2).trim();
      continue;
    }
    if (line.startsWith('- ')) {
      flush();
      pending = { text: line.slice(2).trim().replace(/:$/, ''), code: '' };
      continue;
    }
    const code = line.trim();
    if (pending && /^`[\s\S]+`$/.test(code)) pending.code = code.slice(1, -1);
  }
  flush();
  return { title, description, examples };
}

function pageDir(lang) { return lang === 'en' ? 'pages' : 'pages.' + lang; }
export function pagePath(lang, platform, cmd) { return pageDir(lang) + '/' + platform + '/' + cmd + '.md'; }
export function pageUrls(lang, platform, cmd) {
  const p = pagePath(lang, platform, cmd);
  return [
    'https://raw.githubusercontent.com/tldr-pages/tldr/main/' + p,
    'https://cdn.jsdelivr.net/gh/tldr-pages/tldr@main/' + p,
  ];
}

export function compactIndex(raw) {
  const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.commands) ? raw.commands : []);
  const out = Object.create(null);
  for (const row of list) {
    if (!row || !row.name) continue;
    const name = String(row.name).toLowerCase();
    if (!CMD_RE.test(name)) continue;
    const platforms = (row.platform || row.platforms || []).map(s => String(s).toLowerCase()).filter(p => PLATFORMS.includes(p));
    const languages = (row.language || row.languages || []).map(s => String(s).toLowerCase().replace('_', '-'));
    const langs = LANGS.filter(l => languages.includes(l) || (l === 'zh' && languages.includes('zh-cn')));
    if (!platforms.length || !langs.length) continue;
    const prev = out[name];
    if (!prev) out[name] = { name, platforms: [...new Set(platforms)], languages: [...new Set(langs)] };
    else {
      prev.platforms = [...new Set(prev.platforms.concat(platforms))];
      prev.languages = [...new Set(prev.languages.concat(langs))];
    }
  }
  return out;
}

export function searchIndex(index, q, limit = 20) {
  const query = String(q || '').trim().toLowerCase();
  const names = Object.keys(index);
  let picked;
  if (!query) {
    picked = POPULAR.filter(n => index[n]).concat(names.filter(n => !POPULAR.includes(n))).slice(0, limit);
  } else {
    const start = [], mid = [];
    for (const n of names) {
      if (n.startsWith(query)) start.push(n);
      else if (n.includes(query)) mid.push(n);
    }
    start.sort(); mid.sort();
    picked = start.concat(mid).slice(0, limit);
  }
  return picked.map(name => ({ name, platforms: index[name].platforms, languages: index[name].languages }));
}

export function createTldr({ fetchFn = globalThis.fetch, now = Date.now, ttlMs = DEFAULT_TTL } = {}) {
  let indexCache = null;
  const pageCache = new Map();

  async function httpGet(url, type) {
    const ctrl = (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(8000) : undefined;
    const r = await fetchFn(url, {
      headers: { 'User-Agent': UA, Accept: type === 'json' ? 'application/json' : 'text/plain' },
      signal: ctrl,
      redirect: 'follow',
    });
    if (!r || !r.ok) {
      const err = new Error('http ' + (r && r.status));
      err.status = r && r.status;
      throw err;
    }
    return type === 'json' ? r.json() : r.text();
  }

  async function loadIndex(force) {
    if (!force && indexCache && (now() - indexCache.at) < ttlMs) return indexCache.map;
    try {
      const raw = await httpGet(TLDR_INDEX_URL, 'json');
      const map = compactIndex(raw);
      indexCache = { at: now(), map };
      return map;
    } catch (e) {
      if (indexCache && indexCache.map) return indexCache.map;
      throw new TldrError(503, 'TLDR_UNAVAILABLE', '暂时无法获取命令目录，请检查网络后再试。');
    }
  }

  async function fetchPage(lang, platform, cmd) {
    const key = lang + ':' + platform + ':' + cmd;
    const hit = pageCache.get(key);
    if (hit && (now() - hit.at) < ttlMs) return hit;
    let last;
    for (const url of pageUrls(lang, platform, cmd)) {
      try {
        const body = await httpGet(url, 'text');
        if (typeof body === 'string' && body.trim() && !body.trimStart().startsWith('<!')) {
          const rec = { at: now(), body, lang, platform, path: pagePath(lang, platform, cmd) };
          pageCache.set(key, rec);
          return rec;
        }
      } catch (e) { last = e; }
    }
    throw last || new Error('missing');
  }

  async function getCommand(rawCmd) {
    const cmd = normalizeCmd(rawCmd);
    if (!cmd) throw new TldrError(400, 'BAD_REQUEST', '请输入要查找的命令。');
    let meta = null;
    let indexFailed = false;
    try { meta = (await loadIndex())[cmd] || null; }
    catch (e) {
      if (!(e instanceof TldrError)) throw e;
      indexFailed = true;
    }
    const langs = meta ? LANGS.filter(l => meta.languages.includes(l)) : LANGS;
    const platforms = meta ? PLATFORMS.filter(p => meta.platforms.includes(p)) : PLATFORMS;
    const tryLangs = langs.length ? langs : LANGS;
    const tryPlat = platforms.length ? platforms : PLATFORMS;
    let sawNetwork = false, sawMissing = false;
    for (const lang of tryLangs) {
      for (const platform of tryPlat) {
        try {
          const rec = await fetchPage(lang, platform, cmd);
          const parsed = parseTldrMd(rec.body);
          return {
            name: cmd,
            title: parsed.title || cmd,
            description: parsed.description,
            examples: parsed.examples,
            language: rec.lang,
            platform: rec.platform,
            markdown: rec.body,
            attribution: attribution(rec.path),
          };
        } catch (e) {
          if (e && e.status === 404) { sawMissing = true; continue; }
          sawNetwork = true;
        }
      }
    }
    if ((indexFailed || !meta) && sawNetwork && !sawMissing) {
      throw new TldrError(503, 'TLDR_UNAVAILABLE', '暂时无法获取命令说明，请检查网络后再试。');
    }
    throw new TldrError(404, 'NOT_FOUND', '没有找到这个命令的说明。');
  }

  async function search(q) {
    const map = await loadIndex();
    return { items: searchIndex(map, q), attribution: attribution() };
  }

  async function handle(query = {}) {
    const cmd = query.cmd != null ? String(query.cmd) : '';
    if (cmd.trim()) return getCommand(cmd);
    return search(query.q != null ? String(query.q) : '');
  }

  return { handle, getCommand, search, loadIndex, _cache: { get index() { return indexCache; }, pages: pageCache } };
}
