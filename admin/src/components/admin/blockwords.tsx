import { useEffect, useState } from "react";
import { useAdmin } from "@/lib/admin/store";
import { EmptyState, Field, inputClass, PrimaryButton, Screen, Sheet } from "./ui";

export function BlockwordsScreen() {
  const back = useAdmin((s) => s.back);
  const list = useAdmin((s) => s.blockwords);
  const refresh = useAdmin((s) => s.refreshBlockwords);
  const addBlockword = useAdmin((s) => s.addBlockword);
  const deleteBlockword = useAdmin((s) => s.deleteBlockword);
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <Screen
      title="屏蔽词"
      onBack={back}
      footer={
        <div className="border-t border-line bg-surface px-4 py-3 pb-safe">
          <button
            type="button"
            className="h-11 w-full rounded-full bg-primary font-semibold text-on-primary"
            onClick={() => {
              setWord("");
              setNote("");
              setError("");
              setOpen(true);
            }}
          >
            添加屏蔽词
          </button>
        </div>
      }
    >
      <p className="px-4 pt-2 text-[12px] leading-4 text-muted">
        这里管理的是平台规则，用户发帖或评论含这些词会被拦截。和个人阅读屏蔽是分开的。
      </p>
      {list.length === 0 && <EmptyState title="暂无平台屏蔽词" hint="添加后对新的发言生效。" />}
      <ul className="mt-2 bg-surface">
        {list.map((item) => (
          <li key={item.id} className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
            <div className="min-w-0">
              <div className="text-[15px] font-medium">{item.word}</div>
              {item.note ? <p className="text-[13px] text-muted">{item.note}</p> : null}
              <p className="text-[11px] text-muted">{item.createdAt}</p>
            </div>
            <button
              type="button"
              className="h-9 shrink-0 rounded-full nova-danger-soft px-3 text-[13px] font-semibold"
              onClick={() => void deleteBlockword(item.id)}
            >
              删除
            </button>
          </li>
        ))}
      </ul>
      <Sheet open={open} title="添加屏蔽词" onClose={() => setOpen(false)}>
        <Field label="词语（1–40 字）">
          <input className={inputClass} value={word} onChange={(e) => setWord(e.target.value)} placeholder="例如 广告" />
        </Field>
        <Field label="备注（可选）">
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="原因或来源" />
        </Field>
        {error && <p className="mb-2 text-sm text-danger">{error}</p>}
        <PrimaryButton
          disabled={busy || !word.trim()}
          onClick={() => {
            setBusy(true);
            void addBlockword(word, note).then((msg) => {
              setBusy(false);
              setError(msg ?? "");
              if (!msg) setOpen(false);
            });
          }}
        >
          {busy ? "正在添加…" : "添加"}
        </PrimaryButton>
      </Sheet>
    </Screen>
  );
}
