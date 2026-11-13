/**
 * Capacitor 配置。webDir 指向 npm run build:spa 的产物。
 * iOS 工程不在本仓库里生成；打包机执行 npx cap add ios && npx cap sync ios。
 * 明文 HTTP 的 ATS 例外写在 ios/App/App/Info.plist（cap add 之后若被模板覆盖，再跑 scripts/apply-ios-ats.mjs）。
 */
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
  },
  android: {
    backgroundColor: "#17212B",
  },
};

export default config;
