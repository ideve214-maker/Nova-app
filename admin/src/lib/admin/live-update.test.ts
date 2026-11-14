import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runLiveUpdate, toDownloadOptions, type UpdateCheck } from "./live-update.ts";

describe("toDownloadOptions", () => {
  it("passes the server session_key to CapacitorUpdater.download as sessionKey", () => {
    const options = toDownloadOptions({
      version: "1.1.0",
      url: "https://updates.example/vexo-admin-1.1.0.zip",
      checksum: "abc",
      session_key: "iv-session-key",
    });
    assert.deepEqual(options, {
      url: "https://updates.example/vexo-admin-1.1.0.zip",
      version: "1.1.0",
      checksum: "abc",
      sessionKey: "iv-session-key",
    });
  });

  it("accepts the plugin's camelCase sessionKey as well", () => {
    const options = toDownloadOptions({
      version: "1.1.1",
      url: "https://updates.example/a.zip",
      sessionKey: "already-camel",
    });
    assert.equal(options?.sessionKey, "already-camel");
  });

  it("does not download when the server says the app is up to date", () => {
    assert.equal(toDownloadOptions({ error: "no_new_version_available", kind: "up_to_date", version: "1.1.0" }), null);
    assert.equal(toDownloadOptions(null), null);
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
      checksum: "c0ffee",
      session_key: "server-session-key",
    });
    const id = await runLiveUpdate(updater);
    assert.equal(id, "bundle-7");
    assert.equal(updater.calls.download.length, 1);
    assert.deepEqual(updater.calls.download[0], {
      url: "https://updates.example/vexo-admin-1.1.1.zip",
      version: "1.1.1",
      checksum: "c0ffee",
      sessionKey: "server-session-key",
    });
    assert.deepEqual(updater.calls.next, [{ id: "bundle-7" }]);
  });

  it("does not call download() when the server reports no new version", async () => {
    const updater = fakeUpdater({ error: "no_new_version_available", kind: "up_to_date", version: "1.1.0" });
    assert.equal(await runLiveUpdate(updater), null);
    assert.equal(updater.calls.download.length, 0);
    assert.equal(updater.calls.next.length, 0);
  });
});
