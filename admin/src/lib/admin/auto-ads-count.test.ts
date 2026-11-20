import { test } from "node:test";
import assert from "node:assert/strict";
import { autoAdsChips, checkPerRun, perRunPatch, readPerRun, PER_RUN_FIELD } from "./auto-ads-count.ts";

test("每轮条数：读取 / 提交字段", () => {
  assert.equal(readPerRun({ dailyCap: 15 }), 15);
  assert.equal(readPerRun({}), 0);
  assert.equal(readPerRun(null), 0);
  assert.deepEqual(perRunPatch(15), { [PER_RUN_FIELD]: 15 });
});

test("校验：正整数、不设上限、runMax 只软提示", () => {
  assert.equal(checkPerRun("").ok, false);
  assert.equal(checkPerRun("0").ok, false);
  assert.equal(checkPerRun("1.5").ok, false);
  assert.equal(checkPerRun("-3").ok, false);
  assert.deepEqual(checkPerRun("15"), { ok: true, value: 15 });
  assert.deepEqual(checkPerRun("500"), { ok: true, value: 500 }); // 没有 runMax 时不设上限
  const r = checkPerRun("80", 50);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.value, 80);
  assert.match((r.ok && r.warn) || "", /50/);
  assert.deepEqual(checkPerRun("50", 50), { ok: true, value: 50 });
});

test("状态标签：定时 x/N + 手动加发 y；旧服务端只显示定时", () => {
  assert.deepEqual(autoAdsChips({ scheduledToday: 15, manualToday: 30, todayPublished: 45 }, 15), ["定时 15/15", "手动加发 30"]);
  assert.deepEqual(autoAdsChips({ todayPublished: 12 }, 15), ["定时 12/15"]);
  assert.deepEqual(autoAdsChips({ todayPublished: 3 }, 0), ["定时 3 条"]);
  assert.deepEqual(autoAdsChips({ scheduledToday: 0, manualToday: 0 }, 10), ["定时 0/10", "手动加发 0"]);
});
