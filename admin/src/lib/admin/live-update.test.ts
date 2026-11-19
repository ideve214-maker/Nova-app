import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyCheckedUpdate,
  checkLiveUpdate,
  feedbackForLatest,
  formatAvailableMessage,
  formatUpToDateMessage,
  isUpToDateManifest,
  MISSING_UPDATE_URL_MESSAGE,
  runLiveUpdate,
  toDownloadOptions,
  type UpdateCheck,
  type UpdaterLike,
} from "./live-update.ts";

const VALID = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

describe("toDownloadOptions", () => {
  it("passes the server session_key to CapacitorUpdater.download as sessionKey", () => {
    const options = toDownloadOptions({
      version: "1.1.0",
      url: "https://updates.example/vexo-admin-1.1.0.zip",
      checksum: VALID,
      session_key: "iv-session-key",
    });
    assert.deepEqual(options, {
      url: "https://updates.example/vexo-admin-1.1.0.zip",
      version: "1.1.0",
      checksum: VALID,
      sessionKey: "iv-session-key",
    });
  });

  it("accepts the plugin's camelCase sessionKey as well", () => {
    const options = toDownloadOptions({
      version: "1.1.1",
      url: "https://updates.example/a.zip",
      checksum: VALID,
      sessionKey: "already-camel",
    });
    assert.equal(options?.sessionKey, "already-camel");
  });

  it("does not download when the server says the app is up to date", () => {
    assert.equal(toDownloadOptions({ error: "no_new_version_available", kind: "up_to_date", version: "1.1.0" }), null);
    assert.equal(toDownloadOptions(null), null);
  });
});

describe("unencrypted bundles (no session_key)", () => {
  const sha = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
  it("passes the sha256 checksum and no sessionKey when the manifest has none", () => {
    const options = toDownloadOptions({ version: "1.1.1", url: "https://updates.example/a.zip", checksum: sha });
    assert.deepEqual(options, { url: "https://updates.example/a.zip", version: "1.1.1", checksum: sha });
    assert.equal("sessionKey" in (options ?? {}), false);
  });
  it("treats an empty or blank session_key as absent", () => {
    for (const session_key of ["", "   "]) {
      const options = toDownloadOptions({ version: "1.1.1", url: "https://updates.example/a.zip", checksum: sha, session_key });
      assert.equal("sessionKey" in (options ?? {}), false);
      assert.equal(options?.checksum, sha);
    }
  });
  it("accepts a manifest that names the field sha256", () => {
    const options = toDownloadOptions({ version: "1.1.1", url: "https://updates.example/a.zip", sha256: sha });
    assert.equal(options?.checksum, sha);
  });
});

describe("checksum is required", () => {
  function quiet<T>(fn: () => T): { result: T; warnings: string[] } {
    const warnings: string[] = [];
    const orig = console.warn;
    console.warn = (...args: unknown[]) => void warnings.push(args.join(" "));
    try {
      return { result: fn(), warnings };
    } finally {
      console.warn = orig;
    }
  }
  const base = { version: "1.1.3", url: "http://updates.example/c.zip" };

  it("skips the update and warns when the checksum is missing", () => {
    for (const latest of [base, { ...base, checksum: "" }, { ...base, checksum: "   " }]) {
      const { result, warnings } = quiet(() => toDownloadOptions(latest));
      assert.equal(result, null);
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /missing/);
    }
  });

  it("skips the update when the checksum is the wrong length or not hex", () => {
    const bad = [VALID.slice(0, 63), VALID + "0", "z".repeat(64), VALID.slice(0, 62) + "g1", "md5:" + VALID.slice(4)];
    for (const checksum of bad) {
      const { result, warnings } = quiet(() => toDownloadOptions({ ...base, checksum }));
      assert.equal(result, null, checksum);
      assert.match(warnings[0], /not a 64-char sha256 hex/);
    }
  });

  it("downloads with a valid checksum, normalized to lowercase", () => {
    const { result, warnings } = quiet(() => toDownloadOptions({ ...base, sha256: VALID.toUpperCase() }));
    assert.deepEqual(result, { ...base, checksum: VALID });
    assert.equal(warnings.length, 0);
  });
});

