import { test } from "node:test";
import assert from "node:assert/strict";
import { categoryFailure, matchMeta, metaQuery, normalizeCategory, readPostMeta, sourceOptions } from "./post-category.ts";
import { mapRemoteContent } from "./backend.ts";

test("readPostMeta: 2.1.2 外部帖 / 无字段降级", () => {
  assert.deepEqual(readPostMeta({ category: "game", source: "gcores", external: true, sourceLabel: "来自 机核" }), { category: "game", source: "gcores", sourceLabel: "机核" });
  assert.deepEqual(readPostMeta({ text: "x" }), { category: null, source: "", sourceLabel: "" });
  assert.equal(readPostMeta({ source: "ign" }).sourceLabel, "IGN");
  assert.equal(normalizeCategory("BAD"), null);
  assert.equal(normalizeCategory(" Tech "), "tech");
});
test("matchMeta / metaQuery / sourceOptions", () => {
  const ext = { category: "crypto" as const, source: "panews" }, user = { category: null, source: "" };
  assert.ok(matchMeta(ext, { category: "crypto", source: "" }));
  assert.ok(!matchMeta(ext, { category: "tech", source: "" }));
  assert.ok(matchMeta(user, { category: "none", source: "user" }));
  assert.ok(!matchMeta(ext, { category: "", source: "user" }));
  assert.ok(matchMeta(ext, { category: "", source: "external" }));
  assert.ok(!matchMeta(ext, { category: "", source: "ign" }));
  assert.deepEqual(metaQuery({ category: "", source: "hn" }), { source: "hn" });
  assert.deepEqual(metaQuery({ category: "none", source: "user" }), { source: "user" });
  assert.deepEqual(readPostMeta({ category: "tech", source: "user", sourceLabel: "用户" }), { category: "tech", source: "", sourceLabel: "" });
  assert.ok(sourceOptions([{ source: "weird" }]).some((s) => s.id === "weird"));
});
test("mapRemoteContent 带上分类和来源", () => {
  const m = mapRemoteContent({ id: 1, text: "a", category: "finance", source: "wallstcn" }, "post");
  assert.equal(m!.category, "finance");
  assert.equal(m!.sourceLabel, "华尔街见闻");
});
test("categoryFailure: 404 → 需服务端更新；BAD_CATEGORY → 分类不对", () => {
  assert.equal(categoryFailure(404, { error: { code: "NOT_FOUND" } }), "需服务端更新");
  assert.equal(categoryFailure(404, null), "需服务端更新");
  assert.equal(categoryFailure(400, { error: { code: "BAD_CATEGORY", message: "x" } }), "分类不对");
  assert.equal(categoryFailure(404, { error: { code: "POST_NOT_FOUND", message: "帖子不存在" } }), "帖子不存在");
});
