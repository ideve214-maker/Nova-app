import { categoryText, CATEGORY_LABEL, POST_CATEGORIES, sourceOptions, type MetaFilter, type PostCategory } from "@/lib/admin/post-category";
import { sanitizeText } from "@/lib/admin/sanitize";
import { inputClass, Pill } from "./ui";

/** 帖子分类 + 外部来源小标签；都没有时什么也不显示。 */
export function MetaPills({ category, sourceLabel }: { category?: PostCategory | null; sourceLabel?: string }) {
  if (!category && !sourceLabel) return null;
  return (
    <>
      {category && <Pill tone="vip">{categoryText(category)}</Pill>}
      {sourceLabel && <Pill tone="muted">{sanitizeText(sourceLabel)}</Pill>}
    </>
  );
}

/** 分类 / 来源筛选（两个下拉框）。 */
export function MetaFilterBar({ value, onChange, loaded, note }: { value: MetaFilter; onChange: (f: MetaFilter) => void; loaded: { source?: string }[]; note?: string }) {
  const sel = inputClass + " h-9 text-[14px]";
  return (
    <div className="bg-surface px-4 pb-2" data-testid="meta-filter">
      <div className="flex gap-2">
        <select className={sel} value={value.category} aria-label="分类" onChange={(e) => onChange({ ...value, category: e.target.value })}>
          <option value="">全部分类</option>
          {POST_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          <option value="none">未分类</option>
        </select>
        <select className={sel} value={value.source} aria-label="来源" onChange={(e) => onChange({ ...value, source: e.target.value })}>
          <option value="">全部来源</option>
          <option value="user">站内用户</option>
          <option value="external">全部外部帖</option>
          {sourceOptions(loaded).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>
      {note && <p className="mt-1 text-[11px] leading-4 text-muted">{note}</p>}
    </div>
  );
}
