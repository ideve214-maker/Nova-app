import { useCallback, useEffect, useRef, useState } from "react";
import { useAdmin } from "@/lib/admin/store";
import { Card, mk, Toggle } from "./marketing";
import { Pill, PrimaryButton, Seg } from "./ui";

/* 管理端 2.0.8：外部导入帖（V2EX / HN）AI 审查。
   - 开关：导入时正文和评论都先交给 AI，不合格的不入库。
   - 补审：已经发布的外部帖（含评论）重新过一遍 AI，不合格的帖子隐藏、评论删除，导入任务不会再写回。
   接口见 docs：GET/POST /api/admin/ai-moderation/import、POST .../import/backfill、POST .../import/backfill/stop（服务端 2.1.0）。 */

export type ImportReviewSettings = {
  enabled: boolean;
  reviewComments: boolean;
  /** AI 不可用（没配密钥、限速、超时）时：skip = 本轮先不入库，下轮再审；keyword = 只过屏蔽词就入库 */
  onAiDown: "skip" | "keyword";
};
export type BackfillJob = {
  id: string;
  status: "running" | "done" | "stopped" | "failed";
  scope: "all" | "v2ex" | "hn";
  total: number;
  done: number;
  passedPosts: number;
  hiddenPosts: number;
  removedComments: number;
  skipped: number;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
};
export type ImportReviewStats = {
  /** 已发布、还没经过 AI 审查的外部帖 / 评论数 */
  unreviewedPosts: number;
  unreviewedComments: number;
  /** 今天导入时被拒（不入库）的帖子 / 评论数 */
  rejectedPostsToday: number;
  rejectedCommentsToday: number;
  passedPostsToday: number;
};
type ImportReviewRes = { settings: ImportReviewSettings; stats: ImportReviewStats; job: BackfillJob | null };

const SCOPES = [
  { id: "all", label: "全部来源" },
  { id: "v2ex", label: "V2EX" },
  { id: "hn", label: "HN" },
];
const JOB_TXT: Record<BackfillJob["status"], { t: string; tone: "ok" | "warn" | "danger" | "muted" }> = {
  running: { t: "补审中", tone: "warn" },
  done: { t: "已完成", tone: "ok" },
  stopped: { t: "已停止", tone: "muted" },
  failed: { t: "失败", tone: "danger" },
};

