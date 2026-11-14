import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fakeDocument, tick} from './upd-fake-dom.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const src = (name) => readFileSync(join(root, 'src', name), 'utf8');

function loadUpdater(){
  const ctx = {
    window: {},
    document: {addEventListener(){}, visibilityState:'visible'},
    console,
    setTimeout,
    clearTimeout,
    Promise,
    fetch: async () => { throw new Error('fetch should not run in this test'); },
  };
  vm.createContext(ctx);
  vm.runInContext(src('33_update.js'), ctx);
  return ctx;
}

test('清单地址默认为空，版本比较按 SemVer（含预发布号）', () => {
  const ctx = loadUpdater();
  assert.equal(ctx.updateManifestUrl(), '');
  assert.equal(ctx.builtinAppVersion(), '1.0.0');
  assert.equal(ctx.runningAppVersion(), '1.0.0');
  assert.equal(ctx.cmpVer('0.7.0-m7.r6', '0.7.0-m7.r6'), 0);
  assert.ok(ctx.versionNewer('0.7.0-m7.r7', '0.7.0-m7.r6'));
  assert.ok(ctx.versionNewer('0.7.1', '0.7.0-m7.r6'));
  assert.equal(ctx.versionNewer('0.7.0-m7.r6', '0.7.0-m7.r6'), false);
  assert.equal(ctx.versionNewer('0.7.0-m7.r5', '0.7.0-m7.r6'), false);
  assert.ok(ctx.versionNewer('0.7.0-m7.r6.1', '0.7.0-m7.r6'));
});

test('浏览器 / 非原生环境 updaterPlugin 为空，bootUpdater 不发请求', async () => {
  let fetched = 0;
  const ctx = {
    window: {NOVA_UPDATE_MANIFEST_URL: 'https://example.com/updates.json', NovaNative: {}},
    document: {addEventListener(){}, visibilityState:'visible'},
    console,
    setTimeout,
    clearTimeout,
    Promise,
    fetch: async () => { fetched += 1; return {ok:true, json: async ()=>({})}; },
  };
  vm.createContext(ctx);
  vm.runInContext(src('33_update.js'), ctx);
  await ctx.bootUpdater();
  assert.equal(ctx.updaterPlugin(), null);
  assert.equal(fetched, 0);
});

test('清单为空时即使在原生壳也不检查更新，但仍调用 notifyAppReady', async () => {
  const calls = [];
  const U = {
    async notifyAppReady(){ calls.push('ready'); return {bundle:{id:'builtin', version:'0.7.0-m7.r6'}}; },
    async current(){ calls.push('current'); return {bundle:{id:'builtin', version:'0.7.0-m7.r6'}, native:'0.7.0-m7.r6'}; },
    async download(){ calls.push('download'); return {id:'x'}; },
    async next(){ calls.push('next'); },
  };
  const ctx = {
    window: {
      NOVA_APP_VERSION: '0.7.0-m7.r6',
      NOVA_UPDATE_MANIFEST_URL: '',
      NovaNative: {Capacitor:{isNativePlatform:()=>true}, CapacitorUpdater:U},
    },
    document: {addEventListener(){}, visibilityState:'visible'},
    console, setTimeout, clearTimeout, Promise,
    fetch: async () => { calls.push('fetch'); return {ok:true, json:async()=>({version:'9.0.0', url:'https://x/a.zip'})}; },
  };
  vm.createContext(ctx);
  vm.runInContext(src('33_update.js'), ctx);
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(calls.filter(x=>x!=='current'), ['ready']);
  assert.ok(!calls.includes('fetch'));
  assert.ok(!calls.includes('download'));
});

