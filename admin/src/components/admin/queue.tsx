import { useEffect, useState } from "react";
import { useAdmin, type PostItem, type ReportItem } from "@/lib/admin/store";
import { type MappedMedia } from "@/lib/admin/backend";
import { DemoBanner, PendingApi, Pill, PrimaryButton, Screen, Seg, Sheet } from "./ui";
import { hapticLight } from "@/lib/admin/native";
import { sanitizeText } from "@/lib/admin/sanitize";
import { AdminMediaThumb, MediaScanMeta, MediaStrip, MediaViewerSheet } from "./media-view";
import { VirtualRows } from "./virtual-list";
import { readScroll, saveScroll, scrollKey } from "@/lib/admin/scroll-restore";

export function ContentScreen() {
  const posts = useAdmin((s) => s.posts);
  const members = useAdmin((s) => s.members);
  const back = useAdmin((s) => s.back);
  const go = useAdmin((s) => s.go);
  const hideContent = useAdmin((s) => s.hideContent);
  const restoreContent = useAdmin((s) => s.restoreContent);
  const refreshContent = useAdmin((s) => s.refreshContent);
  const hasContentApi = useAdmin((s) => !!s.connection.available.adminContent || s.authed);
  const mediaReview = useAdmin((s) => s.mediaReview);
  const mediaReviewFeed = useAdmin((s) => s.mediaReviewFeed);
  const refreshMediaReview = useAdmin((s) => s.refreshMediaReview);
  const hasMediaApi = useAdmin((s) => !!s.connection.available.adminMedia);
  const [kind, setKind] = useState<"all" | "post" | "comment" | "review">("all");
  const [status, setStatus] = useState<"all" | "visible" | "removed">("all");
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [threadOf, setThreadOf] = useState<PostItem | null>(null);
  const [viewer, setViewer] = useState<MappedMedia | null>(null);
  const openContentItem = useAdmin((s) => s.openContentItem);

  useEffect(() => {
    if (kind === "review") void refreshMediaReview();
    else void refreshContent({ type: kind, status });
  }, [kind, status, refreshContent, refreshMediaReview]);

  const list = posts.filter((item) => {
    if (kind !== "all" && item.kind !== kind) return false;
    if (status === "removed" && item.status !== "removed") return false;
    if (status === "visible" && item.status === "removed") return false;
    return true;
  });
  const target = posts.find((p) => p.id === reasonFor);

  return (
    <Screen title="内容审核" onBack={back}>
      <Seg
        value={kind}
        options={[
          { id: "all", label: "全部" },
          { id: "post", label: "帖子" },
          { id: "comment", label: "评论" },
          { id: "review", label: "图像复核" },
        ]}
        onChange={(id) => setKind(id as typeof kind)}
      />
      {kind !== "review" && <div className="flex gap-2 bg-surface px-4 pb-2">
        {([
          ["all", "不限"],
          ["visible", "可见"],
          ["removed", "已删除"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setStatus(id)}
            className={`h-8 flex-1 rounded-full text-[13px] font-semibold ${status === id ? "bg-primary text-on-primary" : "bg-subtle text-muted"}`}
          >
            {label}
          </button>
        ))}
      </div>}
      <div className="p-4">
        {kind === "review" ? (
          <MediaReviewList
            items={mediaReview}
            feed={mediaReviewFeed}
            hasApi={hasMediaApi}
            onOpen={setViewer}
          />
        ) : list.length === 0 && (hasContentApi ? <p className="py-10 text-center text-[15px] text-muted">这个分类里没有内容</p> : <PendingApi name="内容列表（GET /api/admin/content）" />)}
        {kind !== "review" && (
          <VirtualRows
            items={list}
            getKey={(post) => post.kind + ":" + post.id}
            estimateSize={200}
            initialOffset={readScroll(scrollKey({ name: "content" }))}
            onOffsetChange={(top) => saveScroll(scrollKey({ name: "content" }), top)}
            render={(post) => {
          const author = members.find((item) => item.id === post.authorId);
          const name = post.authorName || author?.name || "未知";
          return (
            <article className="mb-3 rounded-card bg-surface p-2.5 shadow-card">
              <div className="flex gap-2.5">
                {post.media && post.media[0] ? (
                  <AdminMediaThumb media={post.media[0]} className="size-16 rounded-xl object-cover" onOpen={setViewer} />
                ) : post.image ? (
                  <AdminMediaThumb media={{ id: "", url: post.image, previewUrl: post.image, kind: "image", mime: "", name: "", width: null, height: null, hasPreview: false, scanStatus: "", scanDetail: "", score: null, ownerId: "" }} className="size-16 rounded-xl object-cover" onOpen={setViewer} />
                ) : (
                  <div className="grid size-16 place-items-center rounded-xl bg-subtle text-[12px] text-muted">{post.kind === "comment" ? "评论" : "帖子"}</div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="text-[15px] font-medium">{sanitizeText(post.title || post.excerpt) || (post.media?.length ? `媒体 ×${post.media.length}` : "")}</h2>
                    <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                      {post.kind === "post" && post.audienceLabel && <Pill tone="muted">{post.audienceLabel}</Pill>}
                      <Status status={post.status} />
                    </span>
                  </div>
                  <button type="button" className="mt-1 flex items-center gap-2 text-[13px] text-muted" onClick={() => post.authorId && go("user", post.authorId)}>
                    @{name} · {post.time}
                  </button>
                  {post.kind === "comment" && post.replyToName && (
                    <p className="mt-1 text-[12px] text-muted">回复 @{sanitizeText(post.replyToName)}{post.replyToText ? `：${sanitizeText(post.replyToText)}` : ""}</p>
                  )}
                  {(post.mood || post.location) && (
                    <p className="mt-1 text-[12px] text-muted">{[post.mood, post.location].filter(Boolean).join(" · ")}</p>
                  )}
                  {post.excerpt ? (
                    <p className="mt-1 text-[13px] text-muted">{sanitizeText(post.excerpt)}</p>
                  ) : post.media && post.media.length > 0 ? (
                    <p className="mt-1 text-[13px] text-muted">{post.media.length} 个媒体</p>
                  ) : null}
                  {post.kind === "post" && post.media && post.media.length > 0 && (
                    <MediaStrip items={post.media} onOpen={setViewer} />
                  )}
                  {post.kind === "comment" && (
                    <button
                      type="button"
                      className="mt-1 text-[12px] font-medium text-primary"
                      onClick={async () => {
                        const fresh = await openContentItem("comment", post.id);
                        if (fresh && fresh.rootId && fresh.rootId !== fresh.id) {
                          await openContentItem("comment", fresh.rootId);
                        }
                        if (fresh && fresh.parentId && fresh.parentId !== fresh.id && fresh.parentId !== fresh.rootId) {
                          await openContentItem("comment", fresh.parentId);
                        }
                        setThreadOf(fresh ? {
                          ...post,
                          parentId: fresh.parentId,
                          rootId: fresh.rootId,
                          depth: fresh.depth,
                          replyToName: fresh.replyTo && !fresh.replyTo.deleted ? fresh.replyTo.authorName : post.replyToName,
                          replyToText: fresh.replyTo && !fresh.replyTo.deleted ? fresh.replyTo.text : post.replyToText,
                          replyCount: fresh.replyCount,
                          excerpt: fresh.text,
                        } : post);
                      }}
                    >
                      查看楼层{post.depth ? ` · ${post.depth} 层` : ""}{post.replyCount ? ` · ${post.replyCount} 条回复` : ""}
                    </button>
                  )}
                  {post.adminReason && <p className="mt-1 text-[12px] text-warn">删除原因：{sanitizeText(post.adminReason)}</p>}
                </div>
              </div>
              {post.status === "removed" ? (
                <button
                  type="button"
                  disabled={busy}
                  className="mt-2.5 h-11 w-full rounded-full nova-ok-soft text-[15px] font-semibold disabled:opacity-50"
                  onClick={async () => {
                    void hapticLight();
                    setBusy(true);
                    await restoreContent(post.kind, post.id);
                    setBusy(false);
                  }}
                >
                  恢复
                </button>
              ) : (
                <button
                  type="button"
                  className="mt-2.5 h-11 w-full rounded-full nova-danger-soft text-[15px] font-semibold"
                  onClick={() => {
                    setReason("");
                    setReasonFor(post.id);
                  }}
                >
                  删除
                </button>
              )}
            </article>
          );
            }}
          />
        )}
      </div>
      <Sheet open={!!target} title="删除内容" onClose={() => setReasonFor(null)}>
        {target && (
          <>
            <p className="mb-2 text-[15px]">{sanitizeText(target.title || target.excerpt)}</p>
            <p className="mb-3 text-[13px] text-muted">删除后用户端不再展示。原因选填。</p>
            <textarea
              className="mb-3 min-h-20 w-full rounded-2xl border border-line bg-subtle px-3 py-2 text-[16px] outline-none"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="原因（可选）"
            />
            <PrimaryButton
              disabled={busy}
              onClick={async () => {
                void hapticLight();
                setBusy(true);
                await hideContent(target.kind, target.id, reason);
                setBusy(false);
                setReasonFor(null);
              }}
            >
              确认删除
            </PrimaryButton>
          </>
        )}
      </Sheet>
      <Sheet open={!!threadOf} title="评论楼层" onClose={() => setThreadOf(null)}>
        {threadOf && (
          <ThreadView rootId={threadOf.rootId || threadOf.id} currentId={threadOf.id} comments={posts} />
        )}
      </Sheet>
      <MediaViewerSheet media={viewer} onClose={() => setViewer(null)} />
    </Screen>
  );
}

function MediaReviewList({
  items,
  feed,
  hasApi,
  onOpen,
}: {
  items: MappedMedia[];
  feed: "idle" | "ok" | "error";
  hasApi: boolean;
  onOpen: (media: MappedMedia) => void;
}) {
  if (items.length === 0) {
    if (feed === "ok") return <p className="py-10 text-center text-[15px] text-muted">没有待人工复核的图像</p>;
    if (hasApi || feed === "error") return <PendingApi name="图像复核（GET /api/admin/media?scanStatus=review）" />;
    return <PendingApi name="图像复核（GET /api/admin/media?scanStatus=review）" />;
  }
  return (
    <VirtualRows
      items={items}
      getKey={(item) => item.id}
      estimateSize={120}
      initialOffset={readScroll(scrollKey({ name: "content" }))}
      onOffsetChange={(top) => saveScroll(scrollKey({ name: "content" }), top)}
      render={(item) => (
        <article className="mb-3 rounded-card bg-surface p-2.5 shadow-card">
          <div className="flex gap-2.5">
            <AdminMediaThumb media={item} className="size-16 rounded-xl object-cover" onOpen={onOpen} />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-[15px] font-medium">{sanitizeText(item.name) || item.id || "图像"}</h2>
              </div>
              <MediaScanMeta media={item} />
              <button type="button" className="mt-2 text-[13px] font-medium text-primary" onClick={() => onOpen(item)}>
                查看原图
              </button>
            </div>
          </div>
        </article>
      )}
    />
  );
}

function ThreadView({ rootId, currentId, comments }: { rootId: string; currentId: string; comments: PostItem[] }) {
  const thread = comments
    .filter((c) => c.kind === "comment" && (c.id === rootId || c.rootId === rootId || c.parentId === rootId))
    .slice()
    .sort((a, b) => (a.depth || 0) - (b.depth || 0) || a.time.localeCompare(b.time));
  if (thread.length === 0) {
    return <p className="text-[13px] text-muted">这条评论的楼层里暂时只有它自己。可在「评论」列表里看到其他回复。</p>;
  }
  return (
    <div className="space-y-2">
      {thread.map((c) => (
        <div
          key={c.id}
          className="rounded-2xl bg-subtle px-3 py-2"
          style={{ marginLeft: Math.min(c.depth || 0, 4) * 12 }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-semibold">{sanitizeText(c.authorName) || "未知"}{c.id === currentId ? "（当前）" : ""}</span>
            <span className="text-[11px] text-muted">{c.time}</span>
          </div>
          {c.replyToName && <p className="text-[11px] text-muted">回复 @{sanitizeText(c.replyToName)}</p>}
          <p className="mt-0.5 text-[14px]">{sanitizeText(c.excerpt)}</p>
          {c.replyCount ? <p className="text-[11px] text-muted">{c.replyCount} 条回复</p> : null}
        </div>
      ))}
    </div>
  );
}

function Status({ status }: { status: PostItem["status"] }) {
  if (status === "approved") return <Pill tone="ok">可见</Pill>;
  if (status === "removed") return <Pill tone="danger">已删除</Pill>;
  return <Pill tone="warn">待审核</Pill>;
}

const resolutions = ["删除内容并警告", "仅警告用户", "封禁作者", "驳回举报"];

function reportTargetText(item: ReportItem, communityName?: string) {
  if (item.targetType === "community") {
    const name = item.targetName || communityName || item.targetId;
    return name ? `社区：${name}` : item.target;
  }
  if (item.targetType === "conversation" && !(item.messageIds && item.messageIds.length)) {
    return item.targetName ? `群：${item.targetName}` : item.targetId ? `群：${item.targetId}` : item.target;
  }
  return item.target;
}

export function ReportsScreen() {
  const reports = useAdmin((s) => s.reports);
  const communities = useAdmin((s) => s.communities);
  const back = useAdmin((s) => s.back);
  const go = useAdmin((s) => s.go);
  const resolveReport = useAdmin((s) => s.resolveReport);
  const refreshReports = useAdmin((s) => s.refreshReports);
  const refreshCommunities = useAdmin((s) => s.refreshCommunities);
  const hasReportApi = useAdmin((s) => !!s.connection.available.adminReports || s.authed);
  useEffect(() => {
    void refreshReports();
    void refreshCommunities();
  }, [refreshReports, refreshCommunities]);
  const [tab, setTab] = useState<"open" | "done">("open");
  const [current, setCurrent] = useState<string | null>(null);
  const [choice, setChoice] = useState(resolutions[0]);
  const [viewer, setViewer] = useState<MappedMedia | null>(null);
  const list = reports.filter((item) => item.status === tab);
  const active = reports.find((item) => item.id === current);

  return (
    <Screen title="举报处理" onBack={back}>
      <DemoBanner />
      <Seg
        value={tab}
        options={[
          { id: "open", label: `待处理 (${reports.filter((item) => item.status === "open").length})` },
          { id: "done", label: "已处理" },
        ]}
        onChange={(id) => setTab(id as "open" | "done")}
      />
      <div className="p-4">
        {list.length === 0 && (hasReportApi ? <p className="py-10 text-center text-[15px] text-muted">没有{tab === "open" ? "待处理" : "已处理"}举报</p> : <PendingApi name="举报队列" />)}
        <VirtualRows
          items={list}
          getKey={(item) => item.id}
          estimateSize={160}
          initialOffset={readScroll(scrollKey({ name: "reports" }))}
          onOffsetChange={(top) => saveScroll(scrollKey({ name: "reports" }), top)}
          render={(item) => (
          <article className="mb-3 rounded-card bg-surface p-3 shadow-card">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-[15px] font-medium">{sanitizeText(item.title)}</h2>
                <p className="mt-1 text-sm text-muted">举报人：{sanitizeText(item.reporter)}</p>
                <p className="text-sm text-muted">{sanitizeText(reportTargetText(item, communities.find((c) => c.id === item.targetId)?.name))}</p>
                {item.targetType === "community" && item.targetId && (
                  <button type="button" className="mt-0.5 text-[13px] font-medium text-primary" onClick={() => go("community", item.targetId)}>
                    查看社区
                  </button>
                )}
                <p className="text-sm">理由：{sanitizeText(item.reason)}</p>
                {item.media && item.media.length > 0 && <MediaStrip items={item.media} onOpen={setViewer} />}
                <p className="mt-1 text-xs text-muted">{item.time}</p>
                {item.resolution && <p className="mt-2 text-sm text-ok">结论：{sanitizeText(item.resolution)}</p>}
              </div>
            </div>
            {item.status === "open" && (
              <div className="mt-2.5 grid grid-cols-2 gap-2">
                <button type="button" className="h-10 rounded-full bg-subtle font-semibold" onClick={() => setCurrent(item.id)}>
                  查看
                </button>
                <button type="button" className="h-10 rounded-full bg-primary font-semibold text-on-primary" onClick={() => { setChoice(resolutions[0]); setCurrent(item.id); }}>
                  处理
                </button>
              </div>
            )}
          </article>
          )}
        />
      </div>
      <Sheet open={!!active && active.status === "open"} title="处理举报" onClose={() => setCurrent(null)}>
        {active && (
          <>
            <p className="mb-1 font-semibold">{sanitizeText(active.title)}</p>
            <p className="mb-3 text-sm text-muted">{sanitizeText(reportTargetText(active, communities.find((c) => c.id === active.targetId)?.name))} · {sanitizeText(active.reason)}</p>
            <div className="mb-4 space-y-2">
              {resolutions.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setChoice(item)}
                  className={`flex h-11 w-full items-center rounded-2xl px-3 text-left ${choice === item ? "bg-primary text-on-primary" : "bg-subtle"}`}
                >
                  {item}
                </button>
              ))}
            </div>
            <PrimaryButton
              onClick={() => {
                void hapticLight();
                void resolveReport(active.id, choice).then(() => setCurrent(null));
              }}
            >
              确认处理
            </PrimaryButton>
            <p className="mt-3 text-xs text-muted">只会关联用户提交的对象，不会翻看无关私聊。外部推送未接入，结论写入站内通知。</p>
          </>
        )}
      </Sheet>
      <Sheet open={!!active && active.status === "done"} title="处理记录" onClose={() => setCurrent(null)}>
        {active && (
          <>
            <p className="font-semibold">{sanitizeText(active.title)}</p>
            <p className="mt-2 text-sm text-muted">{sanitizeText(active.resolution)}</p>
            {active.media && active.media.length > 0 && <MediaStrip items={active.media} onOpen={setViewer} />}
          </>
        )}
      </Sheet>
      <MediaViewerSheet media={viewer} onClose={() => setViewer(null)} />
    </Screen>
  );
}
