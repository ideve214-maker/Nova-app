// 命令速查 API：不访问外网，全部用假的 fetch。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';
import {parseTldrMd, compactIndex, searchIndex, pageUrls, pagePath, attribution, normalizeCmd} from '../tldr.mjs';

const LS_ZH = `# ls

> 列出目录内容。

- 列出当前目录的文件：

  \`ls\`

- 列出全部文件，包括隐藏文件：

  \`ls -a\`
`;
const CURL_EN = `# curl

> Transfers data from or to a server.

- Download a file:

  \`curl -O {{url}}\`
`;

function mockFetch(index, pages, {failIndex = false, failPages = false, calls} = {}) {
  const log = calls || [];
  return async (url) => {
    log.push(String(url));
    if (String(url).includes('index.json')) {
      if (failIndex) throw new Error('network down');
      return {ok: true, status: 200, json: async () => index, text: async () => JSON.stringify(index)};
    }
    if (failPages) throw new Error('network down');
    const body = pages[String(url)];
    if (body == null) return {ok: false, status: 404, json: async () => ({}), text: async () => 'not found'};
    return {ok: true, status: 200, json: async () => ({}), text: async () => body};
  };
}

const INDEX = {commands: [
  {name: 'ls', platform: ['common', 'linux'], language: ['en', 'zh']},
  {name: 'tar', platform: ['common'], language: ['en', 'zh']},
  {name: 'curl', platform: ['common'], language: ['en']},
  {name: 'git', platform: ['common'], language: ['en', 'zh']},
  {name: 'windows-only', platform: ['windows'], language: ['en']},
]};

function pagesFor(indexPages) {
  const map = {};
  for (const [path, body] of Object.entries(indexPages)) {
    for (const base of ['https://raw.githubusercontent.com/tldr-pages/tldr/main/', 'https://cdn.jsdelivr.net/gh/tldr-pages/tldr@main/']) {
      map[base + path] = body;
    }
  }
  return map;
}

let seq = 0;
async function boot(fetchFn) {
  const srv = createApp({tldrFetch: fetchFn});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const call = async (m, p, body, tok) => {
    const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
    return {s: r.status, j: await r.json()};
  };
  const acc = async () => {
    const u = 'tldr' + (++seq);
    const r = await call('POST', '/api/auth/register', {agree: true, username: u, email: u + '@x.test', password: 'Passw0rd123'});
    assert.equal(r.s, 200, JSON.stringify(r.j));
    return r.j.token;
  };
  return {srv, call, acc, close: () => new Promise(r => { srv.close(r); srv.closeAllConnections?.(); })};
}

test('parseTldrMd 能拆出标题、说明和带命令的例子', () => {
  const p = parseTldrMd(LS_ZH);
  assert.equal(p.title, 'ls');
  assert.match(p.description, /列出目录内容/);
  assert.equal(p.examples.length, 2);
  assert.equal(p.examples[0].code, 'ls');
  assert.equal(p.examples[1].code, 'ls -a');
});

test('compactIndex 只保留中英和 common/linux/osx', () => {
  const map = compactIndex(INDEX);
  assert.ok(map.ls && map.curl && map.git && map.tar);
  assert.equal(map['windows-only'], undefined);
  assert.deepEqual(map.ls.languages.sort(), ['en', 'zh']);
  assert.ok(!map.curl.languages.includes('zh'));
});

test('searchIndex：空查询给出常用命令，输入按前缀优先', () => {
  const map = compactIndex(INDEX);
  const empty = searchIndex(map, '');
  assert.ok(empty[0].name === 'ls' || empty.some(x => x.name === 'ls'));
  const q = searchIndex(map, 'c');
  assert.equal(q[0].name, 'curl');
});

test('normalizeCmd 拒绝空串和奇怪字符', () => {
  assert.equal(normalizeCmd('LS'), 'ls');
  assert.equal(normalizeCmd('git-commit'), 'git-commit');
  assert.equal(normalizeCmd('../etc/passwd'), '');
  assert.equal(normalizeCmd(''), '');
});

test('未登录不能查', async () => {
  const pages = pagesFor({'pages.zh/common/ls.md': LS_ZH});
  const s = await boot(mockFetch(INDEX, pages));
  const r = await s.call('GET', '/api/tldr?q=ls');
  assert.equal(r.s, 401);
  await s.close();
});

