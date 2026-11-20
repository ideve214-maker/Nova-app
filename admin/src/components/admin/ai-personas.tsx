import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAdmin } from "@/lib/admin/store";
import { apiBinary } from "@/lib/admin/backend";
import { sanitizeText } from "@/lib/admin/sanitize";
import { NEEDS_SERVER_UPDATE, personasApi as api, ZHIPU_MODELS, zhipuModelLabel } from "@/lib/admin/ai-api";
import {
  CATEGORIES, categoryLabel, cleanOverrides, creatingText, DEFAULT_FIELDS, diffSettings, fmtTime, kindLabel, KIND_LABEL,
  MODEL_SOURCE_LABEL, parseCount, resolvePersonaAvatar, parseTags, pctToRate, rateToPct, sourceErrorText, STATUS_LABEL, SUGGESTED_PERSONA_MODEL,
  type AvatarStyle, type PersonaAccount, type PersonaDefaults, type PersonaLogRow, type PersonaSettings, type PersonaSource,
  type PersonasOverview, type RunAction, type RunKind,
} from "@/lib/admin/personas";
import { ConfirmSheet, EmptyState, Field, inputClass, Pill, PrimaryButton, Screen, Seg, Sheet } from "./ui";
import { Card, Toggle } from "./marketing";

/* 管理端 2.0.9：运营营销 →「AI 内部账号」（设计文档 §8.1 / §10 Agen）。
   接口由 Cc 的 ai-personas.mjs 提供、Dift 接线；还没上线时（404）统一显示「需服务端更新」。 */

const TABS = [
  { id: "overview", label: "总览" },
  { id: "accounts", label: "账号" },
  { id: "sources", label: "来源" },
  { id: "log", label: "日志" },
];

export function AiPersonasScreen() {
  const back = useAdmin((s) => s.back);
  const [tab, setTab] = useState("overview");
  return (
    <Screen title="AI 内部账号" onBack={back}>
      <Seg value={tab} options={TABS} onChange={setTab} />
      {tab === "overview" && <OverviewTab />}
      {tab === "accounts" && <AccountsTab />}
      {tab === "sources" && <SourcesTab />}
      {tab === "log" && <LogTab />}
    </Screen>
  );
}

function Problem({ err }: { err: string }) {
  if (err === NEEDS_SERVER_UPDATE) return <EmptyState title="需服务端更新" hint="AI 内部账号的接口还没上线，等服务端新版本发布后这里就能用。" />;
  return <EmptyState title="暂时打不开" hint={err} />;
}

const sheetBody = "max-h-[calc(75dvh-var(--nova-keyboard,0px))] overflow-y-auto px-4 pb-6";
const selectClass = inputClass + " pr-8";
const btnSoft = "h-9 rounded-full bg-subtle px-3 text-[13px] font-semibold disabled:opacity-50";
const btnDanger = "h-9 rounded-full nova-danger-soft px-3 text-[13px] font-semibold disabled:opacity-50";

