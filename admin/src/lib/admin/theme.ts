/** 星澜主题：深色为默认，可跟随系统或在「我的」里手动切换。 */
export type ThemeMode = "system" | "dark" | "light";

export const THEME_STORAGE_KEY = "nova-admin-theme";

export function getStoredTheme(): ThemeMode {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    if (value === "dark" || value === "light" || value === "system") return value;
  } catch {
    /* private mode */
  }
  return "system";
}

export function resolvedTheme(mode: ThemeMode = getStoredTheme()): "dark" | "light" {
  if (mode === "light") return "light";
  if (mode === "dark") return "dark";
  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

export function applyTheme(mode: ThemeMode = getStoredTheme()): "dark" | "light" {
  const resolved = resolvedTheme(mode);
  if (typeof document === "undefined") return resolved;
  const root = document.documentElement;
  root.setAttribute("data-theme", resolved);
  root.style.colorScheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", resolved === "light" ? "#F3F4F9" : "#0A0C14");
  return resolved;
}

export function setTheme(mode: ThemeMode): "dark" | "light" {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    /* private mode */
  }
  return applyTheme(mode);
}

export function watchSystemTheme(): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  const onChange = () => {
    if (getStoredTheme() === "system") applyTheme("system");
  };
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
