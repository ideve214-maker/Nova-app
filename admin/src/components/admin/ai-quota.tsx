import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Gauge, PlugZap, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useAdmin } from "@/lib/admin/store";
import { sanitizeText } from "@/lib/admin/sanitize";
import {
  aiProviderActivate, aiProviderDelete, aiProviderSave, aiProviders, aiProviderTest, aiQuota, aiQuotaSave,
  type AiProvider, type AiProvidersOverview, type AiQuotaItem, type AiQuotaOverview,
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
const money = (v: number | null | undefined, currency: string) => (v == null ? "—" : (currency === "USD" ? "$" : "¥") + v.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/** 主数字：实时余额（元 / 美元），否则估算剩余 token，否则“查不到”。 */
function headline(q: AiQuotaItem): { value: string; note: string } {
  if (q.source === "provider") return { value: money(q.balance, q.currency), note: "可用余额" };
  if (q.source === "estimated") return { value: fmtTokens(q.estimatedRemainingTokens), note: `估算剩余 token（共 ${fmtTokens(q.budgetTokens)}）` };
  return { value: "—", note: q.balanceApi ? "暂时查不到余额" : "这家查不到余额，填资源包总量后可估算" };
}
function SourcePill({ q }: { q: AiQuotaItem }) {
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

function QuotaRow({ q, detailed, onSettings }: { q: AiQuotaItem; detailed?: boolean; onSettings?: () => void }) {
  const h = headline(q);
  const tone = q.empty ? "text-danger" : q.low ? "text-warn" : "";
  return (
    <div className="py-2.5" data-testid="ai-quota-row">
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 truncate text-[14px] font-semibold">{sanitizeText(q.name)}</span>
        {q.active && <Pill tone="ok">当前使用</Pill>}
        {q.search && !q.active && <Pill tone="muted">联网搜索</Pill>}
        <span className="ml-auto shrink-0"><SourcePill q={q} /></span>
      </div>
      <div className="mt-1 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className={cn("text-[22px] font-semibold leading-7 tabular-nums", tone)}>{h.value}</div>
          <p className="text-[12px] leading-4 text-muted">
            {h.note}
            {q.empty ? " · 已用完" : q.low ? (q.source === "provider" ? ` · 低于提醒线 ${money(q.lowBalance, q.currency)}` : " · 剩余不到 10%") : ""}
          </p>
        </div>
        <div className="shrink-0 text-right text-[12px] leading-4 text-muted">
          <div>今天 {q.usage.today.calls} 次 · {fmtTokens(q.usage.today.tokens)} token</div>
          <div>7 天 {q.usage.week.calls} 次 · {fmtTokens(q.usage.week.tokens)} token</div>
        </div>
      </div>
      {q.error && <p className="mt-1 text-[12px] leading-4 text-warn">{q.source === "provider" ? "刷新失败，显示上次结果：" : "余额查询失败："}{sanitizeText(q.error)}</p>}
      {!q.configured && <p className="mt-1 text-[12px] leading-4 text-warn">{q.builtin ? "服务器上还没有配置智谱密钥" : "密钥不可用或已停用"}</p>}
      {detailed && (
        <div className="mt-1.5 space-y-0.5 text-[12px] leading-4 text-muted">
          {q.source === "provider" && (q.used != null || q.totalGranted != null) && (
            <div>累计已花 {money(q.used, q.currency)}{q.totalGranted != null ? ` · 充值+赠送 ${money(q.totalGranted, q.currency)}` : ""}</div>
          )}
          {q.source === "provider" && q.budgetTokens != null && <div>资源包估算剩余 {fmtTokens(q.estimatedRemainingTokens)} / {fmtTokens(q.budgetTokens)} token</div>}
          {q.resourcePackages.map((p, i) => <div key={i}>{p.name}：剩 {fmtTokens(p.remaining)} {p.unit}</div>)}
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
      <div className="divide-y divide-line">{shown.map((q) => <QuotaRow key={q.id} q={q} />)}</div>
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
  const [qs, setQs] = useState<{ q: AiQuotaItem; budget: string; low: string } | null>(null);

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
    if ((budget != null && !(budget >= 0)) || (low != null && !(low >= 0))) { flash("请填数字"); return; }
    const r = await aiQuotaSave(qs.q.id, { budgetTokens: budget, lowBalance: low });
    if (!r.ok) { flash(r.error); return; }
    quota.setData(r.data); setQs(null); flash("已保存额度设置");
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
          <div className="divide-y divide-line">
            {quota.data.providers.map((q) => <QuotaRow key={q.id} q={q} detailed onSettings={() => setQs({ q, budget: q.budgetTokens != null ? String(q.budgetTokens / 1e4) : "", low: String(q.lowBalance) })} />)}
          </div>
          <p className="mt-1 text-[12px] leading-4 text-muted">「实时」= 服务商余额接口查到的现金余额；「估算」= 你填的资源包总量减去这台服务器记录的已用 token。智谱的资源包（token 包）余量官方没有开放接口，可在「额度设置」里填总量来估算。</p>
        </Card>
      )}
      {prov && (
        <Card>
          <div className="text-[15px] font-semibold">AI 接口</div>
          <p className="text-[12px] leading-4 text-muted">AI 助手、广告文案、AI 自动发帖都用「当前使用」的这一家；联网搜索只有智谱支持，当前这家不支持时自动用智谱。{prov.fallback ? "选中的那家现在不可用，已临时改用服务器默认的智谱。" : ""}</p>
          <ul className="mt-1 divide-y divide-line">
            {prov.providers.map((p) => {
              const q = quotaById.get(p.id);
              return (
                <li key={p.id} className="py-3" data-testid="ai-provider-row">
                  <div className="flex items-center gap-1.5">
                    <span className="min-w-0 truncate text-[14px] font-semibold">{sanitizeText(p.name)}</span>
                    {p.active ? <Pill tone="ok">当前使用</Pill> : p.selected ? <Pill tone="warn">已选但不可用</Pill> : null}
                    {!p.enabled && <Pill tone="muted">已停用</Pill>}
                    {p.keyBroken && <Pill tone="danger">密钥需重填</Pill>}
                    {q && q.low && <Pill tone={q.empty ? "danger" : "warn"}>{q.empty ? "额度用完" : "额度偏低"}</Pill>}
                  </div>
                  <p className="mt-0.5 break-all text-[12px] leading-4 text-muted">
                    {p.typeName} · {sanitizeText(p.model)} · {p.hasKey ? "密钥 " + (p.keyMasked || "已设置") : "未配置密钥"}{p.searchCapable && p.search ? " · 支持联网搜索" : ""}
                  </p>
                  <p className="break-all text-[11px] leading-4 text-muted">{sanitizeText(p.baseUrl)}{p.builtin ? " · 在服务器 .env 里配置" : ""}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {!p.active && <button type="button" disabled={!p.usable} className="h-8 rounded-full bg-primary px-3 text-[12px] font-semibold text-on-primary disabled:opacity-40" onClick={() => void activate(p)}><span className="inline-flex items-center gap-1"><Check className="size-3.5" />设为当前</span></button>}
                    <button type="button" disabled={!p.hasKey || busy === "test:" + p.id} className="h-8 rounded-full bg-subtle px-3 text-[12px] font-semibold disabled:opacity-40" onClick={() => void test(p)}><span className="inline-flex items-center gap-1"><PlugZap className="size-3.5" />{busy === "test:" + p.id ? "测试中…" : "测试连接"}</span></button>
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
            <PrimaryButton onClick={() => void saveQuota()}>保存</PrimaryButton>
          </div>
        )}
      </Sheet>
    </Screen>
  );
}
