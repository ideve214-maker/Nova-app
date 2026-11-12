import { useState } from "react";
import { useAdmin } from "@/lib/admin/store";
import { Field, inputClass, PrimaryButton } from "./ui";
import { type EndpointMap } from "@/lib/admin/backend";

export function ServerPanel({ onDone }: { onDone?: () => void }) {
  const connection = useAdmin((s) => s.connection);
  const connectServer = useAdmin((s) => s.connectServer);
  const [base, setBase] = useState(connection.baseUrl || "");
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
        setMsg("路径对照表需要是 JSON 对象，例如 {\"adminUsers\":\"/api/v2/users\"}");
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
      <p className="mb-3 text-sm text-muted">
        填写用户端后端地址（例如 <code className="text-xs">http://192.168.1.8:8787</code>
        ）。在预览链接里可以留空，表示与当前页面同源。连不上时自动使用演示数据，不会卡住页面。
      </p>
      <Field label="接口根地址">
        <input
          className={inputClass}
          value={base}
          onChange={(e) => setBase(e.target.value)}
          placeholder="留空 = 当前网站（或演示）"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="url"
        />
      </Field>
      <p className={`mb-3 text-sm ${tone}`}>{msg || connection.message}</p>
      {connection.detectedVersion && (
        <p className="mb-3 text-xs text-muted">检测到：{connection.detectedVersion}</p>
      )}
      {Object.keys(connection.available).length > 0 && (
        <p className="mb-3 text-xs text-muted">
          可用接口：{Object.entries(connection.available).map(([k, v]) => `${k}→${v}`).join("，")}
        </p>
      )}
      <button type="button" className="mb-3 text-sm text-primary" onClick={() => setAdvanced((v) => !v)}>
        {advanced ? "收起路径对照表" : "高级：自定义接口路径（适配未来版本）"}
      </button>
      {advanced && (
        <Field label="路径对照（JSON，只填要覆盖的项）">
          <textarea
            className={`${inputClass} h-28 py-2 font-mono text-xs`}
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
  const label = connection.mode === "live" ? "已连接后端" : connection.mode === "degraded" ? "后端已通 · 演示数据" : "演示模式";
  const cls =
    connection.mode === "live" ? "nova-ok-soft" : connection.mode === "degraded" ? "nova-warn-soft" : "nova-soft";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>;
}
