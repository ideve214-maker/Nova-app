import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readScroll, saveScroll, scrollKey, _resetScrollPositionsForTests } from "./scroll-restore.ts";

describe("scroll restore keys and memory", () => {
  it("uses the hash path as the key so tabs stay independent", () => {
    assert.equal(scrollKey({ name: "home" }), "home");
    assert.equal(scrollKey({ name: "manage" }), "manage");
    assert.equal(scrollKey({ name: "settings" }), "settings");
    assert.equal(scrollKey({ name: "user", userId: "u1" }), "user/u1");
  });

  it("remembers each route and defaults to 0", () => {
    _resetScrollPositionsForTests();
    assert.equal(readScroll("manage"), 0);
    saveScroll("manage", 320);
    saveScroll("settings", 80);
    assert.equal(readScroll("manage"), 320);
    assert.equal(readScroll("settings"), 80);
    assert.equal(readScroll("home"), 0);
  });
});