export function ImportReviewCard({ aiReady, onChanged }: { aiReady: boolean; onChanged?: () => void }) {
  const flash = useAdmin((s) => s.flash);
  const [data, setData] = useState<ImportReviewRes | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [err, setErr] = useState("");
  const [scope, setScope] = useState("all");
  const [busy, setBusy] = useState(false);
  const wasRunning = useRef(false);

  const load = useCallback(async () => {
    const r = await mk<ImportReviewRes>("adminAiImportReview");
    if (!r.ok) {
      if (r.status === 404) { setUnsupported(true); setErr(""); return; }
      setErr(r.error);
      return;
    }
    setUnsupported(false); setErr(""); setData(r.data);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const running = data?.job?.status === "running";
  // 补审进行中每 3 秒刷新一次进度；结束时刷新一下审查记录
  useEffect(() => {
    if (running) { wasRunning.current = true; const t = setInterval(() => void load(), 3000); return () => clearInterval(t); }
    if (wasRunning.current) { wasRunning.current = false; onChanged?.(); }
    return undefined;
  }, [running, load, onChanged]);

  const save = async (patch: Partial<ImportReviewSettings>) => {
    const r = await mk<ImportReviewRes>("adminAiImportReview", { method: "POST", body: patch });
    if (!r.ok) { flash(r.error); return; }
    setData(r.data); flash("已保存");
  };
  const startBackfill = async () => {
    if (typeof window !== "undefined" && !window.confirm("对已发布的外部帖和评论重新做 AI 审查？不合格的帖子会被隐藏、评论会被删除。")) return;
    setBusy(true);
    const r = await mk<{ job: BackfillJob }>("adminAiImportBackfill", { method: "POST", body: { scope }, timeoutMs: 20000 });
    setBusy(false);
    if (!r.ok) { flash(r.error); return; }
    flash("已开始补审"); void load();
  };
  const stopBackfill = async () => {
    const r = await mk<{ job: BackfillJob }>("adminAiImportBackfillStop", { method: "POST" });
    if (!r.ok) { flash(r.error); return; }
    flash("已停止补审"); void load();
  };

  if (unsupported) {
    return (
      <Card>
        <div className="text-[15px] font-semibold">外部帖审查（V2EX / HN）</div>
        <p className="mt-1 text-[13px] leading-5 text-muted">服务器还不支持外部帖审查，升级到服务端 2.1.0 后这里会出现开关和「补审」按钮。</p>
      </Card>
    );
  }
  if (!data) return err ? <p className="px-4 pt-3 text-sm text-danger">{err}</p> : null;
  const { settings: st, stats, job } = data;
  const pct = job && job.total > 0 ? Math.min(100, Math.round((job.done / job.total) * 100)) : 0;
  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] font-semibold">外部帖审查（V2EX / HN）</div>
          <p className="text-[12px] text-muted">导入时正文和评论先交给 AI，不合格的不入库</p>
        </div>
        <Toggle on={st.enabled} label="外部帖审查开关" onChange={(v) => void save({ enabled: v })} />
      </div>
      {st.enabled && (
        <>
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-[13px]">评论也审查</span>
            <Toggle on={st.reviewComments} label="评论审查开关" onChange={(v) => void save({ reviewComments: v })} />
          </div>
          <div className="mt-3">
            <span className="mb-1 block text-[12px] text-muted">AI 不可用时</span>
            <Seg
              value={st.onAiDown}
              options={[{ id: "skip", label: "先不入库，下轮再审" }, { id: "keyword", label: "只过屏蔽词就入库" }]}
              onChange={(v) => void save({ onAiDown: v as ImportReviewSettings["onAiDown"] })}
            />
          </div>
        </>
      )}
      {!aiReady && st.enabled && (
        <p className="mt-2 text-[12px] leading-4 text-warn">AI 密钥还没配置，{st.onAiDown === "skip" ? "外部帖会全部暂停入库" : "外部帖只会过屏蔽词"}。</p>
      )}
      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[12px]">
        <Num n={stats.passedPostsToday} l="今日通过" />
        <Num n={stats.rejectedPostsToday} l="今日拒帖" />
        <Num n={stats.rejectedCommentsToday} l="今日拒评论" />
      </div>

      <div className="mt-4 border-t border-line pt-3">
        <div className="flex items-center justify-between">
          <span className="text-[15px] font-semibold">补审已发布的外部帖</span>
          {job && <Pill tone={JOB_TXT[job.status].tone}>{JOB_TXT[job.status].t}</Pill>}
        </div>
        <p className="mt-1 text-[12px] leading-4 text-muted">
          还有 {stats.unreviewedPosts} 条帖子、{stats.unreviewedComments} 条评论没审过。不合格的帖子会被隐藏、评论会被删除，之后导入也不会再写回来。
        </p>
        {job && (
          <div className="mt-2">
            <div className="h-2 overflow-hidden rounded-full bg-subtle">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: pct + "%" }} />
            </div>
            <p className="mt-1 text-[12px] text-muted">
              {job.done}/{job.total} · 通过 {job.passedPosts} · 隐藏帖子 {job.hiddenPosts} · 删除评论 {job.removedComments}
              {job.skipped ? ` · 跳过 ${job.skipped}（AI 不可用）` : ""}
            </p>
            {job.error && <p className="mt-1 break-all text-[12px] text-danger">{job.error}</p>}
          </div>
        )}
        {!running && (
          <div className="mt-2">
            <Seg value={scope} options={SCOPES} onChange={setScope} />
          </div>
        )}
        <div className="mt-2">
          {running ? (
            <button type="button" className="h-11 w-full rounded-full border border-danger/50 text-[15px] font-semibold text-danger" onClick={() => void stopBackfill()}>停止补审</button>
          ) : (
            <PrimaryButton disabled={busy || !aiReady || stats.unreviewedPosts + stats.unreviewedComments === 0} onClick={() => void startBackfill()}>
              {busy ? "正在开始…" : !aiReady ? "AI 未配置，无法补审" : stats.unreviewedPosts + stats.unreviewedComments === 0 ? "都已审过" : "开始补审"}
            </PrimaryButton>
          )}
        </div>
      </div>
    </Card>
  );
}
function Num({ n, l }: { n: number; l: string }) {
  return (
    <div className="rounded-xl bg-subtle px-2 py-2">
      <div className="text-[15px] font-semibold">{n}</div>
      <div className="text-[11px] text-muted">{l}</div>
    </div>
  );
}
