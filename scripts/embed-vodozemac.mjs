// 把 vendored @kinsh/vodozemac-wasm（Apache-2.0）的 WASM 内联成可在普通 <script> 与 file:// 下使用的 IIFE。
// 由 scripts/build.mjs 在拼接前端时调用，不把 600KB 生成物放进 src/。
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

export function vodozemacDir() {
  return join(dirname(fileURLToPath(import.meta.url)), '../vendor/vodozemac');
}

export function vodozemacIife() {
  const dir = join(vodozemacDir(), 'pkg-web');
  let js = readFileSync(join(dir, 'kinsh_vodozemac_wasm.js'), 'utf8');
  const wasm = readFileSync(join(dir, 'kinsh_vodozemac_wasm_bg.wasm'));
  const b64 = wasm.toString('base64');
  js = js.replace(/^export class /gm, 'class ');
  js = js.replace(/^export function /gm, 'function ');
  js = js.replace(/^export \{[^}]+\};?\s*$/gm, '');
  js = js.replace(
    /if\s*\(\s*module_or_path\s*===\s*undefined\s*\)\s*\{\s*module_or_path\s*=\s*new URL\('kinsh_vodozemac_wasm_bg\.wasm',\s*import\.meta\.url\);\s*\}/,
    'if (module_or_path === undefined) { module_or_path = Uint8Array.from(atob(VODOZEMAC_WASM_B64), function(c){return c.charCodeAt(0);}).buffer; }'
  );
  if (js.includes('import.meta')) {
    throw new Error('embed-vodozemac: import.meta still present, pattern failed');
  }
  if (/\bexport\b/.test(js)) {
    throw new Error('embed-vodozemac: leftover export');
  }
  return '/* vendored @kinsh/vodozemac-wasm 0.4.2, Apache-2.0; crypto is official vodozemac (Olm). */\n'
    + '(function(global){\n'
    + 'const VODOZEMAC_WASM_B64="' + b64 + '";\n'
    + js
    + '\nglobal.Vodozemac={init:__wbg_init,initSync:initSync,Account:Account,Session:Session,InboundResult:InboundResult,GroupSession:GroupSession,InboundGroupSession:InboundGroupSession};\n'
    + '})(typeof window!=="undefined"?window:globalThis);\n';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = vodozemacIife();
  console.log('iife bytes', s.length);
}
