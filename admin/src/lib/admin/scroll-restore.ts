import { useLayoutEffect } from "react";

const positions = new Map<string, number>();

export type ScrollNav = { name: string; userId?: string; channelId?: string };

export function scrollKey(nav: ScrollNav): string {
  const parts = [nav.name || "home"];
  if (nav.userId) parts.push(nav.userId);
  if (nav.channelId) parts.push(nav.channelId);
  return parts.join("/");
}

export function saveScroll(key: string, top: number) {
  positions.set(key, Math.max(0, top));
}

export function readScroll(key: string): number {
  return positions.get(key) ?? 0;
}

export function contentScroller(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return (
    (document.querySelector("[data-nova-content-scroll]") as HTMLElement | null) ||
    (document.querySelector(".nova-frame-inner .nova-scroll") as HTMLElement | null)
  );
}

export function captureCurrentScroll(nav: ScrollNav) {
  const el = contentScroller();
  if (!el) return;
  saveScroll(scrollKey(nav), el.scrollTop);
}

export function restoreScroll(nav: ScrollNav) {
  const el = contentScroller();
  if (!el) return;
  const top = readScroll(scrollKey(nav));
  el.scrollTop = top;
}

/** After the new page paints, restore the saved .nova-scroll offset for this route.
 *  Retries briefly so late layout (lists, images, spacers) can grow first.
 *  Stops if the user starts scrolling. */
export function useRestoreScroll(nav: ScrollNav, active: boolean) {
  const key = scrollKey(nav);
  useLayoutEffect(() => {
    if (!active) return;
    let lastApplied = -1;
    let stopped = false;
    const apply = () => {
      if (stopped) return;
      const el = contentScroller();
      if (!el) return;
      if (lastApplied >= 0 && Math.abs(el.scrollTop - lastApplied) > 2) {
        stopped = true;
        return;
      }
      const top = readScroll(key);
      if (el.scrollTop !== top) el.scrollTop = top;
      lastApplied = el.scrollTop;
    };
    apply();
    const rafs: number[] = [];
    let frames = 0;
    const tick = () => {
      apply();
      if (!stopped && ++frames < 24) rafs.push(window.requestAnimationFrame(tick));
    };
    rafs.push(window.requestAnimationFrame(tick));
    const t1 = window.setTimeout(apply, 120);
    const t2 = window.setTimeout(apply, 320);
    return () => {
      stopped = true;
      rafs.forEach((id) => window.cancelAnimationFrame(id));
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [active, key]);
}

export function _resetScrollPositionsForTests() {
  positions.clear();
}
