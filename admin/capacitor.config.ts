/**
 * Capacitor 包装配置（占位）。
 * 本仓库不安装 iOS platform，也不在这里执行 cap add / cap sync。
 * 以后用 TestFlight 打包时，把 webDir 指向构建产物 dist-spa（多文件，相对路径）。
 */
const config = {
  appId: "com.nova.admin",
  appName: "NOVA 管理端",
  webDir: "dist-spa",
  ios: {
    // 由 CSS env(safe-area-inset-*) 处理刘海与 Home Indicator，不要让 WebView 再垫一层。
    contentInset: "never",
    backgroundColor: "#0A0C14",
    preferredContentMode: "mobile",
  },
  android: {
    backgroundColor: "#0A0C14",
  },
};

export default config;
