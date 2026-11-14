import { SKIN_STORAGE_KEY, THEME_STORAGE_KEY } from "./storage-keys";

/** 外观：星光 / 社交蓝 / 脉冲。每套都有深色和浅色。未选过皮肤时默认星光。 */
export type ThemeMode = "system" | "dark" | "light";
export type SkinId = "starlight" | "social-blue" | "pulse";

export { SKIN_STORAGE_KEY, THEME_STORAGE_KEY };

export const SKINS: { id: SkinId; label: string }[] = [
  { id: "starlight", label: "星光" },
  { id: "social-blue", label: "社交蓝" },
  { id: "pulse", label: "脉冲" },
];

const THEME_COLOR: Record<SkinId, Record<"dark" | "light", string>> = {
  starlight: { dark: "#070B16", light: "#E8EEF8" },
  "social-blue": { dark: "#17212B", light: "#F0F2F5" },
  pulse: { dark: "#0B0B0D", light: "#F7FBFB" },
};

/** 与用户端 v7-m7.r4 的 SKIN_RENAMES 一致。旧 id 只在这里改写，界面不展示。 */
export const SKIN_RENAMES: Record<string, SkinId> = {
  facebook: "social-blue",
  tiktok: "pulse",
  social: "social-blue",
};

export const SKIN_DEFAULT_MODE: Record<SkinId, "dark" | "light"> = {
  starlight: "dark",
  "social-blue": "light",
  pulse: "dark",
};

const DEFAULT_SKIN: SkinId = "starlight";

export function canonSkin(id: string | null | undefined): SkinId | "" {
  const raw = String(id ?? "").trim();
  if (!raw) return "";
  const mapped = SKIN_RENAMES[raw.toLowerCase()] || raw;
  if (mapped === "starlight" || mapped === "social-blue" || mapped === "pulse") return mapped;
  return "";
}

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeAppearance(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emitAppearance() {
  for (const fn of listeners) fn();
}

export function getStoredTheme(): ThemeMode {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    if (value === "dark" || value === "light" || value === "system") return value;
  } catch {
    /* private mode */
  }
  return SKIN_DEFAULT_MODE[getStoredSkin()];
}

export function migrateStoredSkin(): SkinId {
  let next: SkinId = DEFAULT_SKIN;
  try {
    const raw = localStorage.getItem(SKIN_STORAGE_KEY);
    next = canonSkin(raw) || DEFAULT_SKIN;
    if (raw && raw !== next) localStorage.setItem(SKIN_STORAGE_KEY, next);
  } catch {
    /* private mode */
  }
  return next;
}

export function getStoredSkin(): SkinId {
  return migrateStoredSkin();
}

export function resolvedTheme(mode: ThemeMode = getStoredTheme()): "dark" | "light" {
  if (mode === "light") return "light";
  if (mode === "dark") return "dark";
  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

export function themeColor(skin: SkinId, mode: "dark" | "light") {
  return THEME_COLOR[skin][mode];
}

export function applyAppearance(skin: SkinId = getStoredSkin(), mode: ThemeMode = getStoredTheme()): "dark" | "light" {
  const resolved = resolvedTheme(mode);
  if (typeof document === "undefined") return resolved;
  const root = document.documentElement;
  root.setAttribute("data-skin", skin);
  root.setAttribute("data-theme", resolved);
  root.style.colorScheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", themeColor(skin, resolved));
  return resolved;
}

export function applyTheme(mode: ThemeMode = getStoredTheme()): "dark" | "light" {
  return applyAppearance(getStoredSkin(), mode);
}

export function setTheme(mode: ThemeMode): "dark" | "light" {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    /* private mode */
  }
  const resolved = applyAppearance(getStoredSkin(), mode);
  emitAppearance();
  return resolved;
}

export function setSkin(skin: SkinId): SkinId {
  const next: SkinId = canonSkin(skin) || DEFAULT_SKIN;
  const mode = SKIN_DEFAULT_MODE[next];
  try {
    localStorage.setItem(SKIN_STORAGE_KEY, next);
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    /* private mode */
  }
  applyAppearance(next, mode);
  emitAppearance();
  return next;
}

export function watchSystemTheme(): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  const onChange = () => {
    if (getStoredTheme() === "system") {
      applyAppearance(getStoredSkin(), "system");
      emitAppearance();
    }
  };
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
