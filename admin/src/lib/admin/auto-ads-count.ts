// 2.0.8：AI 自动发营销帖的「每轮发布条数」。
// 语义（ideve 定）：每天 10:00 定时跑一轮发 N 条；每点一次「立即运行一轮」再发 N 条，跟今天已发多少无关。
// 服务端 2.1.1（e09e826）：字段 perRun（1–100，默认 10）；dailyCap 是别名，旧服务端只认 dailyCap，所以两个都发。

export const PER_RUN_FIELD = "perRun" as const;
export const PER_RUN_DEFAULT_MAX = 100;

type Settings = Record<string, unknown>;
type Status = { todayPublished?: number; scheduledToday?: number; manualToday?: number; dailyCap?: number; runMax?: number };

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** 从设置里读每轮条数（新字段优先，旧 dailyCap 兜底）。0 / 缺省返回 0。 */
export function readPerRun(settings: Settings | null | undefined): number {
  if (!settings) return 0;
  return Math.max(0, Math.floor(num(settings[PER_RUN_FIELD]) ?? num(settings.dailyCap) ?? 0));
}

/** 保存时提交的字段。 */
export function perRunPatch(n: number): Record<string, number> {
  return { [PER_RUN_FIELD]: n, dailyCap: n };
}

/** 校验输入：1–上限的整数；上限取服务端 runMax，没有时按 100。 */
export function checkPerRun(input: string, runMax?: number): { ok: true; value: number } | { ok: false; error: string } {
  const s = String(input ?? "").trim();
  const max = num(runMax) && (runMax as number) > 0 ? Math.floor(runMax as number) : PER_RUN_DEFAULT_MAX;
  if (!/^\d+$/.test(s)) return { ok: false, error: `请填写每轮发布条数（1–${max} 的整数）` };
  const value = Number(s);
  if (!Number.isSafeInteger(value) || value < 1) return { ok: false, error: "每轮发布条数至少 1 条" };
  if (value > max) return { ok: false, error: `每轮最多 ${max} 条` };
  return { ok: true, value };
}

/** 一轮没发满时的原因（result.stopped）。 */
const STOPPED: Record<string, string> = {
  search_budget: "今天的搜索次数用完了",
  no_more_results: "没有搜到更多结果",
  quota_exhausted: "AI 额度都用完了",
  switch_off: "开关已关闭",
  try_limit: "尝试次数到上限了",
};
export function stoppedText(code: string | null | undefined): string {
  if (!code) return "";
  return STOPPED[code] || code;
}

/** 状态标签：定时 x/N，以及（服务端返回时）手动加发 y。 */
export function autoAdsChips(st: Status, perRun: number): string[] {
  const scheduled = num(st.scheduledToday) ?? num(st.todayPublished) ?? 0;
  const chips = [perRun > 0 ? `定时 ${scheduled}/${perRun}` : `定时 ${scheduled} 条`];
  const manual = num(st.manualToday);
  if (manual !== undefined) chips.push(`手动加发 ${manual}`);
  return chips;
}
