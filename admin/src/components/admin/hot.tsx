import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Search } from "lucide-react";
import { useAdmin } from "@/lib/admin/store";
import { sanitizeText } from "@/lib/admin/sanitize";
import { moveItem, type MappedContent, type MappedHotPost } from "@/lib/admin/backend";
import * as remote from "@/lib/admin/remote";
import { ConfirmSheet, DataHint, EmptyState, NotOpenYet, PendingApi, Pill, Screen, Sheet, inputClass } from "./ui";

type Feed = "loading" | "ok" | "missing" | "error";

function summary(item: { title: string; text: string }) {
  const t = sanitizeText(item.text || item.title).replace(/\s+/g, " ").trim();
  return t || "（这条帖子没有文字）";
}

/** 热门话题：管理员挑选出现在用户端首页“热门话题”栏的帖子，并调整顺序。 */
export function HotScreen() {
  const back = useAdmin((s) => s.back);
  const flash = useAdmin((s) => s.flash);
  const [feed, setFeed] = useState<Feed>("loading");
  const [items, setItems] = useState<MappedHotPost[]>([]);
  const [order, setOrder] = useState<MappedHotPost[] | null>(null);
  const [max, setMax] = useState(20);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<MappedHotPost | null>(null);
  const [busyRemove, setBusyRemove] = useState(false);

  const apply = useCallback((list: remote.HotList) => {
    setItems(list.items);
    if (list.max > 0) setMax(list.max);
    setOrder(null);
  }, []);

  const load = useCallback(async () => {
    const res = await remote.remoteHotPosts();
    if (!res.ok) {
      setFeed(res.missing ? "missing" : "error");
      return;
    }
    apply(res.data);
    setFeed("ok");
  }, [apply]);

  useEffect(() => {
    void load();
    const onRefresh = () => void load();
    window.addEventListener("nova-hot-refresh", onRefresh);
    return () => window.removeEventListener("nova-hot-refresh", onRefresh);
  }, [load]);

  const shown = order ?? items;
  const dirty = !!order && order.some((item, i) => item.postId !== items[i]?.postId);
  const full = items.length >= max;

  const move = (from: number, to: number) => setOrder(moveItem(shown, from, to));

  const saveOrder = async () => {
    if (!order) return;
    setSaving(true);
    const res = await remote.remoteSaveHotOrder(order.map((item) => item.postId));
    setSaving(false);
    if (res.ok) {
      apply(res.data);
      flash("顺序已保存");
      return;
    }
    if ("conflict" in res && res.conflict) {
      flash("列表已变化，已为你刷新");
      if (res.conflict.items.length) apply(res.conflict);
      else await load();
      return;
    }
    flash(res.missing ? "服务器暂未开放此功能" : res.error);
  };

  const remove = async () => {
    if (!removing) return;
    setBusyRemove(true);
    const res = await remote.remoteRemoveHotPost(removing.postId);
    setBusyRemove(false);
    setRemoving(null);
    if (!res.ok) {
      flash(res.missing ? "服务器暂未开放此功能" : res.error);
      return;
    }
    apply(res.data);
    flash(res.data.already ? "这条帖子已不在热门里" : "已移出热门");
  };

  const footer =
    feed !== "ok" ? undefined : dirty ? (
      <div className="flex gap-2 border-t border-line bg-surface px-4 py-3 pb-safe">
        <button type="button" className="h-11 flex-1 rounded-full bg-subtle font-semibold" onClick={() => setOrder(null)} disabled={saving}>
          还原
        </button>
        <button type="button" className="h-11 flex-[2] rounded-full bg-primary font-semibold text-on-primary disabled:opacity-50" onClick={() => void saveOrder()} disabled={saving}>
          {saving ? "正在保存…" : "保存顺序"}
        </button>
      </div>
    ) : (
      <div className="border-t border-line bg-surface px-4 py-3 pb-safe">
        <button
          type="button"
          className="h-11 w-full rounded-full bg-primary font-semibold text-on-primary disabled:opacity-50"
          disabled={full}
          onClick={() => setAdding(true)}
        >
          {full ? `最多 ${max} 条，请先移出一些` : "添加帖子"}
        </button>
      </div>
    );

  return (
    <Screen title="热门话题" onBack={back} footer={footer}>
      {feed === "missing" ? (
        <NotOpenYet what="热门话题" />
      ) : feed === "error" ? (
        <PendingApi />
      ) : feed === "loading" ? (
        <p className="px-4 py-10 text-center text-[15px] text-muted">正在读取…</p>
      ) : (
        <>
          <DataHint>这里的帖子会按顺序出现在用户首页的“热门话题”栏。共 {items.length}/{max} 条。</DataHint>
          {dirty && <p className="px-4 pb-2 text-[13px] text-primary">顺序已调整，记得点下方“保存顺序”。</p>}
          {shown.length === 0 && <EmptyState title="还没有热门帖子" hint="点下方“添加帖子”，从最近的动态里挑选。" />}
          <ol className="mx-4 overflow-hidden rounded-card bg-surface shadow-card">
            {shown.map((item, i) => (
              <li key={item.postId} className="flex items-start gap-2.5 border-b border-line px-3 py-3 last:border-b-0">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-subtle text-[12px] font-semibold tabular-nums">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className={`line-clamp-2 text-[15px] leading-5 ${item.available ? "" : "text-muted line-through"}`}>{summary(item)}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
                    {!item.available && <Pill tone="danger">已失效</Pill>}
                    <span>{sanitizeText(item.authorName) || "未知作者"}</span>
                    {item.postTime && <span>· {item.postTime}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    aria-label="上移"
                    className="grid size-9 place-items-center rounded-full bg-subtle disabled:opacity-30"
                    disabled={i === 0 || saving}
                    onClick={() => move(i, i - 1)}
                  >
                    <ArrowUp className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="下移"
                    className="grid size-9 place-items-center rounded-full bg-subtle disabled:opacity-30"
                    disabled={i === shown.length - 1 || saving}
                    onClick={() => move(i, i + 1)}
                  >
                    <ArrowDown className="size-4" />
                  </button>
                  <button
                    type="button"
                    className="h-9 rounded-full nova-danger-soft px-2.5 text-[13px] font-semibold disabled:opacity-40"
                    disabled={dirty}
                    onClick={() => setRemoving(item)}
                  >
                    移出
                  </button>
                </div>
              </li>
            ))}
          </ol>
          {dirty && <p className="px-4 pt-2 text-[12px] text-muted">调整顺序时不能移出或添加，请先保存或还原。</p>}
        </>
      )}

      <AddHotSheet
        open={adding}
        hotIds={items.map((item) => item.postId)}
        onClose={() => setAdding(false)}
        onAdded={(list) => {
          apply(list);
          if (list.items.length >= list.max) setAdding(false);
        }}
      />
      <ConfirmSheet
        open={!!removing}
        title="移出热门？"
        message={removing ? `“${summary(removing).slice(0, 40)}”将不再出现在首页热门话题里。帖子本身不会被删除。` : undefined}
        confirmText="移出"
        danger
        busy={busyRemove}
        onClose={() => setRemoving(null)}
        onConfirm={() => void remove()}
      />
    </Screen>
  );
}

function AddHotSheet({
  open,
  hotIds,
  onClose,
  onAdded,
}: {
  open: boolean;
  hotIds: string[];
  onClose: () => void;
  onAdded: (list: remote.HotList) => void;
}) {
  const flash = useAdmin((s) => s.flash);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<MappedContent[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [busyId, setBusyId] = useState("");
  const seq = useRef(0);

  const search = useCallback(async (keyword: string) => {
    const mine = ++seq.current;
    setState("loading");
    const res = await remote.remoteContent({ type: "post", status: "visible", q: keyword.trim() || undefined, limit: 30 });
    if (mine !== seq.current) return;
    if (!res.ok) {
      setState("error");
      return;
    }
    setRows(res.data.filter((item) => item.type === "post" && item.status !== "removed"));
    setState("ok");
  }, []);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => void search(q), q ? 350 : 0);
    return () => window.clearTimeout(t);
  }, [open, q, search]);

  const add = async (item: MappedContent) => {
    setBusyId(item.id);
    const res = await remote.remoteAddHotPost(item.id);
    setBusyId("");
    if (!res.ok) {
      flash(res.missing ? "服务器暂未开放此功能" : res.error);
      return;
    }
    onAdded(res.data);
    flash(res.data.already ? "这条帖子已在热门里" : "已加入热门");
  };

  return (
    <Sheet open={open} title="添加帖子" onClose={onClose}>
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input className={`${inputClass} pl-9`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索帖子内容" enterKeyHint="search" />
      </div>
      <p className="mb-1 text-[12px] text-muted">{q.trim() ? "搜索结果" : "最近动态"}</p>
      <div className="max-h-[55dvh] overflow-y-auto pb-2">
        {state === "loading" && rows.length === 0 && <p className="py-6 text-center text-[14px] text-muted">正在读取…</p>}
        {state === "error" && <p className="py-6 text-center text-[14px] text-muted">暂时读不到动态，请稍后再试</p>}
        {state === "ok" && rows.length === 0 && <p className="py-6 text-center text-[14px] text-muted">{q.trim() ? "没有找到相关帖子" : "还没有动态"}</p>}
        {rows.map((item) => {
          const inHot = hotIds.includes(item.id);
          return (
            <div key={item.id} className="flex items-start gap-2 border-b border-line py-2.5 last:border-b-0">
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-[15px] leading-5">{summary(item)}</p>
                <p className="mt-0.5 text-[12px] text-muted">{sanitizeText(item.authorName)} · {item.time}</p>
              </div>
              {inHot ? (
                <Pill tone="ok">已在热门</Pill>
              ) : (
                <button
                  type="button"
                  className="h-8 shrink-0 rounded-full bg-primary px-3 text-[13px] font-semibold text-on-primary disabled:opacity-50"
                  disabled={!!busyId}
                  onClick={() => void add(item)}
                >
                  {busyId === item.id ? "…" : "加入"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}
