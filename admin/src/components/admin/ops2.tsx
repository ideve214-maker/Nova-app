/**
 * 管理端 2.0 的界面（接口见 ADMIN-2.0-SERVER.md）：用户运营面板、标签、站内通知、AI 日报、活动与互动。
 * 全部读写真实接口；接口不存在时显示“服务器还没更新”的提示，不造数据。
 */
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useAdmin } from "@/lib/admin/store";
import { sanitizeText } from "@/lib/admin/sanitize";
import {
  addUserTag, aiReport, aiReportGenerate, bulkDeleteTag, call, deleteUser, editProfile, listTags, notifyMany, notifyUser,
  removeUserTag, setBadge, setFollowerBonus, v2Act, v2List, type TagCount, type V2Kind,
} from "@/lib/admin/ai-api";
import { cn, ConfirmSheet, EmptyState, Field, inputClass, Pill, PrimaryButton, Screen, Seg, Sheet } from "./ui";

type U = { id: number; username: string; displayName?: string; bio?: string; badge?: string | null; followerBonus?: number; followerCountReal?: number; followerCount?: number; tags?: string[]; status?: string };
const box = "overflow-hidden rounded-card bg-surface shadow-card";
const btn = "h-9 rounded-full bg-subtle px-3 text-[13px] font-semibold disabled:opacity-50";

/** 用户详情里的「运营」页签：编辑资料、粉丝加成、官方标识、标签、站内通知、注销账号（二次确认）。 */
export function UserOpsPanel({ userId }: { userId: string }) {
  const flash = useAdmin((s) => s.flash);
  const back = useAdmin((s) => s.back);
  const refreshUsers = useAdmin((s) => s.refreshUsers);
  const [u, setU] = useState<U | null>(null);
  const [err, setErr] = useState("");
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [bonus, setBonus] = useState("0");
  const [tag, setTag] = useState("");
  const [nTitle, setNTitle] = useState("");
  const [nBody, setNBody] = useState("");
  const [delOpen, setDelOpen] = useState(false);
  const [delName, setDelName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const r = await call<{ user: U }>("adminUser", { params: { id: userId } });
    if (!r.ok) { setErr(r.error); return; }
    const x = r.data.user; setU(x); setErr("");
    setName(x.displayName || ""); setBio(x.bio || ""); setBonus(String(x.followerBonus || 0));
  };
  useEffect(() => { void load(); }, [userId]);
  const run = async (p: Promise<{ ok: boolean; error?: string }>, ok: string) => {
    setBusy(true); const r = await p; setBusy(false);
    if (r.ok) { flash(ok); void load(); void refreshUsers(); return true; }
    flash((r as { error: string }).error); return false;
  };

  if (err) return <EmptyState title="暂时打不开" hint={err} />;
  if (!u) return <p className="px-4 py-8 text-center text-sm text-muted">正在读取…</p>;
  return (
    <div className="space-y-3 px-4 py-3">
      <section className={cn(box, "px-3.5 py-3")}>
        <h3 className="mb-2 text-[13px] font-semibold text-muted">资料</h3>
        <Field label="昵称"><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="简介"><textarea className={cn(inputClass, "h-20 py-2")} value={bio} onChange={(e) => setBio(e.target.value)} /></Field>
        <PrimaryButton disabled={busy} onClick={() => void run(editProfile(userId, { displayName: name, bio }), "资料已保存")}>保存资料</PrimaryButton>
      </section>

      <section className={cn(box, "px-3.5 py-3")}>
        <h3 className="mb-1 text-[13px] font-semibold text-muted">粉丝与标识</h3>
        <p className="mb-2 text-[12px] text-muted">展示粉丝 {u.followerCount ?? "—"} = 真实关注 {u.followerCountReal ?? "—"} + 加成 {u.followerBonus || 0}</p>
        <div className="flex gap-2">
          <input className={cn(inputClass, "flex-1")} inputMode="numeric" value={bonus} onChange={(e) => setBonus(e.target.value.replace(/[^\d]/g, ""))} />
          <button type="button" className={btn} disabled={busy} onClick={() => void run(setFollowerBonus(userId, Number(bonus) || 0), "粉丝加成已更新")}>设置加成</button>
        </div>
        <div className="mt-2.5 grid grid-cols-3 gap-2">
          {([["official", "官方账号"], ["authorized", "官方授权"], [null, "无标识"]] as const).map(([v, label]) => (
            <button key={label} type="button" disabled={busy} className={cn("h-9 rounded-full text-[13px] font-semibold", (u.badge || null) === v ? "bg-primary text-on-primary" : "bg-subtle")} onClick={() => void run(setBadge(userId, v), "标识已更新")}>{label}</button>
          ))}
        </div>
      </section>

      <section className={cn(box, "px-3.5 py-3")}>
        <h3 className="mb-2 text-[13px] font-semibold text-muted">标签</h3>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {(u.tags || []).length === 0 && <span className="text-[13px] text-muted">还没有标签</span>}
          {(u.tags || []).map((t) => (
            <button key={t} type="button" className="flex h-7 items-center gap-1 rounded-full bg-subtle px-2.5 text-[13px]" onClick={() => void run(removeUserTag(userId, t), "已移除标签")}>{sanitizeText(t)}<X className="size-3" /></button>
          ))}
        </div>
        <div className="flex gap-2">
          <input className={cn(inputClass, "flex-1")} value={tag} onChange={(e) => setTag(e.target.value)} placeholder="测试账号 / 内部 / 正式用户…" />
          <button type="button" className={btn} disabled={busy || !tag.trim()} onClick={() => void run(addUserTag(userId, tag.trim()), "已加标签").then((ok) => ok && setTag(""))}>添加</button>
        </div>
      </section>

      <section className={cn(box, "px-3.5 py-3")}>
        <h3 className="mb-2 text-[13px] font-semibold text-muted">站内通知</h3>
        <Field label="标题（可选）"><input className={inputClass} value={nTitle} onChange={(e) => setNTitle(e.target.value)} placeholder="平台通知" /></Field>
        <Field label="内容"><textarea className={cn(inputClass, "h-20 py-2")} value={nBody} onChange={(e) => setNBody(e.target.value)} /></Field>
        <PrimaryButton disabled={busy || nBody.trim().length < 2} onClick={() => void run(notifyUser(userId, nTitle, nBody), "通知已发送").then((ok) => ok && setNBody(""))}>发送通知</PrimaryButton>
      </section>

      <section className={cn(box, "px-3.5 py-3")}>
        <h3 className="mb-1 text-[13px] font-semibold text-danger">注销账号</h3>
        <p className="mb-2 text-[12px] leading-5 text-muted">不可撤销。需要输入该用户的用户名或邮箱再确认，AI 助手不能代办。</p>
        <button type="button" className="h-10 w-full rounded-full nova-danger-soft text-[14px] font-semibold" onClick={() => { setDelName(""); setDelOpen(true); }}>注销这个账号</button>
      </section>

      <Sheet open={delOpen} title="确认注销" onClose={() => setDelOpen(false)}>
        <p className="mb-2 text-[14px] text-muted">请输入用户名 <b className="text-fg">{sanitizeText(u.username)}</b> 或其邮箱：</p>
        <input className={cn(inputClass, "mb-3")} value={delName} onChange={(e) => setDelName(e.target.value)} autoCapitalize="none" />
        <div className="pb-2">
          <button type="button" disabled={busy || !delName.trim()} className="h-11 w-full rounded-full bg-danger text-[15px] font-semibold text-on-primary disabled:opacity-50"
            onClick={() => void run(deleteUser(userId, delName.trim()), "账号已注销").then((ok) => { if (ok) { setDelOpen(false); back(); } })}>
            确认删除
          </button>
        </div>
      </Sheet>
    </div>
  );
}

