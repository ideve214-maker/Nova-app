import { useEffect, useState } from "react";
import { useAdmin } from "@/lib/admin/store";
import { sanitizeText } from "@/lib/admin/sanitize";
import type { MappedAppeal, MappedSecurityEvent } from "@/lib/admin/backend";
import { EmptyState, Field, inputClass, PendingApi, Pill, PrimaryButton, Screen, Seg, Sheet } from "./ui";

const eventKindLabel: Record<string, string> = {
  rate_limit: "限流",
  high_frequency: "高频请求",
  anomaly: "异常",
};

const severityTone = (s: string): "ok" | "warn" | "danger" | "muted" => {
  if (s === "info") return "ok";
  if (s === "warn" || s === "warning") return "warn";
  if (s === "error" || s === "critical") return "danger";
  return "muted";
};

export function EventsScreen() {
  const back = useAdmin((s) => s.back);
  const list = useAdmin((s) => s.securityEvents);
  const refresh = useAdmin((s) => s.refreshSecurityEvents);
  const hasApi = useAdmin((s) => !!s.connection.available.adminSecurityEvents);
  const [kind, setKind] = useState("all");
  useEffect(() => {
    void refresh({ kind: kind === "all" ? undefined : kind });
  }, [refresh, kind]);

  return (
    <Screen title="安全事件" onBack={back}>
      <p className="px-4 pt-2 text-[12px] leading-4 text-muted">这里是限流和异常记录。</p>
      <Seg
        value={kind}
        options={[
          { id: "all", label: "全部" },
          { id: "rate_limit", label: "限流" },
          { id: "high_frequency", label: "高频" },
        ]}
        onChange={setKind}
      />
      {!hasApi && list.length === 0 ? (
        <PendingApi />
      ) : list.length === 0 ? (
        <EmptyState title="暂无安全事件" hint="触发限流或异常时会出现在这里。" />
      ) : (
        <ul className="bg-surface">
          {list.map((item) => (
            <EventRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </Screen>
  );
}

function EventRow({ item }: { item: MappedSecurityEvent }) {
  return (
    <li className="border-b border-line px-4 py-3">
      <div className="flex items-center gap-2">
        <Pill tone={severityTone(item.severity)}>{item.severity}</Pill>
        <span className="text-[15px] font-medium">{eventKindLabel[item.kind] || item.kind}</span>
      </div>
      <p className="mt-0.5 truncate text-[13px] text-muted">{item.path || "—"}</p>
      <p className="text-[11px] text-muted">
        {item.time}
        {item.ip ? ` · IP ${item.ip}` : ""}
        {item.actorId ? ` · ${item.actorId}` : ""}
      </p>
      {item.detail ? <p className="mt-0.5 break-all text-[11px] text-muted">{sanitizeText(item.detail)}</p> : null}
    </li>
  );
}

const appealStatusLabel: Record<string, string> = {
  pending: "待处理",
  accepted: "已通过",
  rejected: "已驳回",
};

const appealKindLabel: Record<string, string> = {
  ban: "封禁申诉",
  other: "其他",
};

export function AppealsScreen() {
  const back = useAdmin((s) => s.back);
  const list = useAdmin((s) => s.appeals);
  const refresh = useAdmin((s) => s.refreshAppeals);
  const decideAppeal = useAdmin((s) => s.decideAppeal);
  const hasApi = useAdmin((s) => !!s.connection.available.adminAppeals);
  const [tab, setTab] = useState("pending");
  const [current, setCurrent] = useState<MappedAppeal | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void refresh({ status: tab });
  }, [refresh, tab]);

  function close() {
    setCurrent(null);
    setNote("");
    setError("");
    setBusy(false);
  }

  function decide(action: "accept" | "reject") {
    if (!current || busy) return;
    const reason = note.trim();
    if (action === "reject" && !reason) {
      setError("驳回需要填写原因");
      return;
    }
    setBusy(true);
    void decideAppeal(current.id, action, reason || undefined).then((msg) => {
      setBusy(false);
      setError(msg ?? "");
      if (!msg) close();
    });
  }

  return (
    <Screen title="申诉处理" onBack={back}>
      <p className="px-4 pt-2 text-[12px] leading-4 text-muted">
        用户提交的账号申诉。通过封禁申诉后，该用户会自动解除封禁。
      </p>
      <Seg
        value={tab}
        options={[
          { id: "pending", label: "待处理" },
          { id: "accepted", label: "已通过" },
          { id: "rejected", label: "已驳回" },
          { id: "all", label: "全部" },
        ]}
        onChange={setTab}
      />
      {!hasApi && list.length === 0 ? (
        <PendingApi />
      ) : list.length === 0 ? (
        <EmptyState title="暂无申诉" hint="用户提交申诉后会出现在这里。" />
      ) : (
        <ul className="bg-surface">
          {list.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="flex w-full flex-col items-start border-b border-line px-4 py-3 text-left"
                onClick={() => {
                  setCurrent(item);
                  setNote(item.decisionNote || "");
                  setError("");
                }}
              >
                <div className="flex w-full items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{appealKindLabel[item.kind] || item.kind}</span>
                  <Pill tone={item.status === "accepted" ? "ok" : item.status === "rejected" ? "danger" : "warn"}>
                    {appealStatusLabel[item.status] || item.status}
                  </Pill>
                </div>
                <p className="mt-0.5 line-clamp-2 text-[13px] text-muted">{sanitizeText(item.body)}</p>
                <p className="text-[11px] text-muted">
                  {item.createdAt}
                  {item.userId ? ` · 用户 ${item.userId}` : ""}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Sheet open={!!current} title="处理申诉" onClose={close}>
        {current && (
          <>
            <p className="text-[15px] font-medium">{appealKindLabel[current.kind] || current.kind}</p>
            <p className="mt-1 whitespace-pre-wrap text-[14px]">{sanitizeText(current.body)}</p>
            <p className="mt-1 text-[12px] text-muted">
              用户 {current.userId || "—"} · {current.createdAt}
              {current.related ? ` · 关联 ${current.related}` : ""}
            </p>
            {current.status !== "pending" && (
              <p className="mt-2 text-[13px] text-muted">
                {appealStatusLabel[current.status] || current.status}
                {current.decidedAt ? ` · ${current.decidedAt}` : ""}
                {current.decisionNote ? ` · ${current.decisionNote}` : ""}
              </p>
            )}
            {current.status === "pending" && (
              <>
                <Field label="处理说明">
                  <textarea className={`${inputClass} min-h-20 py-2`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="通过为可选，驳回请写原因" />
                </Field>
                {error && <p className="mb-2 text-sm text-danger">{error}</p>}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    className="h-11 rounded-full bg-surface font-semibold text-danger shadow-card disabled:opacity-60"
                    onClick={() => decide("reject")}
                  >
                    驳回
                  </button>
                  <PrimaryButton disabled={busy} onClick={() => decide("accept")}>
                    {busy ? "处理中…" : "通过"}
                  </PrimaryButton>
                </div>
              </>
            )}
          </>
        )}
      </Sheet>
    </Screen>
  );
}
