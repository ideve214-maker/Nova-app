import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronRight, ChevronUp, Gauge, PlugZap, Plus, RefreshCw, Shuffle, Trash2 } from "lucide-react";
import { useAdmin } from "@/lib/admin/store";
import { sanitizeText } from "@/lib/admin/sanitize";
import {
  aiFailoverSet, aiProviderActivate, aiProviderDelete, aiProviderOrder, aiProviderRecheck, aiProviderSave, aiProviders, aiProviderTest, aiQuota, aiQuotaSave,
  failoverReason, type AiProvider, type AiProvidersOverview, type AiQuotaItem, type AiQuotaOverview,
} from "@/lib/admin/ai-api";
import { cn, EmptyState, Field, inputClass, Pill, PrimaryButton, Screen, Sheet } from "./ui";
import { Card, Toggle } from "./marketing";

/* 管理端 2.0.6 热更新：AI 额度（每家 AI 服务商还剩多少）+ AI 服务商管理（添加 / 测试 / 切换当前使用）。
   余额来自服务器：有官方余额接口的显示「实时」，没有的按“资源包总量 − 本地记录的已用 token”显示「估算」。密钥只显示打码。 */

const AUTO_REFRESH_MS = 60_000;
const hm = (t: number | null | undefined) => {
  if (!t) return "—";
  const d = new Date(t + 8 * 3600e3);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};
