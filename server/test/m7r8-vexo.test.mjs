import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {createApp} from '../index.mjs';
import {patchManifest, patchGradle, VERSION_CODE, VERSION_NAME} from '../../scripts/stamp-native.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const src = (name) => readFileSync(join(root, 'src', name), 'utf8');

test('建群键盘修复仍在：不全屏重绘时不自动聚焦群名，群名可空，创建按钮在顶部', () => {
  const sheet = src('50_sheets.js');
  const render = src('60_render.js');
  const actions = src('70_actions.js');
  const head = src('00_head.html');
  assert.match(sheet, /s\.t=='newg'/);
  assert.match(sheet, /full=1/);
  assert.match(sheet, /data-d="gn"/);
  assert.doesNotMatch(sheet.slice(sheet.indexOf("s.t=='newg'"), sheet.indexOf("s.t=='newg'") + 900), /data-af/);
  assert.match(sheet, /data-a="mkg"/);
  assert.match(render, /shKey!==prevShKey/);
  assert.match(render, /#v \.pn \[data-af\]/);
  assert.match(actions, /群名需要 1 到 20 个字/);
  assert.match(actions, /if\(!n\)/);
  assert.match(sheet, /默认用成员名字/);
  assert.match(head, /\.pn\.full \.pnh/);
});

test('zoomGuard 防缩放仍在，没有被改掉', () => {
  const z = src('75_r7.js');
  const start = z.indexOf('function zoomGuard');
  assert.ok(start > 0);
  const block = z.slice(start, start + 1600);
  assert.match(block, /gesturestart/);
  assert.match(block, /gesturechange/);
  assert.match(block, /touches\.length>1/);
  assert.match(block, /visualViewport/);
  assert.match(block, /user-scalable=no/);
  assert.match(src('00_head.html'), /touch-action:pan-x pan-y/);
});

test('热更新把清单里的 session_key 传给 download', async () => {
  const calls = [];
  const U = {
    async notifyAppReady(){ return {bundle:{id:'builtin', version:'1.0.0'}}; },
    async current(){ return {bundle:{id:'builtin', version:'1.0.0'}}; },
    async download(opts){ calls.push(opts); return {id:'b1', version:opts.version}; },
    async next(){},
    async delete(){},
  };
  const ctx = {
    window: {
      NOVA_APP_VERSION: '1.0.0',
      NOVA_UPDATE_MANIFEST_URL: 'https://example.com/updates.json',
      NovaNative: {Capacitor:{isNativePlatform:()=>true}, CapacitorUpdater:U},
    },
    document: {addEventListener(){}, visibilityState:'visible'},
    console, setTimeout, clearTimeout, Promise,
    fetch: async () => ({ok:true, json:async()=>({version:'1.0.1', url:'https://example.com/n.zip', checksum:'abc', session_key:'sek_test'})}),
  };
  vm.createContext(ctx);
  vm.runInContext(src('33_update.js'), ctx);
  await new Promise(r => setTimeout(r, 40));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sessionKey, 'sek_test');
  assert.equal(calls[0].session_key, 'sek_test');
  assert.equal(calls[0].checksum, 'abc');
  assert.equal(calls[0].version, '1.0.1');
});

test('退出登录会清会话、加密密钥、草稿、最近位置和本地缓存', () => {
  const auth = src('12_auth.js');
  const e2ee = src('26_e2ee.js');
  assert.match(auth, /e2eeForget\(uid\)/);
  assert.match(auth, /nova_compose_draft/);
  assert.match(auth, /nova_loc_recent/);
  assert.match(auth, /db\.posts\.clear\(\)/);
  assert.match(auth, /db\.msgs\.clear\(\)/);
  assert.match(e2ee, /function e2eeKey/);
  assert.match(e2ee, /function e2eeForget/);
  assert.match(e2ee, /e2eeKey, e2eeForget/);
});

test('版本是 VEXO 1.0.0，图标资源不再是占位说明', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const cap = JSON.parse(readFileSync(join(root, 'capacitor.config.json'), 'utf8'));
  assert.equal(pkg.version, '1.0.0');
  assert.equal(cap.appName, 'VEXO');
  assert.equal(cap.plugins.CapacitorUpdater.version, '1.0.0');
  const head = src('00_head.html');
  assert.match(head, /<title>VEXO<\/title>/);
  assert.match(head, /@font-face\{font-family:Inter/);
  assert.match(head, /assets\/fonts\/inter-latin-400\.woff2/);
  assert.equal(VERSION_NAME, '1.0.0');
  assert.equal(VERSION_CODE, 100);
});

