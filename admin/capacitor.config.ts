/**
 * Capacitor 配置。webDir 指向 npm run build:spa 的产物。
 * iOS 工程不在本仓库里生成；打包机执行 npx cap add ios && npx cap sync ios。
 * 明文 HTTP 的 ATS 例外写在 ios/App/App/Info.plist（cap add 之后若被模板覆盖，再跑 scripts/apply-ios-ats.mjs）。
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Read a key from the process env, then .env.production / .env / .env.local. */
function envValue(name: string): string {
  const fromProcess = String(process.env[name] ?? "").trim();
  if (fromProcess) return fromProcess.replace(/^['"]|['"]$/g, "");
  for (const file of [".env.production", ".env", ".env.local"]) {
    const p = resolve(file);
    if (!existsSync(p)) continue;
    const raw = readFileSync(p, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      if (trimmed.slice(0, eq).trim() !== name) continue;
      return trimmed
        .slice(eq + 1)
        .trim()
        .replace(/^['"]|['"]$/g, "");
    }
  }
  return "";
}

/**
 * 热更新（自托管 @capgo/capacitor-updater）。
 *
 * 地址按顺序取：
 *   1. VITE_NOVA_UPDATE_URL / NOVA_UPDATE_URL（进程环境或 .env.*）
 *   2. NOVA_ADMIN_UPDATE_URL / ADMIN_UPDATE_URL（打包工作流里的名字，
 *      build/v2 的 v2-build.yml 把它设成整个 job 的环境变量）
 *   3. .nova-live-update.json：npm run build:spa 用上面同一套变量解析后写下的，
 *      专门给“第 1 步 build:spa、第 2 步 cap add/sync”分在不同 shell 的打包流程用。
 *      该文件含真实地址，已 gitignore，不要提交。
 * 不要把真实地址写进仓库：仓库公开，地址由打包环境（GitHub secret NOVA_ADMIN_UPDATE_URL）注入。
 * 永远不回落到 Capgo 云（插件内置默认 https://plugin.capgo.app/updates）。
 *
 * 打包时必填：CI=true（GitHub Actions）或 NOVA_REQUIRE_UPDATE_URL=1 时，没有地址直接报错，
 * 不再静默打出 autoUpdate:false 的包。本地调试可不填（热更新关闭），
 * 确需在 CI 打无热更新的包时显式设 NOVA_REQUIRE_UPDATE_URL=0。
 */
const LIVE_UPDATE_FILE = ".nova-live-update.json";

function readLiveUpdateFile(): { updateUrl?: string; version?: string } {
  const p = resolve(LIVE_UPDATE_FILE);
  if (!existsSync(p)) return {};
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function packageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version.trim() : "";
  } catch {
    return "";
  }
}

function isTruthy(v: string): boolean {
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

const liveUpdateFile = readLiveUpdateFile();
let updateUrlSource = "";
let updateUrl = "";
for (const key of [
  "VITE_NOVA_UPDATE_URL",
  "NOVA_UPDATE_URL",
  "NOVA_ADMIN_UPDATE_URL",
  "ADMIN_UPDATE_URL",
]) {
  const v = envValue(key);
  if (v) {
    updateUrl = v;
    updateUrlSource = `环境变量 ${key}`;
    break;
  }
}
if (!updateUrl) {
  const fromFile = String(liveUpdateFile.updateUrl ?? "").trim();
  if (fromFile) {
    updateUrl = fromFile;
    updateUrlSource = `文件 ${LIVE_UPDATE_FILE}（上一次 build:spa 写下的）`;
  }
}

/** 只打印到域名，不打印完整地址（路径里有私有段）。 */
function urlHost(u: string): string {
  try {
    return new URL(u).host || "?";
  } catch {
    return "?";
  }
}

const requireFlag = envValue("NOVA_REQUIRE_UPDATE_URL");
const updateUrlRequired = requireFlag
  ? isTruthy(requireFlag)
  : isTruthy(envValue("CI")) || isTruthy(envValue("GITHUB_ACTIONS"));
if (updateUrlRequired && !updateUrl) {
  throw new Error(
    "[nova-admin] 打包缺少热更新地址：请设置 ADMIN_UPDATE_URL（或 NOVA_ADMIN_UPDATE_URL / VITE_NOVA_UPDATE_URL），" +
      "或先在同一目录用该变量跑 npm run build:spa 生成 .nova-live-update.json。" +
      "确实要打不带热更新的包时设 NOVA_REQUIRE_UPDATE_URL=0。",
  );
}
if (updateUrl && !/^https?:\/\//i.test(updateUrl)) {
  throw new Error("[nova-admin] 热更新地址必须以 http:// 或 https:// 开头。");
}
// 打包日志里留一行来源，方便发现 .nova-live-update.json 残留的旧地址。
console.log(
  updateUrl
    ? `[nova-admin] 热更新地址来源：${updateUrlSource}，域名 ${urlHost(updateUrl)}`
    : "[nova-admin] 未设置热更新地址，热更新关闭",
);

/**
 * 插件上报的 version_name。默认与 package.json version 一致；
 * 打包脚本也用 package.json version 生成 iOS MARKETING_VERSION（CFBundleShortVersionString），三者对齐。
 */
const updateVersion =
  envValue("VITE_NOVA_UPDATE_VERSION") ||
  envValue("NOVA_UPDATE_VERSION") ||
  String(liveUpdateFile.version ?? "").trim() ||
  packageVersion();
const autoFlag = (envValue("VITE_NOVA_UPDATE_AUTO") || envValue("NOVA_UPDATE_AUTO")).toLowerCase();
const autoUpdateOn = !!updateUrl && autoFlag !== "off" && autoFlag !== "0" && autoFlag !== "false";

const config = {
  appId: "com.nova.admin",
  appName: "VEXO 管理端",
  webDir: "dist-spa",
  server: {
    // Android 明文流量。iOS 还要 Info.plist 里对 47.239.0.90 的 ATS 例外。
    cleartext: true,
    allowNavigation: ["47.239.0.90"],
  },
  ios: {
    // 刘海与 Home Indicator 由页面 env(safe-area-inset-*) 处理，WebView 不再垫一层。
    contentInset: "never",
    // 关掉 WKWebView 自己的 UIScrollView。整页橡皮筋由此消失；中间的 .nova-scroll 仍可滚。
    scrollEnabled: false,
    backgroundColor: "#17212B",
    preferredContentMode: "mobile",
  },
  plugins: {
    Keyboard: {
      // 默认 native 会改 WebView 的 frame，顶栏和底栏会跟着整页上移。none 不改 frame。
      resize: "none",
      resizeOnFullScreen: false,
    },
    // 自托管热更新。地址来源见上方 updateUrl 注释；有地址即 autoUpdate "atBackground"。
    // 没地址（仅限本地调试）时 autoUpdate false、updateUrl 为空，不会访问 Capgo 云。
    CapacitorUpdater: {
      appReadyTimeout: 10_000,
      autoDeleteFailed: true,
      autoDeletePrevious: true,
      resetWhenUpdate: true,
      allowModifyUrl: true,
      autoUpdate: autoUpdateOn ? "atBackground" : false,
      updateUrl,
      statsUrl: "",
      channelUrl: "",
      ...(updateVersion ? { version: updateVersion } : {}),
    },
  },
  android: {
    backgroundColor: "#17212B",
  },
};

export default config;