export const fmtTokens = (n: number | null | undefined) => {
  if (n == null) return "—";
  const trim = (x: string) => x.replace(/\.0$/, "");
  if (n >= 1e8) return trim((n / 1e8).toFixed(n >= 1e9 ? 0 : 1)) + " 亿";
  if (n >= 1e4) return trim((n / 1e4).toFixed(n >= 1e6 ? 0 : 1)) + " 万";
  return String(n);
};
const money = (v: number | null | undefined, currency: string) => (v == null ? "—" : (v < 0 ? "-" : "") + (currency === "USD" ? "$" : "¥") + Math.abs(v).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/** 主数字：实时余额（元 / 美元），否则估算剩余 token，否则“查不到”。 */
const CASH_NOTE: Record<string, string> = { free_model: "免费模型，不扣现金", resource_package: "先用资源包", no_cash_history: "没充过现金，先用免费额度", exempt: "不按现金判断" };
/** 现金那一行（资源包 / 免费额度是主数字时显示在下面）。 */
export function cashLine(q: AiQuotaItem): string | null {
  if (q.source !== "provider" || q.balance == null) return null;
  const note = q.cashApplies === false && q.cashNote ? `（${CASH_NOTE[q.cashNote] || "先用资源包/免费额度"}）` : "";
  return `现金 ${money(q.balance, q.currency)}${note}`;
}
function headline(q: AiQuotaItem): { value: string; note: string } {
  // 智谱先扣资源包 / 免费额度，用完才扣现金：资源包剩余是主数字，现金放在下面
  if (q.packageTokens != null) {
    const total = q.packageSource === "estimated" && q.budgetTokens != null ? `，共 ${fmtTokens(q.budgetTokens)}` : "";
    return { value: fmtTokens(q.packageTokens) + " token", note: `资源包 / 免费额度剩余（${q.packageSource === "provider" ? "实时" : "估算"}${total}）` };
  }
  if (q.freeModel) return { value: "免费", note: `${q.model} 是免费模型，调用不扣现金` };
  if (q.source === "provider") return { value: money(q.balance, q.currency), note: "可用余额" };
  if (q.source === "estimated") return { value: fmtTokens(q.estimatedRemainingTokens), note: `估算剩余 token（共 ${fmtTokens(q.budgetTokens)}）` };
  return { value: "—", note: q.balanceApi ? "暂时查不到余额" : "这家查不到余额，填资源包总量后可估算" };
}
function SourcePill({ q }: { q: AiQuotaItem }) {
  if (q.packageTokens != null) return q.packageSource === "provider" ? <Pill tone="ok">实时</Pill> : <Pill tone="vip">估算</Pill>;
  if (q.source === "provider") return q.stale ? <Pill tone="warn">实时（上次）</Pill> : <Pill tone="ok">实时</Pill>;
  if (q.source === "estimated") return <Pill tone="vip">估算</Pill>;
  return <Pill tone="muted">未知</Pill>;
}

/** 拉额度：可见时每 60 秒自动刷新；refresh(true) 让服务器重新去查（服务器 10 秒内同一家只查一次）。 */
export function useAiQuota(enabled = true) {
  const [data, setData] = useState<AiQuotaOverview | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const alive = useRef(true);
  const refresh = useCallback(async (force = false) => {
    setLoading(true);
    const r = await aiQuota(force);
    if (!alive.current) return;
    setLoading(false);
    if (r.ok) { setData(r.data); setErr(""); } else setErr(r.error);
  }, []);
  useEffect(() => {
    alive.current = true;
    if (!enabled) return () => { alive.current = false; };
    void refresh();
    const tick = () => { if (typeof document === "undefined" || document.visibilityState === "visible") void refresh(); };
    const id = window.setInterval(tick, AUTO_REFRESH_MS);
    const onVis = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { alive.current = false; window.clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [enabled, refresh]);
  return { data, err, loading, refresh, setData };
}

/** 额度用完的标记：自动切换打开时显示「已用完 · 已跳过」。 */
function ExhaustedPill({ q, auto }: { q: AiQuotaItem; auto: boolean }) {
  if (!q.exhausted) return null;
  return <span className="shrink-0 whitespace-nowrap"><Pill tone="danger">{auto ? "已用完·跳过" : "已用完"}</Pill></span>;
}

/** 最近一次自动切换（24 小时内）：首页卡片和「AI 接口与额度」顶部都显示。 */
const standInId = (data: AiQuotaOverview | null) => {
  if (!data?.failover?.enabled) return null;
  const first = data.providers.find((p) => p.configured);
  if (!first?.exhausted) return null;
  return data.providers.find((p) => p.configured && !p.exhausted)?.id ?? null;
};

export function FailoverBanner({ data }: { data: AiQuotaOverview | null }) {
  const ev = data?.failover?.lastEvent;
  if (!data || !ev || !ev.at || data.at - ev.at > 24 * 3600e3) return null;
  const usable = data.providers.filter((p) => p.configured);
  const allNow = usable.length > 0 && usable.every((p) => p.exhausted);
  let text: string;
  let danger = false;
  if (ev.reason === "all_exhausted" || !ev.to) {
    if (ev.kind === "web_search" && ev.reason !== "all_exhausted") text = `${hm(ev.at)} ${sanitizeText(ev.fromName || "智谱")}额度用完，联网搜索（AI 自动发帖）暂停`;
    else if (allNow) { text = `${hm(ev.at)} 所有 AI 接口的额度都用完了，已停止调用（防止欠费）。请充值或添加新的接口`; danger = true; }
    else text = `${hm(ev.at)} 曾经所有接口额度都用完，现在已有可用的接口`;
  } else {
    text = `${hm(ev.at)} ${sanitizeText(ev.fromName || "上一家")}${failoverReason(ev.reason)}，已自动切换到「${sanitizeText(ev.toName || "下一家")}」`;
  }
  return (
    <div role="status" data-testid="ai-failover-banner" className={cn("my-2 flex items-start gap-2 rounded-xl px-3 py-2 text-[12px] leading-4", danger ? "nova-danger-soft" : "nova-warn-soft")}>
      {danger ? <AlertTriangle className="mt-px size-3.5 shrink-0" /> : <Shuffle className="mt-px size-3.5 shrink-0" />}
      <span>{text}</span>
    </div>
  );
}

/** 排在前面的用完后，实际在用的那一家。 */
function StandInPill({ show }: { show: boolean }) {
  return show ? <span className="shrink-0 whitespace-nowrap"><Pill tone="vip">临时使用</Pill></span> : null;
}

function QuotaRow({ q, detailed, onSettings, auto = true, standIn = false }: { q: AiQuotaItem; detailed?: boolean; onSettings?: () => void; auto?: boolean; standIn?: boolean }) {
  const h = headline(q);
  const tone = q.empty || q.exhausted ? "text-danger" : q.low ? "text-warn" : "";
  return (
    <div className="py-2.5" data-testid="ai-quota-row">
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 truncate text-[14px] font-semibold">{sanitizeText(q.name)}</span>
        {q.active && <span className="shrink-0 whitespace-nowrap"><Pill tone="ok">当前使用</Pill></span>}
        {q.search && !q.active && <span className="shrink-0 whitespace-nowrap"><Pill tone="muted">联网搜索</Pill></span>}
        <ExhaustedPill q={q} auto={auto} />
        <StandInPill show={standIn && !q.exhausted} />
        <span className="ml-auto shrink-0"><SourcePill q={q} /></span>
      </div>
      <div className="mt-1 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className={cn("text-[22px] font-semibold leading-7 tabular-nums", tone)}>{h.value}</div>
          <p className="text-[12px] leading-4 text-muted">
            {h.note}
            {q.empty ? " · 已用完" : q.low ? (q.source === "provider" && q.cashApplies !== false ? ` · 低于提醒线 ${money(q.lowBalance, q.currency)}` : " · 剩余不到 10%") : ""}
          </p>
          {(q.packageTokens != null || q.freeModel) && cashLine(q) && <p className="text-[12px] leading-4 text-muted" data-testid="ai-quota-cash">{cashLine(q)}</p>}
        </div>
        <div className="shrink-0 text-right text-[12px] leading-4 text-muted">
          <div>今天 {q.usage.today.calls} 次 · {fmtTokens(q.usage.today.tokens)} token</div>
          <div>7 天 {q.usage.week.calls} 次 · {fmtTokens(q.usage.week.tokens)} token</div>
        </div>
      </div>
      {q.exhausted && <p className="mt-1 text-[12px] leading-4 text-danger">{failoverReason(q.exhaustedReason)}{q.exhaustedAt ? `（${hm(q.exhaustedAt)}）` : ""}{auto ? "，AI 调用会自动跳过它；充值后自动恢复" : "，已停止调用"}</p>}
      {q.error && <p className="mt-1 text-[12px] leading-4 text-warn">{q.source === "provider" ? "刷新失败，显示上次结果：" : "余额查询失败："}{sanitizeText(q.error)}</p>}
      {!q.configured && <p className="mt-1 text-[12px] leading-4 text-warn">{q.builtin ? "服务器上还没有配置智谱密钥" : "密钥不可用或已停用"}</p>}
      {detailed && (
        <div className="mt-1.5 space-y-0.5 text-[12px] leading-4 text-muted">
          {q.source === "provider" && (q.used != null || q.totalGranted != null) && (
            <div>累计已花 {money(q.used, q.currency)}{q.totalGranted != null ? ` · 充值+赠送 ${money(q.totalGranted, q.currency)}` : ""}</div>
          )}
          {q.source === "provider" && q.budgetTokens != null && q.packageSource !== "estimated" && <div>资源包估算剩余 {fmtTokens(q.estimatedRemainingTokens)} / {fmtTokens(q.budgetTokens)} token</div>}
          {q.resourcePackages.map((p, i) => <div key={i}>{sanitizeText(p.name)}：剩 {fmtTokens(p.remaining)} {p.unit}{p.expiresAt ? ` · ${new Date(p.expiresAt + 8 * 3600e3).toISOString().slice(0, 10)} 到期` : ""}</div>)}
          {q.packagesError && <div>资源包实时余量查不到（{sanitizeText(q.packagesError)}），{q.budgetTokens != null ? "按填的总量估算" : "可在「额度设置」里填总量来估算"}</div>}
          {(q.stopBalance || q.stopTokens) ? <div>停用线：{q.stopBalance ? money(q.stopBalance, q.currency) : ""}{q.stopBalance && q.stopTokens ? " / " : ""}{q.stopTokens ? fmtTokens(q.stopTokens) + " token" : ""}（到了就切下一家）</div> : null}
          <div>今天联网搜索 {q.usage.today.searches} 次{q.usage.week.errors ? ` · 7 天失败 ${q.usage.week.errors} 次` : ""} · 模型 {sanitizeText(q.model)}</div>
          <div className="flex items-center gap-2">
            <span>更新于 {hm(q.fetchedAt)}{q.keyMasked ? ` · 密钥 ${q.keyMasked}` : ""}</span>
            {onSettings && <button type="button" className="ml-auto h-8 rounded-full bg-subtle px-3 text-[12px] font-semibold" onClick={onSettings}>额度设置</button>}
          </div>
        </div>
      )}
    </div>
  );
}

/** 首页 / AI 发帖里的小卡片：每家一行，点开进「AI 接口与额度」。 */
export function AiQuotaCard({ className, onOpen }: { className?: string; onOpen?: () => void }) {
  const { data, err, loading, refresh } = useAiQuota(true);
  const shown = (data?.providers || []).filter((p) => p.configured || p.active);
  return (
    <section className={cn("rounded-card bg-surface px-4 pb-1 pt-3 shadow-card", className)} data-testid="ai-quota-card">
      <div className="flex items-center gap-2">
        <Gauge className="size-4 text-primary" />
        <h2 className="text-[15px] font-semibold">AI 额度</h2>
        <span className="text-[11px] text-muted">{data ? `更新于 ${hm(data.at)} · 每分钟自动刷新` : ""}</span>
        <button type="button" aria-label="刷新 AI 额度" className="ml-auto grid size-9 place-items-center text-muted" onClick={() => void refresh(true)}>
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />
        </button>
      </div>
      {err && <p className="py-2 text-[13px] text-muted">{err}</p>}
      {!err && !data && <p className="py-2 text-[13px] text-muted">加载中…</p>}
      {data && shown.length === 0 && <p className="py-2 text-[13px] text-muted">还没有可用的 AI 服务商</p>}
      <FailoverBanner data={data} />
      <div className="divide-y divide-line">{shown.map((q) => <QuotaRow key={q.id} q={q} auto={data?.failover?.enabled !== false} standIn={standInId(data) === q.id} />)}</div>
      {onOpen && (
        <button type="button" onClick={onOpen} className="-mx-4 flex h-11 w-[calc(100%+2rem)] items-center border-t border-line px-4 text-[13px] text-primary">
          管理 AI 接口、设置资源包额度<ChevronRight className="ml-auto size-4" />
        </button>
      )}
    </section>
  );
}

type Draft = { id?: string; type: string; name: string; baseUrl: string; apiKey: string; model: string; search: boolean; enabled: boolean; keyMasked?: string };

export function AiProvidersScreen() {
  const back = useAdmin((s) => s.back);
  const flash = useAdmin((s) => s.flash);
  const quota = useAiQuota(true);
  const [prov, setProv] = useState<AiProvidersOverview | null>(null);
  const [err, setErr] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formErr, setFormErr] = useState("");
  const [busy, setBusy] = useState("");
  const [qs, setQs] = useState<{ q: AiQuotaItem; budget: string; low: string; stop: string; stopTokens: string; exempt: boolean } | null>(null);

  const load = useCallback(async () => { const r = await aiProviders(); if (r.ok) { setProv(r.data); setErr(""); } else setErr(r.error); }, []);
  useEffect(() => { void load(); }, [load]);
  const after = (r: { ok: true; data: AiProvidersOverview } | { ok: false; error: string }, msg: string) => {
    if (!r.ok) { flash(r.error); return false; }
    setProv(r.data); flash(msg); void quota.refresh(); return true;
  };
  const typeOf = (t: string) => prov?.types.find((x) => x.type === t);

  const openNew = () => {
    const t = prov?.types.find((x) => !x.blocked && x.type !== "zhipu") || prov?.types[0];
    if (!t) return;
    setFormErr("");
    setDraft({ type: t.type, name: t.name, baseUrl: t.baseUrl, apiKey: "", model: t.model, search: t.searchCapable, enabled: true });
  };
  const openEdit = (p: AiProvider) => { setFormErr(""); setDraft({ id: p.id, type: p.type, name: p.name, baseUrl: p.baseUrl, apiKey: "", model: p.model, search: p.search, enabled: p.enabled, keyMasked: p.keyMasked }); };
  const save = async () => {
    if (!draft) return;
    setBusy("save");
    const body = { type: draft.type, name: draft.name, baseUrl: draft.baseUrl, model: draft.model, search: draft.search, enabled: draft.enabled, ...(draft.apiKey ? { apiKey: draft.apiKey } : {}) };
    const r = await aiProviderSave(body, draft.id);
    setBusy("");
    if (!r.ok) { setFormErr(r.error); return; }
    setDraft(null); after(r, draft.id ? "已保存" : "已添加，可以点“测试”试一下");
  };
  const test = async (p: AiProvider) => {
    setBusy("test:" + p.id);
    const r = await aiProviderTest(p.id);
    setBusy("");
    if (!r.ok) { flash(r.error); return; }
    const t = r.data.test;
    flash(t.ok ? `连接正常（${t.latencyMs ?? "—"} 毫秒）` : "连接失败：" + (t.error || "未知原因"));
  };
  const activate = async (p: AiProvider) => {
    if (typeof window !== "undefined" && !window.confirm(`切换到「${p.name}」？AI 助手、广告文案、AI 自动发帖都会改用它${p.searchCapable && p.search ? "" : "（联网搜索仍用智谱）"}。`)) return;
    after(await aiProviderActivate(p.id), "已切换到「" + p.name + "」");
  };
  const remove = async (p: AiProvider) => {
    if (typeof window !== "undefined" && !window.confirm(`删除「${p.name}」？${p.active ? "它是当前使用的，删除后自动换回服务器默认的智谱。" : ""}`)) return;
    after(await aiProviderDelete(p.id), "已删除");
  };
  const saveQuota = async () => {
    if (!qs) return;
    const budget = qs.budget.trim() === "" ? null : Math.round(Number(qs.budget) * 1e4);
    const low = qs.low.trim() === "" ? null : Number(qs.low);
    const stop = qs.stop.trim() === "" ? 0 : Number(qs.stop);
    const stopTokens = qs.stopTokens.trim() === "" ? 0 : Math.round(Number(qs.stopTokens) * 1e4);
    if ((budget != null && !(budget >= 0)) || (low != null && !(low >= 0)) || !(stop >= 0) || !(stopTokens >= 0)) { flash("请填数字"); return; }
    const r = await aiQuotaSave(qs.q.id, { budgetTokens: budget, lowBalance: low, stopBalance: stop, stopTokens, cashExempt: qs.exempt });
    if (!r.ok) { flash(r.error); return; }
    quota.setData(r.data); setQs(null); flash("已保存额度设置");
  };

  const auto = quota.data?.failover?.enabled ?? prov?.failover?.enabled ?? true;
  const setAuto = async (on: boolean) => {
    if (!on && typeof window !== "undefined" && !window.confirm("关掉后只用排第一的接口，它额度用完就直接停止调用，不会切到别家。确定关掉？")) return;
    const r = await aiFailoverSet(on);
    if (!r.ok) { flash(r.error); return; }
    quota.setData(r.data); flash(on ? "已打开：额度用完自动切换下一家" : "已关闭自动切换");
    void load();
  };
  const move = async (idx: number, dir: -1 | 1) => {
    if (!prov) return;
    const ids = prov.providers.map((p) => p.id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    const first = prov.providers.find((p) => p.id === ids[0]);
    if (j === 0 || idx === 0) {
      if (first && !first.usable) { flash("排第一的接口必须已启用且有可用密钥"); return; }
      if (typeof window !== "undefined" && !window.confirm(`把「${first?.name}」排到第一？它会成为「当前使用」。`)) return;
    }
    setBusy("order");
    const r = await aiProviderOrder(ids);
    setBusy("");
    after(r, "已调整顺序");
  };
  const recheck = async (p: AiProvider) => {
    setBusy("recheck:" + p.id);
    const r = await aiProviderRecheck(p.id);
    setBusy("");
    if (!r.ok) { flash(r.error); return; }
    quota.setData(r.data);
    const q = r.data.providers.find((x) => x.id === p.id);
    flash(q?.exhausted ? "还是没有额度：" + failoverReason(q.exhaustedReason) : "已恢复，可以继续使用");
  };
  const quotaById = new Map((quota.data?.providers || []).map((q) => [q.id, q]));
  const t = draft ? typeOf(draft.type) : undefined;

  return (
    <Screen
      title="AI 接口与额度"
      onBack={back}
      right={<button type="button" aria-label="刷新" className="grid size-11 place-items-center text-muted" onClick={() => { void load(); void quota.refresh(true); }}><RefreshCw className={cn("size-5", quota.loading && "animate-spin")} /></button>}
      footer={<div className="px-4 py-3 pb-safe"><PrimaryButton onClick={openNew} disabled={!prov}><span className="inline-flex items-center gap-1"><Plus className="size-4" />添加 AI 接口</span></PrimaryButton></div>}
    >
      {(err || quota.err) && <EmptyState title="暂时打不开" hint={err || quota.err} />}
      {quota.data && (
        <Card>
          <div className="flex items-center gap-2">
            <Gauge className="size-4 text-primary" />
            <span className="text-[15px] font-semibold">剩余额度</span>
            <span className="ml-auto text-[11px] text-muted">更新于 {hm(quota.data.at)} · 每分钟自动刷新</span>
          </div>
          <FailoverBanner data={quota.data} />
          <div className="divide-y divide-line">
            {quota.data.providers.map((q) => <QuotaRow key={q.id} q={q} detailed auto={auto} standIn={standInId(quota.data) === q.id} onSettings={() => setQs({ q, budget: q.budgetTokens != null ? String(q.budgetTokens / 1e4) : "", low: String(q.lowBalance), stop: q.stopBalance ? String(q.stopBalance) : "", stopTokens: q.stopTokens ? String(q.stopTokens / 1e4) : "", exempt: !!q.cashExempt })} />)}
          </div>
          <p className="mt-1 text-[12px] leading-4 text-muted">智谱先扣资源包 / 免费额度，用完才扣现金，所以大数字显示资源包剩余，现金在下面。「实时」= 从智谱控制台接口查到；「估算」= 你填的资源包总量减去这台服务器记录的已用 token（资源包实时余量查不到时使用）。</p>
        </Card>
      )}
      {prov && (
        <Card>
          <div className="flex items-center justify-between gap-3" data-testid="ai-failover-toggle">
            <div className="min-w-0">
              <div className="text-[15px] font-semibold">额度用完自动切换</div>
              <p className="text-[12px] leading-4 text-muted">{auto ? "打开：排在前面的额度用完（余额到停用线，或服务商提示余额不足）就按顺序用下一家，避免余额被用成负数；充值后自动恢复。全部用完就停止调用。" : "关闭：只用排第一的接口，它额度用完就直接停止调用。"}</p>
            </div>
            <Toggle on={auto} label="额度用完自动切换" onChange={(v) => void setAuto(v)} />
          </div>
        </Card>
      )}
      {prov && (
        <Card>
          <div className="text-[15px] font-semibold">AI 接口（按使用顺序）</div>
          <p className="text-[12px] leading-4 text-muted">排第一的是「当前使用」，AI 助手、广告文案、AI 自动发帖都先用它；用上下箭头调整顺序。联网搜索只有智谱支持，智谱用完时联网搜索会暂停，不会改用别家。{prov.fallback ? "选中的那家现在不可用，已临时改用服务器默认的智谱。" : ""}</p>
          <ul className="mt-1 divide-y divide-line">
            {prov.providers.map((p, idx) => {
              const q = quotaById.get(p.id);
              return (
                <li key={p.id} className="py-3" data-testid="ai-provider-row">
                  <div className="flex items-center gap-1.5">
                    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-subtle text-[11px] font-semibold tabular-nums text-muted">{idx + 1}</span>
                    <span className="min-w-0 truncate text-[14px] font-semibold">{sanitizeText(p.name)}</span>
                    {p.active ? <span className="shrink-0 whitespace-nowrap"><Pill tone="ok">当前使用</Pill></span> : p.selected ? <span className="shrink-0 whitespace-nowrap"><Pill tone="warn">已选但不可用</Pill></span> : null}
                    <StandInPill show={standInId(quota.data) === p.id} />
                    {!p.enabled && <Pill tone="muted">已停用</Pill>}
                    {p.keyBroken && <Pill tone="danger">密钥需重填</Pill>}
                    {q && q.exhausted ? <ExhaustedPill q={q} auto={auto} /> : q && q.low && <Pill tone={q.empty ? "danger" : "warn"}>{q.empty ? "额度用完" : "额度偏低"}</Pill>}
                    <span className="ml-auto flex shrink-0 items-center">
                      <button type="button" aria-label={"上移 " + p.name} disabled={idx === 0 || busy === "order"} className="grid size-8 place-items-center rounded-full text-muted disabled:opacity-30" onClick={() => void move(idx, -1)}><ChevronUp className="size-4" /></button>
                      <button type="button" aria-label={"下移 " + p.name} disabled={idx === prov.providers.length - 1 || busy === "order"} className="grid size-8 place-items-center rounded-full text-muted disabled:opacity-30" onClick={() => void move(idx, 1)}><ChevronDown className="size-4" /></button>
                    </span>
                  </div>
                  <p className="mt-0.5 break-all text-[12px] leading-4 text-muted">
                    {p.typeName} · {sanitizeText(p.model)} · {p.hasKey ? "密钥 " + (p.keyMasked || "已设置") : "未配置密钥"}{p.searchCapable && p.search ? " · 支持联网搜索" : ""}
                  </p>
                  <p className="break-all text-[11px] leading-4 text-muted">{sanitizeText(p.baseUrl)}{p.builtin ? " · 在服务器 .env 里配置" : ""}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {!p.active && <button type="button" disabled={!p.usable} className="h-8 rounded-full bg-primary px-3 text-[12px] font-semibold text-on-primary disabled:opacity-40" onClick={() => void activate(p)}><span className="inline-flex items-center gap-1"><Check className="size-3.5" />设为当前</span></button>}
                    <button type="button" disabled={!p.hasKey || busy === "test:" + p.id} className="h-8 rounded-full bg-subtle px-3 text-[12px] font-semibold disabled:opacity-40" onClick={() => void test(p)}><span className="inline-flex items-center gap-1"><PlugZap className="size-3.5" />{busy === "test:" + p.id ? "测试中…" : "测试连接"}</span></button>
                    {q?.exhausted && <button type="button" disabled={busy === "recheck:" + p.id} className="h-8 rounded-full bg-subtle px-3 text-[12px] font-semibold disabled:opacity-40" onClick={() => void recheck(p)}>{busy === "recheck:" + p.id ? "检查中…" : "已充值，重新检查"}</button>}
                    {!p.builtin && <button type="button" className="h-8 rounded-full bg-subtle px-3 text-[12px] font-semibold" onClick={() => openEdit(p)}>编辑</button>}
                    {!p.builtin && <button type="button" aria-label={"删除 " + p.name} className="ml-auto grid size-8 place-items-center rounded-full nova-danger-soft" onClick={() => void remove(p)}><Trash2 className="size-3.5" /></button>}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-1 text-[12px] leading-4 text-muted">密钥只保存在服务器上{prov.keyStorage === "memory" ? "" : "（加密存储）"}，这里只显示前后几位。测试连接会发一条很短的请求（约几个 token）。</p>
        </Card>
      )}

      <Sheet open={!!draft} title={draft?.id ? "编辑 AI 接口" : "添加 AI 接口"} onClose={() => setDraft(null)}>
        {draft && prov && (
          <div className="max-h-[72dvh] overflow-y-auto px-4 pb-6">
            {!draft.id && (
              <Field label="服务商">
                <select className={inputClass} value={draft.type} onChange={(e) => { const nt = typeOf(e.target.value); if (nt) setDraft({ ...draft, type: nt.type, name: nt.name, baseUrl: nt.baseUrl, model: nt.model, search: nt.searchCapable }); }}>
                  {prov.types.map((x) => <option key={x.type} value={x.type} disabled={x.blocked}>{x.name}{x.blocked ? "（暂不使用）" : ""}</option>)}
                </select>
              </Field>
            )}
            {t && <p className="-mt-1 mb-2 text-[12px] leading-4 text-muted">{t.note}</p>}
            <Field label="显示名称"><input className={inputClass} value={draft.name} maxLength={30} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
            <Field label="接口地址（https://…，OpenAI 兼容，到 /v1 为止）"><input className={inputClass} value={draft.baseUrl} inputMode="url" autoCapitalize="off" autoCorrect="off" onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} /></Field>
            <Field label={draft.id ? `API 密钥（现在是 ${draft.keyMasked || "未设置"}，不改就留空）` : "API 密钥"}>
              <input className={inputClass} type="password" autoComplete="off" autoCapitalize="off" value={draft.apiKey} placeholder={draft.id ? "留空 = 不修改" : "粘贴密钥"} onChange={(e) => setDraft({ ...draft, apiKey: e.target.value.trim() })} />
            </Field>
            <Field label="对话模型"><input className={inputClass} value={draft.model} autoCapitalize="off" autoCorrect="off" onChange={(e) => setDraft({ ...draft, model: e.target.value })} /></Field>
            {t?.searchCapable && (
              <div className="mb-2.5 flex items-center justify-between gap-3">
                <span className="text-[14px]">用它做联网搜索（找广告）</span>
                <Toggle on={draft.search} label="联网搜索" onChange={(v) => setDraft({ ...draft, search: v })} />
              </div>
            )}
            {draft.id && (
              <div className="mb-2.5 flex items-center justify-between gap-3">
                <span className="text-[14px]">启用</span>
                <Toggle on={draft.enabled} label="启用" onChange={(v) => setDraft({ ...draft, enabled: v })} />
              </div>
            )}
            {formErr && <p className="mb-2 text-[13px] text-danger">{formErr}</p>}
            <PrimaryButton disabled={busy === "save"} onClick={() => void save()}>{busy === "save" ? "保存中…" : "保存"}</PrimaryButton>
          </div>
        )}
      </Sheet>

      <Sheet open={!!qs} title={qs ? "额度设置 · " + qs.q.name : "额度设置"} onClose={() => setQs(null)}>
        {qs && (
          <div className="px-4 pb-6">
            <Field label="资源包 / 预算总量（万 token，留空 = 不估算）">
              <input className={inputClass} inputMode="decimal" value={qs.budget} placeholder="例如 1000 = 1000 万 token" onChange={(e) => setQs({ ...qs, budget: e.target.value })} />
            </Field>
            <p className="-mt-1 mb-2 text-[12px] leading-4 text-muted">保存后从现在开始累计已用 token；剩余 = 总量 − 已用。买了新的资源包就改一下总量。</p>
            <Field label={`余额提醒线（${qs.q.currency === "USD" ? "美元" : "元"}，低于它标黄）`}>
              <input className={inputClass} inputMode="decimal" value={qs.low} onChange={(e) => setQs({ ...qs, low: e.target.value })} />
            </Field>
            {qs.q.balanceApi && (
              <Field label={`停用线（${qs.q.currency === "USD" ? "美元" : "元"}，余额到这里就切下一家，默认 0）`}>
                <input className={inputClass} inputMode="decimal" value={qs.stop} placeholder="建议 1，留一点余量防欠费" onChange={(e) => setQs({ ...qs, stop: e.target.value })} />
              </Field>
            )}
            <Field label="估算剩余停用线（万 token，剩这么多就切下一家，默认 0）">
              <input className={inputClass} inputMode="decimal" value={qs.stopTokens} placeholder="0" onChange={(e) => setQs({ ...qs, stopTokens: e.target.value })} />
            </Field>
            <p className="-mt-1 mb-2 text-[12px] leading-4 text-muted">先扣资源包 / 免费额度，用完才扣现金：资源包用完且现金低于停用线才切下一家。服务商结算有延迟，现金可能被扣成负数（欠费），停用线留一点余量（例如 1 元）更稳妥。</p>
            <div className="mb-2.5 flex items-center justify-between gap-3">
              <span className="text-[14px]">不按现金余额判断（免费模型 / 只用资源包，只在服务商提示余额不足时切换）</span>
              <Toggle on={qs.exempt} label="不按现金余额判断" onChange={(v) => setQs({ ...qs, exempt: v })} />
            </div>
            <PrimaryButton onClick={() => void saveQuota()}>保存</PrimaryButton>
          </div>
        )}
      </Sheet>
    </Screen>
  );
}
