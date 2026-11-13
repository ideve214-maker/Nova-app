import { useEffect, useState, type ReactNode } from "react";
import {
  BarChart3,
  Ban,
  ChevronRight,
  CreditCard,
  Crown,
  Flag,
  Hash,
  KeyRound,
  LogOut,
  Megaphone,
  MessagesSquare,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useAdmin, type NoticeItem, type PageName } from "@/lib/admin/store";
import { sanitizeText } from "@/lib/admin/sanitize";
import { formatBytes, formatUptime, readHealthView } from "@/lib/admin/backend";
import { hapticLight } from "@/lib/admin/native";
import { getStoredTheme, setSkin, setTheme, SKIN_DEFAULT_MODE, SKINS, type SkinId, type ThemeMode } from "@/lib/admin/theme";
import { DataHint, DemoBanner, EmptyState, Pill, RowLink, Seg, StarMark, useAppearance } from "./ui";
import { ConnectionBadge } from "./server-panel";

const modules: { name: PageName; label: string; desc: string; icon: typeof Users }[] = [
  { name: "users", label: "用户管理", desc: "查看、封禁、重置", icon: Users },
  { name: "vip", label: "会员权益", desc: "开通与撤销", icon: Crown },
  { name: "content", label: "内容审核", desc: "帖子与评论", icon: Hash },
  { name: "communities", label: "社区管理", desc: "成员、频道、消息", icon: MessagesSquare },
  { name: "announce", label: "公告通知", desc: "发布、编辑、撤回", icon: Megaphone },
  { name: "blockwords", label: "屏蔽词", desc: "平台拦截规则", icon: Ban },
  { name: "payments", label: "付款审核", desc: "收款码人工核对", icon: CreditCard },
  { name: "reports", label: "举报处理", desc: "待处理队列", icon: Flag },
  { name: "appeals", label: "申诉处理", desc: "通过或驳回", icon: Flag },
  { name: "events", label: "安全事件", desc: "限流与异常", icon: ShieldCheck },
  { name: "security", label: "安全中心", desc: "设备、邀请、权限", icon: KeyRound },
  { name: "stats", label: "数据统计", desc: "用户与内容", icon: BarChart3 },
  { name: "settings", label: "系统设置", desc: "开关与服务器", icon: Settings },
  { name: "audit", label: "审计日志", desc: "操作可追溯", icon: ScrollText },
];

const groups: { title: string; names: PageName[] }[] = [
  { title: "用户与会员", names: ["users", "vip"] },
  { title: "内容与社区", names: ["content", "communities", "announce", "blockwords"] },
  { title: "审核与处理", names: ["payments", "reports", "appeals"] },
  { title: "安全", names: ["events", "security"] },
  { title: "系统与数据", names: ["stats", "settings", "audit"] },
];

const moduleByName = new Map(modules.map((item) => [item.name, item]));

function awaitingAppeal(status: string) {
  return status === "pending" || status === "open";
}

