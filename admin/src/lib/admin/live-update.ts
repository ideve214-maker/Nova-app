import { Capacitor } from "@capacitor/core";
import { CapacitorUpdater } from "@capgo/capacitor-updater";

export const CAPACITOR_UPDATER_VERSION = "7.53.0";
export const CAPACITOR_UPDATER_LICENSE = "MPL-2.0";

/** Self-hosted manifest URL baked into the SPA at build time. Empty = disabled. */
export function getUpdateUrl(): string {
  return String(import.meta.env.VITE_NOVA_UPDATE_URL ?? "").trim();
}

/**
 * Shape returned by the self-hosted updater.
 * The server sends `session_key` (Capgo encrypt payload). `download()` takes `sessionKey`.
 */
export type UpdateCheck = {
  url?: string;
  version?: string;
  checksum?: string;
  sessionKey?: string;
  session_key?: string;
  error?: string;
  kind?: string;
};

/** Options for CapacitorUpdater.download(), or null when there is nothing to fetch. */
export function toDownloadOptions(latest: UpdateCheck | null | undefined) {
  if (!latest || latest.error || latest.kind === "up_to_date") return null;
  const url = String(latest.url ?? "").trim();
  const version = String(latest.version ?? "").trim();
  if (!url || !version) return null;
  const checksum = String(latest.checksum ?? "").trim();
  const sessionKey = String(latest.sessionKey ?? latest.session_key ?? "").trim();
  const options: { url: string; version: string; checksum?: string; sessionKey?: string } = { url, version };
  if (checksum) options.checksum = checksum;
  if (sessionKey) options.sessionKey = sessionKey;
  return options;
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

  try {
    const latest = await CapacitorUpdater.getLatest();
    const options = toDownloadOptions(latest);
    if (options) await CapacitorUpdater.download(options);
  } catch {
    /* no bundle, or the native auto-update path already owns this check */
  }
}
