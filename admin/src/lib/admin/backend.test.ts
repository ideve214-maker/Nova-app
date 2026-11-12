import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectVersion,
  extractList,
  formatLockoutMessage,
  readRetryAfter,
  mapRemoteAppeal,
  mapRemoteSecurityEvent,
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
  formatAdminTime,
  mapRemoteBlockword,
  mapRemoteChannelMessage,
  mapRemoteCommunity,
  mapRemoteReport,
  mapAudience,
  audienceLabel,
  parsePostMedia,
  reportKindLabel,
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
  it("appends a short commit when /api/version provides one", () => {
    assert.equal(detectVersion({ version: "0.7.0-m6.1", commit: "27d1595abcdef" }, {}), "0.7.0-m6.1 · 27d1595");
    assert.equal(detectVersion({ version: "0.7.0-m6.1" }, {}), "0.7.0-m6.1");
  });
});

describe("lockout message", () => {
  it("keeps the server message and only appends retry-after when missing", () => {
    assert.equal(
      formatLockoutMessage({ error: { code: "LOCKED", message: "尝试次数过多，请 15 分钟后再试" } }, {}),
      "尝试次数过多，请 15 分钟后再试",
    );
    assert.equal(
      formatLockoutMessage({ error: { code: "RATE_LIMIT", message: "请求过于频繁，请稍后再试", retryAfter: 12 } }, {}),
      "请求过于频繁，请稍后再试（请 12 秒后再试）",
    );
    assert.equal(readRetryAfter({}, { "retry-after": "90" }), 90);
  });
});

