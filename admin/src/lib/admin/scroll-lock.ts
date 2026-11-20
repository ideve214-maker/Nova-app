/**
 * 整页不能滚、不能橡皮筋。只有 .nova-scroll / .nova-sheet / 横向条 / PhotoSwipe 能滚。
 * 滚到边缘时 preventDefault，避免 iOS 把余下的手势交给 WKWebView。
 */

const LOCK_ATTR = "data-nova-scroll-lock";

function canScroll(el: HTMLElement, axis: "y" | "x") {
  const style = getComputedStyle(el);
  if (axis === "y") {
    const oy = style.overflowY;
    return (oy === "auto" || oy === "scroll" || oy === "overlay") && el.scrollHeight > el.clientHeight + 1;
  }
  const ox = style.overflowX;
  return (ox === "auto" || ox === "scroll" || ox === "overlay") && el.scrollWidth > el.clientWidth + 1;
}

function nearestScroller(target: EventTarget | null, axis: "y" | "x"): HTMLElement | null {
  let el = target instanceof Element ? target : null;
  while (el && el !== document.documentElement) {
    if (el instanceof HTMLElement && canScroll(el, axis)) return el;
    el = el.parentElement;
  }
  return null;
}

function pinDocument() {
  const root = document.scrollingElement || document.documentElement;
  if (root.scrollTop !== 0 || root.scrollLeft !== 0) root.scrollTo(0, 0);
  if (document.body.scrollTop !== 0) document.body.scrollTop = 0;
}

export function installScrollLock() {
  if (typeof document === "undefined") return () => {};
  if (document.documentElement.getAttribute(LOCK_ATTR) === "1") return () => {};
  document.documentElement.setAttribute(LOCK_ATTR, "1");

  let lastX = 0;
  let lastY = 0;

  const onStart = (event: TouchEvent) => {
    const t = event.touches[0];
    if (!t) return;
    lastX = t.clientX;
    lastY = t.clientY;
  };

  const onMove = (event: TouchEvent) => {
    const t = event.touches[0];
    if (!t) return;
    const raw = event.target instanceof Element ? event.target : null;
    if (raw && raw.closest(".pswp, .pswp--open, .ptr--ptr, .ptr--box, [class*='ptr--']")) return;
    const dx = t.clientX - lastX;
    const dy = t.clientY - lastY;
    lastX = t.clientX;
    lastY = t.clientY;
    const axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    const scroller = nearestScroller(event.target, axis);
    if (!scroller) {
      event.preventDefault();
      return;
    }
    if (axis === "y") {
      const atTop = scroller.scrollTop <= 0;
      const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
      if ((dy > 0 && atTop) || (dy < 0 && atBottom)) event.preventDefault();
      return;
    }
    const atLeft = scroller.scrollLeft <= 0;
    const atRight = scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 1;
    if ((dx > 0 && atLeft) || (dx < 0 && atRight)) event.preventDefault();
  };

  const onScroll = () => pinDocument();
  const onViewport = () => pinDocument();

  document.addEventListener("touchstart", onStart, { passive: true });
  document.addEventListener("touchmove", onMove, { passive: false });
  window.addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("scroll", onScroll, { passive: true });
  window.visualViewport?.addEventListener("scroll", onViewport);
  pinDocument();

  return () => {
    document.removeEventListener("touchstart", onStart);
    document.removeEventListener("touchmove", onMove);
    window.removeEventListener("scroll", onScroll);
    document.removeEventListener("scroll", onScroll);
    window.visualViewport?.removeEventListener("scroll", onViewport);
    document.documentElement.removeAttribute(LOCK_ATTR);
  };
}

/** 内容区上方被顶栏盖住的高度（Screen 的顶栏浮在内容区上面）。 */
function coveredTop(scroller: HTMLElement): number {
  const spacer = scroller.querySelector(":scope > .nova-top-spacer");
  return spacer instanceof HTMLElement ? spacer.offsetHeight : 0;
}
/** 内容区下方被底栏盖住的高度（Screen 的底栏浮在内容区上面）。 */
function coveredBottom(scroller: HTMLElement): number {
  const footer = scroller.parentElement?.querySelector(":scope > .nova-footer");
  if (!(footer instanceof HTMLElement) || footer.offsetParent === null) return 0;
  const sb = scroller.getBoundingClientRect();
  const fb = footer.getBoundingClientRect();
  return Math.max(0, sb.bottom - fb.top);
}

/**
 * 只滚动输入框所在的内容区（以及外层的弹窗），不用 scrollIntoView（它会把整页顶上去）。
 * 2.0.8：逐层往外滚（弹窗里的列表 → 弹窗本身），并扣掉浮在上面的顶栏 / 底栏。
 */
export function scrollFieldWithinContent(el: HTMLElement) {
  const pad = 16;
  let scroller = nearestScroller(el, "y");
  let guard = 0;
  while (scroller && guard++ < 4) {
    const box = scroller.getBoundingClientRect();
    const field = el.getBoundingClientRect();
    const top = box.top + coveredTop(scroller) + pad;
    const bottom = box.bottom - coveredBottom(scroller) - pad;
    if (field.bottom > bottom) scroller.scrollTop += Math.min(field.bottom - bottom, field.top - top);
    else if (field.top < top) scroller.scrollTop -= top - field.top;
    scroller = nearestScroller(scroller.parentElement, "y");
  }
}

function isField(t: EventTarget | null): t is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  if (t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return true;
  if (!(t instanceof HTMLInputElement)) return false;
  return !["checkbox", "radio", "button", "submit", "reset", "file", "range", "color", "hidden"].includes(t.type);
}

export function installFieldScroll() {
  const timers: number[] = [];
  const run = () => {
    const t = document.activeElement;
    if (isField(t)) scrollFieldWithinContent(t);
  };
  // 键盘弹出要 250ms 左右，内容区在这之后才变矮：聚焦时、键盘高度变化后各对一次位置
  const onFocus = (event: FocusEvent) => {
    if (!isField(event.target)) return;
    for (const ms of [60, 300, 600]) timers.push(window.setTimeout(run, ms));
  };
  const onKeyboard = () => { timers.push(window.setTimeout(run, 30)); };
  document.addEventListener("focusin", onFocus);
  window.addEventListener("nova-keyboard", onKeyboard);
  return () => {
    document.removeEventListener("focusin", onFocus);
    window.removeEventListener("nova-keyboard", onKeyboard);
    timers.forEach((t) => window.clearTimeout(t));
  };
}
