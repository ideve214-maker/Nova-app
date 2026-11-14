#!/usr/bin/env node
/**
 * 静态管理端 + 可选把 /api 反代到用户端后端，这样 iPhone 预览只需一个网址。
 *
 *   NOVA_API=http://127.0.0.1:8787 PORT=4173 node scripts/preview-server.mjs
 */
import http from "node:http";
import { createReadStream, existsSync, statSync, readFileSync } from "node:fs";
import { extname, join, normalize, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const spaDir = join(root, "dist-spa");
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "0.0.0.0";
const API = (process.env.NOVA_API || "http://127.0.0.1:8787").replace(/\/+$/, "");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Cache-Control": "no-store", ...headers });
  res.end(body);
}

function proxy(req, res) {
  const target = new URL(req.url, API);
  const lib = target.protocol === "https:" ? httpsRequest : httpRequest;
  const headers = { ...req.headers, host: target.host };
  const p = lib(target, { method: req.method, headers }, (up) => {
    const out = { ...up.headers };
    out["access-control-allow-origin"] = req.headers.origin || "*";
    out["access-control-allow-headers"] = "Authorization, Content-Type";
    out["access-control-allow-methods"] = "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS";
    res.writeHead(up.statusCode || 502, out);
    up.pipe(res);
  });
  p.on("error", (err) => {
    send(res, 502, JSON.stringify({ error: { code: "UPSTREAM", message: "后端不可达：" + err.message } }), {
      "content-type": "application/json; charset=utf-8",
    });
  });
  req.pipe(p);
}

function safeFile(urlPath) {
  const decoded = decodeURIComponent((urlPath || "/").split("?")[0]);
  const rel = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const file = resolve(spaDir, rel);
  if (!file.startsWith(spaDir)) return null;
  return file;
}

const server = http.createServer((req, res) => {
  const url = req.url || "/";
  const pathOnly = url.split("?")[0];
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": req.headers.origin || "*",
      "access-control-allow-headers": "Authorization, Content-Type",
      "access-control-allow-methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
    });
    res.end();
    return;
  }
  if (pathOnly === "/api" || pathOnly.startsWith("/api/")) {
    proxy(req, res);
    return;
  }
  if (pathOnly === "/__nova-preview") {
    send(res, 200, JSON.stringify({ ok: true, api: API, spa: spaDir, time: Date.now() }), {
      "content-type": "application/json; charset=utf-8",
    });
    return;
  }
  let file = safeFile(pathOnly);
  if (!file || !existsSync(file) || !statSync(file).isFile()) {
    file = join(spaDir, "index.html");
  }
  if (!existsSync(file)) {
    send(res, 500, "dist-spa 不存在，请先 npm run build:spa");
    return;
  }
  const type = TYPES[extname(file).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, { "content-type": type, "Cache-Control": "no-store" });
  createReadStream(file).pipe(res);
});

server.listen(PORT, HOST, () => {
  console.log(`VEXO admin preview  http://127.0.0.1:${PORT}/   (API → ${API})`);
});
