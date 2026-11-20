import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  adjBody, cleanOverrides, creatingText, diffSettings, makePersonasApi, normalizeStatPost, parseAdj, parseCount, parseTags,
  pctToRate, previewShown, rateToPct, sourceErrorText, type CallFn, type PersonaSettings,
} from "./personas.ts";

const base: PersonaSettings = {
  enabled: false, targetCount: 120, model: "",
  activeHours: { quietStart: 1, quietEnd: 7, quietFactor: 0.1 },
  defaults: { postIntervalMinutes: 480, actionIntervalMinutes: 15, likeRate: 0.35, favoriteRate: 0.08, repostRate: 0.03, commentRate: 0.06, replyToUsersRate: 0.7, groupJoinPerDay: 1, groupPostPerDay: 2 },
  categories: ["news", "politics", "sports", "economy"],
  limits: { maxActionsPerTick: 60, aiConcurrency: 2, maxAiCommentsPerPost: 3 },
  avatarStyles: ["notionists", "lorelei"], notifyOnLike: true,
};

/** 假后端：记录每次调用，按接口名返回预设结果；没登记的接口模拟旧服务器 404。 */
function mockBackend(routes: Record<string, (opts: Record<string, unknown>) => unknown>) {
  const calls: { name: string; opts: Record<string, unknown> }[] = [];
  const call: CallFn = async <T,>(name: string, opts: Record<string, unknown> = {}) => {
    calls.push({ name, opts });
    const h = routes[name];
    if (!h) return { ok: false as const, status: 404, error: "需服务端更新" };
    const out = h(opts) as { __err?: { status: number; code: string; error: string } };
    if (out && out.__err) return { ok: false as const, ...out.__err };
    return { ok: true as const, data: out as T };
  };
  return { call, calls };
}

describe("AI 内部账号：设置只传改过的字段", () => {
  it("没改动时为空", () => assert.deepEqual(diffSettings(base, structuredClone(base)), {}));
  it("顶层和嵌套字段只带改过的子项", () => {
    const n = structuredClone(base);
    n.targetCount = 5000; n.model = "glm-4.7-flash"; n.defaults.likeRate = 0.5; n.activeHours.quietEnd = 8; n.categories = ["sports"];
    assert.deepEqual(diffSettings(base, n), {
      targetCount: 5000, model: "glm-4.7-flash", defaults: { likeRate: 0.5 }, activeHours: { quietEnd: 8 }, categories: ["sports"],
    });
  });
  it("账号数量不设上限", () => {
    assert.equal(parseCount("100000"), 100000);
    assert.equal(parseCount("-1"), null);
    assert.equal(parseCount("1.5"), null);
  });
});

describe("概率 / 标签 / 单独频率", () => {
  it("百分比和 0–1 互转", () => {
    assert.equal(rateToPct(0.35), "35");
    assert.equal(rateToPct(0.085), "8.5");
    assert.equal(pctToRate("35"), 0.35);
    assert.equal(pctToRate("8.5"), 0.085);
    assert.equal(pctToRate("101"), null);
    assert.equal(pctToRate("abc"), null);
  });
  it("兴趣用顿号空格逗号分隔并去重", () => assert.deepEqual(parseTags("sports、economy, sports  news"), ["sports", "economy", "news"]));
  it("单独频率全空 = null（用默认）", () => {
    assert.equal(cleanOverrides({ likeRate: null }), null);
    assert.deepEqual(cleanOverrides({ likeRate: 0.1, commentRate: undefined }), { likeRate: 0.1 });
  });
  it("创建进度", () => {
    const st = { envEnabled: true, running: true, lastTickAt: null, model: "", modelSource: "default", aiReady: true, lastError: null };
    assert.equal(creatingText({ ...st, accounts: { active: 40, paused: 0, retired: 0, creating: 20 } }, 120), "正在创建 20 个（已有 40 / 目标 120）");
    assert.equal(creatingText({ ...st, accounts: { active: 120, paused: 0, retired: 3, creating: 0 } }, 120), "已就绪 120 / 120");
  });
  it("BAD_FEED 显示原因", () => {
    assert.equal(sourceErrorText("BAD_FEED", "HTTP 404"), "抓不到这个来源：HTTP 404");
    assert.equal(sourceErrorText(undefined, "网络错误"), "网络错误");
  });
});

