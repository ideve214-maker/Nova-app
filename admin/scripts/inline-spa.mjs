#!/usr/bin/env node
/**
 * Turn dist-spa/spa.html + its JS/CSS assets into one self-contained HTML file
 * that works on iPhone file preview (file://) because nothing is loaded from a sibling path.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "dist-spa");
const srcHtml = ["spa.html", "index.html"]
  .map((n) => join(dir, n))
  .find((p) => {
    try { return statSync(p).isFile(); } catch { return false; }
  });
if (!srcHtml) {
  console.error("dist-spa/spa.html 不存在，请先运行 SPA 构建。");
  process.exit(1);
}

function readAsset(urlPath) {
  const clean = urlPath.split("?")[0].replace(/^\.\//, "").replace(/^\//, "");
  const file = join(dir, clean);
  return readFileSync(file, "utf8");
}

let html = readFileSync(srcHtml, "utf8");

// Drop modulepreload / icon links that would 404 on file://
html = html.replace(/<link[^>]+rel="modulepreload"[^>]*>/gi, "");
html = html.replace(/<link[^>]+crossorigin[^>]*>/gi, (tag) => {
  if (/rel="stylesheet"/i.test(tag)) return tag;
  return "";
});

html = html.replace(/<link([^>]*?)rel="stylesheet"([^>]*?)>/gi, (full) => {
  const m = full.match(/href="([^"]+)"/);
  if (!m) return full;
  if (/^https?:/i.test(m[1])) return full;
  const css = readAsset(m[1]);
  return `<style>${css}</style>`;
});

html = html.replace(/<script([^>]*?)src="([^"]+)"([^>]*)><\/script>/gi, (full, a, src, b) => {
  if (/^https?:/i.test(src)) return full;
  const js = readAsset(src);
  const isModule = /type="module"/.test(full) || /type="module"/.test(a) || /type="module"/.test(b);
  const type = isModule ? ' type="module"' : "";
  return `<script${type}>\n${js}\n</script>`;
});

const out = join(dir, "NOVA_Admin.html");
writeFileSync(out, html);
// also as index.html so a static server can serve it at /
writeFileSync(join(dir, "index.html"), html);
console.log(`Wrote ${out} (${(html.length / 1024 / 1024).toFixed(2)} MB)`);
