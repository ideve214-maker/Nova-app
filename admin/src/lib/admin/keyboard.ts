/**
 * 键盘遮挡（管理端 2.0.8）。
 *
 * 外壳是 position:fixed 的整页，原生端 Keyboard 用 resize:"none"（不改 WebView 大小），
 * 所以键盘出现时要由页面自己把内容区、底栏、弹窗往上让。让出的高度写进 CSS 变量 --nova-keyboard，
 * 同时给 <html> 加 nova-kb-open 类（styles.css 里用它隐藏只有按钮的底栏）。
 *
 * 不同环境下“需要让出的高度”算法不一样：
 * - iOS 原生（resize:none）：WebView 不变，直接用插件给的键盘高度。
 * - Android 原生：系统可能已经把 WebView 缩小（adjustResize），也可能没缩（edge-to-edge / adjustNothing），
 *   所以用 键盘高度 - WebView 已经缩掉的高度，避免重复让位或没让位。
 * - 浏览器 / PWA：没有插件，用 visualViewport 算被键盘盖住的部分。
 */

export type KeyboardInputs = {
  /** 原生插件报的键盘高度（CSS px）；没有插件或键盘收起时为 0 */
  nativeHeight: number;
  /** 是否 iOS 原生（resize:none，WebView 高度不变） */
  iosNative: boolean;
  /** 是否 Android 原生 */
  androidNative: boolean;
  /** 键盘收起时记下的 window.innerHeight */
  baselineHeight: number;
  /** 当前 window.innerHeight */
  innerHeight: number;
  /** visualViewport.height / offsetTop；没有 visualViewport 时传 innerHeight / 0 */
  viewportHeight: number;
  viewportOffsetTop: number;
};

/** 计算内容需要往上让出的高度（px，取整，最小 0）。 */
export function keyboardInset(i: KeyboardInputs): number {
  let v: number;
  if (i.iosNative) v = i.nativeHeight;
  else if (i.androidNative) v = i.nativeHeight > 0 ? i.nativeHeight - Math.max(0, i.baselineHeight - i.innerHeight) : 0;
  else v = i.innerHeight - i.viewportHeight - i.viewportOffsetTop;
  // 小于 80px 的差值是地址栏 / 工具条伸缩，不是键盘
  if (!i.iosNative && !i.androidNative && v < 80) v = 0;
  return Math.max(0, Math.round(v));
}

export const KEYBOARD_EVENT = "nova-keyboard";

type Platform = { iosNative: boolean; androidNative: boolean };

/** 安装键盘让位逻辑。返回 setNativeHeight 给原生插件事件调用，以及卸载函数。 */
export function installKeyboardInset(platform: Platform) {
  if (typeof window === "undefined") return { setNativeHeight: () => {}, dispose: () => {} };
  const root = document.documentElement;
  let nativeHeight = 0;
  let baseline = window.innerHeight;
  let last = -1;

  const apply = () => {
    const vv = window.visualViewport;
    const inset = keyboardInset({
      nativeHeight,
      ...platform,
      baselineHeight: baseline,
      innerHeight: window.innerHeight,
      viewportHeight: vv ? vv.height : window.innerHeight,
      viewportOffsetTop: vv ? vv.offsetTop : 0,
    });
    if (inset === last) return;
    last = inset;
    root.style.setProperty("--nova-keyboard", `${inset}px`);
    root.classList.toggle("nova-kb-open", inset > 0);
    window.dispatchEvent(new CustomEvent(KEYBOARD_EVENT, { detail: { height: inset } }));
  };

  const onResize = () => {
    // 键盘收起时更新基准高度（转屏、分屏都会变）
    const open = platform.iosNative || platform.androidNative ? nativeHeight > 0 : last > 0;
    if (!open) baseline = window.innerHeight;
    apply();
  };
  window.addEventListener("resize", onResize);
  window.visualViewport?.addEventListener("resize", onResize);
  apply();

  return {
    setNativeHeight(h: number) {
      nativeHeight = Math.max(0, Number(h) || 0);
      apply();
      // Android 的 WebView 缩放常比 keyboardWillShow 晚一帧，再算一次
      window.setTimeout(apply, 120);
      window.setTimeout(apply, 360);
    },
    dispose() {
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    },
  };
}
