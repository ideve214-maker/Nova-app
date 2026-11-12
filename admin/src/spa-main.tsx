import { createRoot } from "react-dom/client";
import { AdminApp } from "./components/admin/app";
import { applyTheme, watchSystemTheme } from "./lib/admin/theme";
import "./styles.css";

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

createRoot(rootEl).render(<AdminApp />);
