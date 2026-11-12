import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hashToNav, navToHash } from "./hash-route.ts";

describe("hash routing", () => {
  it("maps home and simple pages", () => {
    assert.equal(navToHash({ name: "home" }), "#/");
    assert.equal(navToHash({ name: "users" }), "#/users");
    assert.deepEqual(hashToNav("#/"), { name: "home" });
    assert.deepEqual(hashToNav(""), { name: "home" });
    assert.deepEqual(hashToNav("#/content"), { name: "content" });
  });
  it("maps user detail with id", () => {
    assert.equal(navToHash({ name: "user", userId: "u/1" }), "#/user/u%2F1");
    assert.deepEqual(hashToNav("#/user/u%2F1"), { name: "user", userId: "u/1" });
  });
  it("rejects unknown paths", () => {
    assert.equal(hashToNav("#/not-a-page"), null);
  });
});
