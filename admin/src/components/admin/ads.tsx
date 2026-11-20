import { useEffect, useState } from "react";
import { Copy, ExternalLink, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useAdmin } from "@/lib/admin/store";
import { sanitizeText } from "@/lib/admin/sanitize";
import {
  adsAddDirection, adsDeleteCampaign, adsDeleteDirection, adsGenerate, adsOverview, adsSaveCampaign, adsSetActive,
  type AdCampaign, type AdsOverview,
} from "@/lib/admin/ai-api";
import { cn, EmptyState, Field, inputClass, Pill, PrimaryButton, Screen, Seg, Sheet } from "./ui";

type Draft = { id?: number; name: string; url: string; info: string; directionId: number | null; enabled: boolean };
const blank: Draft = { name: "", url: "", info: "", directionId: null, enabled: true };

export function AdsScreen() {
  const back = useAdmin((s) => s.back);
  const flash = useAdmin((s) => s.flash);
  const [data, setData] = useState<AdsOverview | null>(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState("copies");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirOpen, setDirOpen] = useState(false);
  const [dirName, setDirName] = useState("");
  const [dirPrompt, setDirPrompt] = useState("");
  const [formErr, setFormErr] = useState("");

  const load = async () => { const r = await adsOverview(); if (r.ok) { setData(r.data); setErr(""); } else setErr(r.error); };
  useEffect(() => { void load(); }, []);
  const apply = (r: { ok: true; data: AdsOverview } | { ok: false; error: string }, okMsg?: string) => {
    if (r.ok) { setData(r.data); if (okMsg) flash(okMsg); return true; }
    flash(r.error); return false;
  };
  const campName = (id: number) => data?.campaigns.find((c) => c.id === id)?.name || `项目 ${id}`;
  const dirName_ = (id: number | null) => (id == null ? "跟随当前方向" : data?.directions.find((d) => d.id === id)?.name || "—");

  async function generate(campaignId?: number) {
    setBusy(true);
    const r = await adsGenerate(campaignId);
    setBusy(false);
    if (apply(r, r.ok ? `已生成 ${r.data.generated.length} 条` : undefined)) setTab("copies");
  }
  async function copy(text: string, url: string) {
    try { await navigator.clipboard.writeText(`${text}\n${url}`); flash("已复制文案和原网址"); } catch { flash("复制失败，请长按文字手动复制"); }
  }

  return (
    <Screen
      title="广告文案"
      onBack={back}
      right={<button type="button" aria-label="刷新" className="grid size-11 place-items-center text-muted" onClick={() => void load()}><RefreshCw className="size-5" /></button>}
      footer={
        <div className="px-4 py-3 pb-safe">
          <PrimaryButton disabled={busy || !data || !data.campaigns.some((c) => c.enabled)} onClick={() => void generate()}>
            {busy ? "正在生成…" : "按当前方向生成"}
          </PrimaryButton>
        </div>
      }
    >
      {err && <EmptyState title="暂时打不开" hint={err} />}
      {data && (
        <>
          <div className="px-4 pt-2">
            <p className="mb-1.5 text-[13px] text-muted">生意方向（每天 {data.schedule.hour}:00 自动生成{data.schedule.enabled ? "" : "，已关闭"}{data.schedule.lastRunDay ? ` · 上次 ${data.schedule.lastRunDay}` : ""}）</p>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2">
              {data.directions.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={cn("h-8 shrink-0 rounded-full px-3 text-[13px] font-semibold", d.id === data.activeDirectionId ? "bg-primary text-on-primary" : "bg-subtle")}
                  onClick={() => void adsSetActive(d.id).then((r) => apply(r, "已切换到「" + d.name + "」"))}
                  onContextMenu={(e) => { e.preventDefault(); if (!d.preset && window.confirm(`删除生意方向「${d.name}」？`)) void adsDeleteDirection(d.id).then((r) => apply(r, "已删除")); }}
                >
                  {d.name}
                </button>
              ))}
              <button type="button" aria-label="添加生意方向" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-subtle" onClick={() => { setDirName(""); setDirPrompt(""); setFormErr(""); setDirOpen(true); }}>
                <Plus className="size-4" />
              </button>
            </div>
          </div>
          <Seg value={tab} options={[{ id: "copies", label: `文案记录 ${data.copies.length}` }, { id: "campaigns", label: `推广项目 ${data.campaigns.length}` }]} onChange={setTab} />

          {tab === "copies" && (
            <div className="space-y-2.5 px-4 py-3">
              {data.copies.length === 0 && <EmptyState title="还没有文案" hint="先在「推广项目」里填好原网址和真实卖点，再点下面的按钮生成。" />}
              {data.copies.map((c) => (
                <div key={c.id} className="rounded-card bg-surface px-3.5 py-3 shadow-card">
                  <div className="flex items-center gap-1.5 text-[12px] text-muted">
                    <span className="truncate font-semibold text-fg">{sanitizeText(campName(c.campaignId))}</span>
                    <span>· {c.day}</span>
                    <Pill tone={c.source === "ai" ? "ok" : "muted"}>{c.source === "ai" ? "AI" : "本地模板"}</Pill>
                    {c.trigger === "schedule" && <Pill tone="muted">每日</Pill>}
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap text-[15px] leading-6">{sanitizeText(c.text)}</p>
                  <a href={c.url} target="_blank" rel="noreferrer noopener" className="mt-1 flex items-center gap-1 truncate text-[13px] text-primary"><ExternalLink className="size-3.5 shrink-0" /><span className="truncate">{c.url}</span></a>
                  <div className="mt-2 flex gap-2">
                    <button type="button" className="flex h-8 items-center gap-1 rounded-full bg-subtle px-3 text-[13px] font-semibold" onClick={() => void copy(c.text, c.url)}><Copy className="size-3.5" />复制</button>
                    <button type="button" disabled={busy} className="flex h-8 items-center gap-1 rounded-full bg-subtle px-3 text-[13px] font-semibold disabled:opacity-50" onClick={() => void generate(c.campaignId)}><RefreshCw className="size-3.5" />重新生成</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "campaigns" && (
            <div className="px-4 py-3">
              <button type="button" className="mb-2.5 flex h-10 w-full items-center justify-center gap-1 rounded-full bg-subtle text-[14px] font-semibold" onClick={() => { setFormErr(""); setDraft({ ...blank }); }}>
                <Plus className="size-4" />添加推广项目
              </button>
              {data.campaigns.length === 0 && <EmptyState title="还没有推广项目" hint="每个项目填一个广告原网址，文案会自动配上它。" />}
              <div className="overflow-hidden rounded-card bg-surface shadow-card">
                {data.campaigns.map((c: AdCampaign) => (
                  <button key={c.id} type="button" className="block w-full border-b border-line px-3.5 py-3 text-left last:border-b-0" onClick={() => { setFormErr(""); setDraft({ id: c.id, name: c.name, url: c.url, info: c.info, directionId: c.directionId, enabled: c.enabled }); }}>
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[15px] font-medium">{sanitizeText(c.name)}</span>
                      {!c.enabled && <Pill tone="muted">已停用</Pill>}
                      <span className="ml-auto shrink-0 text-[12px] text-muted">{dirName_(c.directionId)}</span>
                    </div>
                    <p className="truncate text-[12px] text-muted">{c.url}</p>
                    <p className="truncate text-[12px] text-muted">{c.fetchError ? `网页信息读取失败（${c.fetchError}）` : c.pageTitle ? `网页：${sanitizeText(c.pageTitle)}` : "网页信息未读取"}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <Sheet open={!!draft} title={draft?.id ? "编辑推广项目" : "添加推广项目"} onClose={() => setDraft(null)}>
        {draft && (
          <div className="nova-scroll max-h-[calc(70dvh-var(--nova-keyboard,0px))]">
            <Field label="项目名称"><input className={inputClass} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="例如 VEXO 社区" /></Field>
            <Field label="广告原网址（文案会配上它）"><input className={inputClass} inputMode="url" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="https://" /></Field>
            <Field label="真实卖点（AI 只会用这里和网页标题 / 简介里的信息）">
              <textarea className={cn(inputClass, "h-24 py-2")} value={draft.info} onChange={(e) => setDraft({ ...draft, info: e.target.value })} placeholder="写清楚产品是什么、有什么特点；不要写没把握的数字" />
            </Field>
            <Field label="生意方向">
              <select className={inputClass} value={draft.directionId ?? ""} onChange={(e) => setDraft({ ...draft, directionId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">跟随当前方向</option>
                {data?.directions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <label className="mb-3 flex items-center justify-between text-[15px]">每天自动生成<input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} className="size-5 accent-[var(--nova-primary,currentColor)]" /></label>
            {formErr && <p className="mb-2 text-sm text-danger">{formErr}</p>}
            <PrimaryButton disabled={busy || !draft.name.trim() || !draft.url.trim()} onClick={() => {
              setBusy(true);
              void adsSaveCampaign({ ...draft, refresh: true }).then((r) => { setBusy(false); if (r.ok) { setData(r.data); setDraft(null); flash("已保存"); } else setFormErr(r.error); });
            }}>{busy ? "正在保存并读取网页…" : "保存"}</PrimaryButton>
            {draft.id && (
              <div className="mt-2 flex gap-2 pb-2">
                <button type="button" disabled={busy} className="h-10 flex-1 rounded-full bg-subtle text-[14px] font-semibold" onClick={() => { const id = draft.id!; setDraft(null); void generate(id); }}>生成一条</button>
                <button type="button" className="flex h-10 flex-1 items-center justify-center gap-1 rounded-full nova-danger-soft text-[14px] font-semibold" onClick={() => { if (window.confirm("删除这个推广项目？已生成的文案会保留。")) { const id = draft.id!; setDraft(null); void adsDeleteCampaign(id).then((r) => apply(r, "已删除")); } }}><Trash2 className="size-4" />删除</button>
              </div>
            )}
          </div>
        )}
      </Sheet>

      <Sheet open={dirOpen} title="添加生意方向" onClose={() => setDirOpen(false)}>
        <Field label="名称（最多 20 字）"><input className={inputClass} value={dirName} onChange={(e) => setDirName(e.target.value)} placeholder="例如 山东特产" /></Field>
        <Field label="面向谁、什么语气（可选）"><input className={inputClass} value={dirPrompt} onChange={(e) => setDirPrompt(e.target.value)} placeholder="例如 面向在外的山东人，语气亲切" /></Field>
        {formErr && <p className="mb-2 text-sm text-danger">{formErr}</p>}
        <div className="pb-2"><PrimaryButton disabled={!dirName.trim()} onClick={() => void adsAddDirection(dirName, dirPrompt).then((r) => { if (r.ok) { setData(r.data); setDirOpen(false); flash("已添加，长按自定义方向可删除"); } else setFormErr(r.error); })}>添加</PrimaryButton></div>
      </Sheet>
    </Screen>
  );
}
