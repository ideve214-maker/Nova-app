import { useCallback, useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { useAdmin } from "@/lib/admin/store";
import { autoAdsChips, checkPerRun, perRunPatch, readPerRun, stoppedText } from "@/lib/admin/auto-ads-count";
import { sanitizeText } from "@/lib/admin/sanitize";
import {
  autoAdsLog, autoAdsOverview, autoAdsRun, autoAdsSave, autoAdsTakedown, autoAdsTakedownAll,
  type AutoAd, type AutoAdsLogRow, type AutoAdsOverview,
} from "@/lib/admin/ai-api";
import { EmptyState, Field, inputClass, Pill, PrimaryButton, Seg, Sheet } from "./ui";
import { Card, textareaClass, Toggle } from "./marketing";
import { AiQuotaCard } from "./ai-quota";

/* 2.0.6 营销管理 → AI 发帖：AI 每天联网找商家 / 活动并自动发布营销帖（服务器默认关闭）。 */

const TRIGGER: Record<string, string> = { schedule: "每日自动", manual: "立即运行", assistant: "AI 助手" };
const ACTION: Record<string, string> = {
  "ai.autoads.run_start": "开始运行", "ai.autoads.run": "运行结束", "ai.autoads.searched": "联网搜索", "ai.autoads.published": "已发布",
  "ai.autoads.rejected": "已拦下", "ai.autoads.skipped": "跳过", "ai.autoads.stopped": "已停止", "ai.autoads.error": "出错",
  "admin.ai.autoads.settings": "修改设置", "admin.ai.autoads.switch_on": "打开自动发布", "admin.ai.autoads.switch_off": "关闭自动发布",
  "admin.ai.autoads.takedown": "下架", "admin.ai.autoads.takedown_all": "全部下架", "admin.ai.web_search": "联网搜索（助手）",
};
const SKIP: Record<string, string> = {
  env_off: "服务器还没开启自动发帖", switch_off: "自动发布开关是关着的", no_key: "还没有可用的 AI 接口或联网搜索（智谱）", running: "上一轮还在运行", quota_exhausted: "AI 额度用完了（智谱用完时联网搜索暂停），没有发帖",
  cap_reached: "今天的定时轮已发完", not_due: "还没到时间",
};
const REASON: Record<string, string> = {
  NO_SOURCE: "没有原网址", DUPLICATE: "原网址已发过", CAP: "本轮条数已满", BLOCKED: "命中屏蔽词", NOT_SUITABLE: "不适合推广",
  GEN_FAILED: "文案生成失败", EMPTY: "文案为空", INVALID: "内容不合规",
};
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
const fmt = (t: number | null | undefined) => {
  if (!t) return "";
  const d = new Date(t + 8 * 3600e3);
  return `${d.getUTCMonth() + 1}-${String(d.getUTCDate()).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};
/** 旧版的空格串（超过 3 个词）显示成每行一个方向，和服务器的拆分规则一致。 */
export const toLines = (q: string) => {
  const s = String(q || "");
  if (/[\n\r,，、;；]/.test(s)) return s.split(/[\n\r,，、;；]+/).map((x) => x.trim()).filter(Boolean).join("\n");
  const w = s.trim().split(/\s+/).filter(Boolean);
  return w.length > 3 ? w.join("\n") : s.trim();
};
function logLine(r: AutoAdsLogRow): string {
  const d = (r.detail || {}) as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof d.code === "string" && (REASON[d.code] || typeof d.error !== "string")) parts.push(REASON[d.code] || d.code);
  if (typeof d.reason === "string" && d.reason && !d.code) parts.push(SKIP[d.reason] || ((r.action === "ai.autoads.error" || r.action === "ai.autoads.run") ? "原因：" + d.reason : d.reason));
  if (typeof d.title === "string" && d.title) parts.push("「" + d.title + "」");
  if (typeof d.query === "string" && d.query) parts.push((r.action === "ai.autoads.searched" ? "方向：" : "关键词：") + d.query.replace(/\n/g, "、"));
  if (typeof d.published === "number") parts.push(`发布 ${d.published} 条，拦下 ${Number(d.rejected) || 0} 条`);
  if (typeof d.count === "number" && r.action !== "ai.autoads.run" && !(d.count === 0 && typeof d.error === "string")) parts.push(`${d.count} 条`);
  if (typeof d.error === "string" && d.error) parts.push(d.error);
  if (typeof d.sourceUrl === "string" && d.sourceUrl) parts.push(hostOf(d.sourceUrl));
  return parts.join(" · ");
}

export function AutoAdsTab() {
  const flash = useAdmin((s) => s.flash);
  const go = useAdmin((s) => s.go);
  const [data, setData] = useState<AutoAdsOverview | null>(null);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState<"all" | "live" | "down">("all");
  const [busy, setBusy] = useState(false);
  const [cap, setCap] = useState("");
  const [query, setQuery] = useState("");
  const [words, setWords] = useState("");
  const [logOpen, setLogOpen] = useState(false);
  const [log, setLog] = useState<AutoAdsLogRow[] | null>(null);
  const [logErr, setLogErr] = useState("");

  const fill = (d: AutoAdsOverview) => { setData(d); { const n = readPerRun(d.settings as unknown as Record<string, unknown>); setCap(n ? String(n) : ""); } setQuery(toLines(d.settings.query)); setWords(d.settings.blockwords.join("\n")); };
  const load = useCallback(async (f = filter) => {
    const r = await autoAdsOverview(f);
    if (r.ok) { fill(r.data); setErr(""); } else setErr(r.error);
  }, [filter]);
  useEffect(() => { void load(filter); }, [filter, load]);

  const save = async (patch: Parameters<typeof autoAdsSave>[0], msg = "已保存") => {
    const r = await autoAdsSave(patch);
    if (!r.ok) { flash(r.error); return; }
    fill({ ...r.data, ads: data?.ads || r.data.ads }); flash(msg); void load();
  };
  const run = async () => {
    setBusy(true);
    const r = await autoAdsRun();
    setBusy(false);
    if (!r.ok) { flash(r.error); return; }
    const x = r.data.result;
    flash(x.skipped ? "没有运行：" + (SKIP[x.skipped] || x.skipped) : x.stopped === "quota_exhausted" ? `AI 额度都用完了，这一轮已停止（已发布 ${x.published?.length || 0} 条）` : x.stopped && x.stopped !== "quota_exhausted" ? `已发布 ${x.published?.length || 0} 条，拦下 ${x.rejected || 0} 条；没发满：${stoppedText(x.stopped)}` : x.reason ? "没有发帖：" + x.reason : x.error ? (x.error === "search_failed" ? "联网搜索失败，请稍后再试" : x.error) : `已发布 ${x.published?.length || 0} 条，拦下 ${x.rejected || 0} 条`);
    void load();
  };
  const takedown = async (ad: AutoAd) => {
    if (typeof window !== "undefined" && !window.confirm(`下架「${ad.title || ad.advertiser || "这条营销帖"}」？下架后用户不再看到。`)) return;
    const r = await autoAdsTakedown(ad.id);
    if (!r.ok) flash(r.error); else { flash("已下架"); void load(); }
  };
  const takedownAll = async () => {
    if (typeof window !== "undefined" && !window.confirm("把 AI 发布的营销帖全部下架？")) return;
    const r = await autoAdsTakedownAll();
    if (!r.ok) flash(r.error); else { flash(`已下架 ${r.data.count} 条`); void load(); }
  };
  const openLog = async () => {
    setLogOpen(true); setLog(null); setLogErr("");
    const r = await autoAdsLog();
    if (r.ok) setLog(r.data.log); else setLogErr(r.error);
  };

  const st = data?.status;
  return (
    <div className="pb-6">
      {err && <EmptyState title="暂时打不开" hint={err} />}
      {data && st && (
        <>
          <AiQuotaCard className="mx-4 mt-3" onOpen={() => go("aiquota")} />
          <Card>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[15px] font-semibold">AI 自动发布营销帖</div>
                <p className="text-[12px] leading-4 text-muted">每天 {st.hour}:00 后联网找商家或活动，写好文案直接发到营销帖，不用人工确认</p>
              </div>
              <Toggle on={data.settings.enabled} label="自动发布开关" onChange={(v) => void save({ enabled: v }, v ? "已打开自动发布" : "已关闭自动发布")} />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {st.active ? <Pill tone="ok">运行中</Pill> : <Pill tone="muted">未运行</Pill>}
              {!st.envEnabled && <Pill tone="warn">服务器未开启</Pill>}
              {!st.configured && <Pill tone="warn">未配置 AI 接口或联网搜索</Pill>}
              {autoAdsChips(st, readPerRun(data.settings as unknown as Record<string, unknown>)).map((c) => <Pill key={c} tone="muted">{c}</Pill>)}
              {st.lastRunDay && <Pill tone="muted">上次 {st.lastRunDay}</Pill>}
            </div>
            {!st.envEnabled && <p className="mt-2 text-[12px] leading-4 text-muted">服务器默认关闭，需要在服务器上设置 ADMIN_AI_AUTO_ADS=1 才会运行；打开后每次运行会调用智谱联网搜索和生成（会产生费用）。</p>}
            <p className="mt-2 text-[12px] leading-4 text-muted">每条都附原网址；命中屏蔽词、没有原网址、重复的都会被拦下；{st.ttlDays ? `${st.ttlDays} 天后自动到期；` : ""}关掉开关立即停止。</p>
          </Card>
          <Card>
            <div className="grid grid-cols-[1fr_auto] items-end gap-2">
              <Field label={`每轮发布条数（1–${st.runMax || 100}）`}>
                <input className={inputClass} inputMode="numeric" value={cap} placeholder="例如 15" onChange={(e) => setCap(e.target.value.replace(/\D/g, ""))} />
              </Field>
              {/* 2.0.8：管理端不设上限，只要求正整数；runMax 只做软提示 */}
              <button type="button" className="mb-2.5 h-11 rounded-full bg-subtle px-4 text-[13px] font-semibold" onClick={() => { const c = checkPerRun(cap, st.runMax); if (!c.ok) { flash(c.error); return; } void save(perRunPatch(c.value)); }}>保存</button>
            </div>
            <p className="-mt-1 mb-2 text-[12px] leading-4 text-muted">每天 {st.hour}:00 定时发这么多条；每点一次「立即运行一轮」再加发这么多条，不受今天已发数量影响。</p>
            {!!st.capMax && (
              <p className="-mt-1 mb-2 text-[12px] leading-4 text-warn">服务器 .env 里设了 ADMIN_AI_AUTO_ADS_CAP_MAX = {st.capMax}，超过的数字可能被服务器拒绝。</p>
            )}
            <Field label="搜索方向（每行一个方向）">
              <textarea className={textareaClass} rows={5} value={query} maxLength={600} placeholder={"例如：\n济南 新店开业 优惠活动\n济南 知识培训\n科研教育 机构"} onChange={(e) => setQuery(e.target.value)} />
            </Field>
            <p className="-mt-1 mb-2 text-[12px] leading-4 text-muted">每个方向单独联网搜索一次（每轮最多 5 个，轮流搜），结果合并去重。不相关的方向不要写在同一行，否则容易一条都搜不到。</p>
            <Field label={`额外屏蔽词（每行一个；已内置 ${st.defaultBlockwords} 个高风险词和平台屏蔽词）`}>
              <textarea className={textareaClass} rows={3} value={words} placeholder={"例如：\n加盟\n代理"} onChange={(e) => setWords(e.target.value)} />
            </Field>
            <button type="button" className="h-10 w-full rounded-full bg-subtle text-[13px] font-semibold" onClick={() => void save({ query, blockwords: words })}>保存搜索方向和屏蔽词</button>
          </Card>
          <div className="mt-3 flex gap-2 px-4">
            <div className="flex-1"><PrimaryButton disabled={busy || !st.active} onClick={() => void run()}>{busy ? "正在运行…" : "立即运行一轮"}</PrimaryButton></div>
            <button type="button" className="h-12 rounded-full nova-danger-soft px-4 text-[14px] font-semibold" onClick={() => void takedownAll()}>全部下架</button>
          </div>
          <div className="mt-3 flex items-center justify-between px-4">
            <span className="text-[13px] text-muted">AI 发布的营销帖</span>
            <button type="button" className="h-9 px-1 text-[13px] font-semibold text-primary" onClick={() => void openLog()}>操作日志</button>
          </div>
          <div className="mt-1">
            <Seg value={filter} options={[{ id: "all", label: "全部" }, { id: "live", label: "投放中" }, { id: "down", label: "已下架" }]} onChange={(v) => setFilter(v as "all" | "live" | "down")} />
          </div>
          {data.ads.length === 0 && <EmptyState title="还没有 AI 发布的营销帖" hint={data.settings.enabled ? "到点后会自动发布，也可以点「立即运行一轮」。" : "打开上面的开关后，AI 每天会自动找广告并发布。"} />}
          <ul className="mt-3 space-y-3 px-4">
            {data.ads.map((ad) => (
              <li key={ad.id} className="rounded-card bg-surface p-3 shadow-card" data-testid="auto-ad">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Pill tone="vip">AI 发布</Pill>
                  {ad.trigger && <Pill tone="muted">{TRIGGER[ad.trigger] || ad.trigger}</Pill>}
                  {ad.live ? <Pill tone="ok">投放中</Pill> : <Pill tone="warn">{ad.takenDownAt ? "已下架" : "已停用 / 到期"}</Pill>}
                  <span className="ml-auto text-[11px] text-muted">{fmt(ad.createdAt)}</span>
                </div>
                {ad.advertiser && <div className="mt-2 text-[12px] text-muted">{sanitizeText(ad.advertiser)}</div>}
                {ad.title && <div className="text-[15px] font-semibold">{sanitizeText(ad.title)}</div>}
                {ad.text && <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[13px] text-muted">{sanitizeText(ad.text)}</p>}
                <a className="mt-2 flex min-h-9 items-center gap-1.5 break-all rounded-xl bg-subtle px-3 py-1.5 text-[12px] text-primary" href={ad.sourceUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="size-3.5 shrink-0" />
                  <span className="min-w-0 truncate">原网址：{sanitizeText(ad.sourceTitle || hostOf(ad.sourceUrl))} · {hostOf(ad.sourceUrl)}</span>
                </a>
                <div className="mt-2 flex items-center gap-3 text-[12px] text-muted">
                  <span>曝光 {ad.impressions}</span><span>点击 {ad.clicks}</span>
                  {ad.takenDownAt && <span>下架于 {fmt(ad.takenDownAt)}</span>}
                  {ad.live && <button type="button" className="ml-auto h-9 rounded-full nova-danger-soft px-4 text-[13px] font-semibold" onClick={() => void takedown(ad)}>下架</button>}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <Sheet open={logOpen} title="AI 发帖操作日志" onClose={() => setLogOpen(false)}>
        <div className="max-h-[calc(70dvh-var(--nova-keyboard,0px))] overflow-y-auto px-4 pb-6">
          {logErr && <p className="text-sm text-danger">{logErr}</p>}
          {!log && !logErr && <p className="py-6 text-center text-[13px] text-muted">加载中…</p>}
          {log && log.length === 0 && <EmptyState title="还没有记录" />}
          <ul className="divide-y divide-line">
            {(log || []).map((r) => (
              <li key={r.id} className="py-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-semibold">{ACTION[r.action] || r.action}</span>
                  <span className="ml-auto text-[11px] text-muted">{fmt(r.at)}{r.actorId ? ` · 管理员 ${r.actorId}` : " · 系统"}</span>
                </div>
                {logLine(r) && <p className="mt-0.5 break-all text-[12px] text-muted">{sanitizeText(logLine(r))}</p>}
              </li>
            ))}
          </ul>
        </div>
      </Sheet>
    </div>
  );
}
