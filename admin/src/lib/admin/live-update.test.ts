import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toDownloadOptions } from "./live-update.ts";

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