export function TagsScreen() {
  const back = useAdmin((s) => s.back);
  const go = useAdmin((s) => s.go);
  const flash = useAdmin((s) => s.flash);
  const [tags, setTags] = useState<TagCount[] | null>(null);
  const [err, setErr] = useState("");
  const [del, setDel] = useState<string | null>(null);
  const [users, setUsers] = useState<{ tag: string; list: U[] } | null>(null);
  const load = async () => { const r = await listTags(); if (r.ok) setTags(r.data.tags || []); else setErr(r.error); };
  useEffect(() => { void load(); }, []);
  const open = async (tag: string) => {
    const r = await call<{ users?: U[]; items?: U[] }>("adminUsers", { query: { tag, limit: 100 } });
    if (r.ok) setUsers({ tag, list: r.data.users || r.data.items || [] }); else flash(r.error);
  };
  return (
    <Screen title="用户标签" onBack={back}>
      {err && <EmptyState title="暂时打不开" hint={err} />}
      {tags && tags.length === 0 && <EmptyState title="还没有标签" hint="在用户详情的「运营」里给用户加标签。" />}
      {tags && tags.length > 0 && (
        <div className={cn(box, "mx-4 mt-3")}>
          {tags.map((t) => (
            <div key={t.tag} className="flex items-center gap-2 border-b border-line px-3.5 py-3 last:border-b-0">
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => void open(t.tag)}>
                <span className="text-[15px] font-medium">{sanitizeText(t.tag)}</span>
                <span className="ml-2 text-[13px] text-muted">{t.count} 人</span>
              </button>
              {t.count > 0 && <button type="button" className="h-8 rounded-full nova-danger-soft px-3 text-[12px] font-semibold" onClick={() => setDel(t.tag)}>全部移除</button>}
            </div>
          ))}
        </div>
      )}
      <Sheet open={!!users} title={users ? `标签：${users.tag}` : ""} onClose={() => setUsers(null)}>
        <div className="nova-scroll max-h-[60dvh] pb-2">
          {users && users.list.length === 0 && <p className="py-6 text-center text-sm text-muted">没有用户</p>}
          {users?.list.map((x) => (
            <button key={x.id} type="button" className="block w-full border-b border-line py-2.5 text-left text-[15px]" onClick={() => { setUsers(null); go("user", String(x.id)); }}>
              {sanitizeText(x.displayName || x.username)} <span className="text-[13px] text-muted">ID {x.id}</span>
            </button>
          ))}
        </div>
      </Sheet>
      <ConfirmSheet open={!!del} title="移除标签" danger confirmText="全部移除" message={`把所有用户身上的「${del}」标签移除？`} onClose={() => setDel(null)}
        onConfirm={() => { const t = del!; setDel(null); void bulkDeleteTag(t).then((r) => { flash(r.ok ? "已移除" : r.error); void load(); }); }} />
    </Screen>
  );
}

