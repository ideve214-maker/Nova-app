export const PAGE_NAMES = [
  "home",
  "manage",
  "messages",
  "me",
  "users",
  "user",
  "content",
  "reports",
  "stats",
  "settings",
  "audit",
  "security",
  "community",
  "vip",
  "announce",
  "devices",
  "admins",
  "payments",
  "communities",
  "channel",
  "blockwords",
] as const;

export type HashPageName = (typeof PAGE_NAMES)[number];
export type HashNav = { name: HashPageName; userId?: string; channelId?: string };

export function navToHash(nav: HashNav): string {
  if (!nav || nav.name === "home") return "#/";
  if (nav.name === "user" && nav.userId) return `#/user/${encodeURIComponent(nav.userId)}`;
  if (nav.name === "community" && nav.userId) return `#/community/${encodeURIComponent(nav.userId)}`;
  if (nav.name === "channel" && nav.channelId) {
    const ch = encodeURIComponent(nav.channelId);
    return nav.userId ? `#/channel/${ch}/${encodeURIComponent(nav.userId)}` : `#/channel/${ch}`;
  }
  return `#/${nav.name}`;
}

export function hashToNav(hash: string): HashNav | null {
  const raw = String(hash || "").replace(/^#/, "");
  const parts = raw.split("/").filter(Boolean);
  if (parts.length === 0) return { name: "home" };
  const name = parts[0] as HashPageName;
  if (!(PAGE_NAMES as readonly string[]).includes(name)) return null;
  if (name === "user" || name === "community") {
    return { name, userId: parts[1] ? decodeURIComponent(parts[1]) : undefined };
  }
  if (name === "channel") {
    return { name: "channel", channelId: parts[1] ? decodeURIComponent(parts[1]) : undefined, userId: parts[2] ? decodeURIComponent(parts[2]) : undefined };
  }
  return { name };
}

let writingHash = false;

export function writeHash(nav: HashNav) {
  if (typeof window === "undefined") return;
  const next = navToHash(nav);
  const current = window.location.hash || "#/";
  if (current === next) return;
  writingHash = true;
  window.location.hash = next;
  window.setTimeout(() => {
    writingHash = false;
  }, 0);
}

export function isWritingHash() {
  return writingHash;
}

export function startHashListener(apply: (nav: HashNav) => void) {
  if (typeof window === "undefined") return () => {};
  const onChange = () => {
    if (writingHash) return;
    const nav = hashToNav(window.location.hash);
    if (nav) apply(nav);
  };
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/** 启动时读取当前 hash，没有或无法识别则返回 null。 */
export function readInitialNav(): HashNav | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash;
  if (!hash || hash === "#" || hash === "#/") return { name: "home" };
  return hashToNav(hash);
}
