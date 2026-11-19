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
 * Bundles are not encrypted (no publicKey in capacitor.config.ts). The manifest's
 * sha256 `checksum` is always passed to download() so the plugin verifies the zip.
 * `session_key` is only forwarded as `sessionKey` when the manifest has a non-empty one.
 */
export type UpdateCheck = {
  url?: string;
  version?: string;
  checksum?: string;
  /** Some manifests name the sha256 field explicitly. */
  sha256?: string;
  sessionKey?: string;
  session_key?: string;
  error?: string;
  kind?: string;
};

const SHA256_HEX = /^[0-9a-f]{64}$/i;

/**
 * Options for CapacitorUpdater.download(), or null when there is nothing to fetch.
 * A sha256 checksum (64 hex chars, from `checksum` or `sha256`) is required: the
 * update URL may be plain http, so a bundle without a valid checksum is skipped
 * (no download, no next()) and a warning is logged.
 */
export function toDownloadOptions(latest: UpdateCheck | null | undefined) {
  if (!latest || latest.error || latest.kind === "up_to_date") return null;
  const url = String(latest.url ?? "").trim();
  const version = String(latest.version ?? "").trim();
  if (!url || !version) return null;
  const rawChecksum = String(latest.checksum || latest.sha256 || "").trim();
  if (!SHA256_HEX.test(rawChecksum)) {
    console.warn(
      `[vexo-admin] live update ${version} skipped: manifest checksum is ${rawChecksum ? "not a 64-char sha256 hex" : "missing"}`,
    );
    return null;
  }
  const checksum = rawChecksum.toLowerCase();
  const sessionKey = String(latest.sessionKey ?? latest.session_key ?? "").trim();
  const options: { url: string; version: string; checksum: string; sessionKey?: string } = { url, version, checksum };
  if (sessionKey) options.sessionKey = sessionKey;
  return options;
}

/** The slice of CapacitorUpdater the update flow uses (injectable for tests). */
export type UpdaterLike = {
  getLatest(): Promise<UpdateCheck>;
  download(options: { url: string; version: string; checksum?: string; sessionKey?: string }): Promise<{ id: string }>;
  next(options: { id: string }): Promise<unknown>;
  current?(): Promise<{ bundle?: { version?: string }; native?: string }>;
};

/**
 * Ask the self-hosted server for the latest bundle, download it with the
 * server's session_key (as `sessionKey`) and queue it for the next background.
 * Returns the downloaded bundle id, or null when nothing was downloaded.
 */
export async function runLiveUpdate(updater: UpdaterLike): Promise<string | null> {
  try {
    const latest = await updater.getLatest();
    const options = toDownloadOptions(latest);
    if (!options) return null;
    // 1.1.1：只在服务器版本比当前运行的版本新时才下载，避免每次启动重复下载同一个包。
    if (typeof updater.current === "function") {
      try {
        const cur = await updater.current();
        const running = cur?.bundle?.version && cur.bundle.version !== "builtin" ? cur.bundle.version : cur?.native;
        if (running && !isNewerVersion(options.version, String(running))) return null;
      } catch {
        /* unknown current version: fall through and download */
      }
    }
    const bundle = await updater.download(options);
    if (bundle?.id) await updater.next({ id: bundle.id });
    return bundle?.id ?? null;
  } catch {
    /* no bundle, or the native auto-update path already owns this check */
    return null;
  }
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

  await runLiveUpdate(CapacitorUpdater);
}

/** a > b（按点分数字比较，非数字部分忽略）。 */
export function isNewerVersion(a: string, b: string): boolean {
  const pa = String(a).split(".").map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0;
  }
  return false;
}

export const MISSING_UPDATE_URL_MESSAGE = "未配置更新地址";

/** Result of a user-initiated update check. Always has a message to show. */
export type LiveUpdateFeedback =
  | { status: "up_to_date"; version: string; message: string }
  | {
      status: "available";
      version: string;
      currentVersion: string;
      options: NonNullable<ReturnType<typeof toDownloadOptions>>;
      message: string;
    }
  | { status: "error"; message: string };

/** App version baked in at build time from package.json (empty in unit tests). */
export function getBuiltinAppVersion(): string {
  try {
    const env = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env;
    return String(env?.VITE_NOVA_APP_VERSION || env?.VITE_NOVA_UPDATE_VERSION || "").trim();
  } catch {
    return "";
  }
}