test('有新版本时先弹窗询问；点「更新」才下载并 next，不在当前会话 set；校验失败显示重试并删除包', async () => {
  const calls = [];
  let onDl = null;
  const U = {
    async notifyAppReady(){ calls.push('ready'); return {bundle:{id:'builtin', version:'0.7.0-m7.r6'}}; },
    async current(){ return {bundle:{id:'builtin', version:'0.7.0-m7.r6'}, native:'0.7.0-m7.r6'}; },
    async list(){ return {bundles: []}; },
    async addListener(ev, fn){ if (ev === 'download') onDl = fn; return {remove(){ calls.push('unlisten'); }}; },
    async download(opts){ calls.push('download:'+opts.version+':'+(opts.checksum||'')); if (onDl) onDl({percent: 70, bundle:{version: opts.version}}); return {id:'b1', version:opts.version}; },
    async next(opts){ calls.push('next:'+opts.id); },
    async set(opts){ calls.push('set:'+opts.id); },
    async delete(opts){ calls.push('delete:'+opts.id); },
  };
  const doc = fakeDocument();
  const ctx = {
    window: {
      NOVA_APP_VERSION: '0.7.0-m7.r6',
      NOVA_UPDATE_MANIFEST_URL: 'https://example.com/updates.json',
      NovaNative: {Capacitor:{isNativePlatform:()=>true}, CapacitorUpdater:U},
    },
    document: doc,
    console, setTimeout, clearTimeout, Promise,
    fetch: async (url) => {
      calls.push('fetch:'+url);
      return {ok:true, json:async()=>({version:'0.7.0-m7.r6.1', url:'https://example.com/n.zip', checksum:'abc'})};
    },
  };
  vm.createContext(ctx);
  vm.runInContext(src('33_update.js'), ctx);
  await tick(40);
  assert.ok(calls.includes('ready'));
  assert.ok(calls.includes('fetch:https://example.com/updates.json'));
  assert.ok(!calls.some(c => c.startsWith('download')), '用户确认前不下载');
  assert.match(doc.dialogHtml(), /发现新版本 0\.7\.0-m7\.r6\.1，是否更新？/);
  assert.match(doc.dialogHtml(), /data-upd="go"[^>]*>更新</);
  assert.match(doc.dialogHtml(), /data-upd="later"[^>]*>稍后</);
  doc.tap('go');
  await tick(40);
  assert.ok(calls.includes('download:0.7.0-m7.r6.1:abc'));
  assert.ok(calls.includes('next:b1'));
  assert.ok(calls.includes('unlisten'));
  assert.ok(!calls.some(c => c.startsWith('set')), '不自动 set');
  assert.match(doc.dialogHtml(), /已完成/);
  assert.match(doc.dialogHtml(), /重启生效/);
  doc.tap('restart');
  await tick(20);
  assert.ok(calls.includes('set:b1'), '点「重启生效」才 set');

  const c2 = [];
  const U2 = {
    async notifyAppReady(){ return {bundle:{id:'builtin', version:'0.7.0-m7.r6'}}; },
    async current(){ return {bundle:{id:'builtin', version:'0.7.0-m7.r6'}, native:'0.7.0-m7.r6'}; },
    async download(){ c2.push('download'); throw new Error('checksum mismatch'); },
    async next(){ c2.push('next-bad'); },
    async delete(opts){ c2.push('delete:'+opts.id); },
  };
  const doc2 = fakeDocument();
  const ctx2 = {
    window: {
      NOVA_APP_VERSION: '0.7.0-m7.r6',
      NOVA_UPDATE_MANIFEST_URL: 'https://example.com/updates.json',
      NovaNative: {Capacitor:{isNativePlatform:()=>true}, CapacitorUpdater:U2},
    },
    document: doc2,
    console, setTimeout, clearTimeout, Promise,
    fetch: async () => ({ok:true, json:async()=>({version:'0.8.0', url:'https://example.com/n.zip', checksum:'nope'})}),
  };
  vm.createContext(ctx2);
  vm.runInContext(src('33_update.js'), ctx2);
  await tick(40);
  doc2.tap('go');
  await tick(40);
  assert.ok(!c2.includes('next-bad'));
  assert.match(doc2.dialogHtml(), /下载失败/);
  assert.match(doc2.dialogHtml(), /data-upd="retry"/);
  doc2.tap('retry');
  await tick(40);
  assert.equal(c2.filter(x => x === 'download').length, 2, '重试会再下载一次');
});