test('GET /api/tldr?q=ls 返回匹配项和署名', async () => {
  const pages = pagesFor({'pages.zh/common/ls.md': LS_ZH});
  const s = await boot(mockFetch(INDEX, pages));
  const tok = await s.acc();
  const r = await s.call('GET', '/api/tldr?q=ls', null, tok);
  assert.equal(r.s, 200, JSON.stringify(r.j));
  assert.ok(r.j.items.some(x => x.name === 'ls'));
  assert.match(r.j.attribution.text, /tldr-pages/);
  assert.equal(r.j.attribution.license, 'CC BY 4.0');
  assert.match(r.j.attribution.url, /tldr-pages\/tldr/);
  await s.close();
});

test('GET /api/tldr?cmd=ls 优先中文页，并带原文链接', async () => {
  const pages = pagesFor({
    'pages.zh/common/ls.md': LS_ZH,
    'pages/common/ls.md': '# ls\n\n> English only fallback.\n',
  });
  const s = await boot(mockFetch(INDEX, pages));
  const tok = await s.acc();
  const r = await s.call('GET', '/api/tldr?cmd=ls', null, tok);
  assert.equal(r.s, 200, JSON.stringify(r.j));
  assert.equal(r.j.name, 'ls');
  assert.equal(r.j.language, 'zh');
  assert.equal(r.j.platform, 'common');
  assert.match(r.j.description, /列出目录内容/);
  assert.equal(r.j.examples[0].code, 'ls');
  assert.match(r.j.attribution.pageUrl, /pages\.zh\/common\/ls\.md/);
  assert.match(r.j.attribution.text, /CC BY 4.0/);
  await s.close();
});

test('没有中文时退回英文', async () => {
  const pages = pagesFor({'pages/common/curl.md': CURL_EN});
  const s = await boot(mockFetch(INDEX, pages));
  const tok = await s.acc();
  const r = await s.call('GET', '/api/tldr?cmd=curl', null, tok);
  assert.equal(r.s, 200, JSON.stringify(r.j));
  assert.equal(r.j.language, 'en');
  assert.match(r.j.description, /Transfers data/i);
  await s.close();
});

test('找不到命令返回 404，说明清楚', async () => {
  const s = await boot(mockFetch(INDEX, pagesFor({})));
  const tok = await s.acc();
  const r = await s.call('GET', '/api/tldr?cmd=not-a-real-cmd-xyz', null, tok);
  assert.equal(r.s, 404);
  assert.equal(r.j.error.code, 'NOT_FOUND');
  assert.match(r.j.error.message, /没有找到/);
  await s.close();
});

test('非法命令名返回 400', async () => {
  const s = await boot(mockFetch(INDEX, pagesFor({})));
  const tok = await s.acc();
  const r = await s.call('GET', '/api/tldr?cmd=' + encodeURIComponent('../foo'), null, tok);
  assert.equal(r.s, 400);
  await s.close();
});

test('外网失败时返回 503 和明确提示；有缓存时仍能用', async () => {
  const calls = [];
  const pages = pagesFor({'pages.zh/common/ls.md': LS_ZH});
  const s = await boot(mockFetch(INDEX, pages, {calls}));
  const tok = await s.acc();
  const ok = await s.call('GET', '/api/tldr?cmd=ls', null, tok);
  assert.equal(ok.s, 200);
  const n = calls.length;
  const again = await s.call('GET', '/api/tldr?cmd=ls', null, tok);
  assert.equal(again.s, 200);
  assert.equal(calls.length, n, '第二次应走内存缓存，不再请求外网');
  await s.close();

  const down = await boot(mockFetch(INDEX, pages, {failIndex: true, failPages: true}));
  const tok2 = await down.acc();
  const r = await down.call('GET', '/api/tldr?q=ls', null, tok2);
  assert.equal(r.s, 503);
  assert.equal(r.j.error.code, 'TLDR_UNAVAILABLE');
  assert.match(r.j.error.message, /网络|再试/);
  const r2 = await down.call('GET', '/api/tldr?cmd=ls', null, tok2);
  assert.equal(r2.s, 503);
  await down.close();
});

test('pageUrls 指向官方仓库路径', () => {
  const u = pageUrls('zh', 'common', 'ls');
  assert.ok(u.some(x => x.endsWith(pagePath('zh', 'common', 'ls'))));
  assert.equal(attribution('pages.zh/common/ls.md').license, 'CC BY 4.0');
});
