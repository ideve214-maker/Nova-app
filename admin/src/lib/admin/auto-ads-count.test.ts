import { test } from "node:test";
import assert from "node:assert/strict";
import { autoAdsChips, checkPerRun, perRunPatch, readPerRun, stoppedText, PER_RUN_FIELD } from "./auto-ads-count.ts";

test("每轮条数：读取 / 提交字段", () => {
  assert.equal(readPerRun({ dailyCap: 15 }), 15);
  assert.equal(readPerRun({}), 0);
  assert.equal(readPerRun(null), 0);
  assert.equal(PER_RUN_FIELD, "perRun");
  assert.deepEqual(perRunPatch(15), { perRun: 15, dailyCap: 15 });
  assert.equal(readPerRun({ perRun: 12, dailyCap: 3 }), 12);
});

test("校验：1–runMax（缺省 100）的整数", () => {
  assert.equal(checkPerRun("").ok, false);
  assert.equal(checkPerRun("0").ok, false);
  assert.equal(checkPerRun("1.5").ok, false);
  assert.equal(checkPerRun("-3").ok, false);
  assert.deepEqual(checkPerRun("15"), { ok: true, value: 15 });
  assert.deepEqual(checkPerRun("100"), { ok: true, value: 100 });
  const r = checkPerRun("101");
  assert.equal(r.ok, false); assert.match((!r.ok && r.error) || "", /100/);
  const r2 = checkPerRun("80", 50);
  assert.equal(r2.ok, false); assert.match((!r2.ok && r2.error) || "", /50/);
  assert.deepEqual(checkPerRun("50", 50), { ok: true, value: 50 });
});

test("没发满的原因", () => {
  assert.equal(stoppedText("search_budget"), "今天的搜索次数用完了");
  assert.equal(stoppedText("no_more_results"), "没有搜到更多结果");
  assert.equal(stoppedText("weird_code"), "weird_code");
  assert.equal(stoppedText(null), "");
});

test("状态标签：定时 x/N + 手动加发 y；旧服务端只显示定时", () => {
  assert.deepEqual(autoAdsChips({ scheduledToday: 15, manualToday: 30, todayPublished: 45 }, 15), ["定时 15/15", "手动加发 30"]);
  assert.deepEqual(autoAdsChips({ todayPublished: 12 }, 15), ["定时 12/15"]);
  assert.deepEqual(autoAdsChips({ todayPublished: 3 }, 0), ["定时 3 条"]);
  assert.deepEqual(autoAdsChips({ scheduledToday: 0, manualToday: 0 }, 10), ["定时 0/10", "手动加发 0"]);
});
