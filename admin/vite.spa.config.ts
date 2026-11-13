import { rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = dirname(fileURLToPath(import.meta.url));

const LIVE_UPDATE_FILE = resolve(root, ".nova-live-update.json");

function truthy(v: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(
    String(v ?? "")
      .trim()
      .toLowerCase(),
  );
}

/**
 * 热更新地址：VITE_NOVA_UPDATE_URL / NOVA_UPDATE_URL / NOVA_ADMIN_UPDATE_URL / ADMIN_UPDATE_URL（含 .env.*）。
 * 解析到后写回 process.env.VITE_NOVA_UPDATE_URL，网页包（live-update.ts）就能拿到；
 * 构建成功后再写 .nova-live-update.json，供后面单独一步的 cap add / cap sync 读（capacitor.config.ts）。
 * CI 或 NOVA_REQUIRE_UPDATE_URL=1 时必填，缺失直接报错。
 */
function resolveLiveUpdate(mode: string) {
  const env = loadEnv(mode, root, "");
  const pick = (...keys: string[]) =>
    keys
      .map((k) =>
        String(process.env[k] ?? env[k] ?? "")
          .trim()
          .replace(/^['"]|['"]$/g, ""),
      )
      .find(Boolean) ?? "";
  const url = pick(
    "VITE_NOVA_UPDATE_URL",
    "NOVA_UPDATE_URL",
    "NOVA_ADMIN_UPDATE_URL",
    "ADMIN_UPDATE_URL",
  );
  const version = pick("VITE_NOVA_UPDATE_VERSION", "NOVA_UPDATE_VERSION");
  const requireFlag = pick("NOVA_REQUIRE_UPDATE_URL");
  const required = requireFlag
    ? truthy(requireFlag)
    : truthy(process.env.CI) || truthy(process.env.GITHUB_ACTIONS);
  if (required && !url) {
    throw new Error(
      "[nova-admin] 打包缺少热更新地址：请设置 ADMIN_UPDATE_URL（或 NOVA_ADMIN_UPDATE_URL / VITE_NOVA_UPDATE_URL）后再跑 build:spa。" +
        "确实要打不带热更新的包时设 NOVA_REQUIRE_UPDATE_URL=0。",
    );
  }
  if (url && !/^https?:\/\//i.test(url)) {
    throw new Error("[nova-admin] 热更新地址必须以 http:// 或 https:// 开头。");
  }
  if (url) process.env.VITE_NOVA_UPDATE_URL = url;
  return { url, version };
}

function liveUpdateHandoff(live: { url: string; version: string }): Plugin {
  return {
    name: "nova-live-update-handoff",
    apply: "build",
    closeBundle() {
      if (!live.url) {
        // 没地址就删掉旧文件，避免上一次打包的地址被 cap sync 误用。
        rmSync(LIVE_UPDATE_FILE, { force: true });
        return;
      }
      const body: Record<string, string> = { updateUrl: live.url };
      if (live.version) body.version = live.version;
      writeFileSync(LIVE_UPDATE_FILE, JSON.stringify(body, null, 2) + "\n");
    },
  };
}

export default defineConfig(({ mode }) => {
  const live = resolveLiveUpdate(mode);
  return {
    root,
    base: "./",
    // Media is imported and inlined; skip copying the Grok PWA extras into the single file.
    publicDir: false,
    resolve: {
      tsconfigPaths: true,
      alias: { "@": resolve(root, "src") },
    },
    plugins: [tailwindcss(), viteReact(), liveUpdateHandoff(live)],
    build: {
      outDir: resolve(root, "dist-spa"),
      emptyOutDir: true,
      assetsInlineLimit: 2_000_000,
      cssCodeSplit: false,
      modulePreload: false,
      target: ["es2019", "safari13"],
      cssCodeSplit: false,
      codeSplitting: false,
      rollupOptions: {
        input: resolve(root, "spa.html"),
      },
    },
  };
});