describe("接口封装（假后端）", () => {
  it("路径参数、查询和请求体按 §8.1", async () => {
    const { call, calls } = mockBackend({
      adminAiPersonasSettings: (o) => ({ settings: { ...base, ...(o.body as object) } }),
      adminAiPersonasAccounts: () => ({ accounts: [], nextCursor: "c2" }),
      adminAiPersonasAccount: (o) => ({ account: { userId: Number((o.params as Record<string, string>).userId) } }),
      adminAiPersonasAccountRetire: () => ({ account: {}, hiddenPosts: 2 }),
      adminAiPersonasStopAll: () => ({ paused: 120, hiddenPosts: 0, removedInteractions: 0 }),
      adminAiPersonasRun: () => ({ result: { actions: [{ userId: 1, kind: "post", ok: true }] } }),
      adminAiPersonasSources: (o) => (o.body ? { __err: { status: 400, code: "BAD_FEED", error: "HTTP 404" } } : { sources: [] }),
      adminAiPersonasSourceTest: () => ({ ok: true, items: [{ title: "a", url: "u", publishedAt: 1 }], ms: 820 }),
      adminAiPersonasLog: () => ({ log: [] }),
    });
    const api = makePersonasApi(call);
    const s = await api.saveSettings({ targetCount: 300 });
    assert.ok(s.ok);
    assert.deepEqual(calls[0], { name: "adminAiPersonasSettings", opts: { body: { targetCount: 300 } } });

    const a = await api.accounts({ status: "active", q: "", cursor: "c1" });
    assert.ok(a.ok && a.data.nextCursor === "c2");
    assert.deepEqual(calls[1].opts.query, { status: "active", q: undefined, cursor: "c1", limit: 50 });

    await api.updateAccount(1203, { status: "paused" });
    assert.deepEqual(calls[2].opts, { params: { userId: "1203" }, body: { status: "paused" } });
    await api.retireAccount(1203, true);
    assert.deepEqual(calls[3].opts.body, { hideContent: true });
    await api.stopAll({ hideContent: false, undoInteractions: true });
    assert.deepEqual(calls[4].opts.body, { hideContent: false, undoInteractions: true });
    await api.run("post");
    assert.deepEqual(calls[5].opts.body, { kind: "post", userId: null });

    const add = await api.addSource({ name: "x", url: "https://x/rss", category: "news", lang: "zh" });
    assert.ok(!add.ok && add.code === "BAD_FEED");
    const t = await api.testSource(3);
    assert.ok(t.ok && t.data.ms === 820 && t.data.items.length === 1);
    assert.deepEqual(calls.at(-1)!.opts.params, { id: "3" });

    await api.log({ kind: "post", userId: "12", before: 900 });
    assert.deepEqual(calls.at(-1)!.opts.query, { kind: "post", userId: "12", before: 900, limit: 100 });
  });
  it("服务器没有这个接口时返回「需服务端更新」", async () => {
    const api = makePersonasApi(mockBackend({}).call);
    const r = await api.overview();
    assert.ok(!r.ok && r.status === 404 && r.error === "需服务端更新");
  });
  it("接口登记在 /api/admin/ai/personas 下", async () => {
    const { DEFAULT_ENDPOINT_MAP } = await import("./backend.ts");
    assert.equal(DEFAULT_ENDPOINT_MAP.adminAiPersonas, "/api/admin/ai/personas");
    assert.equal(DEFAULT_ENDPOINT_MAP.adminAiPersonasAccountRetire, "/api/admin/ai/personas/accounts/:userId/retire");
    assert.equal(DEFAULT_ENDPOINT_MAP.adminAiPersonasSourceTest, "/api/admin/ai/personas/sources/:id/test");
    assert.equal(DEFAULT_ENDPOINT_MAP.adminAiPersonasAvatarStyles, "/api/admin/ai/personas/avatar-styles");
    for (const [k, v] of Object.entries(DEFAULT_ENDPOINT_MAP)) if (k.startsWith("adminAiPersonas")) assert.ok(v.startsWith("/api/admin/ai/personas"));
  });
});

describe("数据调整：新旧返回体", () => {
  const v2 = normalizeStatPost({
    id: "po_x", text: "t", author: null,
    real: { views: 10, likes: 3, saves: 1, reposts: 0 }, ai: { views: 25, likes: 9, saves: 2, reposts: 1 },
    adj: { views: 100, likes: 0, saves: 0, reposts: 0 }, shown: { views: 135, likes: 12, saves: 3, reposts: 1 },
  });
  it("新结构带 AI 和转帖", () => {
    assert.equal(v2.v2, true);
    assert.equal(v2.ai.views, 25);
    assert.equal(v2.shown.reposts, 1);
  });
  it("旧结构（没有 ai / shown）回退", () => {
    const old = normalizeStatPost({ id: "po_y", text: "", real: { views: 5, likes: 1, saves: 0 }, adj: { views: 10, likes: 0, saves: 0 } });
    assert.equal(old.v2, false);
    assert.deepEqual(old.ai, { views: 0, likes: 0, saves: 0, reposts: 0 });
    assert.equal(old.shown.views, 15);
  });
  it("保存只传改过的调整量，允许负数", () => {
    assert.deepEqual(adjBody(v2, { views: "100", likes: "5", saves: "0", reposts: "-1" }), { adj: { likes: 5, reposts: -1 } });
    assert.equal(adjBody(v2, { views: "1.5", likes: "0", saves: "0", reposts: "0" }), null);
    assert.equal(parseAdj(""), 0);
    assert.equal(parseAdj("－3"), -3);
  });
  it("预览显示值 = 真人 + AI + 调整，最小 0", () => {
    assert.equal(previewShown(v2, "views", "50"), 85);
    assert.equal(previewShown(v2, "likes", "-100"), 0);
  });
});
