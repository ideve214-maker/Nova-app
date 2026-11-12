// 把 src/ 里的分段文件按文件名顺序拼成单个 HTML：dist/nova_v5.html
import fs from 'node:fs';
const dir = new URL('../src/', import.meta.url);
const files = fs.readdirSync(dir).sort();
const head = files.filter(f => f.endsWith('.html')).map(f => fs.readFileSync(new URL(f, dir), 'utf8')).join('');
const js = files.filter(f => f.endsWith('.js')).map(f => `/* ===== ${f} ===== */\n` + fs.readFileSync(new URL(f, dir), 'utf8')).join('\n');
const out = head.replace(/\n?$/, '\n') + '<div id="app"><div id="v"></div><div id="tt" role="status"></div></div>\n<script>\n' + js + '\n</script></body></html>\n';
fs.mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../dist/nova_v5.html', import.meta.url), out);
const assets = new URL('../assets/', import.meta.url);
const dest = new URL('../dist/assets/', import.meta.url);
fs.mkdirSync(dest, { recursive: true });
for (const f of fs.readdirSync(assets)) {
  if (/\.(jpe?g|png|webp)$/i.test(f)) fs.copyFileSync(new URL(f, assets), new URL(f, dest));
}
console.log('built dist/nova_v5.html', out.length, 'bytes');
