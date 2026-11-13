import { useState } from "react";
import { useAdmin } from "@/lib/admin/store";
import { Field, inputClass, PrimaryButton } from "./ui";
import { builtInApiBase, DEFAULT_API_BASE, type EndpointMap } from "@/lib/admin/backend";

export function ServerPanel({ onDone }: { onDone?: () => void }) {
  const connection = useAdmin((s) => s.connection);
  const connectServer = useAdmin((s) => s.connectServer);
  const builtIn = builtInApiBase() || DEFAULT_API_BASE;
  const [base, setBase] = useState(connection.baseUrl || builtIn);
  const [advanced, setAdvanced] = useState(false);
  const [mapText, setMapText] = useState("{}");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function connect() {
    setBusy(true);
    setMsg("");
    let endpoints: Partial<EndpointMap> = {};
    if (advanced) {
      try {
        const parsed = JSON.parse(mapText || "{}");
        if (parsed && typeof parsed === "object") endpoints = parsed;
        else throw new Error("不是对象");
      } catch {
        setBusy(false);
        setMsg("路径格式不对，请检查后再试");
        return;
      }
    }
    const status = await connectServer(base, endpoints);
    setMsg(status.message);
    setBusy(false);
    if (status.reachable && onDone) {
      /* keep panel open so the user can read the result */
    }
  }

  const tone =
    connection.mode === "live" ? "text-ok" : connection.mode === "degraded" ? "text-warn" : "text-muted";

  return (
    <div>
      <p className="mb-3 text-[13px] leading-5 text-muted">
        应用已预填服务器地址，一般不用改。只有要换服务器时才改这里。留空再保存会回到默认地址。
      </p>
      <Field label="接口根地址">
        <input
          className={inputClass}
          value={base}
          onChange={(e) => setBase(e.target.value)}
          placeholder={builtIn}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="url"
        />
      </Field>
      <p className={`mb-3 text-[13px] leading-5 ${tone}`}>{msg || connection.message}</p>
      {connection.detectedVersion && <p className="mb-3 text-[12px] text-muted">检测到：{connection.detectedVersion}</p>}
      {Object.keys(connection.available).length > 0 && (
        <p className="mb-3 text-[12px] text-muted">
          可用接口：
          {Object.entries(connection.available)
            .map(([k, v]) => `${k}→${v}`)
            .join("，")}
        </p>
      )}
      <button type="button" className="mb-3 h-11 text-[13px] text-primary" onClick={() => setAdvanced((v) => !v)}>
        {advanced ? "收起自定义路径" : "高级：自定义路径"}
      </button>
      {advanced && (
        <Field label="自定义路径（可选）">
          <textarea
            className={`${inputClass} h-28 py-2 font-mono text-[12px]`}
            value={mapText}
            onChange={(e) => setMapText(e.target.value)}
            placeholder='{"adminUsers":"/api/v2/admin/users"}'
          />
        </Field>
      )}
      <PrimaryButton onClick={connect} disabled={busy}>
        {busy ? "正在检测…" : "检测并连接"}
      </PrimaryButton>
    </div>
  );
}

export function ConnectionBadge() {
  const connection = useAdmin((s) => s.connection);
  const needLogin =
    connection.reachable &&
    connection.mode !== "live" &&
    Object.keys(connection.authRequired || {}).some((k) => k.startsWith("admin"));
  const label = connection.mode === "live"
      ? "已连接"
      : needLogin
        ? "请先登录"
        : connection.mode === "degraded"
          ? "部分功能暂不可用"
          : "未连接";
  const cls = connection.mode === "live"
      ? "nova-ok-soft"
      : connection.mode === "degraded"
        ? "nova-warn-soft"
        : "nova-soft";
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{label}</span>;
}
