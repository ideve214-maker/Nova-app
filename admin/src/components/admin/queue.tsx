import { useState } from "react";
import { useAdmin, type PostItem } from "@/lib/admin/store";
import { Avatar, DemoBanner, PendingApi, Pill, PrimaryButton, Screen, Seg, Sheet } from "./ui";
import { mediaUrl } from "@/lib/admin/media";

type ContentTab = "all" | "post" | "comment" | "report";

export function ContentScreen() {
  const posts = useAdmin((s) => s.posts);
  const members = useAdmin((s) => s.members);
  const reports = useAdmin((s) => s.reports);
  const back = useAdmin((s) => s.back);
  const go = useAdmin((s) => s.go);
  const setPostStatus = useAdmin((s) => s.setPostStatus);
  const demoMode = useAdmin((s) => s.demoMode);
  const hasContentApi = useAdmin((s) => !!s.connection.available.adminContent || !!s.connection.available.posts);
  const postsNeedAuth = useAdmin((s) => !!s.connection.authRequired.posts);
  const [tab, setTab] = useState<ContentTab>("all");
  const reported = new Set(reports.filter((item) => item.status === "open" && item.postId).map((item) => item.postId));
  const list = posts.filter((item) => {
    if (tab === "post") return item.kind === "post";
    if (tab === "comment") return item.kind === "comment";
    if (tab === "report") return reported.has(item.id);
    return true;
  });

  return (
    <Screen title="内容审核" onBack={back}>
      <DemoBanner />
      <Seg
        value={tab}
        options={[
          { id: "all", label: "全部" },
          { id: "post", label: "帖子" },
          { id: "comment", label: "评论" },
          { id: "report", label: "举报" },
        ]}
        onChange={(id) => setTab(id as ContentTab)}
      />
      <div className="space-y-3 p-4">
        {list.length === 0 && (demoMode || hasContentApi ? <p className="py-10 text-center text-[15px] text-muted">这个分类里没有内容</p> : <PendingApi name="动态列表（GET /api/posts）" needsAuth={postsNeedAuth} />)}
        {list.map((post) => {
          const author = members.find((item) => item.id === post.authorId);
          return (
            <article key={post.id} className="rounded-card bg-surface p-2.5 shadow-card">
              <div className="flex gap-2.5">
                {post.image ? (
                  <img src={mediaUrl(post.image) || post.image} alt="" className="size-16 rounded-xl object-cover" />
                ) : (
                  <div className="grid size-16 place-items-center rounded-xl bg-subtle text-[12px] text-muted">评论</div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="text-[15px] font-medium">{post.title}</h2>
                    <Status status={post.status} />
                  </div>
                  <button type="button" className="mt-1 flex items-center gap-2 text-[13px] text-muted" onClick={() => author && go("user", author.id)}>
                    <Avatar src={author?.avatar} name={author?.name ?? "?"} className="size-5" />
                    @{author?.name ?? "未知"} · {post.time}
                  </button>
                  <p className="mt-1 text-[13px] text-muted">{post.excerpt}</p>
                </div>
              </div>
              {post.status === "pending" && (
                <div className="mt-2.5 grid grid-cols-2 gap-2">
                  <button type="button" className="h-11 rounded-full nova-ok-soft text-[15px] font-semibold" onClick={() => setPostStatus(post.id, "approved")}>
                    通过
                  </button>
                  <button type="button" className="h-11 rounded-full nova-danger-soft text-[15px] font-semibold" onClick={() => setPostStatus(post.id, "removed")}>
                    删除
                  </button>
                </div>
              )}
              {post.status !== "pending" && (
                <button type="button" className="mt-2.5 h-11 w-full rounded-full bg-subtle text-[13px] font-semibold" onClick={() => setPostStatus(post.id, "pending")}>
                  退回待审
                </button>
              )}
            </article>
          );
        })}
      </div>
    </Screen>
  );
}

function Status({ status }: { status: PostItem["status"] }) {
  if (status === "approved") return <Pill tone="ok">已通过</Pill>;
  if (status === "removed") return <Pill tone="danger">已删除</Pill>;
  return <Pill tone="warn">待审核</Pill>;
}

const resolutions = ["删除内容并警告", "仅警告用户", "封禁作者", "驳回举报"];

export function ReportsScreen() {
  const reports = useAdmin((s) => s.reports);
  const back = useAdmin((s) => s.back);
  const resolveReport = useAdmin((s) => s.resolveReport);
  const demoMode = useAdmin((s) => s.demoMode);
  const hasReportApi = useAdmin((s) => !!s.connection.available.adminReports);
  const [tab, setTab] = useState<"open" | "done">("open");
  const [current, setCurrent] = useState<string | null>(null);
  const [choice, setChoice] = useState(resolutions[0]);
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
      <div className="space-y-3 p-4">
        {list.length === 0 && (demoMode || hasReportApi ? <p className="py-10 text-center text-[15px] text-muted">没有{tab === "open" ? "待处理" : "已处理"}举报</p> : <PendingApi name="举报队列" />)}
        {list.map((item) => (
          <article key={item.id} className="rounded-card bg-surface p-3 shadow-card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-medium">{item.title}</h2>
                <p className="mt-1 text-sm text-muted">举报人：{item.reporter}</p>
                <p className="text-sm text-muted">{item.target}</p>
                <p className="text-sm">理由：{item.reason}</p>
                <p className="mt-1 text-xs text-muted">{item.time}</p>
                {item.resolution && <p className="mt-2 text-sm text-ok">结论：{item.resolution}</p>}
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
        ))}
      </div>
      <Sheet open={!!active && active.status === "open"} title="处理举报" onClose={() => setCurrent(null)}>
        {active && (
          <>
            <p className="mb-1 font-semibold">{active.title}</p>
            <p className="mb-3 text-sm text-muted">{active.target} · {active.reason}</p>
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
                resolveReport(active.id, choice);
                setCurrent(null);
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
            <p className="font-semibold">{active.title}</p>
            <p className="mt-2 text-sm text-muted">{active.resolution}</p>
          </>
        )}
      </Sheet>
    </Screen>
  );
}
