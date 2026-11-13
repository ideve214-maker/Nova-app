import * as Sentry from "@sentry/browser";

export const SENTRY_BROWSER_VERSION = "11.12.0";
export const SENTRY_BROWSER_LICENSE = "MIT";

const LS_ENABLED = "nova-admin-bugsink";
const LS_DSN = "nova-admin-bugsink-dsn";

function envFlagOn() {
  const v = String(import.meta.env.VITE_NOVA_BUGSINK ?? "").toLowerCase();
  return v === "1" || v === "on" || v === "true";
}

function envDsn() {
  return String(import.meta.env.VITE_NOVA_BUGSINK_DSN ?? "").trim();
}

/** Off unless the user (or a build env flag) explicitly turns it on, and a DSN is set. */
export function isBugsinkEnabled() {
  if (typeof window === "undefined") return false;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(LS_ENABLED);
  } catch {
    stored = null;
  }
  if (stored === "0" || stored === "off") return false;
  if (stored === "1" || stored === "on") return true;
  return envFlagOn();
}

export function getBugsinkDsn() {
  if (typeof window === "undefined") return envDsn();
  try {
    return (localStorage.getItem(LS_DSN) || "").trim() || envDsn();
  } catch {
    return envDsn();
  }
}

let started = false;

export function initBugsink() {
  if (typeof window === "undefined") return;
  if (started) return;
  if (!isBugsinkEnabled()) return;
  const dsn = getBugsinkDsn();
  if (!dsn) return;
  Sentry.init({
    dsn,
    enabled: true,
  });
  started = true;
}

export function setBugsinkConfig(enabled: boolean, dsn: string) {
  const next = (dsn || "").trim();
  try {
    localStorage.setItem(LS_ENABLED, enabled ? "1" : "0");
    if (next) localStorage.setItem(LS_DSN, next);
    else localStorage.removeItem(LS_DSN);
  } catch {
    /* private mode */
  }
  if (!enabled) {
    if (started) {
      try {
        Sentry.close();
      } catch {
        /* ignore */
      }
      started = false;
    }
    return;
  }
  if (!next) return;
  if (started) {
    try {
      Sentry.close();
    } catch {
      /* ignore */
    }
    started = false;
  }
  initBugsink();
}

export function captureBugsinkException(err: unknown) {
  if (!started || !isBugsinkEnabled()) return;
  try {
    Sentry.captureException(err);
  } catch {
    /* ignore */
  }
}
