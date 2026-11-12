import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectVersion,
  extractList,
  mapCatalogEntitlements,
  mapRemoteUser,
  mapRemotePayment,
  mapRemoteContent,
  mapRemoteStats,
  mapRemoteAudit,
  mapRemoteAnnouncement,
  paymentStatusLabel,
  pick,
  joinUrl,
  pathTemplate,
  resolveBase,
  pickToken,
  mapRemoteAdmin,
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

describe("resolveBase priority", () => {
  it("uses an explicit non-empty user override first", () => {
    assert.equal(resolveBase("https://user.example/api/", "https://env.example"), "https://user.example/api");
  });
  it("falls through empty override to VITE default", () => {
    assert.equal(resolveBase("", "https://env.example/"), "https://env.example");
  });
  it("returns empty when nothing is set and there is no window (native / node)", () => {
    assert.equal(resolveBase("", ""), "");
  });
});


describe("m4.12 admin mappers", () => {
  it("maps a payment order and receipt fields", () => {
    const p = mapRemotePayment({
      id: "pay_1",
      code: "NVABC123",
      userId: 9,
      method: "wechat",
      methodName: "微信支付",
      period: "month",
      amountCents: 990,
      amountLabel: "¥9.9/月",
      status: "awaiting_review",
      hasReceipt: true,
      receiptUrl: "/api/admin/payments/pay_1/receipt",
      days: 30,
      user: { id: 9, username: "alice", displayName: "Alice", vipUntil: 1800000000000 },
    });
    assert.ok(p);
    assert.equal(p!.code, "NVABC123");
    assert.equal(p!.status, "awaiting_review");
    assert.equal(p!.amountCents, 990);
    assert.equal(p!.days, 30);
    assert.equal(p!.hasReceipt, true);
    assert.equal(p!.userName, "Alice");
    assert.equal(paymentStatusLabel("awaiting_review"), "待审核");
  });
  it("maps content and stats from m4.12 shapes", () => {
    const c = mapRemoteContent({
      id: "po_1",
      type: "post",
      text: "hello world",
      title: "hello",
      authorId: 1,
      author: { id: 1, username: "alice", displayName: "Alice" },
      createdAt: 1700000000000,
      status: "approved",
      deleted: false,
    });
    assert.ok(c);
    assert.equal(c!.type, "post");
    assert.equal(c!.status, "approved");
    assert.equal(c!.authorName, "Alice");
    const s = mapRemoteStats({
      users: { total: 3, active: 2, banned: 1, vip: 1 },
      posts: { visible: 4, removed: 1 },
      comments: { visible: 7 },
      reports: { pending: 2 },
      payments: { pending: 1, awaitingReview: 3 },
    });
    assert.ok(s);
    assert.equal(s!.usersTotal, 3);
    assert.equal(s!.paymentsReview, 3);
    assert.equal(s!.postsRemoved, 1);
  });
  it("maps audit, announcement, login token", () => {
    const a = mapRemoteAudit({ id: 8, action: "admin.user.ban", target: "user:1", at: 1700000000000, ip: "127.0.0.1", actorId: 1 });
    assert.ok(a);
    assert.equal(a!.kind, "admin");
    assert.equal(a!.action, "admin.user.ban");
    const n = mapRemoteAnnouncement({ id: 2, title: "守则", body: "友善", published: 1, createdAt: 1700000000000 });
    assert.ok(n);
    assert.equal(n!.published, true);
    const login = { ok: true, admin: { id: 1, username: "admin", role: "admin", status: "active" }, token: "na_abc", expiresAt: 1 };
    assert.equal(pickToken(login), "na_abc");
    const admin = mapRemoteAdmin(login);
    assert.equal(admin!.username, "admin");
  });
  it("maps temporaryPassword onto tempCode and mustChangePw", () => {
    const u = mapRemoteUser({ id: 2, username: "zhou", temporaryPassword: "Tmpabc1a", mustChangePw: true, status: "active" });
    assert.equal(u!.tempCode, "Tmpabc1a");
    assert.equal(u!.mustChangePw, true);
  });
});