export function NotifyScreen() {
  const back = useAdmin((s) => s.back);
  const flash = useAdmin((s) => s.flash);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [ids, setIds] = useState("");
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const userIds = ids.split(/[\s,，、]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return (
    <Screen title="站内通知" onBack={back}>
      <div className={cn(box, "mx-4 mt-3 px-3.5 py-3")}>
        <Field label="标题（可选，最多 40 字）"><input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="平台通知" /></Field>
        <Field label="内容（2–2000 字）"><textarea className={cn(inputClass, "h-28 py-2")} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
        <Field label="指定用户 ID（可选，空着就是发给全体正常用户）"><input className={inputClass} value={ids} onChange={(e) => setIds(e.target.value)} placeholder="例如 12, 17, 23" /></Field>
        <PrimaryButton disabled={busy || body.trim().length < 2} onClick={() => setAsk(true)}>{userIds.length ? `发给 ${userIds.length} 位用户` : "发给全体用户"}</PrimaryButton>
      </div>
      <p className="px-5 pt-2 text-[12px] leading-5 text-muted">通知会出现在用户的消息列表里。公告弹窗请到「公告通知」。</p>
      <ConfirmSheet open={ask} title="确认发送" confirmText="发送" busy={busy} message={userIds.length ? `发给 ${userIds.length} 位指定用户。` : "发给全体正常用户，发出后不能撤回。"} onClose={() => setAsk(false)}
        onConfirm={() => { setBusy(true); void notifyMany(title, body, userIds).then((r) => { setBusy(false); setAsk(false); if (r.ok) { flash(`已发送 ${r.data.sent} 人`); setBody(""); } else flash(r.error); }); }} />
    </Screen>
  );
}

const STAT_LABELS: Record<string, string> = {
  newUsers: "新注册", newPosts: "发帖", newComments: "评论", openReports: "待处理举报", decidedReports: "已处理举报",
  pendingPayments: "待核对付款", confirmedPayments: "确认付款", bans: "封禁", deletes: "注销", newCommunities: "新社区",
  newExchange: "技能交换", newProjects: "共创项目", activitySignups: "活动报名", aiChecks: "AI 审查", aiBlocks: "AI 拦截", aiFlags: "AI 标记",
};

export function AiReportScreen() {
  const back = useAdmin((s) => s.back);
  const shanghaiToday = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const [date, setDate] = useState(shanghaiToday);
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [report, setReport] = useState<{ text: string; source: string } | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setReport(null); void aiReport(date).then((r) => { if (r.ok) { setStats((r.data.stats as Record<string, unknown>) || null); setErr(""); } else setErr(r.error); }); }, [date]);
  return (
    <Screen title="AI 日报" onBack={back}>
      <div className="px-4 pt-3">
        <input type="date" className={inputClass} value={date} max={shanghaiToday} onChange={(e) => setDate(e.target.value || shanghaiToday)} />
      </div>
      {err && <EmptyState title="暂时打不开" hint={err} />}
      {stats && (
        <div className={cn(box, "mx-4 mt-3 grid grid-cols-3 gap-y-3 px-2 py-3")}>
          {Object.entries(STAT_LABELS).filter(([k]) => stats[k] != null).map(([k, label]) => (
            <div key={k} className="text-center">
              <div className="text-[18px] font-semibold">{String(stats[k])}</div>
              <div className="text-[11px] text-muted">{label}</div>
            </div>
          ))}
        </div>
      )}
      <div className="px-4 pt-3">
        <PrimaryButton disabled={busy || !stats} onClick={() => { setBusy(true); void aiReportGenerate(date).then((r) => { setBusy(false); if (r.ok) setReport({ text: String(r.data.report || ""), source: String(r.data.source || "") }); else setErr(r.error); }); }}>
          {busy ? "正在生成…" : "生成日报"}
        </PrimaryButton>
      </div>
      {report && (
        <div className={cn(box, "mx-4 mt-3 px-3.5 py-3")}>
          <Pill tone={report.source === "zhipu" ? "ok" : "muted"}>{report.source === "zhipu" ? "智谱生成" : "本地汇总"}</Pill>
          <p className="mt-2 whitespace-pre-wrap text-[15px] leading-6">{sanitizeText(report.text)}</p>
        </div>
      )}
    </Screen>
  );
}