test('原生清单只保留粗略定位，并写出版本号', () => {
  const sample = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-permission android:name="android.permission.INTERNET" />
    <application android:label="NOVA"></application>
</manifest>`;
  const out = patchManifest(sample);
  assert.match(out, /ACCESS_COARSE_LOCATION/);
  assert.match(out, /ACCESS_FINE_LOCATION" tools:node="remove"/);
  assert.doesNotMatch(out, /ACCESS_FINE_LOCATION" \/>/);
  const gradle = patchGradle('android {\n    defaultConfig {\n        versionCode 1\n        versionName "1.0"\n    }\n}\n');
  assert.match(gradle, /versionCode 100/);
  assert.match(gradle, /versionName "1\.0\.0"/);
  const stamp = readFileSync(join(root, 'scripts/stamp-native.mjs'), 'utf8');
  assert.match(stamp, /ACCESS_COARSE_LOCATION/);
  assert.doesNotMatch(stamp, /requestPermissions\(MainActivity\.this, new String\[\]\{Manifest\.permission\.ACCESS_FINE_LOCATION/);
});

test('打包脚本把图标目录指到 resources，生成失败就停', () => {
  const prep = readFileSync(join(root, 'scripts/prepare-v2-web.sh'), 'utf8');
  const apk = readFileSync(join(root, 'scripts/build-debug-apk.sh'), 'utf8');
  const ipa = readFileSync(join(root, 'scripts/build-unsigned-ipa.sh'), 'utf8');
  for (const text of [prep, apk, ipa]) assert.match(text, /--assetPath resources/);
  assert.doesNotMatch(apk, /WARN: capacitor-assets failed/);
  assert.doesNotMatch(ipa, /WARN: capacitor-assets failed/);
});

let srv, base, seq = 0;
test.before(async () => { srv = createApp(); await new Promise(r => srv.listen(0, '127.0.0.1', r)); base = 'http://127.0.0.1:' + srv.address().port; });
test.after(() => srv.close());
const call = async (m, p, body, tok) => {
  const r = await fetch(base + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  return {s: r.status, j: await r.json()};
};
async function acc(n) {
  const u = 'r8' + n + (++seq);
  const r = await call('POST', '/api/auth/register', {agree:true, username: u, email: u + '@x.test', password: 'Passw0rd123'});
  assert.equal(r.s, 200, JSON.stringify(r.j));
  return {tok: r.j.token, id: r.j.user.id};
}

test('帖子返回 r8 的 audienceLabel 和 isPublic', async () => {
  const a = await acc('aud');
  const pub = await call('POST', '/api/posts', {text: '公开', audience: 'public'}, a.tok);
  assert.equal(pub.j.post.audienceLabel, '公开');
  assert.equal(pub.j.post.isPublic, true);
  const fr = await call('POST', '/api/posts', {text: '粉丝', audience: 'followers'}, a.tok);
  assert.equal(fr.j.post.audienceLabel, '仅粉丝');
  assert.equal(fr.j.post.isPublic, false);
  const pals = await call('POST', '/api/posts', {text: '好友', audience: 'friends'}, a.tok);
  assert.equal(pals.j.post.audienceLabel, '仅好友');
  const self = await call('POST', '/api/posts', {text: '自己', audience: 'self'}, a.tok);
  assert.equal(self.j.post.audienceLabel, '仅自己');
  assert.equal(self.j.post.isPublic, false);
});

test('两人以上未处理举报才给出风险提示；自己看自己没有', async () => {
  const target = await acc('tgt');
  const one = await acc('one');
  const two = await acc('two');
  const look0 = await call('GET', '/api/users/' + target.id, null, one.tok);
  assert.equal(look0.j.user.risky, false);
  assert.equal(look0.j.user.riskNotice, '');
  const r1 = await call('POST', '/api/reports', {targetType:'user', targetId:String(target.id), reason:'骚扰'}, one.tok);
  assert.equal(r1.s, 200, JSON.stringify(r1.j));
  const look1 = await call('GET', '/api/users/' + target.id, null, two.tok);
  assert.equal(look1.j.user.risky, false);
  const r2 = await call('POST', '/api/reports', {targetType:'user', targetId:String(target.id), reason:'诈骗'}, two.tok);
  assert.equal(r2.s, 200, JSON.stringify(r2.j));
  const look2 = await call('GET', '/api/users/' + target.id, null, one.tok);
  assert.equal(look2.j.user.risky, true);
  assert.match(look2.j.user.riskNotice, /举报/);
  const self = await call('GET', '/api/users/' + target.id, null, target.tok);
  assert.equal(self.j.user.risky, false);
  assert.equal(self.j.user.riskNotice, '');
});