export function HomeScreen() {
  const go = useAdmin((s) => s.go);
  const liveStats = useAdmin((s) => s.stats);
  const feeds = useAdmin((s) => s.feeds);
  const audits = useAdmin((s) => s.audits);
  const securityEvents = useAdmin((s) => s.securityEvents);
  const appeals = useAdmin((s) => s.appeals);
  const appealsTruncated = useAdmin((s) => s.appealsTruncated);
  const connection = useAdmin((s) => s.connection);
  const refreshStats = useAdmin((s) => s.refreshStats);
  const refreshAudit = useAdmin((s) => s.refreshAudit);
  const refreshSecurityEvents = useAdmin((s) => s.refreshSecurityEvents);
  const refreshAppeals = useAdmin((s) => s.refreshAppeals);
  const statsOk = feeds.stats === "ok" && !!liveStats;
  const pendingAppeals = appeals.filter((item) => awaitingAppeal(item.status)).length;
  const health = readHealthView(connection.rawHealth);
  const recentAudits = audits.slice(0, 5);
  const recentEvents = securityEvents.slice(0, 5);
  const dash = "—";

  useEffect(() => {
    void refreshStats();
    void refreshAudit();
    void refreshSecurityEvents();
    void refreshAppeals({ status: "pending" });
  }, [refreshStats, refreshAudit, refreshSecurityEvents, refreshAppeals]);

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="nova-sticky-bar nova-bar relative z-30 shrink-0 border-b border-line" data-nova-chrome="top">
        <div className="flex h-11 items-center justify-between px-4">
          <div className="min-w-0">
            <p className="text-[11px] leading-none text-muted">NOVA</p>
            <h1 className="truncate text-[17px] font-semibold leading-tight">管理后台</h1>
          </div>
          <button type="button" onClick={() => go("me")} aria-label="我的" className="grid size-11 place-items-center">
            <span className="grid size-8 place-items-center rounded-full bg-primary text-on-primary">
              <StarMark className="size-4" />
            </span>
          </button>
        </div>
      </header>
      <div className="nova-scroll min-h-0 flex-1">
      <DemoBanner />

      <div className="nova-hero mx-4 mt-3 rounded-card px-3.5 py-3">
        <div className="flex items-center justify-between text-[13px]">
          <span>平台概览</span>
          <ConnectionBadge />
        </div>
        <p className="mt-2 text-[12px] text-on-primary/80">{statsOk ? "来自 GET /api/admin/stats" : "统计接口未返回"}</p>
        <div className="mt-1.5 grid grid-cols-3 gap-2">
          <Metric value={statsOk && liveStats ? liveStats.usersTotal.toLocaleString("zh-CN") : dash} label="总用户" />
          <Metric value={statsOk && liveStats ? liveStats.usersActive.toLocaleString("zh-CN") : dash} label="活跃用户" />
          <Metric value={statsOk && liveStats ? liveStats.postsVisible.toLocaleString("zh-CN") : dash} label="发帖数" />
        </div>
      </div>

      <div className="mx-4 mt-3 grid grid-cols-2 gap-2.5">
        <Shortcut label="用户管理" onClick={() => go("users")} icon={<Users className="size-6" />} />
        <Shortcut
          label="付款审核"
          badge={statsOk && liveStats && liveStats.paymentsReview > 0 ? String(liveStats.paymentsReview) : undefined}
          onClick={() => go("payments")}
          icon={<CreditCard className="size-6" />}
        />
        <Shortcut
          label="举报处理"
          badge={statsOk && liveStats && liveStats.reportsPending > 0 ? String(liveStats.reportsPending) : undefined}
          onClick={() => go("reports")}
          icon={<Flag className="size-6" />}
        />
        <Shortcut label="系统设置" onClick={() => go("settings")} icon={<Settings className="size-6" />} />
      </div>

      <section className="mx-4 mt-4">
        <h2 className="px-0.5 text-[15px] font-semibold">待办</h2>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <Todo
            label="待审核付款"
            state={feeds.stats}
            value={statsOk && liveStats ? liveStats.paymentsReview : null}
            onClick={() => go("payments")}
          />
          <Todo
            label="待处理举报"
            state={feeds.stats}
            value={statsOk && liveStats ? liveStats.reportsPending : null}
            onClick={() => go("reports")}
          />
          <Todo
            label="待处理申诉"
            state={feeds.appeals}
            value={feeds.appeals === "ok" ? pendingAppeals : null}
            truncated={appealsTruncated}
            onClick={() => go("appeals")}
          />
          {statsOk && liveStats && liveStats.mediaReviewPending != null && (
            <Todo
              label="待复核图像"
              state={feeds.stats}
              value={liveStats.mediaReviewPending}
              onClick={() => go("content")}
            />
          )}
        </div>
        {feeds.stats === "error" && (
          <p className="mt-2 text-[12px] leading-5 text-muted">付款与举报数量来自 GET /api/admin/stats，当前没有返回，所以显示为 —。</p>
        )}
        {feeds.appeals === "error" && (
          <p className="mt-1 text-[12px] leading-5 text-muted">申诉数量来自 GET /api/admin/appeals?status=pending，当前没有返回。</p>
        )}
        {feeds.appeals === "ok" && appealsTruncated && (
          <p className="mt-1 text-[12px] leading-5 text-muted">申诉接口没有给出总数，数字是已加载的待处理条数。</p>
        )}
      </section>

      <FeedList
        title="最近操作"
        endpoint="GET /api/admin/audit"
        state={feeds.audit}
        empty="暂无操作记录"
        onMore={() => go("audit")}
      >
        {recentAudits.map((item) => (
          <article key={item.id} className="border-b border-line px-3.5 py-2.5 last:border-b-0">
            <div className="flex items-center justify-between gap-2">
              <h3 className="min-w-0 truncate text-[14px] font-medium">{item.action || "操作"}</h3>
              <Pill tone={item.kind === "security" ? "warn" : "muted"}>{item.kind === "security" ? "安全" : "管理"}</Pill>
            </div>
            <p className="truncate text-[12px] text-muted">{item.target || "未标明对象"}</p>
            <p className="text-[11px] text-muted">{item.time}{item.ip ? ` · ${item.ip}` : ""}</p>
          </article>
        ))}
      </FeedList>

      <FeedList
        title="安全事件"
        endpoint="GET /api/admin/security/events"
        state={feeds.events}
        empty="暂无安全事件"
        onMore={() => go("events")}
      >
        {recentEvents.map((item) => (
          <article key={item.id} className="border-b border-line px-3.5 py-2.5 last:border-b-0">
            <div className="flex items-center justify-between gap-2">
              <h3 className="min-w-0 truncate text-[14px] font-medium">{item.kind || "事件"}</h3>
              {item.severity ? <Pill tone={severityTone(item.severity)}>{item.severity}</Pill> : null}
            </div>
            <p className="truncate text-[12px] text-muted">{sanitizeText(item.path || item.detail) || "无路径"}</p>
            <p className="text-[11px] text-muted">{item.time}{item.ip ? ` · ${item.ip}` : ""}</p>
          </article>
        ))}
      </FeedList>

      <section className="mx-4 mt-4 mb-2 overflow-hidden rounded-card bg-surface shadow-card">
        <div className="flex items-center justify-between px-3.5 pt-3">
          <h2 className="text-[15px] font-semibold">服务器状态</h2>
          <ConnectionBadge />
        </div>
        <p className="px-3.5 pt-1 text-[12px] text-muted">来自 GET /api/health 与 GET /api/version。没有的字段不显示。</p>
        {!connection.reachable ? (
          <p className="px-3.5 py-3 text-[13px] leading-5 text-muted">{connection.message || "尚未连上后端。"}</p>
        ) : (
          <dl className="mt-1">
            {health.status && <StatusRow label="状态" value={health.status} />}
            {health.db && <StatusRow label="数据库" value={health.db} />}
            {(connection.detectedVersion || health.version) && (
              <StatusRow label="版本" value={connection.detectedVersion || health.version || ""} />
            )}
            {health.uptimeSec != null && <StatusRow label="已运行" value={formatUptime(health.uptimeSec)} />}
            {health.diskLow != null && <StatusRow label="磁盘" value={health.diskLow ? "空间偏低" : "正常"} />}
            {health.diskFree != null && <StatusRow label="可用空间" value={formatBytes(health.diskFree)} />}
            {connection.baseUrl && <StatusRow label="地址" value={connection.baseUrl} />}
            {connection.lastChecked > 0 && (
              <StatusRow label="最近检测" value={new Date(connection.lastChecked).toLocaleString("zh-CN", { hour12: false })} />
            )}
          </dl>
        )}
      </section>
      <div className="nova-tab-spacer" aria-hidden />
      </div>
    </section>
  );
}

