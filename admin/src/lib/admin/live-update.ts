import { Capacitor } from "@capacitor/core";
import { CapacitorUpdater } from "@capgo/capacitor-updater";

export const CAPACITOR_UPDATER_VERSION = "7.53.0";
export const CAPACITOR_UPDATER_LICENSE = "MPL-2.0";

/** Self-hosted manifest URL baked into the SPA at build time. Empty = disabled. */
export function getUpdateUrl(): string {
  return String(import.meta.env.VITE_NOVA_UPDATE_URL ?? "").trim();
}

/**
 * Call as early as possible on native startup.
 * notifyAppReady() must run within appReadyTimeout (10s) or a newly applied
 * bundle is rolled back automatically. Stats/channel URLs are forced empty so
 * nothing is reported to Capgo cloud.
 */
export async function initLiveUpdate() {
  if (typeof window === "undefined") return;
  if (!Capacitor.isNativePlatform()) return;

  try {
    await CapacitorUpdater.notifyAppReady();
  } catch {
    /* plugin not in the native binary yet */
  }

  try {
    await CapacitorUpdater.setStatsUrl({ url: "" });
  } catch {
    /* allowModifyUrl missing on an older binary, or not native */
  }
  try {
    await CapacitorUpdater.setChannelUrl({ url: "" });
  } catch {
    /* same */
  }

  const url = getUpdateUrl();
  if (!url) return;
  try {
    await CapacitorUpdater.setUpdateUrl({ url });
  } catch {
    /* config-only URL still applies when allowModifyUrl is false */
  }
}
