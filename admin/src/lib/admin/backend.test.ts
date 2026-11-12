import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectVersion,
  extractList,
  mapCatalogEntitlements,
  mapRemoteUser,
  pick,
  joinUrl,
  pathTemplate,
} from "./backend.ts";

describe("pick / joinUrl / pathTemplate", () => {
  it("reads nested and fallback keys", () => {
    assert.equal(pick({ profile: { name: "Ada" } }, "name", "profile.name"), "Ada");
    assert.equal(pick({ name: "" }, "name", "username"), undefined);
  });
  it("joins and fills path params", () => {
    assert.equal(joinUrl("http://a.example:8787/", "/api/health"), "http://a.example:8787/api/health");
    assert.equal(pathTemplate("/api/admin/users/:id/ban", { id: "42" }), "/api/admin/users/42/ban");
  });
});

describe("extractList", () => {
  it("accepts several wrapper shapes used by future APIs", () => {
    assert.deepEqual(extractList([{ id: 1 }]), [{ id: 1 }]);
    assert.deepEqual(extractList({ users: [{ id: 2 }] }), [{ id: 2 }]);
    assert.deepEqual(extractList({ data: { items: [{ id: 3 }] } }), [{ id: 3 }]);
    assert.deepEqual(extractList({ foo: 1 }), []);
  });
});

describe("detectVersion", () => {
  it("prefers headers then body, and recognizes health without a version field", () => {
    assert.equal(detectVersion({}, { "x-nova-version": "7.1" }), "7.1");
    assert.equal(detectVersion({ version: "m3.2" }, {}), "m3.2");
    assert.match(detectVersion({ status: "ok", time: 1 }, {}) || "", /未声明版本号/);
    assert.equal(detectVersion({ status: "fail" }, {}), null);
  });
});

describe("mapRemoteUser", () => {
  it("maps current /api/me user shape", () => {
    const u = mapRemoteUser({
      id: 12,
      username: "alice",
      email: "a@b.com",
      role: "user",
      vip: true,
      vipUntil: 1_800_000_000_000,
      createdAt: 1_700_000_000_000,
      profile: { displayName: "Alice", bio: "hi", avatar: { kind: "color" } },
    });
    assert.ok(u);
    assert.equal(u!.id, "12");
    assert.equal(u!.name, "alice"); // username first; displayName is also accepted via name
    assert.equal(u!.email, "a@b.com");
    assert.equal(u!.vipUntil, 1_800_000_000_000);
    assert.equal(u!.status, "active");
  });
  it("maps a future admin user with different field names", () => {
    const u = mapRemoteUser({
      user_id: "u_9",
      displayName: "周光",
      mail: "zhou@nova.test",
      status: "banned",
      vip_until: "2026-12-01T00:00:00Z",
      last_login_at: 1_700_000_000,
      online: true,
      extraFutureField: { foo: 1 },
    });
    assert.ok(u);
    assert.equal(u!.id, "u_9");
    assert.equal(u!.name, "周光");
    assert.equal(u!.email, "zhou@nova.test");
    assert.equal(u!.status, "banned");
    assert.ok(u!.vipUntil && u!.vipUntil > 0);
    assert.equal(u!.presence, "online");
  });
  it("returns null when there is no id", () => {
    assert.equal(mapRemoteUser({ name: "x" }), null);
    assert.equal(mapRemoteUser(null), null);
  });
});

describe("mapCatalogEntitlements", () => {
  it("aliases M2.6 catalog keys onto admin switches", () => {
    const mapped = mapCatalogEntitlements(
      {
        entitlements: {
          vip_badge: { status: "live", vip: true },
          personal_saved_items_plus: { kind: "quota", vip: 500 },
        },
      },
      { "badge.vip": false, "quota.save": true },
    );
    assert.equal(mapped["badge.vip"], true);
    assert.equal(mapped["quota.save"], true);
  });
});