function severityTone(value: string): "ok" | "warn" | "danger" | "muted" {
  const v = value.toLowerCase();
  if (v === "high" || v === "critical" || v === "error" || v === "严重") return "danger";
  if (v === "medium" || v === "warn" || v === "warning" || v === "警告") return "warn";
  if (v === "low" || v === "info" || v === "信息") return "ok";
  return "muted";
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="text-[22px] font-semibold leading-tight tabular-nums">{value}</div>
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
    <button type="button" onClick={onClick} className="flex min-h-[76px] items-center gap-3 rounded-card bg-surface px-3.5 py-3 text-left shadow-card">
      <span className="relative grid size-12 shrink-0 place-items-center rounded-2xl nova-soft">
        {icon}
        {badge && (
          <span className="absolute -right-1.5 -top-1.5 grid min-h-5 min-w-5 place-items-center rounded-full bg-danger px-1 text-[11px] font-semibold text-on-primary">
            {badge}
          </span>
        )}
      </span>
      <span className="text-[15px] font-semibold leading-5">{label}</span>
    </button>
  );
}

function Todo({
  label,
  state,
  value,
  truncated,
  onClick,
}: {
  label: string;
  state: "idle" | "ok" | "error";
  value: number | null;
  truncated?: boolean;
  onClick: () => void;
}) {
  const text = state === "ok" && value != null ? `${value.toLocaleString("zh-CN")}${truncated ? "+" : ""}` : "—";
  return (
    <button type="button" onClick={onClick} className="rounded-card bg-surface px-2 py-3 text-center shadow-card">
      <div className="text-[22px] font-semibold leading-none tabular-nums">{text}</div>
      <div className="mt-1.5 text-[12px] leading-4 text-muted">{label}</div>
    </button>
  );
}

function FeedList({
  title,
  endpoint,
  state,
  empty,
  onMore,
  children,
}: {
  title: string;
  endpoint: string;
  state: "idle" | "ok" | "error";
  empty: string;
  onMore: () => void;
  children: ReactNode;
}) {
  const hasRows = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <section className="mx-4 mt-4 overflow-hidden rounded-card bg-surface shadow-card">
      <div className="flex items-center justify-between px-3.5 pt-3">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <button type="button" className="text-[13px] text-primary" onClick={onMore}>
          查看全部
        </button>
      </div>
      <p className="px-3.5 pb-1 text-[12px] text-muted">{endpoint}</p>
      {state === "error" && <p className="px-3.5 py-3 text-[13px] text-muted">接口没有返回，这里不填数字。</p>}
      {state !== "error" && !hasRows && <p className="px-3.5 py-3 text-[13px] text-muted">{state === "ok" ? empty : "正在读取…"}</p>}
      {state === "ok" && hasRows ? children : null}
    </section>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-t border-line px-3.5 py-2.5">
      <dt className="shrink-0 text-[13px] text-muted">{label}</dt>
      <dd className="min-w-0 break-all text-right text-[13px] font-medium">{value}</dd>
    </div>
  );
}

