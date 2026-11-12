import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import "@fontsource-variable/noto-sans-sc/wght.css";
import appCss from "../styles.css?url";

const APP_NAME = "NOVA 管理端";

const THEME_BOOT = `
(function () {
  if (typeof document === "undefined") return;
  try {
    var m = localStorage.getItem("nova-admin-theme");
    var light = m === "light" || (m !== "dark" && window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches);
    document.documentElement.setAttribute("data-theme", light ? "light" : "dark");
    document.documentElement.style.colorScheme = light ? "light" : "dark";
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "dark");
  }
})();
`;

const BOOT_GUARD = `
(function () {
  if (typeof window === "undefined") return;
  window.__NOVA_BOOTED__ = window.__NOVA_BOOTED__ || false;
  function showError() {
    if (window.__NOVA_BOOTED__) return;
    if (document.getElementById("nova-boot-error")) return;
    var el = document.createElement("div");
    el.id = "nova-boot-error";
    el.setAttribute("role", "alert");
    el.setAttribute("style", "position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 24px;text-align:center;color:#F4F6FC;background:radial-gradient(80% 50% at 50% 34%,rgba(110,139,255,.38),transparent 72%),#0A0C14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;");
    el.innerHTML = '<div style="font-size:42px;line-height:1;margin-bottom:12px;">✦</div>'
      + '<p style="font-size:28px;font-weight:800;letter-spacing:.06em;margin:0 0 8px;background:linear-gradient(180deg,#8BA3FF 0%,#6E8BFF 48%,#5B74F2 100%);-webkit-background-clip:text;background-clip:text;color:transparent;">NOVA</p>'
      + '<p style="font-size:15px;font-weight:700;letter-spacing:.12em;margin:0 0 16px;color:#6E8BFF;">管理端</p>'
      + '<p style="font-size:20px;font-weight:600;margin:0 0 12px;">无法进入管理端</p>'
      + '<p style="max-width:320px;font-size:14px;line-height:1.6;margin:0 0 20px;opacity:.85;">页面停在启动画面，通常是因为用「文件预览」打开了 HTML，脚本没能加载。请用 Safari 打开完整预览链接，或使用单文件版 HTML。</p>'
      + '<button type="button" id="nova-boot-retry" style="height:44px;padding:0 22px;border:0;border-radius:14px;background:linear-gradient(180deg,#8BA3FF 0%,#6E8BFF 48%,#5B74F2 100%);color:#fff;font-size:16px;font-weight:700;letter-spacing:.02em;box-shadow:0 4px 14px rgba(110,139,255,.38);">刷新重试</button>';
    document.body.appendChild(el);
    var btn = document.getElementById("nova-boot-retry");
    if (btn) btn.onclick = function () { window.location.reload(); };
  }
  setTimeout(showError, 4000);
})();
`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: APP_NAME },
      { name: "theme-color", content: "#0A0C14" },
      { name: "description", content: "NOVA 社区管理端，用户、内容、举报与会员权益。" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "format-detection", content: "telephone=no" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32.png" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  component: () => (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        <script dangerouslySetInnerHTML={{ __html: BOOT_GUARD }} />
        <PreviewHostBridge />
        <AuthProvider>
          <Outlet />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  ),
});
