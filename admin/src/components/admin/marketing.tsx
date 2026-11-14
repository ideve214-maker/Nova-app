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
const tabExtra: Record<string, () => ReactNode> = {};
export function registerMarketingTab(id: string, render: () => ReactNode) { tabExtra[id] = render; }

export function MarketingScreen() {
  const back = useAdmin((s) => s.back);
  const [tab, setTab] = useState("ads");
  const tabs = TABS.filter((t) => t.id === "ads" || tabExtra[t.id]);
  return (
    <Screen title="营销管理" onBack={back}>
      <Seg value={tab} options={tabs} onChange={setTab} />
      {tab === "ads" ? <AdsTab /> : tabExtra[tab] ? tabExtra[tab]() : null}
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
