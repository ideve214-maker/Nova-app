import { Capacitor } from "@capacitor/core";
import { Keyboard, KeyboardResize } from "@capacitor/keyboard";

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
}
