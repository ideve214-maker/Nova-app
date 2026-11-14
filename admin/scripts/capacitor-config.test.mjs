import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

describe("capacitor.config.ts CapacitorUpdater", () => {
  const source = readFileSync(new URL("../capacitor.config.ts", import.meta.url), "utf8");

  it("keeps the plugin's own auto update off so only live-update.ts downloads", () => {
    assert.match(source, /autoUpdate:\s*false,/);
    assert.equal(/atBackground|atInstall|onLaunch/.test(source), false);
    assert.equal(/autoUpdate:\s*[^f\s]/.test(source), false);
  });

  it("does not hardcode an update URL or a publicKey", () => {
    assert.match(source, /\n\s*updateUrl,\n/);
    assert.equal(/publicKey/.test(source), false);
  });
});
