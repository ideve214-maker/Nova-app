import { useState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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
import {
  TREND_7,
  overviewOf,
  useAdmin,
  type NoticeItem,
  type PageName,
} from "@/lib/admin/store";
import { Avatar, Pill, RowLink, Screen, Seg, StarMark } from "./ui";
import { ConnectionBadge } from "./server-panel";

const modules: { name: PageName; label: string; desc: string; icon: typeof Users }[] = [
  { name: "users", label: "用户管理", desc: "查看、封禁、重置", icon: Users },
  { name: "content", label: "内容审核", desc: "帖子与评论", icon: Bell },
  { name: "reports", label: "举报处理", desc: "待处理队列", icon: Flag },
  { name: "community", label: "社区管理", desc: "话题与版块", icon: Hash },
  { name: "vip", label: "会员权益", desc: "开通、续期、撤销", icon: Crown },
  { name: "stats", label: "数据统计", desc: "用户与内容", icon: BarChart3 },
  { name: "announce", label: "公告通知", desc: "草稿、发布、撤回", icon: Megaphone },
  { name: "settings", label: "系统设置", desc: "开关与公开配置", icon: Settings },
  { name: "audit", label: "审计日志", desc: "操作可追溯", icon: ScrollText },
  { name: "security", label: "安全中心", desc: "设备、邀请、权限", icon: ShieldCheck },
];

export function HomeScreen() {
  const go = useAdmin((s) => s.go);
  const members = useAdmin((s) => s.members);
  const posts = useAdmin((s) => s.posts);
  const reports = useAdmin((s) => s.reports);
  const stats = overviewOf(members, posts);
  const openReports = reports.filter((item) => item.status === "open").length;
  const pending = posts.filter((item) => item.status === "pending").length;

  return (
    <section className="min-h-0 flex-1 overflow-y-auto pb-4">
      <header className="flex items-center justify-between px-4 pb-2 pt-4">
        <div>
          <p className="text-sm text-muted">NOVA</p>
          <h1 className="text-xl font-semibold">管理后台</h1>
        </div>
        <button type="button" onClick={() => go("me")} aria-label="我的" className="grid size-11 place-items-center">
          <span className="grid size-10 place-items-center rounded-full bg-primary text-on-primary">
            <StarMark className="size-5" />
          </span>
        </button>
      </header>

      <div className="nova-hero mx-4 rounded-card p-4 shadow-card">
        <div className="flex items-center justify-between text-sm">
          <span>平台概览</span>
          <span className="rounded-full bg-surface/20 px-2 py-0.5">较上周 +12%</span>
        </div>
        <p className="mt-3 text-sm text-on-primary/80">今日数据</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <Metric value={stats.users.toLocaleString("zh-CN")} label="总用户" />
          <Metric value={stats.active.toLocaleString("zh-CN")} label="活跃用户" />
          <Metric value={stats.posts.toLocaleString("zh-CN")} label="发帖数" />
        </div>
      </div>

      <div className="mx-4 mt-3 rounded-card bg-surface p-4 shadow-card">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">近 7 日活跃趋势</h2>
          <span className="text-sm text-ok">正常运行</span>
        </div>
        <div className="h-36">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={TREND_7}>
              <XAxis dataKey="d" tick={{ fill: "var(--color-muted)", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis hide domain={["dataMin - 80", "dataMax + 40"]} />
              <Tooltip
                formatter={(value) => [String(value), "活跃"]}
                contentStyle={{ borderRadius: 12, border: "1px solid var(--color-line)", fontSize: 12 }}
              />
              <Area type="monotone" dataKey="active" stroke="var(--color-primary)" fill="var(--color-primary)" fillOpacity={0.18} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="mx-4 mt-3 grid grid-cols-4 gap-2">
        <Shortcut label="用户管理" badge={String(members.length)} onClick={() => go("users")} icon={<Users className="size-5" />} />
        <Shortcut label="内容审核" badge={String(pending)} onClick={() => go("content")} icon={<Bell className="size-5" />} />
        <Shortcut label="举报处理" badge={String(openReports)} onClick={() => go("reports")} icon={<Flag className="size-5" />} />
        <Shortcut label="系统设置" onClick={() => go("settings")} icon={<Settings className="size-5" />} />
      </div>
    </section>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-on-primary/75">{label}</div>
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
    <button type="button" onClick={onClick} className="flex flex-col items-center gap-1 py-2">
      <span className="relative grid size-12 place-items-center rounded-2xl bg-surface text-primary shadow-card">
        {icon}
        {badge && badge !== "0" && (
          <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-danger px-1 text-xs font-semibold text-on-primary">
            {badge}
          </span>
        )}
      </span>
      <span className="text-xs text-muted">{label}</span>
    </button>
  );
}

export function ManageScreen() {
  const go = useAdmin((s) => s.go);
  const pending = useAdmin((s) => s.posts.filter((item) => item.status === "pending").length);
  const openReports = useAdmin((s) => s.reports.filter((item) => item.status === "open").length);
  return (
    <section className="min-h-0 flex-1 overflow-y-auto">
      <header className="px-4 pb-2 pt-4">
        <h1 className="text-xl font-semibold">管理</h1>
        <p className="text-sm text-muted">M3 后台功能</p>
      </header>
      <div className="mx-4 mb-4 overflow-hidden rounded-card bg-surface shadow-card">
        {modules.map((item) => {
          const Icon = item.icon;
          const extra =
            item.name === "content" ? pending : item.name === "reports" ? openReports : 0;
          return (
            <RowLink
              key={item.name}
              icon={<Icon className="size-5" />}
              title={item.label}
              desc={item.desc}
              onClick={() => go(item.name)}
              extra={
                <span className="flex items-center gap-1 text-sm text-muted">
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
  const [tab, setTab] = useState<(typeof noticeTabs)[number]["id"]>("all");
  const list = notices.filter((item) => tab === "all" || item.kind === tab);
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="px-4 pb-2 pt-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">消息中心</h1>
          <button type="button" className="text-sm text-primary" onClick={() => markNotices(tab === "all" ? undefined : tab)}>
            全部已读
          </button>
        </div>
      </header>
      <Seg
        value={tab}
        options={noticeTabs.map((item) => ({ id: item.id, label: item.label }))}
        onChange={(id) => setTab(id as typeof tab)}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted">没有消息</p>}
        {list.map((item) => (
          <article key={item.id} className="flex gap-3 border-b border-line bg-surface px-4 py-3">
            <span className="mt-1 size-2 shrink-0 rounded-full bg-primary" style={{ opacity: item.read ? 0 : 1 }} />
            <div className="min-w-0">
              <h2 className="font-semibold">{item.title}</h2>
              <p className="text-sm text-muted">{item.body}</p>
              <p className="mt-1 text-xs text-muted">{item.time}</p>
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
  const [open, setOpen] = useState(false);
  const changePassword = useAdmin((s) => s.changePassword);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState("");
  return (
    <section className="min-h-0 flex-1 overflow-y-auto">
      <header className="px-4 pb-3 pt-4">
        <h1 className="text-xl font-semibold">我的</h1>
      </header>
      <div className="mx-4 flex items-center gap-3 rounded-card bg-surface p-4 shadow-card">
        <span className="grid size-14 place-items-center rounded-full bg-primary text-on-primary">
          <StarMark className="size-7" />
        </span>
        <div>
          <div className="text-lg font-semibold">管理员</div>
          <div className="text-sm text-muted">admin · 根管理员</div>
          <div className="mt-1"><ConnectionBadge /></div>
        </div>
      </div>
      <div className="mx-4 mt-3 overflow-hidden rounded-card bg-surface shadow-card">
        <RowLink icon={<KeyRound className="size-5" />} title="修改密码" desc="不展示、不回读原密码" onClick={() => setOpen(true)} extra={<ChevronRight className="size-4 text-muted" />} />
        <RowLink icon={<ShieldCheck className="size-5" />} title="安全设置" desc="登录保护与邀请" onClick={() => go("security")} extra={<ChevronRight className="size-4 text-muted" />} />
        <RowLink icon={<Smartphone className="size-5" />} title="登录设备" desc="可退出其他设备" onClick={() => go("devices")} extra={<ChevronRight className="size-4 text-muted" />} />
        <RowLink icon={<ScrollText className="size-5" />} title="审计日志" onClick={() => go("audit")} extra={<ChevronRight className="size-4 text-muted" />} />
      </div>
      <div className="mx-4 mt-3">
        <button type="button" onClick={logout} className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-surface font-semibold text-danger shadow-card">
          <LogOut className="size-4" />
          退出登录
        </button>
      </div>
      {open && (
        <div className="mx-4 mt-3 rounded-card bg-surface p-4 shadow-card">
          <h2 className="mb-2 font-semibold">修改密码</h2>
          <input className="mb-2 h-11 w-full rounded-2xl border border-line bg-subtle px-3" type="password" placeholder="当前密码" value={current} onChange={(e) => setCurrent(e.target.value)} />
          <input className="mb-2 h-11 w-full rounded-2xl border border-line bg-subtle px-3" type="password" placeholder="新密码，至少 8 位" value={next} onChange={(e) => setNext(e.target.value)} />
          {error && <p className="mb-2 text-sm text-danger">{error}</p>}
          <button
            type="button"
            className="h-11 w-full rounded-full bg-primary font-semibold text-on-primary"
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
