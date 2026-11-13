import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {createRequire} from 'node:module';

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
  assert.equal(ctx.builtinAppVersion(), '0.7.0-m7.r7');
  assert.equal(ctx.runningAppVersion(), '0.7.0-m7.r7');
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

test('有新版本时下载并 next，不在当前会话 set；校验失败则删除包', async () => {
  const calls = [];
  const U = {
    async notifyAppReady(){ calls.push('ready'); return {bundle:{id:'builtin', version:'0.7.0-m7.r6'}}; },
    async current(){ return {bundle:{id:'builtin', version:'0.7.0-m7.r6'}, native:'0.7.0-m7.r6'}; },
    async download(opts){ calls.push('download:'+opts.version+':'+(opts.checksum||'')); return {id:'b1', version:opts.version}; },
    async next(opts){ calls.push('next:'+opts.id); },
    async set(){ calls.push('set'); },
    async delete(opts){ calls.push('delete:'+opts.id); },
  };
  const ctx = {
    window: {
      NOVA_APP_VERSION: '0.7.0-m7.r6',
      NOVA_UPDATE_MANIFEST_URL: 'https://example.com/updates.json',
      NovaNative: {Capacitor:{isNativePlatform:()=>true}, CapacitorUpdater:U},
    },
    document: {addEventListener(){}, visibilityState:'visible'},
    console, setTimeout, clearTimeout, Promise,
    fetch: async (url) => {
      calls.push('fetch:'+url);
      return {ok:true, json:async()=>({version:'0.7.0-m7.r6.1', url:'https://example.com/n.zip', checksum:'abc'})};
    },
  };
  vm.createContext(ctx);
  vm.runInContext(src('33_update.js'), ctx);
  await new Promise(r => setTimeout(r, 40));
  assert.ok(calls.includes('ready'));
  assert.ok(calls.includes('fetch:https://example.com/updates.json'));
  assert.ok(calls.includes('download:0.7.0-m7.r6.1:abc'));
  assert.ok(calls.includes('next:b1'));
  assert.ok(!calls.includes('set'));

  const U2 = {
    async notifyAppReady(){ return {bundle:{id:'builtin', version:'0.7.0-m7.r6'}}; },
    async current(){ return {bundle:{id:'builtin', version:'0.7.0-m7.r6'}, native:'0.7.0-m7.r6'}; },
    async download(){ const err=new Error('checksum mismatch'); throw err; },
    async next(){ calls.push('next-bad'); },
    async delete(opts){ calls.push('delete:'+opts.id); },
  };
  const ctx2 = {
    window: {
      NOVA_APP_VERSION: '0.7.0-m7.r6',
      NOVA_UPDATE_MANIFEST_URL: 'https://example.com/updates.json',
      NovaNative: {Capacitor:{isNativePlatform:()=>true}, CapacitorUpdater:U2},
    },
    document: {addEventListener(){}, visibilityState:'visible'},
    console, setTimeout, clearTimeout, Promise,
    fetch: async () => ({ok:true, json:async()=>({version:'0.8.0', url:'https://example.com/n.zip', checksum:'nope'})}),
  };
  vm.createContext(ctx2);
  vm.runInContext(src('33_update.js'), ctx2);
  await new Promise(r => setTimeout(r, 40));
  assert.ok(!calls.includes('next-bad'));
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
  assert.equal(u.version, '0.7.0-m7.r7');
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
  assert.ok(existsSync(join(root, 'docs/hot-update.md')));
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies['@capgo/capacitor-updater'], '^7.53.0');
  assert.equal(pkg.scripts.bundle, 'node scripts/make-bundle.mjs');
});
