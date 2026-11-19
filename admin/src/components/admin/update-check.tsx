import { useState } from "react";
import { ChevronRight, RefreshCw } from "lucide-react";
import { CapacitorUpdater } from "@capgo/capacitor-updater";
import { hapticLight } from "@/lib/admin/native";
import {
  applyCheckedUpdate,
  checkLiveUpdate,
  getBuiltinAppVersion,
  type LiveUpdateFeedback,
} from "@/lib/admin/live-update";
import { PrimaryButton, RowLink, Sheet } from "./ui";

function titleFor(checking: boolean, result: LiveUpdateFeedback | null, applied: boolean): string {
  if (checking) return "正在检查…";
  if (applied) return "更新已下载";
  if (result?.status === "up_to_date") return "已是最新版本";
  if (result?.status === "available") return "发现新版本";
  if (result?.status === "error") return "检查更新";
  return "检查更新";
}

export function UpdateCheckRow() {
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const [result, setResult] = useState<LiveUpdateFeedback | null>(null);
  const version = getBuiltinAppVersion();

  async function startCheck() {
    void hapticLight();
    setOpen(true);
    setChecking(true);
    setApplied(false);
    setResult(null);
    try {
      setResult(await checkLiveUpdate(CapacitorUpdater));
    } finally {
      setChecking(false);
    }
  }

  async function apply() {
    if (!result || result.status !== "available") return;
    setBusy(true);
    const done = await applyCheckedUpdate(CapacitorUpdater, result.options);
    if (done.ok) setApplied(true);
    else setResult({ status: "error", message: done.message });
    setBusy(false);
  }

  return (
    <>
      <RowLink
        icon={<RefreshCw className="size-4" />}
        title="检查更新"
        desc={version ? `当前版本 ${version}` : "查看是否有新的管理端版本"}
        onClick={() => void startCheck()}
        extra={<ChevronRight className="size-4 text-muted" />}
      />
      <Sheet
        open={open}
        title={titleFor(checking, result, applied)}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
      >
        {checking && (
          <div className="flex flex-col items-center gap-3 py-6">
            <RefreshCw className="size-6 animate-spin text-primary" aria-hidden />
            <p className="text-[15px] text-muted">正在检查…</p>
          </div>
        )}
        {!checking && result?.status === "up_to_date" && (
          <>
            <p className="mb-3 text-[15px] leading-6">{result.message}</p>
            <PrimaryButton onClick={() => setOpen(false)}>知道了</PrimaryButton>
          </>
        )}
        {!checking && result?.status === "available" && !applied && (
          <>
            <p className="mb-3 text-[15px] leading-6">
              {result.message}
              {result.currentVersion ? `（当前 ${result.currentVersion}）` : ""}。下载后下次打开 App 生效。
            </p>
            <div className="flex gap-2 pb-2">
              <button
                type="button"
                className="h-11 flex-1 rounded-full bg-subtle text-[15px] font-semibold"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                稍后
              </button>
              <button
                type="button"
                disabled={busy}
                className="h-11 flex-1 rounded-full bg-primary text-[15px] font-semibold text-on-primary disabled:opacity-50"
                onClick={() => void apply()}
              >
                {busy ? "正在更新…" : "更新"}
              </button>
            </div>
          </>
        )}
        {!checking && applied && (
          <>
            <p className="mb-3 text-[15px] leading-6">新版本已下载，下次打开 App 后生效。</p>
            <PrimaryButton onClick={() => setOpen(false)}>知道了</PrimaryButton>
          </>
        )}
        {!checking && result?.status === "error" && (
          <>
            <p className="mb-3 text-[15px] leading-6 text-muted">{result.message}</p>
            <PrimaryButton onClick={() => setOpen(false)}>知道了</PrimaryButton>
          </>
        )}
      </Sheet>
    </>
  );
}
