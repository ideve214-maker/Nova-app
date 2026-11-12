import { useEffect, useState, type ReactNode } from "react";
import {
  BarChart3,
  Bell,
  ChevronRight,
  CreditCard,
  Crown,
  Flag,
  Ban,
  Hash,
  MessagesSquare,
  KeyRound,
  LogOut,
  Megaphone,
  ScrollText,
  Settings,
  ShieldCheck,
  Smartphone,
  Users,
} from "lucide-react";
import { overviewOf, useAdmin, type NoticeItem, type PageName } from "@/lib/admin/store";
import { getStoredTheme, setTheme, type ThemeMode } from "@/lib/admin/theme";
import { DataHint, DemoBanner, EmptyState, Pill, PendingApi, RowLink, Seg, StarMark } from "./ui";
import { ConnectionBadge } from "./server-panel";

const modules: { name: PageName; label: string; desc: string; icon: typeof Users }[] = [
  { name: "users", label: "用户管理", desc: "查看、封禁、重置", icon: Users },
  { name: "content", label: "内容审核", desc: "帖子与评论", icon: Bell },
  { name: "payments", label: "付款审核", desc: "收款码人工核对", icon: CreditCard },
  { name: "reports", label: "举报处理", desc: "待处理队列", icon: Flag },
  { name: "communities", label: "社区管理", desc: "成员、频道、消息", icon: MessagesSquare },
  { name: "blockwords", label: "屏蔽词", desc: "平台拦截规则", icon: Ban },
  { name: "vip", label: "会员权益", desc: "开通与撤销", icon: Crown },
  { name: "stats", label: "数据统计", desc: "用户与内容", icon: BarChart3 },
  { name: "announce", label: "公告通知", desc: "发布、编辑、撤回", icon: Megaphone },
  { name: "settings", label: "系统设置", desc: "开关与服务器", icon: Settings },
  { name: "audit", label: "审计日志", desc: "操作可追溯", icon: ScrollText },
  { name: "events", label: "安全事件", desc: "限流与异常", icon: ShieldCheck },
  { name: "appeals", label: "申诉处理", desc: "通过或驳回", icon: Flag },
  { name: "security", label: "安全中心", desc: "设备、邀请、权限", icon: KeyRound },
];