describe("runLiveUpdate", () => {
  function fakeUpdater(latest: UpdateCheck) {
    const calls: { download: unknown[]; next: unknown[] } = { download: [], next: [] };
    return {
      calls,
      async getLatest() {
        return latest;
      },
      async download(options: { url: string; version: string; checksum?: string; sessionKey?: string }) {
        calls.download.push(options);
        return { id: "bundle-7" };
      },
      async next(options: { id: string }) {
        calls.next.push(options);
        return {};
      },
    };
  }

  it("calls CapacitorUpdater.download() with the server session_key, then next()", async () => {
    const updater = fakeUpdater({
      version: "1.1.1",
      url: "https://updates.example/vexo-admin-1.1.1.zip",
      checksum: VALID,
      session_key: "server-session-key",
    });
    const id = await runLiveUpdate(updater);
    assert.equal(id, "bundle-7");
    assert.equal(updater.calls.download.length, 1);
    assert.deepEqual(updater.calls.download[0], {
      url: "https://updates.example/vexo-admin-1.1.1.zip",
      version: "1.1.1",
      checksum: VALID,
      sessionKey: "server-session-key",
    });
    assert.deepEqual(updater.calls.next, [{ id: "bundle-7" }]);
  });

  it("calls download() with the checksum and without sessionKey for an unencrypted bundle", async () => {
    const updater = fakeUpdater({ version: "1.1.2", url: "https://updates.example/b.zip", checksum: VALID });
    await runLiveUpdate(updater);
    assert.deepEqual(updater.calls.download, [{ url: "https://updates.example/b.zip", version: "1.1.2", checksum: VALID }]);
    assert.deepEqual(updater.calls.next, [{ id: "bundle-7" }]);
  });

  it("does not call download() or next() when the manifest has no valid checksum", async () => {
    const orig = console.warn;
    console.warn = () => {};
    try {
      for (const checksum of [undefined, "abc123", "x".repeat(64)]) {
        const updater = fakeUpdater({ version: "1.1.4", url: "http://updates.example/d.zip", checksum });
        assert.equal(await runLiveUpdate(updater), null);
        assert.equal(updater.calls.download.length, 0);
        assert.equal(updater.calls.next.length, 0);
      }
    } finally {
      console.warn = orig;
    }
  });

  it("does not call download() when the server reports no new version", async () => {
    const updater = fakeUpdater({ error: "no_new_version_available", kind: "up_to_date", version: "1.1.0" });
    assert.equal(await runLiveUpdate(updater), null);
    assert.equal(updater.calls.download.length, 0);
    assert.equal(updater.calls.next.length, 0);
  });
});


describe("manual check feedback", () => {
  const sha = VALID;
  const newer = {
    version: "2.0.7",
    url: "https://updates.example/admin-2.0.7.zip",
    checksum: sha,
  };

  it("treats error plus kind up_to_date as already latest, not a failed check", () => {
    const latest: UpdateCheck = {
      error: "no_new_version_available",
      message: "No new version available",
      kind: "up_to_date",
      version: "2.0.6",
    } as UpdateCheck;
    assert.equal(isUpToDateManifest(latest), true);
    const feedback = feedbackForLatest(latest, "2.0.6");
    assert.equal(feedback.status, "up_to_date");
    assert.equal(feedback.message, "已是最新版本 2.0.6");
  });

  it("formats the dialog copy for latest and for a newer version", () => {
    assert.equal(formatUpToDateMessage("2.0.6"), "已是最新版本 2.0.6");
    assert.equal(formatAvailableMessage("2.0.7"), "发现新版本 2.0.7");
    const available = feedbackForLatest(newer, "2.0.6");
    assert.equal(available.status, "available");
    if (available.status === "available") {
      assert.equal(available.message, "发现新版本 2.0.7");
      assert.equal(available.options.version, "2.0.7");
    }
  });

  it("treats a same-or-older manifest version as already latest", () => {
    const same = feedbackForLatest({ ...newer, version: "2.0.6" }, "2.0.6");
    assert.equal(same.status, "up_to_date");
    assert.equal(same.message, "已是最新版本 2.0.6");
  });

  it("returns 未配置更新地址 when the build-time URL is missing", async () => {
    const updater: UpdaterLike = {
      async getLatest() {
        throw new Error("should not be called");
      },
      async download() {
        return { id: "x" };
      },
      async next() {
        return {};
      },
    };
    const feedback = await checkLiveUpdate(updater, { getUrl: () => "", builtinVersion: "2.0.6" });
    assert.equal(feedback.status, "error");
    assert.equal(feedback.message, MISSING_UPDATE_URL_MESSAGE);
    assert.equal(feedback.message, "未配置更新地址");
  });

  it("returns a clear error when getLatest throws, and when the checksum is missing", async () => {
    const throwing: UpdaterLike = {
      async getLatest() {
        throw new Error("network down");
      },
      async download() {
        return { id: "x" };
      },
      async next() {
        return {};
      },
    };
    const failed = await checkLiveUpdate(throwing, {
      getUrl: () => "https://updates.example/manifest.json",
      builtinVersion: "2.0.6",
    });
    assert.equal(failed.status, "error");
    assert.equal(failed.message, "network down");

    const bad = feedbackForLatest({ version: "2.0.7", url: "https://updates.example/a.zip" }, "2.0.6");
    assert.equal(bad.status, "error");
    assert.match(bad.message, /校验信息不完整/);
  });

  it("downloads and queues a bundle when the user confirms 更新", async () => {
    const calls: { download: unknown[]; next: unknown[] } = { download: [], next: [] };
    const updater: UpdaterLike = {
      async getLatest() {
        return newer;
      },
      async download(options) {
        calls.download.push(options);
        return { id: "bundle-9" };
      },
      async next(options) {
        calls.next.push(options);
        return {};
      },
    };
    const feedback = await checkLiveUpdate(updater, {
      getUrl: () => "https://updates.example/manifest.json",
      builtinVersion: "2.0.6",
    });
    assert.equal(feedback.status, "available");
    if (feedback.status !== "available") return;
    const applied = await applyCheckedUpdate(updater, feedback.options);
    assert.deepEqual(applied, { ok: true, id: "bundle-9" });
    assert.equal(calls.download.length, 1);
    assert.deepEqual(calls.next, [{ id: "bundle-9" }]);
  });
});
