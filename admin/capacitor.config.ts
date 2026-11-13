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
      return trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    }
  }
  return "";
}

/**
 * Self-hosted live-update manifest URL (Dift will provide this).
 * Leave empty to keep auto-update off. Never default to Capgo cloud
 * (the plugin's built-in default is https://plugin.capgo.app/updates).
 */
const updateUrl = envValue("VITE_NOVA_UPDATE_URL") || envValue("NOVA_UPDATE_URL");
const updateVersion = envValue("VITE_NOVA_UPDATE_VERSION") || envValue("NOVA_UPDATE_VERSION");
const autoFlag = (envValue("VITE_NOVA_UPDATE_AUTO") || envValue("NOVA_UPDATE_AUTO")).toLowerCase();
const autoUpdateOn = !!updateUrl && autoFlag !== "off" && autoFlag !== "0" && autoFlag !== "false";

const config = {
  appId: "com.nova.admin",
  appName: "NOVA 管理端",
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
    // Live updates are self-hosted. Empty updateUrl + autoUpdate false means
    // the app will not contact Capgo cloud. Fill VITE_NOVA_UPDATE_URL (Dift's
    // manifest) before `cap sync` to turn auto-update on.
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
