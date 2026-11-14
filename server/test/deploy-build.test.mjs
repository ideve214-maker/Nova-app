// DEPLOY.1 / DEPLOY.3：构建可注入 API 基址与关闭演示；源码中的网络请求都走 apiUrl。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {parseBuildOpts, build} from '../../scripts/build.mjs';

const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));

test('parseBuildOpts 读取 --api-base / --disable-demo 与环境变量', () => {
  const empty = parseBuildOpts([], {});
  assert.equal(empty.apiBase, '');
  assert.equal(empty.disableDemo, false);
  assert.equal(empty.secureTransport, false);
  assert.equal(empty.bugsink, false);
  assert.equal(parseBuildOpts(['--api-base=https://api.example.com/'], {}).apiBase, 'https://api.example.com');
  assert.equal(parseBuildOpts(['--secure-transport'], {}).secureTransport, true);
  assert.equal(parseBuildOpts(['--disable-demo'], {}).disableDemo, true);
  assert.equal(parseBuildOpts(['--disable-demo', 'true'], {}).disableDemo, true);
  assert.equal(parseBuildOpts([], {NOVA_API_BASE: 'https://x.test/', NOVA_DISABLE_DEMO: '1'}).apiBase, 'https://x.test');
  assert.equal(parseBuildOpts([], {NOVA_DISABLE_DEMO: 'true'}).disableDemo, true);
  assert.equal(parseBuildOpts([], {}).updateManifestUrl, '');
  assert.equal(parseBuildOpts(['--update-manifest-url=https://example.com/u.json'], {}).updateManifestUrl, 'https://example.com/u.json');
  assert.equal(parseBuildOpts([], {NOVA_UPDATE_MANIFEST_URL: 'https://cdn.example/updates.json'}).updateManifestUrl, 'https://cdn.example/updates.json');
});

test('build 注入 window.NOVA_API_BASE 与 NOVA_DISABLE_DEMO；默认构建不注入', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nova-build-'));
  const a = build({apiBase: 'https://api.example.com', disableDemo: true, destDir: dir});
  assert.match(a.html, /window\.NOVA_API_BASE = window\.NOVA_API_BASE \|\| "https:\/\/api\.example\.com"/);
  assert.match(a.html, /window\.NOVA_DISABLE_DEMO/);
  const written = readFileSync(join(dir, 'nova_v5.html'), 'utf8');
  assert.equal(written, a.html);
  const b = build({destDir: mkdtempSync(join(tmpdir(), 'nova-build-'))});
  assert.doesNotMatch(b.html, /window\.NOVA_API_BASE = window\.NOVA_API_BASE/);
  assert.doesNotMatch(b.html, /window\.NOVA_DISABLE_DEMO = window\.NOVA_DISABLE_DEMO/);
});

test('src/ 里所有 fetch 到 /api/ 都经过 apiUrl，不直接写死路径', () => {
  const files = readdirSync(srcDir).filter(f => f.endsWith('.js'));
  const hits = [];
  for (const f of files) {
    const t = readFileSync(join(srcDir, f), 'utf8');
    const re = /fetch\s*\(\s*(['"`])\/api\//g;
    let m;
    while ((m = re.exec(t))) hits.push(f + ':' + t.slice(0, m.index).split('\n').length);
  }
  assert.deepEqual(hits, [], '不应再出现 fetch("/api/...")，请改用 apiUrl()');
  const auth = readFileSync(join(srcDir, '12_auth.js'), 'utf8');
  assert.match(auth, /function apiBase\(/);
  assert.match(auth, /function apiUrl\(/);
  assert.match(auth, /fetch\(apiUrl\(path\)/);
  assert.match(auth, /fetch\(apiUrl\('\/api\/health'\)/);
  assert.match(auth, /fetch\(apiUrl\('\/api\/auth\/logout'\)/);
  const chat = readFileSync(join(srcDir, '22_chat.js'), 'utf8');
  assert.match(chat, /fetch\(apiUrl\('\/api\/events'\)/);
  const act = readFileSync(join(srcDir, '70_actions.js'), 'utf8');
  assert.match(act, /fetch\(apiUrl\('\/api\/media'\)/);
});

test('默认构建注入 NOVA_APP_VERSION，不注入热更新清单地址', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nova-build-'));
  const b = build({destDir: dir});
  const ver = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
  assert.ok(b.html.includes(`window.NOVA_APP_VERSION = window.NOVA_APP_VERSION || ${JSON.stringify(ver)}`), '注入的版本号应等于 package.json 的 ' + ver);
  assert.doesNotMatch(b.html, /window\.NOVA_UPDATE_MANIFEST_URL = window\.NOVA_UPDATE_MANIFEST_URL/);
  assert.ok(readdirSync(dir).includes('index.html'));
});

test('构建可注入 NOVA_UPDATE_MANIFEST_URL', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nova-build-'));
  const a = build({updateManifestUrl: 'https://example.com/nova/updates.json', destDir: dir});
  assert.match(a.html, /window\.NOVA_UPDATE_MANIFEST_URL = window\.NOVA_UPDATE_MANIFEST_URL \|\| "https:\/\/example\.com\/nova\/updates\.json"/);
});

