import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import "@fontsource-variable/noto-sans-sc/wght.css";
import appCss from "../styles.css?url";

const APP_NAME = "NOVA 管理端";

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
    el.setAttribute("style", "position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 24px;text-align:center;color:#fff;background:linear-gradient(180deg,#5b35f0 0%,#7a59ff 46%,#c8b6ff 100%);font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB',sans-serif;");
    el.innerHTML = '<div style="font-size:42px;line-height:1;margin-bottom:20px;">✦</div>'
      + '<p style="font-size:20px;font-weight:600;margin:0 0 12px;">无法进入管理端</p>'
      + '<p style="max-width:320px;font-size:14px;line-height:1.6;margin:0 0 20px;opacity:.92;">页面停在启动画面，通常是因为用「文件预览」打开了 HTML，脚本没能加载。请用 Safari 打开完整预览链接，或使用单文件版 HTML。</p>'
      + '<button type="button" id="nova-boot-retry" style="height:44px;padding:0 22px;border:0;border-radius:999px;background:#fff;color:#542ee0;font-size:16px;font-weight:600;">刷新重试</button>';
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
      { name: "theme-color", content: "#6d4aff" },
      { name: "description", content: "NOVA 社区管理端，用户、内容、举报与会员权益。" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "format-detection", content: "telephone=no" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
    ],
  }),
  component: () => (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
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
