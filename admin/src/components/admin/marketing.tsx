import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useAdmin } from "@/lib/admin/store";
import { apiRequest, loadConfig, readErrorMessage, resolveBase, joinUrl, type EndpointName } from "@/lib/admin/backend";
import { sanitizeText } from "@/lib/admin/sanitize";
import { EmptyState, Field, inputClass, Pill, PrimaryButton, Screen, Seg, Sheet } from "./ui";

/* r10 营销管理：营销帖 / 数据调整 / 推流加热 / AI 审查。 */

type Res<T> = { ok: true; data: T } | { ok: false; error: string };
export async function mk<T = Record<string, unknown>>(
  name: EndpointName,
  opts: { method?: string; body?: unknown; params?: Record<string, string>; query?: Record<string, string | number | undefined>; timeoutMs?: number } = {},
): Promise<Res<T>> {
  const r = await apiRequest(name, opts);
  if (!r.ok) return { ok: false, error: r.error || readErrorMessage(r.json, "操作失败，请稍后再试") };
  return { ok: true, data: r.json as T };
}
export function mediaUrl(u: string): string {
  if (/^https?:\/\//i.test(u)) return u;
  const base = resolveBase(loadConfig().baseUrl);
  return base ? joinUrl(base, u) : u;
}
export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={"relative h-7 w-12 shrink-0 rounded-full transition " + (on ? "bg-primary" : "bg-subtle border border-line")}
    >
      <span className={"absolute top-0.5 size-6 rounded-full bg-white shadow transition-all " + (on ? "left-[22px]" : "left-0.5")} />
    </button>
  );
}
export function Card({ children }: { children: ReactNode }) {
  return <div className="mx-4 mt-3 rounded-card bg-surface p-4 shadow-card">{children}</div>;
}
export const textareaClass = "w-full rounded-xl border border-line bg-subtle px-3 py-2 text-[16px] outline-none focus:border-primary";

const TABS = [
  { id: "ads", label: "营销帖" },
  { id: "stats", label: "数据调整" },
  { id: "boost", label: "推流加热" },
  { id: "ai", label: "AI 审查" },
];
const READY = new Set(["ads", "stats", "boost", "ai"]);

export function MarketingScreen() {
  const back = useAdmin((s) => s.back);
  const [tab, setTab] = useState("ads");
  const tabs = TABS.filter((t) => READY.has(t.id));
  return (
    <Screen title="营销管理" onBack={back}>
      <Seg value={tab} options={tabs} onChange={setTab} />
      {tab === "ads" && <AdsTab />}
      {tab === "stats" && <StatsTab />}
      {tab === "boost" && <BoostTab />}
      {tab === "ai" && <AiTab />}
    </Screen>
  );
}

type Ad = {
  id: string; kind: "text" | "image" | "video" | "sdk"; advertiser: string; title: string; text: string;
  media: { url: string; kind: string }[]; linkUrl: string; cta: string; sdk: { provider: string; slot: string } | null;
  enabled: boolean; weight: number; impressions: number; clicks: number; hides: number; ctr: number;
};
type AdSettings = { enabled: boolean; every: number; perFeed: number; dailyCap: number };
const KIND_LABEL: Record<string, string> = { text: "文字", image: "图片", video: "视频", sdk: "广告位 SDK" };
const emptyAd = { kind: "text", advertiser: "", title: "", text: "", media: [] as { url: string; kind: string }[], linkUrl: "", cta: "", sdkProvider: "revive", sdkSlot: "", weight: 1, enabled: true };

