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
    assert.equal(navToHash({ name: "payments" }), "#/payments");
    assert.deepEqual(hashToNav("#/payments"), { name: "payments" });
  });
  it("maps user detail with id", () => {
    assert.equal(navToHash({ name: "user", userId: "u/1" }), "#/user/u%2F1");
    assert.deepEqual(hashToNav("#/user/u%2F1"), { name: "user", userId: "u/1" });
  });
  it("rejects unknown paths", () => {
    assert.equal(hashToNav("#/not-a-page"), null);
  });
  it("maps community, channel and blockwords", () => {
    assert.equal(navToHash({ name: "communities" }), "#/communities");
    assert.equal(navToHash({ name: "community", userId: "cm_1" }), "#/community/cm_1");
    assert.deepEqual(hashToNav("#/community/cm_1"), { name: "community", userId: "cm_1" });
    assert.equal(navToHash({ name: "channel", channelId: "ch_1" }), "#/channel/ch_1");
    assert.deepEqual(hashToNav("#/channel/ch_1"), { name: "channel", channelId: "ch_1", userId: undefined });
    assert.equal(navToHash({ name: "channel", channelId: "ch_1", userId: "cm_1" }), "#/channel/ch_1/cm_1");
    assert.deepEqual(hashToNav("#/channel/ch_1/cm_1"), { name: "channel", channelId: "ch_1", userId: "cm_1" });
    assert.equal(navToHash({ name: "blockwords" }), "#/blockwords");
    assert.deepEqual(hashToNav("#/blockwords"), { name: "blockwords" });
  });
  it("maps security events and appeals", () => {
    assert.equal(navToHash({ name: "events" }), "#/events");
    assert.deepEqual(hashToNav("#/events"), { name: "events" });
    assert.equal(navToHash({ name: "appeals" }), "#/appeals");
    assert.deepEqual(hashToNav("#/appeals"), { name: "appeals" });
  });
});
