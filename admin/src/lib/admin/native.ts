import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { Keyboard, KeyboardResize } from "@capacitor/keyboard";
import { StatusBar, Style } from "@capacitor/status-bar";
import { getStoredSkin, resolvedTheme, themeColor, type SkinId } from "./theme";


/** Web / Safari viewport lock. Keeps the layout at device width and prevents
 *  iOS from auto-zooming out when content is slightly taller or wider than
 *  the visible window (the "fat / squashed webpage" look). */
export const WEB_VIEWPORT =
  "width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover";

export function lockWebViewport() {
  if (typeof document === "undefined") return;
  let meta = document.querySelector('meta[name="viewport"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "viewport");
    document.head.appendChild(meta);
  }
  if (meta.getAttribute("content") !== WEB_VIEWPORT) {
    meta.setAttribute("content", WEB_VIEWPORT);
  }
}

/**
 * 键盘用 resize: none。native / body 会改 WebView 或 body 高度，顶栏和底栏会跟着整页上移。
 * setScroll(isDisabled) 让 WKWebView 的 scrollView 不能滚，并把 contentOffset 钉在 0。
 * 键盘高度只写成 CSS 变量，缩内容区的下边，不移动外壳。
 */
export async function lockNativeViewport() {
  if (typeof window === "undefined" || !Capacitor.isNativePlatform()) return;
  try {
    await Keyboard.setResizeMode({ mode: KeyboardResize.None });
  } catch {
    /* 插件未打进原生工程时忽略，配置里的 resize:"none" 仍会在 cap sync 后生效 */
  }
  try {
    await Keyboard.setScroll({ isDisabled: true });
  } catch {
    /* same */
  }
  const setInset = (height: number) => {
    document.documentElement.style.setProperty("--nova-keyboard", `${Math.max(0, height)}px`);
  };
  await Keyboard.addListener("keyboardWillShow", (info) => setInset(info.keyboardHeight));
  await Keyboard.addListener("keyboardDidShow", (info) => setInset(info.keyboardHeight));
  await Keyboard.addListener("keyboardWillHide", () => setInset(0));
  await Keyboard.addListener("keyboardDidHide", () => setInset(0));
  await syncNativeChrome();
}

/** 状态栏文字颜色跟随皮肤的深/浅色，背景色与主题色一致。 */
export async function syncNativeChrome(skin: SkinId = getStoredSkin(), mode: "dark" | "light" = resolvedTheme()) {
  if (typeof window === "undefined" || !Capacitor.isNativePlatform()) return;
  try {
    // Style.Dark = 浅色字（深色底）；Style.Light = 深色字（浅色底）
    await StatusBar.setStyle({ style: mode === "dark" ? Style.Dark : Style.Light });
  } catch {
    /* 插件未同步进原生工程时忽略 */
  }
  try {
    await StatusBar.setBackgroundColor({ color: themeColor(skin, mode) });
  } catch {
    /* iOS 通常忽略背景色 */
  }
}

/** 关键操作的轻触反馈。Web 预览和无插件时静默跳过。 */
export async function hapticLight() {
  if (typeof window === "undefined" || !Capacitor.isNativePlatform()) return;
  try {
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    /* same */
  }
}
