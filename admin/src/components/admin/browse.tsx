import { useState, type ReactNode } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  BarChart3,
  Bell,
  ChevronRight,
  Crown,
  Flag,
  Hash,
  KeyRound,
  LogOut,
  Megaphone,
  ScrollText,
  Settings,
  ShieldCheck,
  Smartphone,
  Users,
} from "lucide-react";
import { TREND_7, overviewOf, useAdmin, type NoticeItem, type PageName } from "@/lib/admin/store";
import { DataHint, DemoBanner, EmptyState, Pill, PendingApi, RowLink, Seg, StarMark } from "./ui";
import { ConnectionBadge } from "./server-panel";

const modules: { name: PageName; label: string; desc: string; icon: typeof Users }[] = [
  { name: "users", label: "用户管理", desc: "查看、封禁、重置", icon: Users },
  { name: "content", label: "内容审核", desc: "帖子与评论", icon: Bell },
  { name: "reports", label: "举报处理", desc: "待处理队列", icon: Flag },
  { name: "community", label: "社区管理", desc: "话题与版块", icon: Hash },
  { name: "vip", label: "会员权益", desc: "目录、开通、续期", icon: Crown },
  { name: "stats", label: "数据统计", desc: "用户与内容", icon: BarChart3 },
  { name: "announce", label: "公告通知", desc: "草稿、发布、撤回", icon: Megaphone },
  { name: "settings", label: "系统设置", desc: "开关与服务器", icon: Settings },
  { name: "audit", label: "审计日志", desc: "操作可追溯", icon: ScrollText },
  { name: "security", label: "安全中心", desc: "设备、邀请、权限", icon: ShieldCheck },
];

