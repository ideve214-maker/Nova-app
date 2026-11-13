import { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { AdminApp } from "./components/admin/app";
import { applyTheme, watchSystemTheme } from "./lib/admin/theme";
import { useAdmin } from "./lib/admin/store";
import { lockWebViewport } from "./lib/admin/native";
import "./styles.css";

lockWebViewport();
applyTheme();
watchSystemTheme();
import m0 from "../public/media/av-chen.jpg";
import m1 from "../public/media/av-group.jpg";
import m2 from "../public/media/av-he.jpg";
import m3 from "../public/media/av-jiang.jpg";
import m4 from "../public/media/av-me.jpg";
import m5 from "../public/media/av-notice.jpg";
import m6 from "../public/media/av-pei.jpg";
import m7 from "../public/media/av-su.jpg";
import m8 from "../public/media/av-zhou.jpg";
import m9 from "../public/media/bg-read.jpg";
import m10 from "../public/media/bg-river.jpg";
import m11 from "../public/media/post-beach.jpg";
import m12 from "../public/media/post-hike.jpg";
import m13 from "../public/media/post-object.jpg";
import m14 from "../public/media/post-town.jpg";

declare global {
  interface Window {
    __NOVA_BOOTED__?: boolean;
    __NOVA_MEDIA__?: Record<string, string>;
  }
}

window.__NOVA_MEDIA__ = {
  "/media/av-chen.jpg": String(m0),
  "/media/av-group.jpg": String(m1),
  "/media/av-he.jpg": String(m2),
  "/media/av-jiang.jpg": String(m3),
  "/media/av-me.jpg": String(m4),
  "/media/av-notice.jpg": String(m5),
  "/media/av-pei.jpg": String(m6),
  "/media/av-su.jpg": String(m7),
  "/media/av-zhou.jpg": String(m8),
  "/media/bg-read.jpg": String(m9),
  "/media/bg-river.jpg": String(m10),
  "/media/post-beach.jpg": String(m11),
  "/media/post-hike.jpg": String(m12),
  "/media/post-object.jpg": String(m13),
  "/media/post-town.jpg": String(m14),
};

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("缺少 #root");

class FatalBoundary extends Component<{ children: ReactNode }, { err: unknown }> {
  state = { err: null as unknown };
  static getDerivedStateFromError(err: unknown) {
    return { err };
  }
  componentDidCatch(err: unknown) {
    const w = window as unknown as { __NOVA_SHOW_ERROR__?: (t: string) => void };
    const e = err as { stack?: string; message?: string };
    w.__NOVA_SHOW_ERROR__?.("渲染出错: " + String(e?.stack || e?.message || err));
  }
  render() {
    if (this.state.err) {
      return (
        <div style={{ padding: "64px 24px", color: "#F4F6FC", textAlign: "center" }}>
          <p style={{ fontSize: 20, fontWeight: 700 }}>管理端出错了</p>
          <button type="button" onClick={() => location.reload()} style={{ marginTop: 16, height: 44, padding: "0 22px", borderRadius: 14, border: 0, background: "#6E8BFF", color: "#fff", fontSize: 16, fontWeight: 700 }}>
            刷新重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(rootEl).render(
  <FatalBoundary>
    <AdminApp />
  </FatalBoundary>,
);


// Local screenshot aid only: ?__shot__=1 on localhost exposes the store so
// layout shots can open Home/Manage/list without a real login.
if (typeof window !== "undefined") {
  const host = window.location.hostname;
  const local = host === "localhost" || host === "127.0.0.1";
  if (local && /(?:^|[?&])__shot__=1(?:&|$)/.test(window.location.search)) {
    (window as unknown as { __NOVA_ADMIN_STORE__?: typeof useAdmin }).__NOVA_ADMIN_STORE__ = useAdmin;
  }
}
