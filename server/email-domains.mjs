// 注册邮箱域名白名单（服务器和客户端共用这一份：客户端构建时 scripts/build.mjs 会把本文件原样内联进页面）。
// 要加新的邮箱服务商，只改下面的列表即可。只影响新注册，不影响已有账号登录。
// 本文件不能 import 任何东西，也不要用浏览器没有的 API。
export const EMAIL_DOMAINS = [
  // 国内
  'qq.com', 'vip.qq.com', 'foxmail.com',
  '163.com', '126.com', 'yeah.net', '188.com', 'vip.163.com', 'vip.126.com', 'vip.188.com',
  'sina.com', 'sina.cn', 'vip.sina.com', 'sohu.com', 'vip.sohu.com', 'aliyun.com', 'tom.com', '21cn.com',
  '139.com', '189.cn', 'wo.cn',
  // 海外
  'gmail.com', 'googlemail.com',
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'outlook.jp', 'hotmail.co.uk', 'live.cn',
  'yahoo.com', 'yahoo.co.jp', 'yahoo.com.tw', 'yahoo.com.hk', 'ymail.com',
  'icloud.com', 'me.com', 'mac.com',
  'proton.me', 'protonmail.com', 'pm.me',
  'aol.com', 'zoho.com', 'gmx.com', 'gmx.de', 'yandex.com', 'mail.ru', 'naver.com', 'daum.net',
];
// 学校邮箱：以这些后缀结尾的也允许（例如 xxx@mails.tsinghua.edu.cn）。不需要的话把这一行清空即可。
export const EMAIL_DOMAIN_SUFFIXES = ['.edu.cn', '.edu', '.edu.hk', '.edu.tw', '.ac.uk'];

function emailEditDistance(a, b) {
  // Damerau–Levenshtein（相邻两个字母对调算 1 步），只用于判断「是不是打错了」
  const m = a.length, n = b.length, d = [];
  for (let i = 0; i <= m; i++) { d[i] = [i]; }
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    const c = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[m][n];
}

// 返回 {ok:true} 或 {ok:false, suggest:'gmail.com'|null}。
// allowTest：测试环境允许 RFC 2606 保留的测试域名（.test / .example / example.com 等），正式环境不允许。
export function emailDomainCheck(email, {allowTest = false} = {}) {
  const e = String(email || '').trim().toLowerCase();
  const m = /^[^\s@]{1,64}@([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/.exec(e);
  if (!m) return {ok: false, suggest: null};
  const dom = m[1];
  if (EMAIL_DOMAINS.includes(dom)) return {ok: true};
  if (EMAIL_DOMAIN_SUFFIXES.some(s => dom.endsWith(s) && dom.length > s.length)) return {ok: true};
  if (allowTest && (/\.(test|example|invalid|localhost)$/.test(dom) || /^example\.(com|net|org)$/.test(dom))) return {ok: true};
  let best = null, bd = 99;
  for (const d of EMAIL_DOMAINS) {
    const dist = emailEditDistance(dom, d);
    if (dist < bd) { bd = dist; best = d; }
  }
  // 短域名（qq.com、163.com）只允许差 1 个字；长一些的（gmail.com、outlook.com）允许差 2 个
  const limit = best && best.length >= 9 ? 2 : 1;
  return {ok: false, suggest: best && bd > 0 && bd <= limit ? best : null};
}
