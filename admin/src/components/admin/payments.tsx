import { useEffect, useState } from "react";
import { paymentStatusLabel, VIP_PRICES, type MappedPayment, type PaymentStatus } from "@/lib/admin/backend";
import { useAdmin } from "@/lib/admin/store";
import { Field, inputClass, PendingApi, Pill, PrimaryButton, Screen, Seg, Sheet } from "./ui";

const TABS: { id: string; label: string }[] = [
  { id: "awaiting_review", label: "待审核" },
  { id: "all", label: "全部" },
  { id: "paid", label: "已开通" },
  { id: "rejected", label: "已拒绝" },
  { id: "refunded", label: "已退款" },
];

function toneOf(status: PaymentStatus | string): "ok" | "warn" | "danger" | "muted" | "vip" {
  if (status === "awaiting_review") return "warn";
  if (status === "paid") return "ok";
  if (status === "rejected" || status === "expired") return "danger";
  if (status === "refunded") return "muted";
  return "muted";
}

export function PaymentsScreen() {
  const back = useAdmin((s) => s.back);
  const payments = useAdmin((s) => s.payments);
  const refreshPayments = useAdmin((s) => s.refreshPayments);
  const confirmPayment = useAdmin((s) => s.confirmPayment);
  const rejectPayment = useAdmin((s) => s.rejectPayment);
  const refundPayment = useAdmin((s) => s.refundPayment);
  const fetchReceiptUrl = useAdmin((s) => s.fetchReceiptUrl);
  const hasApi = useAdmin((s) => !!s.connection.available.adminPayments || s.authed);
  const [tab, setTab] = useState("awaiting_review");
  const [current, setCurrent] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<{ url: string; mime: string } | null>(null);
  const [receiptErr, setReceiptErr] = useState("");

  useEffect(() => {
    void refreshPayments({ status: tab === "all" ? undefined : tab });
  }, [tab, refreshPayments]);

  useEffect(() => {
    return () => {
      if (receipt?.url) URL.revokeObjectURL(receipt.url);
    };
  }, [receipt]);

  const list = tab === "all" ? payments : payments.filter((p) => p.status === tab);
  const active = payments.find((p) => p.id === current) || null;
  const reviewCount = payments.filter((p) => p.status === "awaiting_review").length;

  async function openDetail(p: MappedPayment) {
    setCurrent(p.id);
    setError("");
    setRejectOpen(false);
    setRefundOpen(false);
    setReason("");
    if (receipt?.url) URL.revokeObjectURL(receipt.url);
    setReceipt(null);
    setReceiptErr("");
    if (p.hasReceipt) {
      const got = await fetchReceiptUrl(p.id);
      if ("url" in got) setReceipt(got);
      else setReceiptErr(got.error);
    }
  }

  return (
    <Screen title="付款审核" onBack={back}>
      <p className="px-4 pt-2 text-[12px] leading-4 text-muted">
        用户扫个人微信 / 支付宝收款码转账，备注订单码（NV + 6 位）。月卡 {VIP_PRICES[0].label}（{VIP_PRICES[0].days} 天），年卡{" "}
        {VIP_PRICES[1].label}（{VIP_PRICES[1].days} 天）。确认后开通或续期 VIP。
      </p>
      <Seg
        value={tab}
        options={TABS.map((t) => ({
          id: t.id,
          label: t.id === "awaiting_review" && reviewCount > 0 ? `${t.label} (${reviewCount})` : t.label,
        }))}
        onChange={setTab}
      />
      <div className="space-y-2.5 p-4">
        {list.length === 0 &&
          (hasApi ? (
            <p className="py-10 text-center text-[15px] text-muted">{tab === "awaiting_review" ? "没有待审核的付款" : "这个分类里没有订单"}</p>
          ) : (
            <PendingApi name="付款列表（GET /api/admin/payments）" />
          ))}
        {list.map((p) => (
          <button
            key={p.id}
            type="button"
            className="block w-full rounded-card bg-surface p-3 text-left shadow-card"
            onClick={() => void openDetail(p)}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[15px] font-semibold tracking-wide">{p.code || p.id}</span>
                  {p.hasReceipt && <Pill tone="vip">有截图</Pill>}
                </div>
                <p className="mt-0.5 text-[13px] text-muted">
                  {p.userName || "用户 " + p.userId} · {p.methodName || p.method} · {p.amountLabel || p.period}
                </p>
                <p className="text-[12px] text-muted">{p.createdAt}</p>
              </div>
              <Pill tone={toneOf(p.status)}>{paymentStatusLabel(p.status)}</Pill>
            </div>
          </button>
        ))}
      </div>

      <Sheet open={!!active} title="付款详情" onClose={() => setCurrent(null)}>
        {active && (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[17px] font-semibold tracking-wide">{active.code}</span>
              <Pill tone={toneOf(active.status)}>{paymentStatusLabel(active.status)}</Pill>
            </div>
            <Row k="用户" v={`${active.userName || active.userId}${active.userEmail ? " · " + active.userEmail : ""}`} />
            <Row k="方式" v={active.methodName || active.method} />
            <Row k="套餐" v={`${active.amountLabel} · ${active.days} 天（${active.period === "year" ? "年卡" : "月卡"}）`} />
            <Row k="下单" v={active.createdAt} />
            {active.paidAt && <Row k="确认" v={active.paidAt} />}
            {active.rejectReason && <Row k="原因" v={active.rejectReason} />}
            {active.expiresAt && active.status === "pending" && <Row k="过期" v={active.expiresAt} />}

            <div className="mt-3">
              <p className="mb-1.5 text-[13px] text-muted">付款截图</p>
              {receipt ? (
                <img src={receipt.url} alt="付款截图" className="max-h-64 w-full rounded-xl object-contain bg-subtle" />
              ) : receiptErr ? (
                <p className="text-[13px] text-danger">{receiptErr}</p>
              ) : active.hasReceipt ? (
                <p className="text-[13px] text-muted">正在加载截图…</p>
              ) : (
                <p className="text-[13px] text-muted">用户未上传截图</p>
              )}
            </div>

            {error && <p className="mt-3 text-[13px] text-danger">{error}</p>}

            {active.status === "awaiting_review" && !rejectOpen && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={busy}
                  className="h-11 rounded-full nova-ok-soft text-[15px] font-semibold disabled:opacity-50"
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    const msg = await confirmPayment(active.id);
                    setBusy(false);
                    if (msg) setError(msg);
                    else setCurrent(null);
                  }}
                >
                  {busy ? "…" : "确认开通 VIP"}
                </button>
                <button
                  type="button"
                  className="h-11 rounded-full nova-danger-soft text-[15px] font-semibold"
                  onClick={() => {
                    setReason("");
                    setRejectOpen(true);
                    setError("");
                  }}
                >
                  拒绝
                </button>
              </div>
            )}
            {active.status === "pending" && (
              <p className="mt-3 text-[12px] text-muted">用户尚未点「我已付款」，此时不能确认开通。</p>
            )}
            {active.status === "paid" && !refundOpen && (
              <button
                type="button"
                className="mt-3 h-11 w-full rounded-full bg-subtle text-[15px] font-semibold"
                onClick={() => {
                  setReason("");
                  setRefundOpen(true);
                  setError("");
                }}
              >
                退款并撤销 VIP
              </button>
            )}

            {rejectOpen && (
              <div className="mt-3">
                <Field label="拒绝原因（必填）">
                  <textarea
                    className="min-h-20 w-full rounded-2xl border border-line bg-subtle px-3 py-2 text-[16px] outline-none"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="例如 金额不符、备注不是本订单码"
                  />
                </Field>
                <PrimaryButton
                  disabled={busy || !reason.trim()}
                  onClick={async () => {
                    if (!reason.trim()) {
                      setError("请填写拒绝原因");
                      return;
                    }
                    setBusy(true);
                    const msg = await rejectPayment(active.id, reason);
                    setBusy(false);
                    if (msg) setError(msg);
                    else {
                      setRejectOpen(false);
                      setCurrent(null);
                    }
                  }}
                >
                  确认拒绝
                </PrimaryButton>
              </div>
            )}

            {refundOpen && (
              <div className="mt-3">
                <p className="mb-2 text-[13px] leading-5 text-muted">
                  将订单标为已退款，并撤销该订单开通的 VIP。
                </p>
                <Field label="备注（可选）">
                  <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="退款说明" />
                </Field>
                <PrimaryButton
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    const msg = await refundPayment(active.id, reason);
                    setBusy(false);
                    if (msg) setError(msg);
                    else {
                      setRefundOpen(false);
                      setCurrent(null);
                    }
                  }}
                >
                  确认退款
                </PrimaryButton>
              </div>
            )}
          </div>
        )}
      </Sheet>
    </Screen>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-start gap-3 border-b border-line py-2">
      <span className="w-14 shrink-0 text-[13px] text-muted">{k}</span>
      <span className="min-w-0 flex-1 text-[13px]">{v}</span>
    </div>
  );
}
