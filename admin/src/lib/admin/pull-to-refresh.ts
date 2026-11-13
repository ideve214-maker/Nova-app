import { useEffect } from "react";
import PullToRefresh from "pulltorefreshjs";
import { useAdmin, type PageName } from "./store";

export const PULLTOREFRESHJS_VERSION = "0.1.22";
export const PULLTOREFRESHJS_LICENSE = "MIT";

function modalOpen() {
  return !!(
    document.querySelector(".nova-sheet, .pswp--open, .pswp, [data-nova-modal], [role='dialog']") ||
    document.documentElement.getAttribute("data-nova-lightbox") === "1"
  );
}

function contentScroller(): HTMLElement | null {
  return (
    (document.querySelector("[data-nova-content-scroll]") as HTMLElement | null) ||
    (document.querySelector(".nova-frame-inner .nova-scroll") as HTMLElement | null)
  );
}

export async function refreshForPage(name: PageName): Promise<void> {
  const s = useAdmin.getState();
  switch (name) {
    case "home":
      await Promise.all([
        s.refreshStats(),
        s.refreshAudit(),
        s.refreshSecurityEvents(),
        s.refreshAppeals({ status: "pending" }),
      ]);
      return;
    case "manage":
    case "stats":
      await s.refreshStats();
      return;
    case "users":
    case "user":
      await s.refreshUsers();
      return;
    case "content":
      await Promise.all([s.refreshContent(), s.refreshMediaReview()]);
      return;
    case "payments":
      await s.refreshPayments();
      return;
    case "reports":
      await s.refreshReports();
      return;
    case "audit":
      await s.refreshAudit();
      return;
    case "announce":
      await s.refreshAnnouncements();
      return;
    case "communities":
    case "community":
    case "channel":
      await s.refreshCommunities();
      return;
    case "blockwords":
      await s.refreshBlockwords();
      return;
    case "events":
      await s.refreshSecurityEvents();
      return;
    case "appeals":
      await s.refreshAppeals();
      return;
    case "messages":
    case "me":
    case "settings":
    case "security":
    case "vip":
      await s.refreshStats();
      return;
    default:
      return;
  }
}

function shouldRefresh(scroller: HTMLElement) {
  return scroller.scrollTop <= 0 && !modalOpen();
}

function movePtrInsideScroller(scroller: HTMLElement, ptr: HTMLElement | null | undefined) {
  if (!ptr) return;
  const after = scroller.querySelector(":scope > .nova-top-spacer");
  if (after) scroller.insertBefore(ptr, after.nextSibling);
  else if (ptr.parentNode !== scroller) scroller.insertBefore(ptr, scroller.firstChild);
}

export function attachPullToRefresh(scroller: HTMLElement, onRefresh: () => void | Promise<void>) {
  PullToRefresh.destroyAll();

  const handler = PullToRefresh.init({
    mainElement: scroller,
    triggerElement: scroller,
    distIgnore: 10,
    distThreshold: 60,
    distMax: 80,
    distReload: 50,
    instructionsPullToRefresh: "下拉刷新",
    instructionsReleaseToRefresh: "松开刷新",
    instructionsRefreshing: "正在刷新",
    shouldPullToRefresh: () => shouldRefresh(scroller),
    onRefresh: () => Promise.resolve(onRefresh()),
    onInit: (h) => movePtrInsideScroller(scroller, h.ptrElement),
    getStyles: () => `
      .ptr--ptr {
        box-shadow: none;
        pointer-events: none;
        font-size: 13px;
        font-weight: 600;
        top: 0;
        height: 0;
        transition: height 0.3s, min-height 0.3s;
        text-align: center;
        width: 100%;
        overflow: hidden;
        display: flex;
        align-items: flex-end;
        align-content: stretch;
        background: transparent;
      }
      .ptr--box { padding: 10px; flex-basis: 100%; }
      .ptr--pull { transition: none; }
      .ptr--text { margin-top: .33em; color: var(--t2); }
      .ptr--icon { color: var(--t2); transition: transform .3s; }
      .ptr--release .ptr--icon { transform: rotate(180deg); }
    `,
  });

  return () => {
    try {
      handler.destroy();
    } catch {
      /* ignore */
    }
    try {
      PullToRefresh.destroyAll();
    } catch {
      /* ignore */
    }
    if (handler.ptrElement?.parentNode) handler.ptrElement.parentNode.removeChild(handler.ptrElement);
  };
}

/** Bind pull-to-refresh to the current page's .nova-scroll. Never uses body or window.scrollY. */
export function usePagePullToRefresh(active: boolean, page: PageName) {
  useEffect(() => {
    if (!active) return;
    let stop: (() => void) | undefined;
    const id = window.requestAnimationFrame(() => {
      const el = contentScroller();
      if (!el) return;
      stop = attachPullToRefresh(el, () => refreshForPage(page));
    });
    return () => {
      window.cancelAnimationFrame(id);
      stop?.();
    };
  }, [active, page]);
}