const V2_TABS: { id: V2Kind; label: string; key: string }[] = [
  { id: "activities", label: "活动", key: "activities" },
  { id: "polls", label: "投票", key: "polls" },
  { id: "exchange", label: "技能交换", key: "posts" },
  { id: "projects", label: "共创", key: "projects" },
];
type V2Row = { id: string | number; title?: string; question?: string; offers?: string; wants?: string; author?: unknown; username?: string; removed?: boolean; status?: string; createdAt?: number };

export function V2Screen() {
  const back = useAdmin((s) => s.back);
  const flash = useAdmin((s) => s.flash);
  const [kind, setKind] = useState<V2Kind>("activities");
  const [rows, setRows] = useState<V2Row[] | null>(null);
  const [err, setErr] = useState("");
  const [ask, setAsk] = useState<V2Row | null>(null);
  const load = async (k = kind) => {
    setRows(null);
    const r = await v2List(k);
    if (!r.ok) { setErr(r.error); return; }
    setErr("");
    const key = V2_TABS.find((t) => t.id === k)!.key;
    setRows(((r.data[key] as V2Row[]) || []));
  };
  useEffect(() => { void load(kind); }, [kind]);
  const removed = (x: V2Row) => !!x.removed || x.status === "removed";
  const label = (x: V2Row) => x.title || x.question || (x.offers ? `会：${x.offers} / 想要：${x.wants || ""}` : `#${x.id}`);
  const who = (x: V2Row) => { const a = x.author as { username?: string; displayName?: string } | string | null; return typeof a === "string" ? a : (a && (a.displayName || a.username)) || x.username || ""; };
  return (
    <Screen title="活动与互动" onBack={back}>
      <Seg value={kind} options={V2_TABS.map((t) => ({ id: t.id, label: t.label }))} onChange={(v) => setKind(v as V2Kind)} />
      {err && <EmptyState title="暂时打不开" hint={err} />}
      {rows && rows.length === 0 && <EmptyState title="暂时没有内容" />}
      {rows && rows.length > 0 && (
        <div className="bg-surface">
          {rows.map((x) => (
            <div key={String(x.id)} className="flex items-start gap-3 border-b border-line px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-[15px]">{sanitizeText(label(x))}</p>
                <p className="text-[12px] text-muted">{who(x) ? sanitizeText(who(x)) + " · " : ""}ID {String(x.id)} {removed(x) && <Pill tone="danger">已移除</Pill>}</p>
              </div>
              <button type="button" className={cn("h-8 shrink-0 rounded-full px-3 text-[12px] font-semibold", removed(x) ? "nova-ok-soft" : "nova-danger-soft")} onClick={() => setAsk(x)}>{removed(x) ? "恢复" : "移除"}</button>
            </div>
          ))}
        </div>
      )}
      <ConfirmSheet open={!!ask} title={ask && removed(ask) ? "恢复" : "移除"} danger={!!ask && !removed(ask)} confirmText={ask && removed(ask) ? "恢复" : "移除"} message={ask ? sanitizeText(label(ask)) : ""} onClose={() => setAsk(null)}
        onConfirm={() => { const x = ask!; setAsk(null); void v2Act(kind, String(x.id), removed(x) ? "restore" : "remove").then((r) => { flash(r.ok ? "已完成" : r.error); void load(); }); }} />
    </Screen>
  );
}
