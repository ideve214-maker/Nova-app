import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runLiveUpdate, toDownloadOptions, type UpdateCheck } from "./live-update.ts";

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