function AdsTab() {
  const flash = useAdmin((s) => s.flash);
  const [ads, setAds] = useState<Ad[]>([]);
  const [st, setSt] = useState<AdSettings | null>(null);
  const [err, setErr] = useState("");
  const [edit, setEdit] = useState<null | { id?: string; f: typeof emptyAd }>(null);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState("");
  const load = useCallback(async () => {
    const r = await mk<{ ads: Ad[]; settings: AdSettings }>("adminMarketingAds");
    if (!r.ok) { setErr(r.error); return; }
    setErr(""); setAds(r.data.ads || []); setSt(r.data.settings);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const saveSettings = async (patch: Partial<AdSettings>) => {
    const r = await mk<{ settings: AdSettings }>("adminMarketingSettings", { method: "POST", body: patch });
    if (!r.ok) { flash(r.error); return; }
    setSt(r.data.settings); flash("已保存");
  };
  const upload = async (file: File) => {
    if (file.size > 30 * 1024 * 1024) { setFormErr("文件不能超过 30 MB"); return; }
    setBusy(true); setFormErr("");
    const data = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result || "")); fr.onerror = () => rej(fr.error); fr.readAsDataURL(file); });
    const r = await mk<{ url: string; kind: string }>("adminMarketingMedia", { method: "POST", body: { data }, timeoutMs: 120000 });
    setBusy(false);
    if (!r.ok) { setFormErr(r.error); return; }
    setEdit((e) => e && { ...e, f: { ...e.f, media: e.f.kind === "video" ? [{ url: r.data.url, kind: r.data.kind }] : [...e.f.media, { url: r.data.url, kind: r.data.kind }].slice(0, 9) } });
  };
  const submit = async () => {
    if (!edit) return;
    setBusy(true); setFormErr("");
    const f = edit.f;
    const body = { kind: f.kind, advertiser: f.advertiser, title: f.title, text: f.text, media: f.media, linkUrl: f.linkUrl, cta: f.cta, sdkProvider: f.sdkProvider, sdkSlot: f.sdkSlot, weight: f.weight, enabled: f.enabled };
    const r = edit.id
      ? await mk("adminMarketingAd", { method: "POST", params: { id: edit.id }, body })
      : await mk("adminMarketingAds", { method: "POST", body });
    setBusy(false);
    if (!r.ok) { setFormErr(r.error); return; }
    setEdit(null); flash(edit.id ? "已保存" : "已发布营销帖"); void load();
  };
  const toggle = async (ad: Ad) => {
    const r = await mk("adminMarketingAd", { method: "POST", params: { id: ad.id }, body: { enabled: !ad.enabled } });
    if (!r.ok) flash(r.error); else void load();
  };
  const remove = async (ad: Ad) => {
    if (typeof window !== "undefined" && !window.confirm("删除这条营销帖？")) return;
    const r = await mk("adminMarketingAdDelete", { method: "POST", params: { id: ad.id } });
    if (!r.ok) flash(r.error); else { flash("已删除"); void load(); }
  };
  const num = (v: string) => Math.max(0, Math.round(Number(v) || 0));

  return (
    <div className="pb-6">
      {err && <p className="px-4 pt-3 text-sm text-danger">{err}</p>}
      {st && (
        <Card>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[15px] font-semibold">在信息流中投放</div>
              <p className="text-[12px] text-muted">关闭后所有用户都不再看到营销帖</p>
            </div>
            <Toggle on={st.enabled} label="投放开关" onChange={(v) => void saveSettings({ enabled: v })} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <SettingNum label="每 N 条普通帖插 1 条" value={st.every} onSave={(v) => void saveSettings({ every: Math.max(1, v) })} />
            <SettingNum label="每次刷新每人最多" value={st.perFeed} onSave={(v) => void saveSettings({ perFeed: v })} />
            <SettingNum label="每人每天上限（0 不限）" value={st.dailyCap} onSave={(v) => void saveSettings({ dailyCap: v })} />
          </div>
          <p className="mt-2 text-[12px] leading-4 text-muted">每个用户随机挑选；点过「不感兴趣」的不会再给他看；只有一条时会重复出现。</p>
        </Card>
      )}
      <div className="px-4 pt-4">
        <PrimaryButton onClick={() => { setFormErr(""); setEdit({ f: { ...emptyAd } }); }}>发布营销帖</PrimaryButton>
      </div>
      {ads.length === 0 && !err && <EmptyState title="还没有营销帖" hint="发布后按上面的频率出现在用户的信息流里，带「推广」标记。" />}
      <ul className="mt-3 space-y-3 px-4">
        {ads.map((ad) => (
          <li key={ad.id} className="rounded-card bg-surface p-3 shadow-card">
            <div className="flex items-center gap-2">
              <Pill tone="vip">推广</Pill>
              <Pill tone="muted">{KIND_LABEL[ad.kind] || ad.kind}</Pill>
              {!ad.enabled && <Pill tone="warn">已停用</Pill>}
              <span className="ml-auto text-[11px] text-muted">权重 {ad.weight}</span>
            </div>
            {ad.title && <div className="mt-2 text-[15px] font-semibold">{sanitizeText(ad.title)}</div>}
            {ad.text && <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[13px] text-muted">{sanitizeText(ad.text)}</p>}
            {ad.media[0] && (ad.media[0].kind === "video"
              ? <video className="mt-2 max-h-40 w-full rounded-xl bg-black" src={mediaUrl(ad.media[0].url)} muted controls />
              : <img className="mt-2 max-h-40 w-full rounded-xl object-cover" src={mediaUrl(ad.media[0].url)} alt="" />)}
            {ad.sdk && <p className="mt-1 break-all text-[12px] text-muted">{ad.sdk.provider} · {ad.sdk.slot}</p>}
            <div className="mt-2 grid grid-cols-4 gap-1 text-center text-[12px]">
              <Stat n={ad.impressions} l="曝光" /><Stat n={ad.clicks} l="点击" /><Stat n={ad.ctr + "%"} l="点击率" /><Stat n={ad.hides} l="不感兴趣" />
            </div>
            <div className="mt-2 flex gap-2">
              <button type="button" className="h-9 flex-1 rounded-full bg-subtle text-[13px] font-semibold" onClick={() => { setFormErr(""); setEdit({ id: ad.id, f: { kind: ad.kind, advertiser: ad.advertiser, title: ad.title, text: ad.text, media: ad.media, linkUrl: ad.linkUrl, cta: ad.cta, sdkProvider: ad.sdk?.provider || "revive", sdkSlot: ad.sdk?.slot || "", weight: ad.weight, enabled: ad.enabled } }); }}>编辑</button>
              <button type="button" className="h-9 flex-1 rounded-full bg-subtle text-[13px] font-semibold" onClick={() => void toggle(ad)}>{ad.enabled ? "停用" : "启用"}</button>
              <button type="button" className="h-9 flex-1 rounded-full nova-danger-soft text-[13px] font-semibold" onClick={() => void remove(ad)}>删除</button>
            </div>
          </li>
        ))}
      </ul>
      <Sheet open={!!edit} title={edit?.id ? "编辑营销帖" : "发布营销帖"} onClose={() => setEdit(null)}>
        {edit && (
          <div className="max-h-[70dvh] overflow-y-auto px-4 pb-4">
            <Field label="类型">
              <select className={inputClass} value={edit.f.kind} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, kind: e.target.value, media: [] } })}>
                <option value="text">文字</option><option value="image">图片</option><option value="video">视频</option><option value="sdk">广告位 SDK（Revive 等）</option>
              </select>
            </Field>
            {edit.f.kind !== "sdk" && (
              <>
                <Field label="标题（可选，最多 60 字）"><input className={inputClass} value={edit.f.title} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, title: e.target.value } })} /></Field>
                <Field label="正文（最多 1000 字）"><textarea className={textareaClass} rows={4} value={edit.f.text} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, text: e.target.value } })} /></Field>
              </>
            )}
            {(edit.f.kind === "image" || edit.f.kind === "video") && (
              <Field label={edit.f.kind === "video" ? "视频（MP4 / WebM，≤30 MB）" : "图片（最多 9 张，≤30 MB）"}>
                <input type="file" accept={edit.f.kind === "video" ? "video/mp4,video/webm" : "image/*"} className="block w-full text-[13px]" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
                <div className="mt-2 flex flex-wrap gap-2">
                  {edit.f.media.map((m, i) => (
                    <button key={m.url} type="button" className="relative" aria-label="移除" onClick={() => setEdit({ ...edit, f: { ...edit.f, media: edit.f.media.filter((_, j) => j !== i) } })}>
                      {m.kind === "video" ? <video className="h-16 w-24 rounded-lg bg-black object-cover" src={mediaUrl(m.url)} muted /> : <img className="size-16 rounded-lg object-cover" src={mediaUrl(m.url)} alt="" />}
                      <span className="absolute -right-1 -top-1 rounded-full bg-ink px-1 text-[11px] text-white">✕</span>
                    </button>
                  ))}
                </div>
              </Field>
            )}
            {edit.f.kind === "sdk" && (
              <>
                <Field label="广告平台">
                  <select className={inputClass} value={edit.f.sdkProvider} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, sdkProvider: e.target.value } })}>
                    <option value="revive">Revive Adserver（开源自建，网页投放）</option>
                    <option value="admob">Google AdMob（需原生插件，暂不下发）</option>
                    <option value="pangle">穿山甲（需原生 SDK，暂不下发）</option>
                    <option value="gdt">优量汇（需原生 SDK，暂不下发）</option>
                  </select>
                </Field>
                <Field label={edit.f.sdkProvider === "revive" ? "广告位地址（…/www/delivery/afr.php?zoneid=1）" : "广告位 ID"}>
                  <input className={inputClass} value={edit.f.sdkSlot} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, sdkSlot: e.target.value } })} />
                </Field>
              </>
            )}
            {edit.f.kind !== "sdk" && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="跳转链接（可选）"><input className={inputClass} placeholder="https://" value={edit.f.linkUrl} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, linkUrl: e.target.value } })} /></Field>
                <Field label="按钮文字（可选）"><input className={inputClass} placeholder="了解详情" value={edit.f.cta} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, cta: e.target.value } })} /></Field>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Field label="广告主（仅后台可见）"><input className={inputClass} value={edit.f.advertiser} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, advertiser: e.target.value } })} /></Field>
              <Field label="权重（1–100）"><input className={inputClass} inputMode="numeric" value={String(edit.f.weight)} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, weight: Math.min(100, Math.max(1, num(e.target.value) || 1)) } })} /></Field>
            </div>
            {formErr && <p className="mb-2 text-sm text-danger">{formErr}</p>}
            <PrimaryButton disabled={busy} onClick={() => void submit()}>{busy ? "正在处理…" : edit.id ? "保存" : "发布"}</PrimaryButton>
          </div>
        )}
      </Sheet>
    </div>
  );
}
function Stat({ n, l }: { n: number | string; l: string }) {
  return <div className="rounded-lg bg-subtle py-1.5"><div className="text-[14px] font-semibold">{n}</div><div className="text-[11px] text-muted">{l}</div></div>;
}
function SettingNum({ label, value, onSave }: { label: string; value: number; onSave: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  return (
    <label className="block min-w-0">
      <span className="mb-1 block min-h-8 text-[11px] leading-4 text-muted">{label}</span>
      <input className={inputClass + " text-center"} inputMode="numeric" value={v} onChange={(e) => setV(e.target.value.replace(/\D/g, ""))} onBlur={() => { const n = Math.max(0, Math.round(Number(v) || 0)); if (n !== value) onSave(n); }} />
    </label>
  );
}

type StatPost = {
  id: string; text: string; createdAt: number; author: { id: number; username: string; displayName: string } | null;
  real: { views: number; likes: number; saves: number }; adj: { views: number; likes: number; saves: number };
  shown: { views: number; likes: number; saves: number };
};
function StatsTab() {
  const flash = useAdmin((s) => s.flash);
  const [q, setQ] = useState("");
  const [list, setList] = useState<StatPost[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<null | { p: StatPost; views: string; likes: string; saves: string }>(null);
  const search = useCallback(async (kw: string) => {
    setBusy(true);
    const r = await mk<{ posts: StatPost[] }>("adminMarketingPosts", { query: { q: kw.trim(), limit: 50 } });
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setErr(""); setList(r.data.posts || []);
  }, []);
  useEffect(() => { void search(""); }, [search]);
  const save = async (reset = false) => {
    if (!edit) return;
    const body = reset ? { reset: true } : { views: edit.views, likes: edit.likes, saves: edit.saves };
    const r = await mk<{ post: StatPost }>("adminMarketingPostStats", { method: "POST", params: { id: edit.p.id }, body });
    if (!r.ok) { flash(r.error); return; }
    setList((l) => l.map((x) => (x.id === r.data.post.id ? r.data.post : x)));
    setEdit(null); flash(reset ? "已恢复真实数据" : "已保存，用户端刷新后可见");
  };
  return (
    <div className="pb-6">
      <form className="flex gap-2 px-4 pt-3" onSubmit={(e) => { e.preventDefault(); void search(q); }}>
        <input className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索帖子内容或用户名" enterKeyHint="search" />
        <button type="submit" className="nova-btn-primary h-11 shrink-0 px-4 text-[15px]">{busy ? "…" : "搜索"}</button>
      </form>
      <p className="px-4 pt-2 text-[12px] leading-4 text-muted">修改的是用户看到的数字；真实数据单独保留，可随时恢复。之后的真实阅读、点赞、收藏会在此基础上继续累加。</p>
      {err && <p className="px-4 pt-2 text-sm text-danger">{err}</p>}
      {!err && list.length === 0 && !busy && <EmptyState title="没有找到帖子" hint="换个关键词或用户名试试。" />}
      <ul className="mt-2 space-y-2 px-4">
        {list.map((p) => {
          const adjusted = p.adj.views || p.adj.likes || p.adj.saves;
          return (
            <li key={p.id}>
              <button type="button" className="w-full rounded-card bg-surface p-3 text-left shadow-card" onClick={() => setEdit({ p, views: String(p.shown.views), likes: String(p.shown.likes), saves: String(p.shown.saves) })}>
                <div className="flex items-center gap-2 text-[12px] text-muted">
                  <span className="truncate font-semibold">{p.author ? sanitizeText(p.author.displayName) : "未知用户"}</span>
                  <span className="truncate">@{p.author?.username}</span>
                  {adjusted ? <span className="ml-auto"><Pill tone="warn">已调整</Pill></span> : null}
                </div>
                <p className="mt-1 line-clamp-2 text-[14px]">{sanitizeText(p.text) || "（无文字）"}</p>
                <div className="mt-2 grid grid-cols-3 gap-1 text-center text-[12px]">
                  <Stat n={p.shown.views} l={"阅读" + (p.adj.views ? "（真实 " + p.real.views + "）" : "")} />
                  <Stat n={p.shown.likes} l={"点赞" + (p.adj.likes ? "（真实 " + p.real.likes + "）" : "")} />
                  <Stat n={p.shown.saves} l={"收藏" + (p.adj.saves ? "（真实 " + p.real.saves + "）" : "")} />
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      <Sheet open={!!edit} title="调整显示数据" onClose={() => setEdit(null)}>
        {edit && (
          <div className="px-4 pb-4">
            <p className="mb-3 line-clamp-2 text-[13px] text-muted">{sanitizeText(edit.p.text)}</p>
            {(["views", "likes", "saves"] as const).map((k) => (
              <Field key={k} label={{ views: "阅读数", likes: "点赞数", saves: "收藏数" }[k] + "（真实 " + edit.p.real[k] + "）"}>
                <input className={inputClass} inputMode="numeric" value={edit[k]} onChange={(e) => setEdit({ ...edit, [k]: e.target.value.replace(/\D/g, "") })} />
              </Field>
            ))}
            <PrimaryButton onClick={() => void save(false)}>保存</PrimaryButton>
            <button type="button" className="mt-2 h-11 w-full rounded-full bg-subtle text-[15px] font-semibold" onClick={() => void save(true)}>恢复真实数据</button>
          </div>
        )}
      </Sheet>
    </div>
  );
}

type Plan = { id: string; name: string; priceCents: number; impressions: number; days: number; priceLabel?: string; cpm?: number; priceText?: string };
// 价格输入：编辑时保留原文（否则输入「9.」会被立刻改回「9」，小数点打不进去）；接受中英文逗号/句号，最多两位小数。
export function normPrice(raw: string): string | null {
  const t = String(raw).replace(/[，,。]/g, ".").replace(/\s+/g, "");
  return /^\d{0,6}(\.\d{0,2})?$/.test(t) ? t : null;
}
export function yuanText(cents: number): string {
  const n = Math.round(Number(cents) || 0);
  return n % 100 === 0 ? String(n / 100) : (n / 100).toFixed(2).replace(/0$/, "");
}
type BoostOrder = {
  id: string; code: string; postId: string; planName: string; amountLabel: string; impressions: number; days: number;
  methodName: string; status: string; statusLabel: string; delivered: number; progress: number; rejectReason: string | null;
  createdAt: number; endsAt: number | null; user: { id: number; username: string; displayName: string } | null;
  post: { id: string; text: string; deleted: boolean } | null;
};
type BoostSettings = { enabled: boolean; perFeed: number; slots: number[] };
const BOOST_FILTERS = [
  { id: "awaiting_review", label: "待核对" }, { id: "active", label: "推流中" }, { id: "all", label: "全部" },
];
function BoostTab() {
  const flash = useAdmin((s) => s.flash);
  const [filter, setFilter] = useState("awaiting_review");
  const [orders, setOrders] = useState<BoostOrder[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [st, setSt] = useState<BoostSettings | null>(null);
  const [err, setErr] = useState("");
  const [planEdit, setPlanEdit] = useState<Plan[] | null>(null);
  const [rej, setRej] = useState<null | { o: BoostOrder; reason: string; mode: "reject" | "stop" | "refund" }>(null);
  const load = useCallback(async (f: string) => {
    const r = await mk<{ orders: BoostOrder[]; plans: Plan[]; settings: BoostSettings }>("adminBoostOrders", { query: { status: f } });
    if (!r.ok) { setErr(r.error); return; }
    setErr(""); setOrders(r.data.orders || []); setPlans(r.data.plans || []); setSt(r.data.settings);
  }, []);
  useEffect(() => { void load(filter); }, [load, filter]);
  const saveSettings = async (body: Record<string, unknown>) => {
    const r = await mk<{ settings: BoostSettings; plans: Plan[] }>("adminBoostSettings", { method: "POST", body });
    if (!r.ok) { flash(r.error); return false; }
    setSt(r.data.settings); setPlans(r.data.plans); flash("已保存"); return true;
  };
  const confirm = async (o: BoostOrder) => {
    const r = await mk("adminBoostConfirm", { method: "POST", params: { id: o.id } });
    if (!r.ok) { flash(r.error); return; }
    flash("已开通，开始推流"); void load(filter);
  };
  const submitRej = async () => {
    if (!rej) return;
    const r = rej.mode === "reject"
      ? await mk("adminBoostReject", { method: "POST", params: { id: rej.o.id }, body: { reason: rej.reason } })
      : await mk("adminBoostStop", { method: "POST", params: { id: rej.o.id }, body: { reason: rej.reason, refund: rej.mode === "refund" } });
    if (!r.ok) { flash(r.error); return; }
    setRej(null); flash(rej.mode === "reject" ? "已拒绝" : rej.mode === "refund" ? "已标记退款，请线下退回款项" : "已停止推流"); void load(filter);
  };
  const tone = (s: string) => (s === "active" ? "ok" : s === "awaiting_review" ? "warn" : s === "rejected" || s === "refunded" ? "danger" : "muted") as "ok" | "warn" | "danger" | "muted";
  return (
    <div className="pb-6">
      {err && <p className="px-4 pt-3 text-sm text-danger">{err}</p>}
      {st && (
        <Card>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[15px] font-semibold">开放推流</div>
              <p className="text-[12px] text-muted">用户可在自己的公开帖子 ⋯ 菜单里购买</p>
            </div>
            <Toggle on={st.enabled} label="推流开关" onChange={(v) => void saveSettings({ enabled: v })} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <SettingNum label="每次刷新最多插入几条" value={st.perFeed} onSave={(v) => void saveSettings({ perFeed: Math.min(5, v) })} />
            <label className="block min-w-0">
              <span className="mb-1 block min-h-8 text-[11px] leading-4 text-muted">插在第几条之后（逗号分隔）</span>
              <SlotsInput value={st.slots} onSave={(v) => void saveSettings({ slots: v })} />
            </label>
          </div>
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[13px] font-semibold">套餐（价格 → 曝光人数）</span>
              <button type="button" className="text-[13px] font-semibold text-primary" onClick={() => setPlanEdit(plans.map((p) => ({ ...p })))}>编辑</button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {plans.map((p) => (
                <div key={p.id} className="rounded-xl bg-subtle px-3 py-2">
                  <div className="text-[15px] font-semibold">{p.priceLabel} · {p.name}</div>
                  <div className="text-[12px] text-muted">{p.impressions} 次曝光 · {p.days} 天 · 千次 ¥{((p.priceCents / p.impressions) * 10).toFixed(1)}</div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-4 text-muted">参考：抖音 DOU+ 约 100 元 ≈ 5000 次播放（约 ¥20/千次），信息流 CPM 常见 ¥4–30/千次。这里每人只算 1 次、投满即止，用户少时请把曝光数设得保守些。</p>
          </div>
        </Card>
      )}
      <div className="mt-3"><Seg value={filter} options={BOOST_FILTERS} onChange={setFilter} /></div>
      {orders.length === 0 && !err && <EmptyState title="没有订单" hint={filter === "awaiting_review" ? "用户点「我已付款」后会出现在这里。" : undefined} />}
      <ul className="mt-2 space-y-2 px-4">
        {orders.map((o) => (
          <li key={o.id} className="rounded-card bg-surface p-3 shadow-card">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[15px] font-semibold">{o.code}</span>
              <Pill tone={tone(o.status)}>{o.statusLabel}</Pill>
              <span className="ml-auto text-[14px] font-semibold">{o.amountLabel}</span>
            </div>
            <p className="mt-1 text-[12px] text-muted">{o.user ? sanitizeText(o.user.displayName) + " @" + o.user.username : ""} · {o.methodName} · {o.planName} {o.impressions} 次 / {o.days} 天</p>
            {o.post && <p className="mt-1 line-clamp-2 text-[13px]">{o.post.deleted ? "（帖子已删除）" : sanitizeText(o.post.text)}</p>}
            {(o.status === "active" || o.status === "done" || o.status === "ended" || o.status === "refunded") && (
              <div className="mt-2">
                <div className="h-2 overflow-hidden rounded-full bg-subtle"><div className="h-full rounded-full bg-primary" style={{ width: o.progress + "%" }} /></div>
                <p className="mt-1 text-[12px] text-muted">已曝光 {o.delivered} / {o.impressions}（{o.progress}%）</p>
              </div>
            )}
            {o.rejectReason && <p className="mt-1 text-[12px] text-danger">原因：{sanitizeText(o.rejectReason)}</p>}
            <div className="mt-2 flex gap-2">
              {(o.status === "awaiting_review" || o.status === "pending" || o.status === "expired") && (
                <>
                  <button type="button" className="nova-btn-primary h-9 flex-1 text-[13px]" onClick={() => void confirm(o)}>已收款，开始推流</button>
                  <button type="button" className="h-9 flex-1 rounded-full nova-danger-soft text-[13px] font-semibold" onClick={() => setRej({ o, reason: "", mode: "reject" })}>拒绝</button>
                </>
              )}
              {o.status === "active" && <button type="button" className="h-9 flex-1 rounded-full bg-subtle text-[13px] font-semibold" onClick={() => setRej({ o, reason: "", mode: "stop" })}>停止推流</button>}
              {(o.status === "active" || o.status === "done" || o.status === "ended") && <button type="button" className="h-9 flex-1 rounded-full nova-danger-soft text-[13px] font-semibold" onClick={() => setRej({ o, reason: "", mode: "refund" })}>标记退款</button>}
            </div>
          </li>
        ))}
      </ul>
      <Sheet open={!!rej} title={rej?.mode === "reject" ? "拒绝订单" : rej?.mode === "refund" ? "标记退款" : "停止推流"} onClose={() => setRej(null)}>
        {rej && (
          <div className="px-4 pb-4">
            {rej.mode === "refund" && <p className="mb-2 text-[13px] text-muted">会停止投放并把订单标记为已退款。款项需要你在微信 / 支付宝里手动退回。</p>}
            <Field label={rej.mode === "reject" ? "拒绝原因（用户可见）" : "备注（可选）"}>
              <input className={inputClass} value={rej.reason} onChange={(e) => setRej({ ...rej, reason: e.target.value })} placeholder={rej.mode === "reject" ? "例如 未收到款项" : ""} />
            </Field>
            <PrimaryButton disabled={rej.mode === "reject" && !rej.reason.trim()} onClick={() => void submitRej()}>确定</PrimaryButton>
          </div>
        )}
      </Sheet>
      <Sheet open={!!planEdit} title="编辑推流套餐" onClose={() => setPlanEdit(null)}>
        {planEdit && (
          <div className="max-h-[70dvh] overflow-y-auto px-4 pb-4">
            {planEdit.map((p, i) => (
              <div key={i} className="mb-2 grid grid-cols-[1fr_1fr_1fr_0.7fr_auto] items-end gap-1.5">
                <Field label="名称"><input className={inputClass} value={p.name} onChange={(e) => setPlanEdit(planEdit.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></Field>
                <Field label="价格（元）"><input className={inputClass} type="text" inputMode="decimal" pattern="[0-9]*[.,]?[0-9]*" autoComplete="off" placeholder="9.90" value={p.priceText ?? yuanText(p.priceCents)} onChange={(e) => { const t = normPrice(e.target.value); if (t == null) return; setPlanEdit(planEdit.map((x, j) => (j === i ? { ...x, priceText: t, priceCents: Math.round((Number(t) || 0) * 100) } : x))); }} onBlur={() => setPlanEdit(planEdit.map((x, j) => (j === i ? { ...x, priceText: undefined } : x)))} /></Field>
                <Field label="曝光"><input className={inputClass} inputMode="numeric" value={String(p.impressions)} onChange={(e) => setPlanEdit(planEdit.map((x, j) => (j === i ? { ...x, impressions: Number(e.target.value.replace(/\D/g, "")) || 0 } : x)))} /></Field>
                <Field label="天数"><input className={inputClass} inputMode="numeric" value={String(p.days)} onChange={(e) => setPlanEdit(planEdit.map((x, j) => (j === i ? { ...x, days: Number(e.target.value.replace(/\D/g, "")) || 0 } : x)))} /></Field>
                <button type="button" aria-label="删除套餐" className="mb-2.5 h-11 px-1 text-danger" onClick={() => setPlanEdit(planEdit.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            {planEdit.length < 8 && <button type="button" className="mb-3 h-10 w-full rounded-full bg-subtle text-[14px] font-semibold" onClick={() => setPlanEdit([...planEdit, { id: "p" + Date.now().toString(36), name: "新套餐", priceCents: 1000, impressions: 300, days: 3 }])}>添加套餐</button>}
            <PrimaryButton onClick={() => void saveSettings({ plans: planEdit.map(({ priceText: _t, ...x }) => x) }).then((ok) => { if (ok) setPlanEdit(null); })}>保存套餐</PrimaryButton>
          </div>
        )}
      </Sheet>
    </div>
  );
}
function SlotsInput({ value, onSave }: { value: number[]; onSave: (v: number[]) => void }) {
  const [v, setV] = useState(value.join(","));
  useEffect(() => setV(value.join(",")), [value]);
  return (
    <input className={inputClass + " text-center"} value={v} onChange={(e) => setV(e.target.value.replace(/[^\d,，]/g, ""))}
      onBlur={() => { const arr = v.split(/[,，]/).map((x) => Math.round(Number(x))).filter((n) => Number.isFinite(n) && n >= 0).slice(0, 5); if (arr.length && arr.join(",") !== value.join(",")) onSave(arr); }} />
  );
}

/* ---------- AI 审查（Groq） ---------- */
type AiSettings = { enabled: boolean; mode: "block" | "flag"; model: string; rules: string; timeoutMs: number };
type AiStatus = {
  provider: string; keyConfigured: boolean; rpm: number; rpd: number; usedLastMinute: number; usedToday: number;
  cooldownUntil: number | null; lastError: string | null; models: string[]; defaultRules: string;
};
type AiLog = {
  id: number; kind: string; username: string | null; postId: string | null; excerpt: string; verdict: string;
  category: string | null; reason: string | null; source: string; model: string | null; latencyMs: number | null; error: string | null; createdAt: number;
};
const AI_FILTERS = [
  { id: "", label: "全部" }, { id: "block", label: "已拦截" }, { id: "flag", label: "已标记" }, { id: "fallback", label: "兜底" },
];
const VERDICT: Record<string, { t: string; tone: "ok" | "warn" | "danger" | "muted" }> = {
  allow: { t: "通过", tone: "ok" }, block: { t: "拦截", tone: "danger" }, flag: { t: "标记", tone: "warn" }, fallback: { t: "兜底", tone: "muted" },
};
const FALLBACK_WHY: Record<string, string> = {
  no_key: "未配置密钥", rate_limited: "Groq 限速冷却中", timeout: "超时", bad_json: "返回格式不对", bad_verdict: "返回格式不对",
  local_limit_rpm: "本地每分钟限额", local_limit_rpd: "本地每日限额",
};
const KIND_TXT: Record<string, string> = { post: "发帖", edit: "编辑", test: "测试" };
function fmtTime(t: number) {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function AiTab() {
  const flash = useAdmin((s) => s.flash);
  const [st, setSt] = useState<AiSettings | null>(null);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [logs, setLogs] = useState<AiLog[]>([]);
  const [filter, setFilter] = useState("");
  const [rules, setRules] = useState("");
  const [err, setErr] = useState("");
  const [testText, setTestText] = useState("");
  const [testRes, setTestRes] = useState<AiLog | null | { verdict: string; reason?: string; category?: string; source: string; error?: string; latencyMs?: number }>(null);
  const [busy, setBusy] = useState(false);
  const [showDefault, setShowDefault] = useState(false);
  const load = useCallback(async (f: string) => {
    const r = await mk<{ settings: AiSettings; status: AiStatus; logs: AiLog[] }>("adminAiModeration", { query: { verdict: f || undefined } });
    if (!r.ok) { setErr(r.error); return; }
    setErr(""); setSt(r.data.settings); setStatus(r.data.status); setLogs(r.data.logs || []); setRules(r.data.settings.rules || "");
  }, []);
  useEffect(() => { void load(filter); }, [load, filter]);
  const save = async (body: Partial<AiSettings>) => {
    const r = await mk<{ settings: AiSettings; status: AiStatus }>("adminAiModeration", { method: "POST", body });
    if (!r.ok) { flash(r.error); return; }
    setSt(r.data.settings); setStatus(r.data.status); flash("已保存");
  };
  const runTest = async () => {
    if (!testText.trim()) return;
    setBusy(true);
    const r = await mk<{ result: { verdict: string; reason?: string; category?: string; source: string; error?: string; latencyMs?: number }; status: AiStatus }>(
      "adminAiModerationTest", { method: "POST", body: { text: testText }, timeoutMs: 20000 });
    setBusy(false);
    if (!r.ok) { flash(r.error); return; }
    setTestRes(r.data.result); setStatus(r.data.status); void load(filter);
  };
  const delPost = async (l: AiLog) => {
    if (!l.postId) return;
    const r = await mk("adminContentDelete", { method: "POST", params: { type: "post", id: l.postId }, body: { reason: "AI 审查标记：" + (l.reason || l.category || "") } });
    if (!r.ok) { flash(r.error); return; }
    flash("已删除该帖子");
  };
  const tr = testRes as { verdict: string; reason?: string; category?: string; source: string; error?: string; latencyMs?: number } | null;
  return (
    <div className="pb-6">
      {err && <p className="px-4 pt-3 text-sm text-danger">{err}</p>}
      {status && !status.keyConfigured && (
        <div className="mx-4 mt-3 rounded-card border border-warn/40 bg-warn/10 p-3 text-[13px] leading-5">
          服务器还没配置 <span className="font-mono">GROQ_API_KEY</span>，AI 审查不会调用，发帖只走屏蔽词过滤。在服务器环境变量里设置后重启服务即可生效。
        </div>
      )}
      {st && status && (
        <Card>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[15px] font-semibold">AI 审查新帖</div>
              <p className="text-[12px] text-muted">发帖和编辑时先过屏蔽词，再交给 AI 判断</p>
            </div>
            <Toggle on={st.enabled} label="AI 审查开关" onChange={(v) => void save({ enabled: v })} />
          </div>
          <div className="mt-3">
            <span className="mb-1 block text-[12px] text-muted">判定违规时</span>
            <Seg value={st.mode} options={[{ id: "block", label: "直接拦截" }, { id: "flag", label: "仅标记，人工处理" }]} onChange={(v) => void save({ mode: v as "block" | "flag" })} />
          </div>
          <div className="mt-3">
            <Field label="模型">
              <select className={inputClass} value={st.model} onChange={(e) => void save({ model: e.target.value })}>
                {Array.from(new Set([st.model, ...status.models])).map((m) => (
                  <option key={m} value={m}>{m}{m === "openai/gpt-oss-20b" ? "（推荐）" : m === "openai/gpt-oss-safeguard-20b" ? "（审核专用，限速低）" : ""}</option>
                ))}
              </select>
            </Field>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Stat n={`${status.usedLastMinute}/${status.rpm}`} l="本分钟" />
            <Stat n={`${status.usedToday}/${status.rpd}`} l="今日" />
            <Stat n={status.cooldownUntil ? "冷却中" : status.keyConfigured ? "正常" : "未配置"} l="Groq" />
          </div>
          {status.lastError && <p className="mt-2 break-all text-[11px] text-muted">最近一次失败：{FALLBACK_WHY[status.lastError] || status.lastError}（已自动改用屏蔽词过滤）</p>}
        </Card>
      )}
      {st && status && (
        <Card>
          <div className="flex items-center justify-between">
            <span className="text-[15px] font-semibold">补充规则</span>
            <button type="button" className="text-[13px] font-semibold text-primary" onClick={() => setShowDefault((v) => !v)}>{showDefault ? "收起内置规则" : "查看内置规则"}</button>
          </div>
          {showDefault && <pre className="mt-2 whitespace-pre-wrap rounded-xl bg-subtle p-3 text-[12px] leading-5 text-muted">{status.defaultRules}</pre>}
          <textarea className={textareaClass + " mt-2 min-h-24"} value={rules} maxLength={4000} placeholder={"每行一条，例如：\n禁止推销保健品\n禁止发布代练、代充信息"} onChange={(e) => setRules(e.target.value)} />
          <div className="mt-2 flex justify-end">
            <PrimaryButton disabled={rules === st.rules} onClick={() => void save({ rules })}>保存规则</PrimaryButton>
          </div>
        </Card>
      )}
      {st && (
        <Card>
          <span className="text-[15px] font-semibold">试一试</span>
          <textarea className={textareaClass + " mt-2 min-h-20"} value={testText} maxLength={2000} placeholder="输入一段内容，看看 AI 会怎么判断（不会发布）" onChange={(e) => setTestText(e.target.value)} />
          {tr && (
            <div className="mt-2 rounded-xl bg-subtle px-3 py-2 text-[13px] leading-5">
              <Pill tone={(VERDICT[tr.verdict] || VERDICT.fallback).tone}>{(VERDICT[tr.verdict] || VERDICT.fallback).t}</Pill>{" "}
              {tr.source === "fallback" ? "AI 不可用：" + (FALLBACK_WHY[tr.error || ""] || tr.error) : (tr.category ? tr.category + " · " : "") + (tr.reason || "未发现问题")}
              {tr.latencyMs != null && tr.source === "ai" ? ` · ${tr.latencyMs}ms` : ""}
            </div>
          )}
          <div className="mt-2">
            <PrimaryButton disabled={busy || !testText.trim()} onClick={() => void runTest()}>{busy ? "判断中…" : "测试"}</PrimaryButton>
          </div>
        </Card>
      )}
      <div className="mt-3"><Seg value={filter} options={AI_FILTERS} onChange={setFilter} /></div>
      {logs.length === 0 && !err && <EmptyState title="还没有审查记录" hint="开启后，新帖的判断结果会显示在这里。" />}
      <ul className="mt-2 space-y-2 px-4">
        {logs.map((l) => {
          const v = VERDICT[l.verdict] || VERDICT.fallback;
          return (
            <li key={l.id} className="rounded-card bg-surface p-3 shadow-card">
              <div className="flex items-center gap-2 text-[12px] text-muted">
                <Pill tone={v.tone}>{v.t}</Pill>
                <span>{KIND_TXT[l.kind] || l.kind}</span>
                {l.username && <span className="truncate">@{sanitizeText(l.username)}</span>}
                <span className="ml-auto shrink-0">{fmtTime(l.createdAt)}</span>
              </div>
              <p className="mt-1 line-clamp-3 break-words text-[13px]">{sanitizeText(l.excerpt)}</p>
              <p className="mt-1 text-[12px] text-muted">
                {l.source === "fallback" ? "AI 不可用（" + (FALLBACK_WHY[l.error || ""] || l.error || "未知") + "），已用屏蔽词过滤" : (l.category ? l.category + " · " : "") + (l.reason || "未发现问题")}
                {l.latencyMs != null && l.source === "ai" ? ` · ${l.latencyMs}ms` : ""}
              </p>
              {l.verdict === "flag" && l.postId && (
                <div className="mt-2 flex justify-end">
                  <button type="button" className="rounded-full border border-danger/50 px-3 py-1 text-[13px] font-semibold text-danger" onClick={() => void delPost(l)}>删除该帖</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
