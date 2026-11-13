// 把浏览器端依赖打成普通脚本，供无打包器的客户端页面加载。
import {build} from 'esbuild';
import {cpSync, mkdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'assets/vendor');
mkdirSync(out, {recursive: true});
const nm = join(root, 'node_modules');

cpSync(join(nm, 'dompurify/dist/purify.min.js'), join(out, 'purify.min.js'));
cpSync(join(nm, 'dexie/dist/dexie.min.js'), join(out, 'dexie.min.js'));
cpSync(join(nm, 'pulltorefreshjs/dist/index.umd.js'), join(out, 'pulltorefresh.min.js'));
cpSync(join(nm, 'photoswipe/dist/photoswipe.css'), join(out, 'photoswipe.css'));

const entries = {
  'photoswipe.js': `
    import PhotoSwipe from 'photoswipe';
    globalThis.PhotoSwipe = PhotoSwipe;
  `,
  'virtual.js': `
    import * as TV from '@tanstack/virtual-core';
    globalThis.TanVirtual = TV;
  `,
  'sentry.js': `
    import * as Sentry from '@sentry/browser';
    globalThis.NovaSentry = Sentry;
  `,
  'nova-native.js': `
    import { Capacitor } from '@capacitor/core';
    import { Keyboard, KeyboardResize } from '@capacitor/keyboard';
    import { StatusBar, Style } from '@capacitor/status-bar';
    import { Haptics, ImpactStyle } from '@capacitor/haptics';
    globalThis.NovaNative = { Capacitor, Keyboard, KeyboardResize, StatusBar, Style, Haptics, ImpactStyle };
  `,
};

for (const [file, contents] of Object.entries(entries)) {
  await build({
    stdin: {contents, resolveDir: root, sourcefile: file},
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    outfile: join(out, file),
    legalComments: 'none',
    logLevel: 'warning',
  });
}
console.log('vendor bundles', out);
