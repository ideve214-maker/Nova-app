import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

describe("generate-capacitor-assets.sh", () => {
  const source = readFileSync(new URL("./generate-capacitor-assets.sh", import.meta.url), "utf8");

  it("passes --assetPath resources and does not swallow a failed generation", () => {
    assert.match(source, /set -euo pipefail/);
    assert.match(source, /--assetPath resources/);
    assert.equal(source.includes("||"), false);
    assert.equal(/capacitor-assets failed/.test(source), false);
  });
});