describe("map security events and appeals", () => {
  it("maps event fields and UTC time", () => {
    const ev = mapRemoteSecurityEvent({
      id: "3", kind: "rate_limit", severity: "warn", ip: "127.0.0.1",
      actorId: null, path: "/api/admin/auth/login", at: 1_700_000_000_000,
      detail: { bucket: "login", count: 8 },
    });
    assert.ok(ev);
    assert.equal(ev!.kind, "rate_limit");
    assert.equal(ev!.ip, "127.0.0.1");
    assert.match(ev!.detail, /login/);
    assert.ok(ev!.time);
  });
  it("maps appeal wrapper and decision fields", () => {
    const a = mapRemoteAppeal({
      appeal: {
        id: "ap_1", userId: 9, kind: "ban", body: "请解封", related: null,
        status: "pending", createdAt: 1_700_000_000_000, decidedAt: null, decisionNote: null,
      },
    });
    assert.ok(a);
    assert.equal(a!.id, "ap_1");
    assert.equal(a!.userId, "9");
    assert.equal(a!.status, "pending");
    assert.equal(a!.body, "请解封");
    assert.ok(a!.createdAt);
    assert.equal(a!.decidedAt, "");
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


describe("formatAdminTime", () => {
  it("renders ISO UTC and epoch milliseconds as the same local time", () => {
    const iso = "2026-01-01T12:00:00.000Z";
    const ms = Date.parse(iso);
    assert.equal(formatAdminTime(iso), formatAdminTime(ms));
    assert.equal(formatAdminTime("2026-01-01 12:00:00"), formatAdminTime(iso));
    assert.equal(formatAdminTime(""), "");
    assert.ok(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(formatAdminTime(iso)));
  });
  it("treats second-scale epoch as UTC", () => {
    const sec = 1762944000; // 2025-11-12T10:40:00Z-ish depending
    const a = formatAdminTime(sec);
    const b = formatAdminTime(sec * 1000);
    assert.equal(a, b);
  });
});

describe("m5.1 mappers", () => {
  it("maps nested comment thread fields and createdAtUtc", () => {
    const iso = "2026-11-12T04:00:00.000Z";
    const c = mapRemoteContent({
      id: "c1",
      type: "comment",
      text: "回你一句",
      parentId: "c0",
      rootId: "c0",
      depth: 1,
      replyCount: 2,
      createdAtUtc: iso,
      replyTo: { id: "c0", deleted: false, author: { id: 1, username: "zhou", displayName: "周周" }, text: "原评" },
      author: { id: 2, username: "li", displayName: "李李" },
    }, "comment");
    assert.ok(c);
    assert.equal(c!.parentId, "c0");
    assert.equal(c!.rootId, "c0");
    assert.equal(c!.depth, 1);
    assert.equal(c!.replyCount, 2);
    assert.equal(c!.replyTo!.authorName, "周周");
    assert.equal(c!.replyTo!.text, "原评");
    assert.equal(c!.time, formatAdminTime(iso));
  });
  it("maps withdrawn announcement when published is 0", () => {
    const n = mapRemoteAnnouncement({ id: 3, title: "旧", body: "文", published: 0, withdrawn: true, createdAt: 1700000000000 });
    assert.equal(n!.published, false);
    assert.equal(n!.withdrawn, true);
  });
  it("maps community detail with real member and message counts", () => {
    const c = mapRemoteCommunity({
      community: {
        id: "cm_1",
        name: "清晨",
        description: "散步",
        visibility: "public",
        ownerId: 1,
        memberCount: 3,
        createdAt: 1700000000000,
        members: [{ userId: 1, username: "zhou", role: "owner", status: "active", joinedAt: 1700000000000 }],
        channels: [{ id: "ch_1", name: "大厅", kind: "text", isDefault: true, messageCount: 12 }],
      },
    });
    assert.ok(c);
    assert.equal(c!.memberCount, 3);
    assert.equal(c!.members[0].username, "zhou");
    assert.equal(c!.channels[0].messageCount, 12);
  });
  it("maps channel message createdAtUtc and blockwords", () => {
    const iso = "2026-11-12T04:00:00.000Z";
    const m = mapRemoteChannelMessage({
      id: "m1", channelId: "ch_1", authorId: 1, author: { username: "zhou", displayName: "周周" }, text: "你好", createdAtUtc: iso,
    });
    assert.equal(m!.authorName, "周周");
    assert.equal(m!.time, formatAdminTime(iso));
    const w = mapRemoteBlockword({ id: 9, word: "spam", note: "广告", createdAt: 1700000000000, scope: "platform" });
    assert.equal(w!.word, "spam");
    assert.equal(w!.scope, "platform");
  });
});


describe("m7.r3 post audience and media", () => {
  it("maps audience labels and does not invent one when the field is missing", () => {
    assert.equal(mapAudience({ audience: "friends" }), "friends");
    assert.equal(audienceLabel("friends"), "好友可见");
    assert.equal(audienceLabel("followers"), "粉丝可见");
    assert.equal(audienceLabel("self"), "仅自己");
    assert.equal(audienceLabel("public"), "公开");
    assert.equal(mapAudience({ audience: "everyone" }), "public");
    assert.equal(mapAudience({ text: "no field" }), undefined);
    const c = mapRemoteContent({
      id: "po_fr",
      type: "post",
      text: "只给好友看",
      audience: "friends",
      mood: "开心",
      location: "上海",
      author: { username: "alice", displayName: "Alice" },
      createdAtUtc: "2026-11-12T04:00:00.000Z",
    });
    assert.equal(c!.audience, "friends");
    assert.equal(c!.audienceLabel, "好友可见");
    assert.equal(c!.mood, "开心");
    assert.equal(c!.location, "上海");
    const bare = mapRemoteContent({ id: "po_x", type: "post", text: "普通" });
    assert.equal(bare!.audience, undefined);
    assert.equal(bare!.audienceLabel, undefined);
  });

  it("tolerates empty body when media is present", () => {
    const media = parsePostMedia([{ id: "md_1", url: "/api/media/md_1", kind: "image" }, { id: "md_2", url: "https://cdn.example/a.jpg" }]);
    assert.equal(media.length, 2);
    assert.equal(media[0].url, "/api/media/md_1");
    const c = mapRemoteContent({
      id: "po_media",
      type: "post",
      text: "",
      audience: "self",
      media: [{ id: "md_1", url: "/api/media/md_1", kind: "image" }, { id: "md_2" }],
    });
    assert.equal(c!.text, "");
    assert.equal(c!.title, "媒体 ×2");
    assert.equal(c!.media.length, 2);
    assert.equal(c!.image, "/api/media/md_1");
    assert.equal(c!.audienceLabel, "仅自己");
    const adminShape = mapRemoteContent({
      id: "po_empty",
      type: "post",
      text: "",
      title: "",
      author: { username: "alice" },
    });
    assert.equal(adminShape!.title, "动态");
    assert.equal(adminShape!.text, "");
    assert.equal(adminShape!.media.length, 0);
  });
});

describe("m7.r3 community and group reports", () => {
  it("labels community and whole-group reports and keeps existing types", () => {
    assert.equal(reportKindLabel("community"), "社区举报");
    assert.equal(reportKindLabel("conversation", []), "整群举报");
    assert.equal(reportKindLabel("conversation", ["m1"]), "会话举报");
    assert.equal(reportKindLabel("message", ["m1"]), "私聊消息举报");
    assert.equal(reportKindLabel("post"), "帖子举报");

    const cm = mapRemoteReport({
      id: "rp_cm",
      targetType: "community",
      targetId: "cm_1",
      reason: "违规内容",
      status: "pending",
      queueStatus: "open",
      reporter: { displayName: "周周" },
      context: { communityName: "摄影俱乐部" },
      createdAt: 1700000000000,
    });
    assert.equal(cm!.title, "社区举报");
    assert.equal(cm!.targetName, "摄影俱乐部");
    assert.equal(cm!.target, "社区：摄影俱乐部");
    assert.equal(cm!.targetType, "community");
    assert.equal(cm!.messageIds.length, 0);

    const gp = mapRemoteReport({
      id: "rp_gp",
      targetType: "conversation",
      targetId: "cv_9",
      reason: "骚扰",
      status: "pending",
      reporter: { username: "li" },
      messageIds: [],
      context: { conversationId: "cv_9", groupName: "夜跑小队" },
    });
    assert.equal(gp!.title, "整群举报");
    assert.equal(gp!.target, "群：夜跑小队");
    assert.equal(gp!.targetName, "夜跑小队");

    const post = mapRemoteReport({
      id: "rp_p",
      title: "举报帖子",
      targetType: "post",
      targetId: "po_1",
      reason: "广告",
      status: "pending",
      target: "post:po_1",
      reporter: { username: "a" },
    });
    assert.equal(post!.title, "帖子举报");
    assert.equal(post!.postId, "po_1");
    assert.equal(post!.target, "post:po_1");
  });
});