export function HomeScreen() {
  const go = useAdmin((s) => s.go);
  const members = useAdmin((s) => s.members);
  const posts = useAdmin((s) => s.posts);
  const reports = useAdmin((s) => s.reports);
  const liveStats = useAdmin((s) => s.stats);
  const connection = useAdmin((s) => s.connection);
  const refreshStats = useAdmin((s) => s.refreshStats);
  const local = overviewOf(members, posts);
  const stats = liveStats
    ? { users: liveStats.usersTotal, active: liveStats.usersActive, posts: liveStats.postsVisible }
    : local;
  const openReports = liveStats ? liveStats.reportsPending : reports.filter((item) => item.status === "open").length;
  const pendingPay = liveStats ? liveStats.paymentsReview : 0;
  const hasUserApi = !!connection.available.adminUsers || !!connection.available.adminStats;
  const hasStatsApi = !!connection.available.adminStats || !!liveStats;
  const showCounts = hasUserApi || hasStatsApi || !!liveStats;
  const dash = "—";
  useEffect(() => { void refreshStats(); }, [refreshStats]);

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
        <p className="mt-2 text-[12px] text-on-primary/80">{showCounts ? "来自已接入的接口" : "今日数据"}</p>
        <div className="mt-1.5 grid grid-cols-3 gap-2">
          <Metric value={showCounts ? stats.users.toLocaleString("zh-CN") : dash} label="总用户" />
          <Metric value={showCounts ? stats.active.toLocaleString("zh-CN") : dash} label="活跃用户" />
          <Metric value={showCounts ? stats.posts.toLocaleString("zh-CN") : dash} label="发帖数" />
        </div>
      </div>

      {!hasStatsApi && !liveStats && (
        <DataHint>
          {connection.reachable
            ? "还没有读到管理统计。登录后会从 GET /api/admin/stats 拉取真实数字。"
            : "未连接后端，无法读取统计。数字显示为 —，不是 0，也不是演示数据。"}
        </DataHint>
      )}

      <div className="mx-4 mt-2 rounded-card bg-surface px-3 py-3 shadow-card">
        <h2 className="text-[15px] font-semibold">近 7 日活跃趋势</h2>
        <p className="mt-1 text-[13px] leading-5 text-muted">后端目前不提供按日活跃序列，这里不展示虚构曲线。</p>
      </div>

      <div className="mx-4 mt-2 grid grid-cols-4 gap-1">
        <Shortcut label="用户管理" badge={showCounts && members.length ? String(members.length) : undefined} onClick={() => go("users")} icon={<Users className="size-4" />} />
        <Shortcut label="付款审核" badge={showCounts && pendingPay ? String(pendingPay) : undefined} onClick={() => go("payments")} icon={<CreditCard className="size-4" />} />
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
  const pending = useAdmin((s) => s.stats?.paymentsReview || 0);
  const openReports = useAdmin((s) => s.stats?.reportsPending || s.reports.filter((item) => item.status === "open").length);
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
          const extra = item.name === "payments" ? pending : item.name === "reports" ? openReports : 0;
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
        {list.length === 0 && <EmptyState title="没有消息" hint="管理端通知接口尚未提供，这里不会显示虚构消息。" />}
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

const themeOptions: { id: ThemeMode; label: string }[] = [
  { id: "system", label: "跟随系统" },
  { id: "dark", label: "深色" },
  { id: "light", label: "浅色" },
];

export function MeScreen() {
  const go = useAdmin((s) => s.go);
  const logout = useAdmin((s) => s.logout);
  const adminProfile = useAdmin((s) => s.adminProfile);
  const adminName = useAdmin((s) => s.adminName);
  const detectedVersion = useAdmin((s) => s.connection.detectedVersion);
  const [theme, setThemeMode] = useState<ThemeMode>(() => (typeof window === "undefined" ? "system" : getStoredTheme()));
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
          <div className="text-[16px] font-semibold">{adminProfile?.username || adminName || "管理员"}</div>
          <div className="text-[13px] text-muted">{adminProfile?.role || "admin"} · 服务器账号</div>
          <div className="mt-1">
            <ConnectionBadge />
          </div>
        </div>
      </div>
      <DataHint>
        已用服务器管理员账号登录，请求会带 na_ 令牌。口令由运营用 admin-cli 管理，这里不能改。401 会回到登录页。
      </DataHint>
      <div className="mx-4 mt-2 overflow-hidden rounded-card bg-surface shadow-card">
        <RowLink icon={<CreditCard className="size-4" />} title="付款审核" desc="收款码人工核对" onClick={() => go("payments")} extra={<ChevronRight className="size-4 text-muted" />} />
        <RowLink icon={<ShieldCheck className="size-4" />} title="安全事件" desc="限流与异常" onClick={() => go("events")} extra={<ChevronRight className="size-4 text-muted" />} />
        <RowLink icon={<Flag className="size-4" />} title="申诉处理" desc="通过或驳回" onClick={() => go("appeals")} extra={<ChevronRight className="size-4 text-muted" />} />
        <RowLink icon={<KeyRound className="size-4" />} title="安全设置" desc="登录保护说明" onClick={() => go("security")} extra={<ChevronRight className="size-4 text-muted" />} />
        <RowLink icon={<ScrollText className="size-4" />} title="审计日志" onClick={() => go("audit")} extra={<ChevronRight className="size-4 text-muted" />} />
      </div>
      <div className="mx-4 mt-3 overflow-hidden rounded-card bg-surface px-3.5 py-3 shadow-card">
        <div className="text-[15px] font-medium">外观</div>
        <div className="mt-0.5 text-[13px] text-muted">星澜主题，深色为默认，也可跟随系统。</div>
        <div className="mt-2.5 grid grid-cols-3 gap-1 rounded-[14px] bg-subtle p-1">
          {themeOptions.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setTheme(item.id);
                setThemeMode(item.id);
              }}
              className={`h-9 rounded-[12px] text-[13px] font-semibold ${theme === item.id ? "bg-surface text-primary shadow-card" : "text-muted"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      {detectedVersion && (
        <p className="mt-3 px-4 text-center text-[12px] text-muted">后端 {detectedVersion}</p>
      )}
      <div className="mx-4 mt-3">
        <button type="button" onClick={() => void logout()} className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-surface text-[16px] font-semibold text-danger shadow-card">
          <LogOut className="size-4" />
          退出登录
        </button>
      </div>
    </section>
  );
}
