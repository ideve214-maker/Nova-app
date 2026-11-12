// 法律文档：配置中的运营者信息渲染进《隐私政策》《用户协议》。
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'docs', 'compliance');

export const LEGAL_DEFAULTS = {
  operatorName: 'Sterling ideve',
  contactEmail: 'ideve217@gmail.com',
  effectiveDate: '2026年11月20日',
  version: '2026-11-20',
};

export function legalConfig(env = process.env) {
  const pick = (k, d) => {
    const s = env && env[k] != null ? String(env[k]).trim() : '';
    return s || d;
  };
  return {
    operatorName: pick('NOVA_LEGAL_OPERATOR', LEGAL_DEFAULTS.operatorName),
    contactEmail: pick('NOVA_LEGAL_EMAIL', LEGAL_DEFAULTS.contactEmail),
    effectiveDate: pick('NOVA_LEGAL_EFFECTIVE', LEGAL_DEFAULTS.effectiveDate),
    version: pick('NOVA_LEGAL_VERSION', LEGAL_DEFAULTS.version),
  };
}

export function interpolate(text, cfg = legalConfig()) {
  const map = {
    operatorName: cfg.operatorName,
    contactEmail: cfg.contactEmail,
    effectiveDate: cfg.effectiveDate,
    version: cfg.version,
  };
  return String(text).replace(/\{\{(operatorName|contactEmail|effectiveDate|version)\}\}/g, (_, k) => map[k]);
}

export function legalDoc(kind, env = process.env) {
  const cfg = legalConfig(env);
  const isTerms = kind === 'terms' || kind === 'agreement';
  const title = isTerms ? 'NOVA 用户协议' : 'NOVA 隐私政策';
  const name = isTerms ? '04_user-agreement.md' : '04_privacy-policy.md';
  let raw = '';
  try { raw = readFileSync(join(DIR, name), 'utf8'); }
  catch { raw = '# ' + title + '\n\n文档暂时无法加载，请联系 ' + cfg.contactEmail + '。'; }
  const body = interpolate(raw, cfg);
  return {
    kind: isTerms ? 'terms' : 'privacy',
    title,
    version: cfg.version,
    effectiveDate: cfg.effectiveDate,
    operatorName: cfg.operatorName,
    contactEmail: cfg.contactEmail,
    language: 'zh-CN',
    body,
  };
}

export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
  const inner = mdToHtml(doc.body);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(doc.title)}</title>
<style>
  body{font:16px/1.65 "Noto Sans CJK SC","Noto Sans SC","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;max-width:720px;margin:0 auto;padding:24px 20px 64px;color:#13151C;background:#F3F4F9}
  h1{font-size:24px;margin:0 0 8px}
  h2{font-size:18px;margin:28px 0 8px}
  h3{font-size:16px;margin:20px 0 8px}
  p,li{margin:0 0 10px}
  ul{padding-left:1.3em}
  .meta{color:#5C6478;font-size:14px;margin-bottom:24px}
  .foot{margin-top:40px;padding-top:16px;border-top:1px solid #E0E3EC;font-size:14px;color:#5C6478}
  a{color:#4F6EF7}
  code{font-size:.92em;background:#EEEFF5;padding:0 4px;border-radius:4px}
</style>
</head>
<body>
<p class="meta">运营者：${escapeHtml(doc.operatorName)} · 生效日期：${escapeHtml(doc.effectiveDate)} · 版本：${escapeHtml(doc.version)} · 联系：<a href="mailto:${escapeHtml(doc.contactEmail)}">${escapeHtml(doc.contactEmail)}</a></p>
${inner}
<p class="foot"><a href="/legal/privacy">隐私政策</a> · <a href="/legal/terms">用户协议</a> · <a href="/">返回应用</a></p>
</body>
</html>`;
}