test('1.0.7 更新对话框：进度显示「正在下载 n%」；「稍后」本次不再弹；已下载的同版本直接显示已完成；英文界面', async () => {
  let release, onDl;
  const U = {
    async notifyAppReady(){}, async current(){ return {bundle:{id:'builtin'}}; },
    async list(){ return {bundles: []}; },
    async addListener(ev, fn){ onDl = fn; return {remove(){}}; },
    download(){ return new Promise(r => { release = r; }); },
    async next(){}, async delete(){},
  };
  const doc = fakeDocument();
  const ctx = {
    window: {NOVA_APP_VERSION:'1.0.6', NOVA_UPDATE_MANIFEST_URL:'https://x/m.json', NovaNative:{Capacitor:{isNativePlatform:()=>true}, CapacitorUpdater:U}},
    document: doc, console, setTimeout, clearTimeout, Promise,
    fetch: async () => ({ok:true, json:async()=>({version:'1.0.8', url:'https://x/b.zip'})}),
  };
  vm.createContext(ctx);
  vm.runInContext(src('33_update.js'), ctx);
  await tick(40);
  doc.tap('go');
  await tick(20);
  assert.match(doc.dialogHtml(), /正在下载 0%/);
  onDl({percent: 42, bundle: {version: '1.0.8'}});
  assert.match(doc.dialogHtml(), /正在下载 42%/);
  assert.match(doc.dialogHtml(), /width:42%/);
  assert.match(doc.dialogHtml(), /aria-valuenow="42"/);
  release({id: 'b8', version: '1.0.8'});
  await tick(20);
  assert.match(doc.dialogHtml(), /已完成/);
  doc.tap('close');
  assert.equal(doc.dialogHtml(), '', '关闭后对话框消失（下次启动生效）');

  // 稍后：同一会话里不再弹
  const doc2 = fakeDocument();
  const U2 = {...U, download: async () => { throw new Error('should not download'); }};
  const ctx2 = {...ctx, document: doc2, window: {...ctx.window, NovaNative:{Capacitor:{isNativePlatform:()=>true}, CapacitorUpdater:U2}}};
  vm.createContext(ctx2);
  vm.runInContext(src('33_update.js'), ctx2);
  await tick(40);
  doc2.tap('later');
  assert.equal(doc2.dialogHtml(), '');
  await vm.runInContext('checkAndDownloadUpdate(updaterPlugin())', ctx2);
  assert.equal(doc2.dialogHtml(), '', '点过稍后，本次不再弹');

  // 已下载好的同版本：直接已完成；英文
  const doc3 = fakeDocument();
  const U3 = {...U, list: async () => ({bundles: [{id: 'b8', version: '1.0.8', status: 'pending'}]}), download: async () => { throw new Error('no re-download'); }};
  const ctx3 = {...ctx, LANG: 'en', document: doc3, window: {...ctx.window, NovaNative:{Capacitor:{isNativePlatform:()=>true}, CapacitorUpdater:U3}}};
  vm.createContext(ctx3);
  vm.runInContext('var LANG="en";' + src('33_update.js'), ctx3);
  await tick(40);
  assert.match(doc3.dialogHtml(), /Done/);
  assert.match(doc3.dialogHtml(), /Restart now/);
  assert.match(doc3.dialogHtml(), />Close</);
});

test('capacitor.config 为自托管手动模式且不指向 Capgo 云', () => {
  const cfg = JSON.parse(readFileSync(join(root, 'capacitor.config.json'), 'utf8'));
  const u = cfg.plugins.CapacitorUpdater;
  assert.equal(u.autoUpdate, false);
  assert.equal(u.updateUrl, '');
  assert.equal(u.statsUrl, '');
  assert.equal(u.channelUrl, '');
  assert.equal(u.appReadyTimeout, 10000);
  assert.equal(u.autoDeleteFailed, true);
  assert.equal(u.version, '1.0.0');
});

test('小游戏宫格使用自绘 SVG 图标，不再用单字', () => {
  const js = src('31_games.js');
  assert.match(js, /function gameIcon\(/);
  assert.match(js, /const GAME_ICO=/);
  for (const id of ['2048','tower','gobang','chess','snake','solitaire','reversi','calc24','mines','sudoku','c4']) {
    assert.match(js, new RegExp("(^|\\n)\\s*['\"]?"+id+"['\"]?:"), `missing icon for ${id}`);
  }
  assert.match(js, /<span class="gico">\$\{gameIcon\(g\.id\)\}<\/span>/);
  assert.doesNotMatch(js, /esc\(g\.name\)\.slice\(0,1\)/);
});

test('打包脚本与说明文档存在', () => {
  assert.ok(existsSync(join(root, 'scripts/make-bundle.mjs')));
  const mk=readFileSync(join(root, 'scripts/make-bundle.mjs'), 'utf8');
  assert.match(mk, /requireDeployConfig/);
  assert.match(mk, /NOVA_API_BASE/);
  assert.match(mk, /NOVA_DISABLE_DEMO/);
  assert.match(mk, /NOVA_UPDATE_MANIFEST_URL/);
  assert.ok(existsSync(join(root, 'docs/hot-update.md')));
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies['@capgo/capacitor-updater'], '^7.53.0');
  assert.equal(pkg.scripts.bundle, 'node scripts/make-bundle.mjs');
});
