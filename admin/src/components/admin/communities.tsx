import { useEffect, useState } from "react";
import { useAdmin } from "@/lib/admin/store";
import { sanitizeText } from "@/lib/admin/sanitize";
import { EmptyState, PendingApi, Pill, Screen } from "./ui";

export function CommunitiesScreen() {
  const back = useAdmin((s) => s.back);
  const list = useAdmin((s) => s.communities);
  const refresh = useAdmin((s) => s.refreshCommunities);
  const openCommunity = useAdmin((s) => s.openCommunity);
  const authed = useAdmin((s) => s.authed);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <Screen title="社区" onBack={back}>
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
                <Pill tone={c.visibility === "private" ? "muted" : "ok"}>{c.visibility === "private" ? "私密" : "公开"}</Pill>
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
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (id && (!detail || detail.id !== id)) void openCommunity(id, false).then(() => {
      /* openCommunity also navigates; if already on this page that's ok */
    });
  }, [id]); // eslint-disable-line

  const c = detail && detail.id === id ? detail : null;
  if (!c) {
    return (
      <Screen title="社区详情" onBack={back}>
        <p className="px-4 py-10 text-center text-[15px] text-muted">正在加载…</p>
      </Screen>
    );
  }

  return (
    <Screen title={sanitizeText(c.name)} onBack={() => go("communities")}>
      <div className="bg-surface px-4 py-3">
        <p className="text-[13px] text-muted">{c.description || "没有简介"}</p>
        <p className="mt-1 text-[13px]">
          <Pill tone={c.visibility === "private" ? "muted" : "ok"}>{c.visibility === "private" ? "私密" : "公开"}</Pill>
          <span className="ml-2 text-muted">{c.memberCount} 位成员 · {c.createdAt}</span>
        </p>
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
            <Pill tone={m.role === "owner" ? "vip" : "muted"}>{roleLabel(m.role)}</Pill>
          </li>
        ))}
        {c.members.length === 0 && <li className="px-4 py-6 text-center text-[13px] text-muted">没有成员</li>}
      </ul>
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

  useEffect(() => {
    if (channelId) void openChannel(communityId || "", channelId, false);
  }, [channelId]); // eslint-disable-line

  return (
    <Screen title={sanitizeText(info?.name) || "频道消息"} onBack={() => (communityId ? go("community", communityId) : back())}>
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
