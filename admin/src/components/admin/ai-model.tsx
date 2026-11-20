import { useCallback, useEffect, useState } from "react";
import { Cpu } from "lucide-react";
import { useAdmin } from "@/lib/admin/store";
import { aiModelGet, aiModelSave, DEFAULT_ZHIPU_MODEL, isValidModelCode, zhipuModelLabel, ZHIPU_MODELS, type AiModelSetting } from "@/lib/admin/ai-api";
import { sanitizeText } from "@/lib/admin/sanitize";
import { Card } from "./marketing";
import { Field, inputClass, PrimaryButton } from "./ui";

const CUSTOM = "__custom__";

/** 管理端 2.0.8：智谱 AI 模型选择。AI 审查、AI 发帖、AI 助手都用这里选的模型（服务端 2.1.0）。 */
export function AiModelCard() {
  const flash = useAdmin((s) => s.flash);
  const [cur, setCur] = useState<AiModelSetting | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [err, setErr] = useState("");
  const [pick, setPick] = useState(DEFAULT_ZHIPU_MODEL);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);

  const apply = (m: AiModelSetting) => {
    setCur(m);
    const model = m.model || DEFAULT_ZHIPU_MODEL;
    if (ZHIPU_MODELS.some((x) => x.id === model)) { setPick(model); setCustom(""); } else { setPick(CUSTOM); setCustom(model); }
  };
  const load = useCallback(async () => {
    const r = await aiModelGet();
    if (!r.ok) {
      if (r.status === 404) { setUnsupported(true); setErr(""); return; }
      setErr(r.error); return;
    }
    setUnsupported(false); setErr(""); apply(r.data);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const target = pick === CUSTOM ? custom.trim() : pick;
  const valid = isValidModelCode(target);
  const changed = !!cur && target !== (cur.model || DEFAULT_ZHIPU_MODEL);
  const save = async () => {
    if (!valid) return;
    setBusy(true);
    const r = await aiModelSave("zhipu", target);
    setBusy(false);
    if (!r.ok) { flash(r.error); return; }
    apply(r.data); flash("已切换到 " + zhipuModelLabel(r.data.model));
  };

  return (
    <Card>
      <div className="flex items-center gap-2">
        <Cpu className="size-4 text-primary" />
        <span className="text-[15px] font-semibold">AI 模型（智谱）</span>
        {cur && <span className="ml-auto truncate text-[12px] text-muted">当前：{sanitizeText(zhipuModelLabel(cur.model || DEFAULT_ZHIPU_MODEL))}</span>}
      </div>
      {unsupported ? (
        <p className="mt-1 text-[13px] leading-5 text-muted">服务器还不支持选择模型，升级到服务端 2.1.0 后这里可以切换 GLM-5.3-Flash 等模型。</p>
      ) : err ? (
        <p className="mt-1 text-[13px] text-danger">{err}</p>
      ) : cur ? (
        <>
          <p className="mt-1 text-[12px] leading-4 text-muted">AI 审查、外部帖审查、AI 发帖和 AI 助手都用这个模型。用资源包的模型先扣资源包，用完才扣现金。</p>
          <div className="mt-2">
            <Field label="模型">
              <select className={inputClass} value={pick} onChange={(e) => setPick(e.target.value)} data-testid="ai-model-select">
                {ZHIPU_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label} · {m.id}</option>)}
                <option value={CUSTOM}>自定义模型编码…</option>
              </select>
            </Field>
            {pick === CUSTOM && (
              <Field label="模型编码（照智谱文档填写，例如 glm-5.3-flash）">
                <input className={inputClass} value={custom} maxLength={80} autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="glm-…" onChange={(e) => setCustom(e.target.value)} data-testid="ai-model-custom" />
              </Field>
            )}
            {pick === CUSTOM && custom.trim() && !valid && <p className="mb-2 text-[12px] text-danger">模型编码只能包含字母、数字和 . _ : -</p>}
            <PrimaryButton disabled={busy || !valid || !changed} onClick={() => void save()}>{busy ? "正在保存…" : changed ? "保存并切换" : "已在使用"}</PrimaryButton>
          </div>
        </>
      ) : null}
    </Card>
  );
}
