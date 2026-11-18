// 法律文档：配置中的运营者信息渲染进《隐私政策》《用户协议》。
// 运营者、生效日期已写入默认值；仅联系邮箱在未提供前保持【待填：联系邮箱】。可用环境变量覆盖。
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'docs', 'compliance');

export const LEGAL_DEFAULTS = {
  operatorName: 'Sterling ideve',
  contactEmail: '【待填：联系邮箱】',
  effectiveDate: '2026年11月20日',
  version: '2026-11-19',
};

const KEYS = Object.keys(LEGAL_DEFAULTS);
const ENV_MAP = {
  operatorName: 'NOVA_LEGAL_OPERATOR',
  contactEmail: 'NOVA_LEGAL_EMAIL',
  effectiveDate: 'NOVA_LEGAL_EFFECTIVE',
  version: 'NOVA_LEGAL_VERSION',
};

export function legalConfig(env = process.env) {
  const pick = (k, d) => {
    const s = env && env[ENV_MAP[k]] != null ? String(env[ENV_MAP[k]]).trim() : '';
    return s || d;
  };
  const out = {};
  for (const k of KEYS) out[k] = pick(k, LEGAL_DEFAULTS[k]);
  return out;
}

export function interpolate(text, cfg = legalConfig()) {
  const re = new RegExp('\\{\\{(' + KEYS.join('|') + ')\\}\\}', 'g');
  return String(text).replace(re, (_, k) => cfg[k]);
}

export function legalDoc(kind, env = process.env) {
  const cfg = legalConfig(env);
  const isTerms = kind === 'terms' || kind === 'agreement';
  const title = isTerms ? 'VEXO 用户协议' : 'VEXO 隐私政策';
  const name = isTerms ? '04_user-agreement.md' : '04_privacy-policy.md';
  let raw = '';
  try { raw = readFileSync(join(DIR, name), 'utf8'); }
  catch { raw = '# ' + title + '\n\n文档暂时无法加载，请联系 ' + cfg.contactEmail + '。'; }
  const body = interpolate(raw, cfg);
  const html = markPlaceholders(mdToHtml(body));
  return {
    kind: isTerms ? 'terms' : 'privacy',
    title,
    version: cfg.version,
    effectiveDate: cfg.effectiveDate,
    operatorName: cfg.operatorName,
    contactEmail: cfg.contactEmail,
    language: 'zh-CN',
    body,
    html,
  };
}

export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function markPlaceholders(html) {
  return String(html).replace(/【待填：[^】]+】/g, m => '<span class="legal-ph">' + m + '</span>');
}

export function mdToHtml(src) {
  const lines = String(src).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let para = [], list = null;
  const flushP = () => {
    if (!para.length) return;
    const t = para.join(' ').trim();
    para = [];
    if (t) out.push('<p>' + inline(t) + '</p>');
  };
  const flushL = () => {
    if (!list) return;
    out.push('<ul>' + list.map(x => '<li>' + inline(x) + '</li>').join('') + '</ul>');
    list = null;
  };
  const inline = t => escapeHtml(t)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flushP(); flushL(); continue; }
    const h = /^(#{1,3})\s+(.+)$/.exec(line);
    if (h) {
      flushP(); flushL();
      const n = h[1].length;
      out.push('<h' + n + '>' + inline(h[2]) + '</h' + n + '>');
      continue;
    }
    const li = /^[-*]\s+(.+)$/.exec(line);
    if (li) {
      flushP();
      if (!list) list = [];
      list.push(li[1]);
      continue;
    }
    flushL();
    para.push(line.trim());
  }
  flushP(); flushL();
  return out.join('\n');
}

export function renderLegalHtml(doc) {
  const inner = doc.html || markPlaceholders(mdToHtml(doc.body));
  const title = escapeHtml(doc.title);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark light">
<title>${title}</title>
<style>
  :root{
    --bg:#0B0C0F;--sf:#14161A;--tx:#F5F6F7;--t2:#A4A9B2;--ln:#292D34;
    --ac:#2D88FF;--ac-soft:rgba(45,136,255,.16);
    --font:Inter,"Noto Sans CJK SC","Noto Sans SC","PingFang SC","Hiragino Sans GB","Microsoft YaHei",-apple-system,sans-serif;
    color-scheme:dark;
  }
  .mark-light{display:none}
  .mark-dark{display:block}
  @media (prefers-color-scheme:light){
    :root{--bg:#F0F2F5;--sf:#fff;--tx:#15171A;--t2:#65676B;--ln:#CED0D4;--ac:#2D88FF;--ac-soft:rgba(45,136,255,.12);color-scheme:light}
    .mark-dark{display:none}
    .mark-light{display:block}
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--tx);font:16px/1.75 var(--font)}
  .wrap{max-width:720px;margin:0 auto;padding:28px 20px 80px}
  .brand{display:flex;align-items:center;gap:10px;margin:0 0 28px;text-decoration:none;color:inherit}
  .brand img{height:28px;width:auto;display:block}
  h1{font-size:26px;letter-spacing:.02em;margin:0 0 10px;font-weight:650}
  h2{font-size:17px;margin:32px 0 10px;font-weight:650}
  h3{font-size:15px;margin:22px 0 8px;font-weight:650}
  p,li{margin:0 0 10px}
  ul{padding-left:1.25em;margin:0 0 12px}
  .meta{color:var(--t2);font-size:13px;line-height:1.7;margin:0 0 28px;padding-bottom:18px;border-bottom:1px solid var(--ln)}
  .meta div{margin:0}
  .foot{margin-top:48px;padding-top:18px;border-top:1px solid var(--ln);font-size:13px;color:var(--t2)}
  a{color:var(--ac);text-decoration:none}
  a:hover{text-decoration:underline}
  code{font-size:.92em;background:var(--sf);padding:0 4px;border-radius:4px}
  .legal-ph{display:inline;background:var(--ac-soft);color:var(--ac);border-radius:4px;padding:0 .28em;font-weight:600}
</style>
</head>
<body>
<div class="wrap">
  <a class="brand" href="/">
    <img class="mark-dark" src="/assets/brand/vexo-lockup.png" alt="VEXO">
    <img class="mark-light" src="/assets/brand/vexo-lockup-light.png" alt="VEXO">
  </a>
  <h1>${title}</h1>
  <div class="meta">
    <div>运营者：${markPlaceholders(escapeHtml(doc.operatorName))}</div>
    <div>生效日期：${markPlaceholders(escapeHtml(doc.effectiveDate))} · 版本：${escapeHtml(doc.version)}</div>
    <div>联系：${String(doc.contactEmail||'').includes('待填') ? markPlaceholders(escapeHtml(doc.contactEmail||'')) : '<a href="mailto:' + escapeHtml(doc.contactEmail) + '">' + escapeHtml(doc.contactEmail) + '</a>'}</div>
  </div>
  ${inner}
  <p class="foot"><a href="/legal/privacy">隐私政策</a> · <a href="/legal/terms">用户协议</a> · <a href="/">返回应用</a></p>
</div>
</body>
</html>`;
}