function Check({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex items-center gap-2 py-1.5 text-[14px]">
      <input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

// 头像：avatar.path 用管理员令牌（放请求头）拉成 blob → objectURL，按 path 缓存、没人用时释放；
// 拉不到就依次用 avatar.url、avatar.fallback，最后用昵称首字。
type BlobEntry = { url: string | null; refs: number; p: Promise<string | null> };
const blobCache = new Map<string, BlobEntry>();
function usePathBlob(path: string): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(() => (path ? blobCache.get(path)?.url ?? undefined : null));
  useEffect(() => {
    if (!path) { setUrl(null); return; }
    let e = blobCache.get(path);
    if (!e) {
      const entry: BlobEntry = { url: null, refs: 0, p: Promise.resolve(null) };
      entry.p = apiBinary("adminAiPersonasAccounts", { rawPath: path, timeoutMs: 15000 }).then((r) => {
        if (r.ok && r.blob && /^image\//.test(r.mime)) entry.url = URL.createObjectURL(r.blob);
        return entry.url;
      }).catch(() => null);
      blobCache.set(path, entry);
      e = entry;
    }
    const entry = e;
    entry.refs += 1;
    let alive = true;
    void entry.p.then((u) => { if (alive) setUrl(u); });
    return () => {
      alive = false;
      entry.refs -= 1;
      if (entry.refs <= 0) {
        // 稍等再释放，列表重渲染时不会反复下载
        window.setTimeout(() => {
          if (entry.refs > 0 || blobCache.get(path) !== entry) return;
          if (entry.url) URL.revokeObjectURL(entry.url);
          blobCache.delete(path);
        }, 30000);
      }
    };
  }, [path]);
  return url;
}

function PersonaAvatarImg({ avatar, name, className }: { avatar: PersonaAccount["avatar"]; name: string; className: string }) {
  const r = useMemo(() => resolvePersonaAvatar(avatar, name), [avatar, name]);
  const blob = usePathBlob(r.path);
  const list = useMemo(() => [...(blob ? [blob] : []), ...r.direct], [blob, r.direct]);
  const [bad, setBad] = useState<Set<string>>(new Set());
  const src = blob === undefined && r.path ? null : list.find((u) => !bad.has(u)) || null;
  if (src) {
    return <img src={src} alt="" className={"rounded-full bg-subtle object-cover " + className} onError={() => setBad((b) => new Set(b).add(src))} data-testid="persona-avatar-img" />;
  }
  const bg = /^#[0-9a-f]{3,8}$/i.test(r.color) ? r.color : undefined;
  return (
    <span role="img" aria-label={name} className={"grid place-items-center rounded-full text-[15px] font-semibold " + (bg ? "text-white " : "bg-primary text-on-primary ") + className} style={bg ? { backgroundColor: bg } : undefined} data-testid="persona-avatar-letter">
      {r.letter}
    </span>
  );
}

// ---------------- 总览

function OverviewTab() {
  const flash = useAdmin((s) => s.flash);
  const [data, setData] = useState<PersonasOverview | null>(null);
  const [err, setErr] = useState("");
  const [target, setTarget] = useState("");
  const [kind, setKind] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [actions, setActions] = useState<RunAction[] | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);
  const [stopOpts, setStopOpts] = useState({ hideContent: false, undoInteractions: false });
  const [stopping, setStopping] = useState(false);

  const fill = (d: PersonasOverview) => { setData(d); setTarget(String(d.settings.targetCount ?? 0)); };
  const load = useCallback(async () => {
    const r = await api.overview();
    if (r.ok) { fill(r.data); setErr(""); } else setErr(r.error);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async (patch: Partial<Record<keyof PersonaSettings, unknown>>, msg = "已保存") => {
    const r = await api.saveSettings(patch);
    if (!r.ok) { flash(r.error); return false; }
    fill(r.data); flash(msg); return true;
  };
  const tc = parseCount(target);
  const run = async () => {
    setRunning(true); setActions(null);
    const r = await api.run((kind || null) as RunKind);
    setRunning(false);
    if (!r.ok) { flash(r.error); return; }
    const acts = r.data.result?.actions || [];
    setActions(acts);
    if (r.data.settings) fill(r.data);
    flash(`跑完一轮：成功 ${acts.filter((a) => a.ok).length} / ${acts.length}`);
  };
  const stopAll = async () => {
    setStopping(true);
    const r = await api.stopAll(stopOpts);
    setStopping(false);
    if (!r.ok) { flash(r.error); return; }
    setStopOpen(false);
    flash(`已停用 ${r.data.paused} 个账号` + (r.data.hiddenPosts ? `，隐藏 ${r.data.hiddenPosts} 条帖子` : "") + (r.data.removedInteractions ? `，撤销 ${r.data.removedInteractions} 条互动` : ""));
    void load();
  };

  if (err) return <Problem err={err} />;
  if (!data) return <p className="py-8 text-center text-[13px] text-muted">加载中…</p>;
  const { settings, status: st, today } = data;
  const a = st.accounts || { active: 0, paused: 0, retired: 0, creating: 0 };
  const T: [string, number | undefined][] = [
    ["浏览", today.browse], ["点赞", today.like], ["收藏", today.favorite], ["转帖", today.repost], ["评论", today.comment], ["回复", today.reply],
    ["发帖", today.post], ["加入小组", today.join_group], ["小组发言", today.group_post], ["AI 调用", today.aiCalls], ["Tokens", today.aiTokens], ["AI 失败", today.aiFailures],
  ];

  return (
    <div className="pb-6" data-testid="personas-overview">
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[15px] font-semibold">AI 内部账号总开关</div>
            <p className="text-[12px] leading-4 text-muted">打开后 AI 账号会浏览、点赞、收藏、转帖、评论和发帖；不私聊、不进群聊</p>
          </div>
          <Toggle on={settings.enabled} label="AI 内部账号总开关" onChange={(v) => void save({ enabled: v }, v ? "已打开" : "已关闭")} />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {st.running ? <Pill tone="ok">运行中</Pill> : <Pill tone="muted">未运行</Pill>}
          {!st.envEnabled && <Pill tone="warn">服务器未开启</Pill>}
          {st.aiReady ? <Pill tone="ok">AI 可用</Pill> : <Pill tone="warn">AI 不可用</Pill>}
          <Pill tone="muted">模型 {zhipuModelLabel(st.model || "")}（{MODEL_SOURCE_LABEL[st.modelSource] || st.modelSource}）</Pill>
          {st.lastTickAt ? <Pill tone="muted">上次 {fmtTime(st.lastTickAt)}</Pill> : null}
        </div>
        {st.lastError && <p className="mt-2 break-all text-[12px] text-danger">最近错误：{sanitizeText(st.lastError)}</p>}
      </Card>

      <Card>
        <div className="text-[15px] font-semibold">账号数量</div>
        <p className="text-[12px] leading-4 text-muted">不设上限。比现有多就在后台分批创建，比现有少就停用多出来的（内容保留）。</p>
        <div className="mt-2 flex gap-2">
          <input className={inputClass} inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value.replace(/\D/g, ""))} aria-label="账号数量" data-testid="personas-target" />
          <button type="button" className="nova-btn-primary h-11 shrink-0 px-4 text-[15px] disabled:opacity-50" disabled={tc === null || tc === settings.targetCount}
            onClick={() => tc !== null && void save({ targetCount: tc }, `账号数量已设为 ${tc}`)}>保存</button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Pill tone={a.creating ? "warn" : "muted"}>{creatingText(st, settings.targetCount)}</Pill>
          <Pill tone="ok">活跃 {a.active}</Pill>
          <Pill tone="muted">暂停 {a.paused}</Pill>
          <Pill tone="muted">停用 {a.retired}</Pill>
        </div>
      </Card>

      <Card>
        <div className="text-[15px] font-semibold">今日数据</div>
        <div className="mt-2 grid grid-cols-4 gap-1.5 text-center">
          {T.map(([l, n]) => (
            <div key={l} className="rounded-xl bg-subtle px-1 py-1.5">
              <div className="text-[15px] font-semibold tabular-nums">{n ?? 0}</div>
              <div className="text-[11px] text-muted">{l}</div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-muted">来源：启用 {data.sources?.enabled ?? 0} · 出错 {data.sources?.failing ?? 0} · 未用条目 {data.sources?.unusedItems ?? 0}</p>
      </Card>

      <Card>
        <div className="text-[15px] font-semibold">手动跑一轮</div>
        <p className="text-[12px] leading-4 text-muted">测试用，马上让 AI 账号做一轮动作。</p>
        <div className="mt-2 flex gap-2">
          <select className={selectClass} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="动作类型" data-testid="personas-run-kind">
            <option value="">自动（按频率）</option>
            <option value="post">发帖</option>
            <option value="comment">评论</option>
            <option value="browse">浏览</option>
          </select>
          <button type="button" className="nova-btn-primary h-11 shrink-0 px-4 text-[15px] disabled:opacity-50" disabled={running} onClick={() => void run()}>{running ? "运行中…" : "跑一轮"}</button>
        </div>
        {actions && (
          actions.length === 0 ? <p className="mt-2 text-[13px] text-muted">这一轮没有动作。</p> : (
            <ul className="mt-2 divide-y divide-line text-[13px]">
              {actions.slice(0, 30).map((x, i) => (
                <li key={i} className="flex items-center gap-2 py-1.5">
                  <span className="font-semibold">{kindLabel(x.kind)}</span>
                  <span className="text-muted">账号 {x.userId}</span>
                  <span className="ml-auto">{x.ok ? <Pill tone="ok">成功</Pill> : <Pill tone="danger">{sanitizeText(x.error || "失败")}</Pill>}</span>
                </li>
              ))}
            </ul>
          )
        )}
      </Card>

      <div className="mx-4 mt-3 flex gap-2">
        <button type="button" className="h-11 flex-1 rounded-full bg-subtle text-[15px] font-semibold" onClick={() => setSettingsOpen(true)} data-testid="personas-open-settings">频率与内容设置</button>
        <button type="button" className="h-11 flex-1 rounded-full nova-danger-soft text-[15px] font-semibold" onClick={() => { setStopOpts({ hideContent: false, undoInteractions: false }); setStopOpen(true); }}>一键停用</button>
      </div>

      <SettingsSheet open={settingsOpen} settings={settings} onClose={() => setSettingsOpen(false)} onSave={async (patch) => { if (await save(patch)) setSettingsOpen(false); }} />

      <ConfirmSheet
        open={stopOpen}
        danger
        busy={stopping}
        title="一键停用全部 AI 账号"
        confirmText="确认停用"
        onClose={() => setStopOpen(false)}
        onConfirm={() => void stopAll()}
        message={
          <span className="block">
            <span className="block">所有 AI 账号立即停止活动。紧急情况用。</span>
            <Check on={stopOpts.hideContent} onChange={(v) => setStopOpts({ ...stopOpts, hideContent: v })}>同时隐藏 AI 发的帖子</Check>
            <Check on={stopOpts.undoInteractions} onChange={(v) => setStopOpts({ ...stopOpts, undoInteractions: v })}>撤销 AI 的点赞、收藏、浏览（数据回到 真人 + 调整）</Check>
          </span>
        }
      />
    </div>
  );
}

// 数字输入：本地保留原文，合法时回调
function NumInput({ value, onChange, rate, label, placeholder, testId }: { value: number | null | undefined; onChange: (v: number | null, ok: boolean) => void; rate?: boolean; label: string; placeholder?: string; testId?: string }) {
  const show = (v: number | null | undefined) => (v === null || v === undefined ? "" : rate ? rateToPct(v) : String(v));
  const [s, setS] = useState(show(value));
  useEffect(() => setS(show(value)), [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const bad = s.trim() !== "" && (rate ? pctToRate(s) === null : parseCount(s) === null);
  return (
    <Field label={label}>
      <input
        className={inputClass + (bad ? " border-danger" : "")}
        inputMode={rate ? "decimal" : "numeric"}
        value={s}
        placeholder={placeholder}
        data-testid={testId}
        onChange={(e) => {
          const t = e.target.value;
          setS(t);
          if (t.trim() === "") { onChange(null, true); return; }
          const v = rate ? pctToRate(t) : parseCount(t);
          onChange(v, v !== null);
        }}
      />
    </Field>
  );
}

function SettingsSheet({ open, settings, onClose, onSave }: { open: boolean; settings: PersonaSettings; onClose: () => void; onSave: (patch: Partial<Record<keyof PersonaSettings, unknown>>) => Promise<void> }) {
  const flash = useAdmin((s) => s.flash);
  const [d, setD] = useState<PersonaSettings>(settings);
  const [bad, setBad] = useState<Set<string>>(new Set());
  const [styles, setStyles] = useState<AvatarStyle[] | null>(null);
  const [stylesErr, setStylesErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setD(structuredClone(settings)); setBad(new Set()); } }, [open, settings]);
  useEffect(() => {
    if (!open || styles) return;
    void api.avatarStyles().then((r) => { if (r.ok) setStyles(r.data.styles || []); else setStylesErr(r.error); });
  }, [open, styles]);
  const mark = (k: string, ok: boolean) => setBad((b) => { const n = new Set(b); if (ok) n.delete(k); else n.add(k); return n; });
  const num = (k: string, v: number | null, ok: boolean, set: (n: number) => void, required = true) => {
    mark(k, ok && (!required || v !== null));
    if (v !== null) set(v);
  };
  const patch = useMemo(() => diffSettings(settings, d), [settings, d]);
  const changed = Object.keys(patch).length;
  const modelKnown = !d.model || ZHIPU_MODELS.some((m) => m.id === d.model);
  const catList = [...CATEGORIES.map((c) => c.id), ...d.categories.filter((c) => !CATEGORIES.some((x) => x.id === c))];
  const styleList: { key: string; label: string; preview?: string; license?: string }[] = styles && styles.length ? styles : d.avatarStyles.map((k) => ({ key: k, label: k }));
  const toggleIn = (arr: string[], k: string, on: boolean) => (on ? [...new Set([...arr, k])] : arr.filter((x) => x !== k));

  const submit = async () => {
    if (bad.size) { flash("有数字填得不对，请检查标红的输入框"); return; }
    if (!changed) { flash("没有改动"); return; }
    setBusy(true); await onSave(patch); setBusy(false);
  };

  return (
    <Sheet open={open} title="频率与内容设置" onClose={onClose}>
      <div className={sheetBody} data-testid="personas-settings">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[14px] font-semibold">总开关</span>
          <Toggle on={d.enabled} label="总开关" onChange={(v) => setD({ ...d, enabled: v })} />
        </div>
        <NumInput label="账号数量（不设上限）" value={d.targetCount} onChange={(v, ok) => num("targetCount", v, ok, (n) => setD((x) => ({ ...x, targetCount: n })))} />

        <Field label="模型">
          <select className={selectClass} value={d.model} onChange={(e) => setD({ ...d, model: e.target.value })} data-testid="personas-model">
            <option value="">跟全站设置</option>
            {ZHIPU_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label} · {m.id}</option>)}
            {!modelKnown && <option value={d.model}>{d.model}</option>}
          </select>
        </Field>
        {d.model !== SUGGESTED_PERSONA_MODEL && (
          <p className="-mt-1 mb-2 text-[12px] text-muted">建议用免费的 GLM-4.7-Flash，省资源包。<button type="button" className="font-semibold text-primary" onClick={() => setD({ ...d, model: SUGGESTED_PERSONA_MODEL })}>改用</button></p>
        )}

        <div className="mt-3 text-[14px] font-semibold">安静时段（北京时间）</div>
        <div className="grid grid-cols-3 gap-2">
          <NumInput label="开始（点）" value={d.activeHours.quietStart} onChange={(v, ok) => num("quietStart", v, ok && (v === null || v <= 23), (n) => setD((x) => ({ ...x, activeHours: { ...x.activeHours, quietStart: n } })))} />
          <NumInput label="结束（点）" value={d.activeHours.quietEnd} onChange={(v, ok) => num("quietEnd", v, ok && (v === null || v <= 23), (n) => setD((x) => ({ ...x, activeHours: { ...x.activeHours, quietEnd: n } })))} />
          <NumInput label="活跃度 %" rate value={d.activeHours.quietFactor} onChange={(v, ok) => num("quietFactor", v, ok, (n) => setD((x) => ({ ...x, activeHours: { ...x.activeHours, quietFactor: n } })))} />
        </div>

        <div className="mt-3 text-[14px] font-semibold">默认频率</div>
        <p className="mb-1 text-[12px] text-muted">间隔是平均值，实际随机 ±50%。</p>
        <div className="grid grid-cols-2 gap-x-2">
          {DEFAULT_FIELDS.map((f) => (
            <NumInput key={f.key} label={f.label} rate={f.rate} value={d.defaults[f.key]} testId={"personas-def-" + f.key}
              onChange={(v, ok) => num("d." + f.key, v, ok, (n) => setD((x) => ({ ...x, defaults: { ...x.defaults, [f.key]: n } })))} />
          ))}
        </div>

        <div className="mt-3 text-[14px] font-semibold">内容分类</div>
        <div className="flex flex-wrap gap-x-4">
          {catList.map((c) => <Check key={c} on={d.categories.includes(c)} onChange={(on) => setD({ ...d, categories: toggleIn(d.categories, c, on) })}>{categoryLabel(c)}</Check>)}
        </div>

        <div className="mt-3 text-[14px] font-semibold">上限</div>
        <div className="grid grid-cols-3 gap-2">
          <NumInput label="每轮动作" value={d.limits.maxActionsPerTick} onChange={(v, ok) => num("maxActionsPerTick", v, ok, (n) => setD((x) => ({ ...x, limits: { ...x.limits, maxActionsPerTick: n } })))} />
          <NumInput label="AI 并发" value={d.limits.aiConcurrency} onChange={(v, ok) => num("aiConcurrency", v, ok, (n) => setD((x) => ({ ...x, limits: { ...x.limits, aiConcurrency: n } })))} />
          <NumInput label="每帖 AI 评论" value={d.limits.maxAiCommentsPerPost} onChange={(v, ok) => num("maxAiCommentsPerPost", v, ok, (n) => setD((x) => ({ ...x, limits: { ...x.limits, maxAiCommentsPerPost: n } })))} />
        </div>

        <div className="mt-3 text-[14px] font-semibold">头像风格</div>
        {stylesErr && <p className="text-[12px] text-muted">{stylesErr === NEEDS_SERVER_UPDATE ? "头像风格列表需服务端更新" : stylesErr}</p>}
        <div className="grid grid-cols-2 gap-x-2">
          {styleList.map((s) => (
            <Check key={s.key} on={d.avatarStyles.includes(s.key)} onChange={(on) => setD({ ...d, avatarStyles: toggleIn(d.avatarStyles, s.key, on) })}>
              <span className="inline-flex items-center gap-1.5">
                {s.preview && /^data:image\/svg\+xml|^https?:/.test(s.preview) && <img src={s.preview} alt="" className="size-6 rounded-full bg-subtle" />}
                {sanitizeText(s.label)}{s.license ? <span className="text-[11px] text-muted">{sanitizeText(s.license)}</span> : null}
              </span>
            </Check>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between">
          <span className="text-[14px]">AI 点赞时通知真人</span>
          <Toggle on={d.notifyOnLike} label="AI 点赞时通知真人" onChange={(v) => setD({ ...d, notifyOnLike: v })} />
        </div>

        <div className="mt-4">
          <PrimaryButton disabled={busy} onClick={() => void submit()}>{busy ? "正在保存…" : changed ? `保存（改了 ${changed} 项）` : "没有改动"}</PrimaryButton>
        </div>
      </div>
    </Sheet>
  );
}

// ---------------- 账号

const ACC_FILTERS = [
  { id: "", label: "全部" }, { id: "active", label: "活跃" }, { id: "paused", label: "暂停" }, { id: "retired", label: "停用" }, { id: "creating", label: "创建中" },
];

function AccountsTab() {
  const flash = useAdmin((s) => s.flash);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [list, setList] = useState<PersonaAccount[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<PersonaAccount | null>(null);

  const load = useCallback(async (st: string, kw: string, cur: string | null) => {
    setBusy(true);
    const r = await api.accounts({ status: st, q: kw.trim(), cursor: cur });
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setErr("");
    setList((l) => (cur ? [...(l || []), ...(r.data.accounts || [])] : r.data.accounts || []));
    setCursor(r.data.nextCursor || null);
  }, []);
  useEffect(() => { void load(status, q, null); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  const replace = (acc: PersonaAccount) => {
    setList((l) => (l || []).map((x) => (x.userId === acc.userId ? acc : x)));
    setEdit((e) => (e && e.userId === acc.userId ? acc : e));
  };
  const quick = async (acc: PersonaAccount, next: "active" | "paused") => {
    const r = await api.updateAccount(acc.userId, { status: next });
    if (!r.ok) { flash(r.error); return; }
    replace(r.data.account); flash(next === "paused" ? "已暂停" : "已恢复");
  };

  if (err) return <Problem err={err} />;
  return (
    <div className="pb-6" data-testid="personas-accounts">
      <div className="flex gap-1.5 overflow-x-auto px-4 pt-3">
        {ACC_FILTERS.map((f) => (
          <button key={f.id} type="button" onClick={() => setStatus(f.id)} className={"h-8 shrink-0 rounded-full px-3 text-[13px] font-semibold " + (status === f.id ? "bg-primary text-on-primary" : "bg-subtle")}>{f.label}</button>
        ))}
      </div>
      <form className="flex gap-2 px-4 pt-2" onSubmit={(e) => { e.preventDefault(); void load(status, q, null); }}>
        <input className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索昵称或用户名" enterKeyHint="search" />
        <button type="submit" className="nova-btn-primary h-11 shrink-0 px-4 text-[15px]">搜索</button>
      </form>
      {!list && <p className="py-8 text-center text-[13px] text-muted">加载中…</p>}
      {list && list.length === 0 && !busy && <EmptyState title="没有账号" hint="在总览里设置账号数量后会自动创建。" />}
      <ul className="mt-2 space-y-2 px-4">
        {(list || []).map((acc) => (
          <li key={acc.userId} className="rounded-card bg-surface p-3 shadow-card">
            <button type="button" className="flex w-full items-center gap-2.5 text-left" onClick={() => setEdit(acc)}>
              <span className="relative shrink-0">
                <PersonaAvatarImg avatar={acc.avatar} name={acc.displayName} className="size-10" />
                <span className="absolute -bottom-0.5 -right-0.5 rounded bg-primary px-0.5 text-[8px] font-bold leading-3 text-on-primary">AI</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[15px] font-semibold">{sanitizeText(acc.displayName)}</span>
                  <Pill tone={acc.status === "active" ? "ok" : acc.status === "retired" ? "danger" : "muted"}>{STATUS_LABEL[acc.status] || acc.status}</Pill>
                </span>
                <span className="block truncate text-[12px] text-muted">@{acc.username} · {acc.interests.map(categoryLabel).join("、") || "无兴趣"}{acc.overrides ? " · 单独频率" : ""}</span>
                <span className="block text-[12px] text-muted">帖 {acc.counts?.posts ?? 0} · 评 {acc.counts?.comments ?? 0} · 赞 {acc.counts?.likes ?? 0} · 最近 {fmtTime(acc.lastActionAt)}</span>
              </span>
            </button>
            {acc.status !== "retired" && acc.status !== "creating" && (
              <div className="mt-2 flex justify-end gap-2">
                {acc.status === "paused"
                  ? <button type="button" className={btnSoft} onClick={() => void quick(acc, "active")}>恢复</button>
                  : <button type="button" className={btnSoft} onClick={() => void quick(acc, "paused")}>暂停</button>}
              </div>
            )}
          </li>
        ))}
      </ul>
      {cursor && <div className="px-4 pt-3"><button type="button" className="h-11 w-full rounded-full bg-subtle text-[15px] font-semibold" disabled={busy} onClick={() => void load(status, q, cursor)}>{busy ? "加载中…" : "加载更多"}</button></div>}
      <AccountSheet acc={edit} onClose={() => setEdit(null)} onChanged={replace} />
    </div>
  );
}

function AccountSheet({ acc, onClose, onChanged }: { acc: PersonaAccount | null; onClose: () => void; onChanged: (a: PersonaAccount) => void }) {
  const flash = useAdmin((s) => s.flash);
  const [name, setName] = useState("");
  const [interests, setInterests] = useState("");
  const [ov, setOv] = useState<Partial<Record<keyof PersonaDefaults, number | null>>>({});
  const [bad, setBad] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [retireOpen, setRetireOpen] = useState(false);
  const [hide, setHide] = useState(false);
  const id = acc?.userId;
  useEffect(() => {
    if (!acc) return;
    setName(acc.displayName); setInterests(acc.interests.join("、")); setOv({ ...(acc.overrides || {}) }); setBad(new Set());
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!acc) return null;

  const saveInfo = async () => {
    if (bad.size) { flash("单独频率有数字填得不对"); return; }
    const patch: Parameters<typeof api.updateAccount>[1] = {};
    const n = name.trim();
    if (!n) { flash("昵称不能为空"); return; }
    if (n !== acc.displayName) patch.displayName = n;
    const tags = parseTags(interests);
    if (JSON.stringify(tags) !== JSON.stringify(acc.interests)) patch.interests = tags;
    const o = cleanOverrides(ov);
    if (JSON.stringify(o) !== JSON.stringify(acc.overrides || null)) patch.overrides = o;
    if (!Object.keys(patch).length) { flash("没有改动"); return; }
    setBusy(true);
    const r = await api.updateAccount(acc.userId, patch);
    setBusy(false);
    if (!r.ok) { flash(r.error); return; }
    onChanged(r.data.account); flash("已保存");
  };
  const regen = async () => {
    setBusy(true);
    const r = await api.updateAccount(acc.userId, { regenerateAvatar: true });
    setBusy(false);
    if (!r.ok) { flash(r.error); return; }
    onChanged(r.data.account); flash("已换头像");
  };
  const retire = async () => {
    setBusy(true);
    const r = await api.retireAccount(acc.userId, hide);
    setBusy(false);
    if (!r.ok) { flash(r.error); return; }
    setRetireOpen(false); onChanged(r.data.account);
    flash("已停用" + (r.data.hiddenPosts ? `，隐藏 ${r.data.hiddenPosts} 条帖子` : ""));
  };

  return (
    <>
      <Sheet open={!!acc && !retireOpen} title={sanitizeText(acc.displayName) || "AI 账号"} onClose={onClose}>
        <div className={sheetBody} data-testid="personas-account-sheet">
          <div className="mb-3 flex items-center gap-3">
            <PersonaAvatarImg avatar={acc.avatar} name={acc.displayName} className="size-12" />
            <div className="min-w-0 flex-1 text-[12px] text-muted">
              <div>@{acc.username} · ID {acc.userId} · {STATUS_LABEL[acc.status] || acc.status}</div>
              <div>风格 {acc.style || "—"} · 下次 {fmtTime(acc.nextAt)}</div>
            </div>
            <button type="button" className={btnSoft} disabled={busy} onClick={() => void regen()}>换头像</button>
          </div>
          <Field label="昵称"><input className={inputClass} value={name} maxLength={30} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="兴趣（news / politics / sports / economy，用顿号或空格分隔）"><input className={inputClass} value={interests} onChange={(e) => setInterests(e.target.value)} autoCapitalize="off" /></Field>
          <div className="mt-2 text-[14px] font-semibold">单独频率</div>
          <p className="mb-1 text-[12px] text-muted">留空 = 用默认设置。</p>
          <div className="grid grid-cols-2 gap-x-2">
            {DEFAULT_FIELDS.map((f) => (
              <NumInput key={f.key} label={f.label} rate={f.rate} value={ov[f.key] ?? null} placeholder="默认"
                onChange={(v, ok) => { setBad((b) => { const n = new Set(b); if (ok) n.delete(f.key); else n.add(f.key); return n; }); if (ok) setOv((x) => ({ ...x, [f.key]: v })); }} />
            ))}
          </div>
          <PrimaryButton disabled={busy} onClick={() => void saveInfo()}>{busy ? "请稍候…" : "保存"}</PrimaryButton>
          {acc.status !== "retired" && (
            <button type="button" className="mt-2 h-11 w-full rounded-full nova-danger-soft text-[15px] font-semibold" onClick={() => { setHide(false); setRetireOpen(true); }}>停用这个账号</button>
          )}
        </div>
      </Sheet>
      <ConfirmSheet open={retireOpen} danger busy={busy} title="停用 AI 账号" confirmText="确认停用" onClose={() => setRetireOpen(false)} onConfirm={() => void retire()}
        message={<span className="block"><span className="block">「{sanitizeText(acc.displayName)}」停用后不再活动，内容默认保留。</span><Check on={hide} onChange={setHide}>同时隐藏它发的帖子</Check></span>} />
    </>
  );
}

// ---------------- 来源

type SrcDraft = { id?: number; name: string; url: string; category: string; lang: string };

function SourcesTab() {
  const flash = useAdmin((s) => s.flash);
  const [list, setList] = useState<PersonaSource[] | null>(null);
  const [err, setErr] = useState("");
  const [draft, setDraft] = useState<SrcDraft | null>(null);
  const [draftErr, setDraftErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState<PersonaSource | null>(null);
  const [test, setTest] = useState<{ src: PersonaSource; ms?: number; items?: { title: string; url: string; publishedAt: number | null }[]; err?: string } | null>(null);

  const load = useCallback(async () => {
    const r = await api.sources();
    if (r.ok) { setList(r.data.sources || []); setErr(""); } else setErr(r.error);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const put = (s: PersonaSource) => setList((l) => { const xs = l || []; return xs.some((x) => x.id === s.id) ? xs.map((x) => (x.id === s.id ? s : x)) : [...xs, s]; });

  const submit = async () => {
    if (!draft) return;
    const name = draft.name.trim(), url = draft.url.trim();
    if (!name) { setDraftErr("请填名称"); return; }
    if (!draft.id && !/^https?:\/\/\S+$/i.test(url)) { setDraftErr("网址要以 http:// 或 https:// 开头"); return; }
    setBusy(true); setDraftErr("");
    const r = draft.id ? await api.updateSource(draft.id, { name, category: draft.category }) : await api.addSource({ name, url, category: draft.category, lang: draft.lang });
    setBusy(false);
    if (!r.ok) { setDraftErr(sourceErrorText(r.code, r.error)); return; }
    put(r.data.source); setDraft(null); flash(draft.id ? "已保存" : "已添加");
  };
  const toggle = async (s: PersonaSource, on: boolean) => {
    const r = await api.updateSource(s.id, { enabled: on });
    if (!r.ok) { flash(r.error); return; }
    put(r.data.source);
  };
  const runTest = async (s: PersonaSource) => {
    setTest({ src: s });
    const r = await api.testSource(s.id);
    if (!r.ok) setTest({ src: s, err: sourceErrorText(r.code, r.error) });
    else setTest({ src: s, ms: r.data.ms, items: r.data.items || [], err: r.data.ok ? undefined : "抓取失败" });
  };
  const remove = async () => {
    if (!del) return;
    setBusy(true);
    const r = await api.deleteSource(del.id);
    setBusy(false);
    if (!r.ok) { flash(r.error); return; }
    setList((l) => (l || []).filter((x) => x.id !== del.id)); setDel(null); flash("已删除");
  };

  if (err) return <Problem err={err} />;
  return (
    <div className="pb-6" data-testid="personas-sources">
      <div className="px-4 pt-3">
        <PrimaryButton onClick={() => { setDraftErr(""); setDraft({ name: "", url: "", category: "news", lang: "zh" }); }}>添加来源</PrimaryButton>
      </div>
      {!list && <p className="py-8 text-center text-[13px] text-muted">加载中…</p>}
      {list && list.length === 0 && <EmptyState title="还没有来源" hint="添加 RSS 网址，AI 账号会读新闻写自己的观点。" />}
      <ul className="mt-2 space-y-2 px-4">
        {(list || []).map((s) => (
          <li key={s.id} className="rounded-card bg-surface p-3 shadow-card">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[15px] font-semibold">{sanitizeText(s.name)}</span>
                  <Pill tone="muted">{categoryLabel(s.category)}</Pill>
                  {s.lastError ? <Pill tone="danger">出错</Pill> : null}
                </div>
                <p className="truncate text-[12px] text-muted">{sanitizeText(s.url)}</p>
                <p className="text-[12px] text-muted">{s.itemCount} 条 · 上次成功 {fmtTime(s.lastOkAt)}</p>
                {s.lastError && <p className="break-all text-[12px] text-danger">{sanitizeText(s.lastError)}</p>}
              </div>
              <Toggle on={s.enabled} label={"启用 " + s.name} onChange={(v) => void toggle(s, v)} />
            </div>
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" className={btnSoft} onClick={() => void runTest(s)}>测试</button>
              <button type="button" className={btnSoft} onClick={() => { setDraftErr(""); setDraft({ id: s.id, name: s.name, url: s.url, category: s.category, lang: s.lang }); }}>编辑</button>
              <button type="button" className={btnDanger} onClick={() => setDel(s)}>删除</button>
            </div>
          </li>
        ))}
      </ul>

      <Sheet open={!!draft} title={draft?.id ? "编辑来源" : "添加来源"} onClose={() => setDraft(null)}>
        {draft && (
          <div className={sheetBody} data-testid="personas-source-form">
            <Field label="名称"><input className={inputClass} value={draft.name} maxLength={40} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="例如 中新网 体育" /></Field>
            <Field label="RSS 网址">
              <input className={inputClass + (draft.id ? " opacity-60" : "")} value={draft.url} readOnly={!!draft.id} inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false}
                onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="https://…" />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="分类">
                <select className={selectClass} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
                  {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </Field>
              <Field label="语言">
                <select className={selectClass} value={draft.lang} disabled={!!draft.id} onChange={(e) => setDraft({ ...draft, lang: e.target.value })}>
                  <option value="zh">中文</option><option value="en">英文</option>
                </select>
              </Field>
            </div>
            {draftErr && <p className="mb-2 break-all text-[13px] text-danger" data-testid="personas-source-error">{draftErr}</p>}
            <PrimaryButton disabled={busy} onClick={() => void submit()}>{busy ? (draft.id ? "保存中…" : "正在试抓…") : draft.id ? "保存" : "试抓并添加"}</PrimaryButton>
          </div>
        )}
      </Sheet>

      <Sheet open={!!test} title={test ? "测试：" + sanitizeText(test.src.name) : "测试"} onClose={() => setTest(null)}>
        {test && (
          <div className={sheetBody}>
            {!test.items && !test.err && <p className="py-6 text-center text-[13px] text-muted">正在抓取…</p>}
            {test.err && <p className="break-all text-[13px] text-danger">{test.err}</p>}
            {test.items && <p className="mb-2 text-[13px] text-muted">抓到 {test.items.length} 条，用时 {test.ms ?? 0} ms</p>}
            <ul className="divide-y divide-line">
              {(test.items || []).slice(0, 20).map((it, i) => (
                <li key={i} className="py-2 text-[13px]"><div className="line-clamp-2">{sanitizeText(it.title)}</div><div className="text-[11px] text-muted">{fmtTime(it.publishedAt)}</div></li>
              ))}
            </ul>
          </div>
        )}
      </Sheet>

      <ConfirmSheet open={!!del} danger busy={busy} title="删除来源" confirmText="删除" onClose={() => setDel(null)} onConfirm={() => void remove()}
        message={del ? `删除「${sanitizeText(del.name)}」？已经发出的帖子不受影响。` : ""} />
    </div>
  );
}

// ---------------- 日志

function LogTab() {
  const [kind, setKind] = useState("");
  const [userId, setUserId] = useState("");
  const [rows, setRows] = useState<PersonaLogRow[] | null>(null);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const LIMIT = 100;
  const load = useCallback(async (k: string, u: string, before: number | null) => {
    setBusy(true);
    const r = await api.log({ kind: k, userId: u.trim(), before, limit: LIMIT });
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setErr("");
    const got = r.data.log || [];
    setRows((x) => (before ? [...(x || []), ...got] : got));
    // 服务端 2.1.3 回 nextBefore（null = 没有更多）；旧格式按条数判断
    setMore(r.data.nextBefore !== undefined ? r.data.nextBefore != null : got.length >= LIMIT);
  }, []);
  useEffect(() => { void load(kind, userId, null); }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return <Problem err={err} />;
  const last = rows && rows.length ? rows[rows.length - 1] : null;
  return (
    <div className="pb-6" data-testid="personas-log">
      <form className="flex gap-2 px-4 pt-3" onSubmit={(e) => { e.preventDefault(); void load(kind, userId, null); }}>
        <select className={selectClass} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="动作">
          <option value="">全部动作</option>
          {Object.keys(KIND_LABEL).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
        <input className={inputClass + " w-28 shrink-0"} inputMode="numeric" value={userId} onChange={(e) => setUserId(e.target.value.replace(/\D/g, ""))} placeholder="账号 ID" enterKeyHint="search" />
        <button type="submit" className="nova-btn-primary h-11 shrink-0 px-3 text-[15px]">筛选</button>
      </form>
      {!rows && <p className="py-8 text-center text-[13px] text-muted">加载中…</p>}
      {rows && rows.length === 0 && <EmptyState title="还没有记录" />}
      <ul className="mx-4 mt-2 divide-y divide-line rounded-card bg-surface px-3 shadow-card">
        {(rows || []).map((r) => (
          <li key={r.id} className="py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-semibold">{kindLabel(r.kind)}</span>
              <span className="truncate text-[12px] text-muted">{sanitizeText(r.displayName || (r.userId ? "账号 " + r.userId : "系统"))}</span>
              <span className="ml-auto shrink-0">{r.ok ? <Pill tone="ok">成功</Pill> : <Pill tone="danger">失败</Pill>}</span>
            </div>
            <p className="mt-0.5 break-all text-[12px] text-muted">
              {fmtTime(r.at)}{r.target ? " · " + sanitizeText(r.target) : ""}{r.model ? " · " + r.model : ""}{r.tokens ? ` · ${r.tokens} tokens` : ""}
            </p>
            {r.error && <p className="break-all text-[12px] text-danger">{sanitizeText(r.error)}</p>}
          </li>
        ))}
      </ul>
      {more && last && <div className="px-4 pt-3"><button type="button" className="h-11 w-full rounded-full bg-subtle text-[15px] font-semibold" disabled={busy} onClick={() => void load(kind, userId, last.id)}>{busy ? "加载中…" : "加载更多"}</button></div>}
    </div>
  );
}
