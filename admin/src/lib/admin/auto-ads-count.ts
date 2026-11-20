// 2.0.8：AI 自动发营销帖的「每轮发布条数」。
// 语义（ideve 定）：每天 10:00 定时跑一轮发 N 条；每点一次「立即运行一轮」再发 N 条，跟今天已发多少无关。
// 服务端暂时沿用 dailyCap 字段存 N（Dift 会兼容）；新字段名定下来后只改 PER_RUN_FIELD 这一处。

export const PER_RUN_FIELD = "dailyCap" as const;

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
  return { [PER_RUN_FIELD]: n };
}

/** 校验输入：必须是正整数，管理端不设上限；runMax 只做软提示。 */
export function checkPerRun(input: string, runMax?: number): { ok: true; value: number; warn?: string } | { ok: false; error: string } {
  const s = String(input ?? "").trim();
  if (!/^\d+$/.test(s)) return { ok: false, error: "请填写每轮发布条数（正整数）" };
  const value = Number(s);
  if (!Number.isSafeInteger(value) || value < 1) return { ok: false, error: "每轮发布条数至少 1 条" };
  const max = num(runMax);
  if (max && value > max) return { ok: true, value, warn: `超过服务器单轮安全上限 ${max} 条，服务器每轮可能只发 ${max} 条` };
  return { ok: true, value };
}

/** 状态标签：定时 x/N，以及（服务端返回时）手动加发 y。 */
export function autoAdsChips(st: Status, perRun: number): string[] {
  const scheduled = num(st.scheduledToday) ?? num(st.todayPublished) ?? 0;
  const chips = [perRun > 0 ? `定时 ${scheduled}/${perRun}` : `定时 ${scheduled} 条`];
  const manual = num(st.manualToday);
  if (manual !== undefined) chips.push(`手动加发 ${manual}`);
  return chips;
}
