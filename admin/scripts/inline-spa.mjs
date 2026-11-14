#!/usr/bin/env node
/**
 * After Vite writes dist-spa/ (multi-file: HTML + ./assets, base="./"):
 *   1. Ensure dist-spa/index.html is the MULTI-FILE shell (Capacitor webDir).
 *   2. Also emit dist-spa/VEXO_Admin.html — a single inlined file for file:// / 分享。
 * Never overwrite index.html with the inlined bundle.
 */
import { readFileSync, writeFileSync, copyFileSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "dist-spa");

function isFile(p) {
  try { return statSync(p).isFile(); } catch { return false; }
}

// Vite may emit spa.html (input name) or index.html.
const viteHtml = ["spa.html", "index.html"]
  .map((n) => join(dir, n))
  .find((p) => isFile(p) && !isInlined(p));

function isInlined(p) {
  try {
    const s = readFileSync(p, "utf8");
    // Inlined file has the bundle inside a <script> and is several MB.
    return s.length > 200_000 || /<script type="module">\s*\n/.test(s);
  } catch {
    return false;
  }
}

if (!viteHtml) {
  console.error("dist-spa 里没有多文件版 HTML（spa.html / 未内联的 index.html）。请先运行 Vite SPA 构建。");
  process.exit(1);
}

const multi = join(dir, "index.html");
if (resolve(viteHtml) !== resolve(multi)) {
  copyFileSync(viteHtml, multi);
}

function readAsset(urlPath) {
  const clean = urlPath.split("?")[0].replace(/^\.\//, "").replace(/^\//, "");
  const file = join(dir, clean);
  return readFileSync(file, "utf8");
}

let html = readFileSync(viteHtml, "utf8");

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

// Brand icons for the multi-file webDir (SPA build sets publicDir: false).
const brandFiles = [
  "favicon.svg",
  "favicon-32.png",
  "apple-touch-icon.png",
  "icon-192.png",
  "mark.svg",
];
for (const name of brandFiles) {
  const src = join(root, "public", name);
  if (existsSync(src)) copyFileSync(src, join(dir, name));
}

const out = join(dir, "VEXO_Admin.html");
writeFileSync(out, html);
console.log(`Multi-file (Capacitor webDir): ${multi}`);
console.log(`Single-file: ${out} (${(html.length / 1024 / 1024).toFixed(2)} MB)`);