/** The self-hosted manifest uses error + kind:"up_to_date" to mean "already latest", not a failure. */
export function isUpToDateManifest(latest: UpdateCheck | null | undefined): boolean {
  if (!latest) return false;
  if (latest.kind === "up_to_date") return true;
  const err = String(latest.error ?? "").trim().toLowerCase();
  return err === "no_new_version_available" || err === "up_to_date";
}

export function formatUpToDateMessage(version: string): string {
  const v = String(version || "").trim();
  return v ? `已是最新版本 ${v}` : "已是最新版本";
}

export function formatAvailableMessage(version: string): string {
  const v = String(version || "").trim();
  return v ? `发现新版本 ${v}` : "发现新版本";
}

export function readRunningVersion(
  current?: { bundle?: { version?: string }; native?: string } | null,
  fallback = "",
): string {
  const bundle = current?.bundle?.version;
  if (bundle && bundle !== "builtin") return String(bundle);
  if (current?.native) return String(current.native);
  return fallback || getBuiltinAppVersion();
}

/**
 * Turn a getLatest() payload into UI feedback.
 * kind:"up_to_date" (even when error is set) is "already latest", not a failed check.
 */
export function feedbackForLatest(
  latest: UpdateCheck | null | undefined,
  currentVersion: string,
): LiveUpdateFeedback {
  const current = String(currentVersion || "").trim();
  if (isUpToDateManifest(latest)) {
    const version = String(latest?.version || current || "").trim();
    return { status: "up_to_date", version, message: formatUpToDateMessage(version) };
  }
  const options = toDownloadOptions(latest);
  if (options) {
    if (current && !isNewerVersion(options.version, current)) {
      return { status: "up_to_date", version: current, message: formatUpToDateMessage(current) };
    }
    return {
      status: "available",
      version: options.version,
      currentVersion: current,
      options,
      message: formatAvailableMessage(options.version),
    };
  }
  if (!latest) {
    return { status: "error", message: "检查更新失败，请稍后重试" };
  }
  if (latest.error) {
    return { status: "error", message: String(latest.error) };
  }
  const url = String(latest.url ?? "").trim();
  const version = String(latest.version ?? "").trim();
  if (!url || !version) {
    return { status: "error", message: "更新信息无效，请稍后重试" };
  }
  const rawChecksum = String(latest.checksum || latest.sha256 || "").trim();
  if (!SHA256_HEX.test(rawChecksum)) {
    return { status: "error", message: "更新包校验信息不完整，已取消下载" };
  }
  return { status: "error", message: "检查更新失败，请稍后重试" };
}

/**
 * Manual "检查更新": always returns something the UI can show.
 * Missing build-time manifest URL becomes "未配置更新地址".
 */
export async function checkLiveUpdate(
  updater: UpdaterLike,
  deps: { getUrl?: () => string; builtinVersion?: string } = {},
): Promise<LiveUpdateFeedback> {
  const url = (deps.getUrl ?? getUpdateUrl)();
  if (!url) {
    return { status: "error", message: MISSING_UPDATE_URL_MESSAGE };
  }
  let currentVersion = deps.builtinVersion ?? getBuiltinAppVersion();
  if (typeof updater.current === "function") {
    try {
      currentVersion = readRunningVersion(await updater.current(), currentVersion);
    } catch {
      /* keep fallback */
    }
  }
  try {
    const latest = await updater.getLatest();
    return feedbackForLatest(latest, currentVersion);
  } catch (err) {
    const msg = err instanceof Error && err.message.trim() ? err.message.trim() : "检查更新失败，请稍后重试";
    return { status: "error", message: msg };
  }
}

export async function applyCheckedUpdate(
  updater: UpdaterLike,
  options: NonNullable<ReturnType<typeof toDownloadOptions>>,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  try {
    const bundle = await updater.download(options);
    if (!bundle?.id) return { ok: false, message: "下载更新失败，请稍后重试" };
    await updater.next({ id: bundle.id });
    return { ok: true, id: bundle.id };
  } catch (err) {
    const msg = err instanceof Error && err.message.trim() ? err.message.trim() : "下载更新失败，请稍后重试";
    return { ok: false, message: msg };
  }
}
