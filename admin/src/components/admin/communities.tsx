import { useEffect, useState } from "react";
import { useAdmin } from "@/lib/admin/store";
import { sanitizeText } from "@/lib/admin/sanitize";
import { EmptyState, Field, inputClass, PendingApi, Pill, Screen, Sheet } from "./ui";
import type { CommunityAction, CommunityMemberAction } from "@/lib/admin/remote";

export function CommunitiesScreen() {
  const backTo = useAdmin((s) => s.backTo);
  const list = useAdmin((s) => s.communities);
  const refresh = useAdmin((s) => s.refreshCommunities);
  const openCommunity = useAdmin((s) => s.openCommunity);
  const authed = useAdmin((s) => s.authed);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <Screen title="社区" onBack={() => backTo("manage")}>
      <p className="px-4 pt-2 text-[12px] text-muted">成员数、频道和消息来自服务器，不是估计值。</p>
      <div className="space-y-2.5 p-4">
        {list.length === 0 && (authed ? <EmptyState title="暂无社区" hint="用户创建社区后会出现在这里。" /> : <PendingApi />)}
        {list.map((c) => (
          <button
            key={c.id}
            type="button"
            disabled={busy === c.id}
            className="block w-full rounded-card bg-surface p-3 text-left shadow-card disabled:opacity-60"
            onClick={async () => {
              setBusy(c.id);
              await openCommunity(c.id);
              setBusy(null);
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[15px] font-semibold">{sanitizeText(c.name)}</div>
                {c.description ? <p className="mt-0.5 text-[13px] text-muted">{c.description}</p> : null}
                <p className="mt-1 text-[12px] text-muted">{c.createdAt}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {c.status === "taken_down" ? <Pill tone="danger">已下架</Pill> : <Pill tone={c.visibility === "private" ? "muted" : "ok"}>{c.visibility === "private" ? "私密" : "公开"}</Pill>}
                <span className="text-[12px] text-muted">{c.memberCount} 位成员</span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </Screen>
  );
}

export function CommunityDetailScreen() {
  const back = useAdmin((s) => s.back);
  const id = useAdmin((s) => s.nav.userId);
  const detail = useAdmin((s) => s.communityDetail);
  const openCommunity = useAdmin((s) => s.openCommunity);
  const openChannel = useAdmin((s) => s.openChannel);
  const go = useAdmin((s) => s.go);
  const backTo = useAdmin((s) => s.backTo);
  const moderate = useAdmin((s) => s.moderateCommunity);
  const moderateMember = useAdmin((s) => s.moderateMember);
  const [busy, setBusy] = useState<string | null>(null);
  const [act, setAct] = useState<null | { kind: CommunityAction } | { kind: CommunityMemberAction; userId: string; name: string; ban?: boolean }>(null);
  const [reason, setReason] = useState("");
  const [hours, setHours] = useState(24);
  const [sure, setSure] = useState(false);
  const [err, setErr] = useState("");
  const [working, setWorking] = useState(false);
  const [memberMenu, setMemberMenu] = useState<null | { userId: string; name: string; muted: boolean }>(null);

  useEffect(() => {
    if (id && (!detail || detail.id !== id)) void openCommunity(id, false).then(() => {
      /* openCommunity also navigates; if already on this page that's ok */
    });
  }, [id]); // eslint-disable-line

  function openAct(next: NonNullable<typeof act>) {
    setAct(next); setReason(""); setHours(24); setSure(false); setErr(""); setWorking(false);
  }
  function closeAct() { setAct(null); setErr(""); setWorking(false); }
  async function submitAct() {
    if (!act || !id || working) return;
    const r = reason.trim();
    const optional = act.kind === "restore" || act.kind === "unmute";
    if (!optional && !r) { setErr("请填写原因"); return; }
    if (act.kind === "delete" && !sure) { setErr("请勾选确认删除"); return; }
    setWorking(true);
    let msg: string | null;
    if (act.kind === "remove" || act.kind === "mute" || act.kind === "unmute") {
      msg = await moderateMember(act.kind, id, act.userId, { reason: r || undefined, hours: act.kind === "mute" ? hours : undefined, ban: act.kind === "remove" ? !!act.ban : undefined });
    } else {
      msg = await moderate(act.kind, id, { reason: r || undefined, confirm: act.kind === "delete" ? id : undefined });
    }
    setWorking(false);
    if (msg) { setErr(msg); return; }
    const wasDelete = act.kind === "delete";
    closeAct();
    if (wasDelete) backTo("communities");
  }

  const c = detail && detail.id === id ? detail : null;
  if (!c) {
    return (
      <Screen title="社区详情" onBack={() => backTo("communities")}>
        <p className="px-4 py-10 text-center text-[15px] text-muted">正在加载…</p>
      </Screen>
    );
  }

  return (
    <Screen title={sanitizeText(c.name)} onBack={() => backTo("communities")}>
      <div className="bg-surface px-4 py-3">
        <p className="text-[13px] text-muted">{c.description || "没有简介"}</p>
        <p className="mt-1 text-[13px]">
          <Pill tone={c.visibility === "private" ? "muted" : "ok"}>{c.visibility === "private" ? "私密" : "公开"}</Pill>
          {c.status === "taken_down" && <span className="ml-1"><Pill tone="danger">已下架</Pill></span>}
          <span className="ml-2 text-muted">{c.memberCount} 位成员 · {c.createdAt}</span>
        </p>
        {c.status === "taken_down" && (
          <p className="mt-1 text-[13px] text-danger">下架原因：{sanitizeText(c.takedownReason) || "—"}{c.takenDownAt ? ` · ${c.takenDownAt}` : ""}</p>
        )}
        <div className="mt-3 grid grid-cols-3 gap-2">
          <button type="button" className="h-10 rounded-full bg-subtle text-[14px] font-semibold" onClick={() => openAct({ kind: "warn" })}>警告</button>
          {c.status === "taken_down" ? (
            <button type="button" className="h-10 rounded-full bg-primary text-[14px] font-semibold text-on-primary" onClick={() => openAct({ kind: "restore" })}>恢复上架</button>
          ) : (
            <button type="button" className="nova-warn-soft h-10 rounded-full text-[14px] font-semibold" onClick={() => openAct({ kind: "takedown" })}>下架</button>
          )}
          <button type="button" className="nova-danger-soft h-10 rounded-full text-[14px] font-semibold" onClick={() => openAct({ kind: "delete" })}>删除</button>
        </div>
      </div>
      <h2 className="px-4 pt-3 text-[13px] font-semibold text-muted">频道</h2>
      <div className="mx-4 mb-2 overflow-hidden rounded-card bg-surface shadow-card">
        {c.channels.length === 0 && <p className="px-4 py-6 text-center text-[13px] text-muted">没有频道</p>}
        {c.channels.map((ch) => (
          <button
            key={ch.id}
            type="button"
            disabled={busy === ch.id}
            className="flex w-full items-center justify-between border-b border-line px-4 py-3 text-left last:border-b-0 disabled:opacity-60"
            onClick={async () => {
              setBusy(ch.id);
              await openChannel(c.id, ch.id);
              setBusy(null);
            }}
          >
            <span>
              <span className="text-[15px] font-medium">{sanitizeText(ch.name)}</span>
              <span className="ml-2 text-[12px] text-muted">{ch.kind === "announce" || ch.kind === "公告" ? "公告" : "文字"}{ch.isDefault ? " · 默认" : ""}</span>
            </span>
            <span className="text-[12px] text-muted">{ch.messageCount} 条消息</span>
          </button>
        ))}
      </div>
      <h2 className="px-4 pt-2 text-[13px] font-semibold text-muted">成员</h2>
      <ul className="bg-surface">
        {c.members.map((m) => (
          <li key={m.userId} className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <button type="button" className="text-left" onClick={() => go("user", m.userId)}>
              <span className="text-[15px]">{m.username || m.userId}</span>
              <span className="mt-0.5 block text-[12px] text-muted">加入于 {m.joinedAt || "—"}</span>
            </button>
            <span className="flex items-center gap-2">
              {m.muted && <Pill tone="warn">禁言中</Pill>}
              <Pill tone={m.role === "owner" ? "vip" : "muted"}>{roleLabel(m.role)}</Pill>
              {m.role !== "owner" && (
                <button type="button" aria-label="成员操作" className="h-9 px-2 text-[18px] text-muted" onClick={() => setMemberMenu({ userId: m.userId, name: m.username || m.userId, muted: m.muted })}>⋯</button>
              )}
            </span>
          </li>
        ))}
        {c.members.length === 0 && <li className="px-4 py-6 text-center text-[13px] text-muted">没有成员</li>}
      </ul>
      <Sheet open={!!memberMenu} title={memberMenu ? `成员 ${memberMenu.name}` : ""} onClose={() => setMemberMenu(null)}>
        {memberMenu && (
          <div className="grid gap-2 pb-2">
            {memberMenu.muted ? (
              <button type="button" className="h-11 rounded-full bg-subtle font-semibold" onClick={() => { const m = memberMenu; setMemberMenu(null); openAct({ kind: "unmute", userId: m.userId, name: m.name }); }}>解除禁言</button>
            ) : (
              <button type="button" className="h-11 rounded-full bg-subtle font-semibold" onClick={() => { const m = memberMenu; setMemberMenu(null); openAct({ kind: "mute", userId: m.userId, name: m.name }); }}>禁言</button>
            )}
            <button type="button" className="nova-warn-soft h-11 rounded-full font-semibold" onClick={() => { const m = memberMenu; setMemberMenu(null); openAct({ kind: "remove", userId: m.userId, name: m.name }); }}>移出社区</button>
            <button type="button" className="nova-danger-soft h-11 rounded-full font-semibold" onClick={() => { const m = memberMenu; setMemberMenu(null); openAct({ kind: "remove", userId: m.userId, name: m.name, ban: true }); }}>移出并禁止再加入</button>
          </div>
        )}
      </Sheet>
      <Sheet open={!!act} title={act ? actTitle(act) : ""} onClose={closeAct}>
        {act && (
          <div className="pb-2">
            <p className="mb-2 text-[13px] leading-5 text-muted">{actHint(act)}</p>
            <Field label={act.kind === "restore" || act.kind === "unmute" ? "说明（可选）" : "原因（必填，会通知对方）"}>
              <textarea className={`${inputClass} min-h-20 py-2`} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="例如：发布违规引流内容" />
            </Field>
            {act.kind === "mute" && (
              <Field label="禁言时长">
                <select className={inputClass} value={hours} onChange={(e) => setHours(Number(e.target.value))}>
                  <option value={1}>1 小时</option>
                  <option value={24}>1 天</option>
                  <option value={72}>3 天</option>
                  <option value={168}>7 天</option>
                  <option value={720}>30 天</option>
                </select>
              </Field>
            )}
            {act.kind === "delete" && (
              <label className="mb-2 flex items-center gap-2 text-[14px]">
                <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />
                我确认删除这个社区，删除后不能恢复
              </label>
            )}
            {err && <p className="mb-2 text-sm text-danger">{err}</p>}
            <div className="flex gap-2">
              <button type="button" className="h-11 flex-1 rounded-full bg-subtle text-[15px] font-semibold" onClick={closeAct}>取消</button>
              <button type="button" disabled={working} className={`h-11 flex-1 rounded-full text-[15px] font-semibold disabled:opacity-50 ${act.kind === "restore" || act.kind === "unmute" ? "bg-primary text-on-primary" : "nova-danger-soft"}`} onClick={() => void submitAct()}>
                {working ? "请稍候…" : "确认" + actTitle(act)}
              </button>
            </div>
          </div>
        )}
      </Sheet>
    </Screen>
  );
}

export function ChannelMessagesScreen() {
  const back = useAdmin((s) => s.back);
  const channelId = useAdmin((s) => s.nav.channelId);
  const communityId = useAdmin((s) => s.nav.userId);
  const info = useAdmin((s) => s.channelInfo);
  const messages = useAdmin((s) => s.channelMessages);
  const openChannel = useAdmin((s) => s.openChannel);
  const go = useAdmin((s) => s.go);
  const backTo = useAdmin((s) => s.backTo);

  useEffect(() => {
    if (channelId) void openChannel(communityId || "", channelId, false);
  }, [channelId]); // eslint-disable-line

  return (
    <Screen title={sanitizeText(info?.name) || "频道消息"} onBack={() => (communityId ? backTo("community", communityId) : back())}>
      <p className="px-4 pt-2 text-[12px] text-muted">{info ? `${messages.length} 条消息` : ""}</p>
      <div className="space-y-2 p-4">
        {messages.length === 0 && <EmptyState title="这个频道还没有消息" />}
        {messages.map((m) => (
          <article key={m.id} className="rounded-card bg-surface p-3 shadow-card">
            <div className="flex items-center justify-between gap-2">
              <button type="button" className="text-[13px] font-semibold" onClick={() => m.authorId && go("user", m.authorId)}>
                {m.authorName}
              </button>
              <span className="text-[11px] text-muted">{m.time}</span>
            </div>
            <p className="mt-1 text-[15px] leading-5">{sanitizeText(m.text)}</p>
          </article>
        ))}
      </div>
    </Screen>
  );
}

function roleLabel(role: string) {
  const map: Record<string, string> = { owner: "所有者", admin: "管理员", mod: "版主", member: "成员" };
  return map[role] || role;
}

type ActLike = { kind: CommunityAction | CommunityMemberAction; name?: string; ban?: boolean };
function actTitle(a: ActLike) {
  switch (a.kind) {
    case "takedown": return "下架社区";
    case "restore": return "恢复上架";
    case "warn": return "警告所有者";
    case "delete": return "删除社区";
    case "mute": return "禁言成员";
    case "unmute": return "解除禁言";
    case "remove": return a.ban ? "移出并禁止加入" : "移出成员";
  }
}
function actHint(a: ActLike) {
  switch (a.kind) {
    case "takedown": return "下架后用户端搜不到、进不去这个社区，所有者会收到带申诉入口的通知。可以随时恢复。";
    case "restore": return "恢复后社区重新对用户可见，所有者会收到通知。";
    case "warn": return "向社区所有者发送一条警告通知，社区不受影响。";
    case "delete": return "删除后社区和频道对所有人不可见，不能恢复。一般建议先下架。";
    case "mute": return `「${a.name || ""}」在禁言期间不能在这个社区发言，会收到通知。`;
    case "unmute": return `恢复「${a.name || ""}」在这个社区的发言。`;
    case "remove": return `把「${a.name || ""}」移出社区${a.ban ? "，并且不能再加入" : ""}，对方和所有者都会收到通知。`;
  }
}
