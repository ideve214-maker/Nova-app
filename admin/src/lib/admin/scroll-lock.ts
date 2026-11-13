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
    if (raw && raw.closest(".pswp, .pswp--open")) return;
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

/** 只滚动离输入框最近的内容区，不用 scrollIntoView（它会把整页顶上去）。 */
export function scrollFieldWithinContent(el: HTMLElement) {
  const scroller = nearestScroller(el, "y");
  if (!scroller) return;
  const box = scroller.getBoundingClientRect();
  const field = el.getBoundingClientRect();
  const pad = 16;
  if (field.bottom > box.bottom - pad) scroller.scrollTop += field.bottom - (box.bottom - pad);
  else if (field.top < box.top + pad) scroller.scrollTop -= box.top + pad - field.top;
}

export function installFieldScroll() {
  const onFocus = (event: FocusEvent) => {
    const t = event.target;
    if (!(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) return;
    window.setTimeout(() => scrollFieldWithinContent(t), 60);
  };
  document.addEventListener("focusin", onFocus);
  return () => document.removeEventListener("focusin", onFocus);
}