export function HomeScreen() {
  const go = useAdmin((s) => s.go);
  const members = useAdmin((s) => s.members);
  const posts = useAdmin((s) => s.posts);
  const reports = useAdmin((s) => s.reports);
  const demoMode = useAdmin((s) => s.demoMode);
  const connection = useAdmin((s) => s.connection);
  const stats = overviewOf(members, posts);
  const openReports = reports.filter((item) => item.status === "open").length;
  const pending = posts.filter((item) => item.status === "pending").length;
  const hasUserApi = !!connection.available.adminUsers;
  const hasStatsApi = !!connection.available.adminStats;
  const showCounts = demoMode || hasUserApi || hasStatsApi;
  const dash = "—";

  return (
    <section className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-3">
      <header className="flex items-center justify-between px-4 pb-1.5 pt-safe">
        <div className="pt-2">
          <p className="text-[12px] text-muted">NOVA</p>
          <h1 className="text-[17px] font-semibold leading-tight">管理后台</h1>
        </div>
        <button type="button" onClick={() => go("me")} aria-label="我的" className="grid size-11 place-items-center">
          <span className="grid size-8 place-items-center rounded-full bg-primary text-on-primary">
            <StarMark className="size-4" />
          </span>
        </button>
      </header>

      <DemoBanner />

      <div className="nova-hero mx-4 rounded-card px-3.5 py-3">
        <div className="flex items-center justify-between text-[13px]">
          <span>平台概览</span>
          <ConnectionBadge />
        </div>
        <p className="mt-2 text-[12px] text-on-primary/80">{demoMode ? "演示数据（虚构）" : showCounts ? "来自已接入的接口" : "今日数据"}</p>
        <div className="mt-1.5 grid grid-cols-3 gap-2">
          <Metric value={showCounts ? stats.users.toLocaleString("zh-CN") : dash} label="总用户" />
          <Metric value={showCounts ? stats.active.toLocaleString("zh-CN") : dash} label="活跃用户" />
          <Metric value={showCounts ? stats.posts.toLocaleString("zh-CN") : dash} label="发帖数" />
        </div>
      </div>

      {!demoMode && !hasStatsApi && (
        <DataHint>
          {connection.reachable
            ? "没有管理统计接口。动态、社区等用户接口需登录，管理端没有管理员令牌，不会代拉，这里不展示虚构数字。"
            : "未连接后端，无法读取统计。公开预览无法访问你电脑上的服务。数字显示为 —，不是 0，也不是演示数据。"}
        </DataHint>
      )}

      {demoMode ? (
        <div className="mx-4 mt-2 rounded-card bg-surface p-3 shadow-card">
          <div className="mb-1.5 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">近 7 日活跃趋势</h2>
            <span className="text-[12px] text-warn">演示</span>
          </div>
          <div className="h-28">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={TREND_7}>
                <XAxis dataKey="d" tick={{ fill: "var(--color-muted)", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis hide domain={["dataMin - 80", "dataMax + 40"]} />
                <Tooltip
                  formatter={(value) => [String(value), "活跃"]}
                  contentStyle={{ borderRadius: 10, border: "1px solid var(--color-line)", fontSize: 12 }}
                />
                <Area type="monotone" dataKey="active" stroke="var(--color-primary)" fill="var(--color-primary)" fillOpacity={0.18} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : (
        <div className="mx-4 mt-2 rounded-card bg-surface px-3 py-3 shadow-card">
          <h2 className="text-[15px] font-semibold">近 7 日活跃趋势</h2>
          <p className="mt-1 text-[13px] leading-5 text-muted">接口待接入，暂无趋势图。</p>
        </div>
      )}

      <div className="mx-4 mt-2 grid grid-cols-4 gap-1">
        <Shortcut label="用户管理" badge={showCounts && members.length ? String(members.length) : undefined} onClick={() => go("users")} icon={<Users className="size-4" />} />
        <Shortcut label="内容审核" badge={showCounts && pending ? String(pending) : undefined} onClick={() => go("content")} icon={<Bell className="size-4" />} />
        <Shortcut label="举报处理" badge={showCounts && openReports ? String(openReports) : undefined} onClick={() => go("reports")} icon={<Flag className="size-4" />} />
        <Shortcut label="系统设置" onClick={() => go("settings")} icon={<Settings className="size-4" />} />
      </div>
    </section>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="text-[20px] font-semibold leading-tight tabular-nums">{value}</div>
      <div className="text-[11px] text-on-primary/75">{label}</div>
    </div>
  );
}

function Shortcut({
  label,
  icon,
  badge,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-center gap-1 py-1.5">
      <span className="relative grid size-10 place-items-center rounded-xl bg-surface text-primary shadow-card">
        {icon}
        {badge && (
          <span className="absolute -right-1 -top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-danger px-0.5 text-[10px] font-semibold text-on-primary">
            {badge}
          </span>
        )}
      </span>
      <span className="text-[10px] leading-3 text-muted">{label}</span>
    </button>
  );
}

export function ManageScreen() {
  const go = useAdmin((s) => s.go);
  const demoMode = useAdmin((s) => s.demoMode);
  const pending = useAdmin((s) => s.posts.filter((item) => item.status === "pending").length);
  const openReports = useAdmin((s) => s.reports.filter((item) => item.status === "open").length);
  return (
    <section className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
      <header className="px-4 pb-1.5 pt-safe">
        <h1 className="pt-2 text-[17px] font-semibold">管理</h1>
        <p className="text-[13px] text-muted">后台功能</p>
      </header>
      <DemoBanner />
      <div className="mx-4 mb-3 overflow-hidden rounded-card bg-surface shadow-card">
        {modules.map((item) => {
          const Icon = item.icon;
          const extra = demoMode ? (item.name === "content" ? pending : item.name === "reports" ? openReports : 0) : 0;
          return (
            <RowLink
              key={item.name}
              icon={<Icon className="size-4" />}
              title={item.label}
              desc={item.desc}
              onClick={() => go(item.name)}
              extra={
                <span className="flex items-center gap-1 text-[13px] text-muted">
                  {extra > 0 && <Pill tone="danger">{extra}</Pill>}
                  <ChevronRight className="size-4" />
                </span>
              }
            />
          );
        })}
      </div>
    </section>
  );
}

const noticeTabs: { id: NoticeItem["kind"] | "all"; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "system", label: "系统通知" },
  { id: "review", label: "审核通知" },
  { id: "violation", label: "违规提醒" },
];

export function MessagesScreen() {
  const notices = useAdmin((s) => s.notices);
  const markNotices = useAdmin((s) => s.markNotices);
  const demoMode = useAdmin((s) => s.demoMode);
  const noticeNeedsAuth = useAdmin((s) => !!s.connection.authRequired.notifications);
  const [tab, setTab] = useState<(typeof noticeTabs)[number]["id"]>("all");
  const list = notices.filter((item) => tab === "all" || item.kind === tab);
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-x-hidden">
      <header className="px-4 pb-1.5 pt-safe">
        <div className="flex items-center justify-between pt-2">
          <h1 className="text-[17px] font-semibold">消息中心</h1>
          <button type="button" className="h-11 text-[13px] text-primary" onClick={() => markNotices(tab === "all" ? undefined : tab)}>
            全部已读
          </button>
        </div>
      </header>
      <DemoBanner />
      <Seg
        value={tab}
        options={noticeTabs.map((item) => ({ id: item.id, label: item.label }))}
        onChange={(id) => setTab(id as typeof tab)}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.length === 0 &&
          (demoMode ? (
            <EmptyState title="没有消息" />
          ) : (
            <PendingApi name="通知（GET /api/notifications）" needsAuth={noticeNeedsAuth} />
          ))}
        {list.map((item) => (
          <article key={item.id} className="flex gap-3 border-b border-line bg-surface px-4 py-2.5">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" style={{ opacity: item.read ? 0 : 1 }} />
            <div className="min-w-0">
              <h2 className="text-[15px] font-medium">{item.title}</h2>
              <p className="text-[13px] text-muted">{item.body}</p>
              <p className="mt-0.5 text-[11px] text-muted">{item.time}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function MeScreen() {
  const go = useAdmin((s) => s.go);
  const logout = useAdmin((s) => s.logout);
  const demoMode = useAdmin((s) => s.demoMode);
  const setDemoMode = useAdmin((s) => s.setDemoMode);
  const [open, setOpen] = useState(false);
  const changePassword = useAdmin((s) => s.changePassword);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState("");
  return (
    <section className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-3">
      <header className="px-4 pb-2 pt-safe">
        <h1 className="pt-2 text-[17px] font-semibold">我的</h1>
      </header>
      <div className="mx-4 flex items-center gap-3 rounded-card bg-surface p-3 shadow-card">
        <span className="grid size-11 place-items-center rounded-full bg-primary text-on-primary">
          <StarMark className="size-5" />
        </span>
        <div className="min-w-0">
          <div className="text-[16px] font-semibold">管理员</div>
          <div className="text-[13px] text-muted">admin · 本机操作员</div>
          <div className="mt-1">
            <ConnectionBadge />
          </div>
        </div>
      </div>
      <DataHint>
        登录使用本机口令，因为 M2.6 后端没有管理端鉴权（/api/admin/auth 等尚未实现）。修改密码只保存在这台设备上。
      </DataHint>
      <div className="mx-4 mt-2 flex items-center justify-between rounded-card bg-surface px-3.5 py-2.5 shadow-card">
        <div className="min-w-0 pr-3">
          <div className="text-[15px] font-medium">演示模式</div>
          <div className="text-[12px] leading-4 text-muted">默认关闭。打开后用本地虚构数据预览界面，并在各页标明。</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={demoMode}
          aria-label="演示模式"
          onClick={() => setDemoMode(!demoMode)}
          className={`h-7 w-11 shrink-0 rounded-full p-0.5 ${demoMode ? "bg-warn" : "bg-line"}`}
        >
          <span className={`block size-6 rounded-full bg-surface transition-transform ${demoMode ? "translate-x-4" : ""}`} />
        </button>
      </div>
      <div className="mx-4 mt-2 overflow-hidden rounded-card bg-surface shadow-card">
        <RowLink icon={<KeyRound className="size-4" />} title="修改本机口令" desc="不展示、不回读原密码" onClick={() => setOpen(true)} extra={<ChevronRight className="size-4 text-muted" />} />
        <RowLink icon={<ShieldCheck className="size-4" />} title="安全设置" desc="登录保护与邀请" onClick={() => go("security")} extra={<ChevronRight className="size-4 text-muted" />} />
        <RowLink icon={<Smartphone className="size-4" />} title="登录设备" desc="本机会话" onClick={() => go("devices")} extra={<ChevronRight className="size-4 text-muted" />} />
        <RowLink icon={<ScrollText className="size-4" />} title="审计日志" onClick={() => go("audit")} extra={<ChevronRight className="size-4 text-muted" />} />
      </div>
      <div className="mx-4 mt-3">
        <button type="button" onClick={logout} className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-surface text-[16px] font-semibold text-danger shadow-card">
          <LogOut className="size-4" />
          退出登录
        </button>
      </div>
      {open && (
        <div className="mx-4 mt-3 rounded-card bg-surface p-3 shadow-card">
          <h2 className="mb-2 text-[15px] font-semibold">修改本机口令</h2>
          <input className="mb-2 h-11 w-full rounded-xl border border-line bg-subtle px-3 text-[16px]" type="password" placeholder="当前密码" value={current} onChange={(e) => setCurrent(e.target.value)} />
          <input className="mb-2 h-11 w-full rounded-xl border border-line bg-subtle px-3 text-[16px]" type="password" placeholder="新密码，至少 8 位" value={next} onChange={(e) => setNext(e.target.value)} />
          {error && <p className="mb-2 text-[13px] text-danger">{error}</p>}
          <button
            type="button"
            className="h-11 w-full rounded-full bg-primary text-[16px] font-semibold text-on-primary"
            onClick={() => {
              const message = changePassword(current, next);
              setError(message ?? "");
              if (!message) {
                setOpen(false);
                setCurrent("");
                setNext("");
              }
            }}
          >
            保存
          </button>
        </div>
      )}
    </section>
  );
}