export function ManageScreen() {
  const go = useAdmin((s) => s.go);
  const stats = useAdmin((s) => s.stats);
  const feeds = useAdmin((s) => s.feeds);
  const pending = feeds.stats === "ok" && stats ? stats.paymentsReview : 0;
  const openReports = feeds.stats === "ok" && stats ? stats.reportsPending : 0;
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="nova-sticky-bar nova-bar relative z-30 shrink-0 border-b border-line" data-nova-chrome="top">
        <div className="px-4 py-2">
          <h1 className="text-[17px] font-semibold leading-tight">管理</h1>
          <p className="text-[12px] leading-4 text-muted">按类别进入</p>
        </div>
      </header>
      <div className="nova-scroll min-h-0 flex-1">
      <DemoBanner />
      <div className="space-y-3 px-4 pb-3 pt-3">
        {groups.map((group) => (
          <section key={group.title}>
            <h2 className="mb-1.5 px-1 text-[13px] font-semibold text-muted">{group.title}</h2>
            <div className="overflow-hidden rounded-card bg-surface shadow-card">
              {group.names.map((name) => {
                const item = moduleByName.get(name);
                if (!item) return null;
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
        ))}
      </div>
      <div className="nova-tab-spacer" aria-hidden />
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
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="nova-sticky-bar nova-bar relative z-30 shrink-0 border-b border-line" data-nova-chrome="top">
        <div className="flex h-11 items-center justify-between px-4">
          <h1 className="text-[17px] font-semibold">消息中心</h1>
          <button type="button" className="h-11 text-[13px] text-primary" onClick={() => markNotices(tab === "all" ? undefined : tab)}>
            全部已读
          </button>
        </div>
        <Seg
          value={tab}
          options={noticeTabs.map((item) => ({ id: item.id, label: item.label }))}
          onChange={(id) => setTab(id as typeof tab)}
        />
      </div>
      <div className="nova-scroll min-h-0 flex-1">
      <DemoBanner />
      {list.length === 0 && <EmptyState title="没有消息" hint="管理端通知接口尚未提供，这里不会显示虚构消息。" />}
      {list.map((item) => (
        <article key={item.id} className="flex gap-3 border-b border-line bg-surface px-4 py-2.5">
          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" style={{ opacity: item.read ? 0 : 1 }} />
          <div className="min-w-0">
            <h2 className="text-[15px] font-medium">{sanitizeText(item.title)}</h2>
            <p className="text-[13px] text-muted">{sanitizeText(item.body)}</p>
            <p className="mt-0.5 text-[11px] text-muted">{item.time}</p>
          </div>
        </article>
      ))}
      <div className="nova-tab-spacer" aria-hidden />
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
  const appearance = useAppearance();
  const [theme, setThemeMode] = useState<ThemeMode>(() => (typeof window === "undefined" ? "system" : getStoredTheme()));
  const [skin, setSkinId] = useState<SkinId>(appearance.skin);
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="nova-sticky-bar nova-bar relative z-30 shrink-0 border-b border-line" data-nova-chrome="top">
        <div className="flex h-11 items-center px-4">
          <h1 className="text-[17px] font-semibold">我的</h1>
        </div>
      </header>
      <div className="nova-scroll min-h-0 flex-1">
      <div className="mx-4 mt-3 flex items-center gap-3 rounded-card bg-surface p-3 shadow-card">
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
        <div className="mt-0.5 text-[13px] text-muted">皮肤和深浅色分开切换，两套皮肤都有深色和浅色。</div>
        <div className="mt-2.5 grid grid-cols-2 gap-1 rounded-[14px] bg-subtle p-1">
          {SKINS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                void hapticLight();
                setSkin(item.id);
                setSkinId(item.id);
                setThemeMode(SKIN_DEFAULT_MODE[item.id]);
              }}
              className={`h-9 rounded-[12px] text-[13px] font-semibold ${skin === item.id ? "bg-surface text-primary shadow-card" : "text-muted"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1 rounded-[14px] bg-subtle p-1">
          {themeOptions.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                void hapticLight();
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
      <div className="nova-tab-spacer" aria-hidden />
      </div>
    </section>
  );
}
