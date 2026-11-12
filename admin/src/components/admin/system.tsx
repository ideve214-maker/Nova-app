import { useEffect, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { Bell, ChevronRight, LockKeyhole, Megaphone, ScrollText, Server, ShieldCheck, SlidersHorizontal } from "lucide-react";
import {
  ENTITLEMENTS,
  TREND_30,
  TREND_7,
  TREND_90,
  fmtUntil,
  useAdmin,
  vipPhase,
  type Flags,
} from "@/lib/admin/store";
import { DataHint, DemoBanner, EmptyState, Field, inputClass, PendingApi, Pill, PrimaryButton, RowLink, Screen, Seg, Sheet } from "./ui";
import { ServerPanel } from "./server-panel";

export function StatsScreen() {
  const back = useAdmin((s) => s.back);
  const stats = useAdmin((s) => s.stats);
  const refreshStats = useAdmin((s) => s.refreshStats);
  const demoMode = useAdmin((s) => s.demoMode);
  const hasStats = useAdmin((s) => !!s.connection.available.adminStats || !!s.stats);
  useEffect(() => { void refreshStats(); }, [refreshStats]);

  return (
    <Screen title="数据统计" onBack={back}>
      <DemoBanner />
      {!demoMode && !hasStats && !stats ? (
        <PendingApi name="管理统计（GET /api/admin/stats）" />
      ) : !stats && !demoMode ? (
        <p className="px-4 py-10 text-center text-[15px] text-muted">暂无统计</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5 p-3">
            <Card label="总用户" value={String(stats?.usersTotal ?? 0)} delta="" />
            <Card label="正常账号" value={String(stats?.usersActive ?? 0)} delta="" />
            <Card label="封禁" value={String(stats?.usersBanned ?? 0)} delta="" />
            <Card label="VIP" value={String(stats?.usersVip ?? 0)} delta="" />
          </div>
          <div className="mx-4 overflow-hidden rounded-card bg-surface shadow-card">
            <Info label="可见帖子" value={String(stats?.postsVisible ?? 0)} hint="GET /api/admin/stats" />
            <Info label="已删帖子" value={String(stats?.postsRemoved ?? 0)} />
            <Info label="可见评论" value={String(stats?.commentsVisible ?? 0)} />
            <Info label="待处理举报" value={String(stats?.reportsPending ?? 0)} />
            <Info label="待付款订单" value={String(stats?.paymentsPending ?? 0)} />
            <Info label="待审核付款" value={String(stats?.paymentsReview ?? 0)} />
          </div>
          <p className="px-4 py-3 text-[12px] text-muted">后端目前不提供按日趋势，这里只展示当前真实汇总，没有虚构折线。</p>
        </>
      )}
    </Screen>
  );
}

function Card({ label, value, delta }: { label: string; value: string; delta: string }) {
  return (
    <div className="rounded-card bg-surface p-3 shadow-card">
      <div className="text-[13px] text-muted">{label}</div>
      <div className="mt-0.5 text-[20px] font-semibold tabular-nums">{value}</div>
      {delta ? <div className="text-[12px] text-warn">{delta}</div> : null}
    </div>
  );
}

function Info({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-line px-4 py-3 last:border-b-0">
      <span>
        <span className="block">{label}</span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

const flagRows: { key: keyof Flags; label: string; desc: string }[] = [
  { key: "loginProtect", label: "登录保护", desc: "连续失败会暂时锁定" },
  { key: "registrationOpen", label: "开放注册", desc: "关闭后新用户不能注册" },
  { key: "reviewRequired", label: "内容先审后发", desc: "新帖进入审核队列" },
  { key: "maintenance", label: "维护模式", desc: "用户端应显示维护说明" },
];

export function SettingsScreen() {
  const back = useAdmin((s) => s.back);
  const flags = useAdmin((s) => s.flags);
  const toggleFlag = useAdmin((s) => s.toggleFlag);
  const go = useAdmin((s) => s.go);
  const [server, setServer] = useState(false);
  return (
    <Screen title="系统设置" onBack={back}>
      <DataHint>下列开关目前只存在本机，没有写入服务器的配置接口（接口待接入）。密钥不会出现在此页面。</DataHint>
      <div className="mx-4 overflow-hidden rounded-card bg-surface shadow-card">
        <RowLink icon={<Megaphone className="size-5" />} title="公告管理" desc="草稿、发布、撤回" onClick={() => go("announce")} extra={<ChevronRight className="size-4 text-muted" />} />
        <RowLink icon={<SlidersHorizontal className="size-5" />} title="权益开关" desc="套餐能力由配置控制" onClick={() => go("vip")} extra={<ChevronRight className="size-4 text-muted" />} />
        <RowLink icon={<ScrollText className="size-5" />} title="内容规则" desc="举报、删除和审计都留记录" onClick={() => go("reports")} extra={<ChevronRight className="size-4 text-muted" />} />
        <RowLink icon={<Server className="size-5" />} title="服务器配置" desc="与用户端共用后端" onClick={() => setServer(true)} extra={<ChevronRight className="size-4 text-muted" />} />
      </div>
      <div className="mx-4 mt-3 overflow-hidden rounded-card bg-surface px-4 shadow-card">
        {flagRows.map((item) => (
          <div key={item.key} className="flex items-center gap-3 border-b border-line py-3 last:border-b-0">
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{item.label}</div>
              <div className="text-sm text-muted">{item.desc}</div>
            </div>
            <button type="button" role="switch" aria-checked={flags[item.key]} aria-label={item.label} onClick={() => toggleFlag(item.key)} className={`h-7 w-12 shrink-0 rounded-full p-0.5 ${flags[item.key] ? "bg-primary" : "bg-line"}`}>
              <span className={`block size-6 rounded-full bg-surface ${flags[item.key] ? "translate-x-5" : ""}`} />
            </button>
          </div>
        ))}
      </div>
      <Sheet open={server} title="服务器配置" onClose={() => setServer(false)}>
        <p className="mb-3 text-xs text-muted">密钥只放环境变量，这里不能查看。支付未接入。</p>
        <ServerPanel onDone={() => setServer(false)} />
      </Sheet>
    </Screen>
  );
}

export function AuditScreen() {
  const back = useAdmin((s) => s.back);
  const audits = useAdmin((s) => s.audits);
  const refreshAudit = useAdmin((s) => s.refreshAudit);
  const [tab, setTab] = useState("all");
  useEffect(() => { void refreshAudit(); }, [refreshAudit]);
  const list = audits.filter((item) => tab === "all" || item.kind === tab);
  return (
    <Screen title="审计日志" onBack={back}>
      <Seg
        value={tab}
        options={[
          { id: "all", label: "全部" },
          { id: "admin", label: "管理操作" },
          { id: "security", label: "安全事件" },
        ]}
        onChange={setTab}
      />
      <DemoBanner />
      <p className="px-4 py-2 text-[12px] text-muted">来自 GET /api/admin/audit 的真实记录。</p>
      {list.length === 0 && <EmptyState title="暂无审计记录" hint="登录、封禁、开通 VIP、审核付款等操作会出现在这里。" />}
      {list.map((item) => (
        <article key={item.id} className="flex gap-3 border-b border-line bg-surface px-4 py-3">
          <span className={`mt-1 grid size-9 place-items-center rounded-2xl ${item.kind === "security" ? "nova-warn-soft" : "nova-soft"}`}>
            {item.kind === "security" ? <LockKeyhole className="size-4" /> : <ScrollText className="size-4" />}
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold">{item.action}</h2>
            <p className="truncate text-sm text-muted">对象：{item.target}</p>
            <p className="text-xs text-muted">{item.time} · IP {item.ip}</p>
          </div>
        </article>
      ))}
    </Screen>
  );
}

export function SecurityScreen() {
  const back = useAdmin((s) => s.back);
  const go = useAdmin((s) => s.go);
  const flags = useAdmin((s) => s.flags);
  const devices = useAdmin((s) => s.devices);
  const [report, setReport] = useState(false);
  return (
    <Screen title="安全中心" onBack={back}>
      <DemoBanner />
      <DataHint>下面不是服务器体检结果。管理员口令由 admin-cli 管理。付款走人工核对，见「付款审核」。</DataHint>
      <div className="px-4 py-4 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-full nova-soft">
          <ShieldCheck className="size-6" />
        </span>
        <h2 className="mt-2 text-[17px] font-semibold">安全中心</h2>
        <p className="text-[13px] text-muted">接口待接入，不展示虚构「状态良好」。</p>
      </div>
      <div className="mx-4 overflow-hidden rounded-card bg-surface shadow-card">
        <Check label="账户安全" ok={flags.loginProtect} desc={flags.loginProtect ? "登录保护已开启" : "登录保护已关闭"} />
        <Check label="数据备份" ok desc="生产备份尚未在本预览执行" />
        <Check label="风险监控" ok={!flags.maintenance} desc={flags.maintenance ? "维护模式开启中" : "没有进行中的维护"} />
        <Check label="其他设备" ok={devices.length <= 1} desc={devices.length <= 1 ? "仅当前设备" : `还有 ${devices.length - 1} 台设备`} />
      </div>
      <div className="grid grid-cols-2 gap-2 px-4 py-4">
        <button type="button" className="h-11 rounded-full bg-primary font-semibold text-on-primary" onClick={() => setReport(true)}>
          安全报告
        </button>
        <button type="button" className="h-11 rounded-full bg-surface font-semibold shadow-card" onClick={() => go("admins")}>
          更多设置
        </button>
      </div>
      <div className="mx-4 overflow-hidden rounded-card bg-surface shadow-card">
        <RowLink icon={<Bell className="size-5" />} title="登录设备" onClick={() => go("devices")} extra={<ChevronRight className="size-4 text-muted" />} />
        <RowLink icon={<LockKeyhole className="size-5" />} title="管理员与邀请码" onClick={() => go("admins")} extra={<ChevronRight className="size-4 text-muted" />} />
      </div>
      <Sheet open={report} title="安全报告" onClose={() => setReport(false)}>
        <p className="mb-3 text-sm text-muted">这是预览摘要，不是渗透测试结论。</p>
        <ul className="mb-4 space-y-2 text-sm">
          <li>管理员口令只留在本机，不回读用户原密码。</li>
          <li>邮箱默认脱敏，完整查看会写审计。</li>
          <li>邀请码一次性，根管理员不能在这里被撤销。</li>
          <li>用户付款为个人收款码人工核对：月卡 ¥9.9 / 30 天，年卡 ¥99 / 365 天。</li>
        </ul>
        <PrimaryButton onClick={() => setReport(false)}>关闭</PrimaryButton>
      </Sheet>
    </Screen>
  );
}

function Check({ label, ok, desc }: { label: string; ok: boolean; desc: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
      <Pill tone={ok ? "ok" : "warn"}>{ok ? "正常" : "注意"}</Pill>
      <div>
        <div className="font-semibold">{label}</div>
        <div className="text-sm text-muted">{desc}</div>
      </div>
    </div>
  );
}

export function DevicesScreen() {
  const back = useAdmin((s) => s.back);
  const devices = useAdmin((s) => s.devices);
  const logoutOtherDevices = useAdmin((s) => s.logoutOtherDevices);
  return (
    <Screen
      title="登录设备"
      onBack={back}
      footer={
        <div className="border-t border-line bg-surface px-4 py-3 pb-safe">
          <button type="button" className="h-11 w-full rounded-full bg-primary font-semibold text-on-primary" onClick={logoutOtherDevices}>
            退出其他设备
          </button>
        </div>
      }
    >
      <DemoBanner />
      <p className="px-4 py-2 text-[13px] text-muted">本机会话。服务器设备列表接口待接入；关闭演示后只显示本机浏览器，没有虚构设备。</p>
      {devices.map((item) => (
        <article key={item.id} className="border-b border-line bg-surface px-4 py-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{item.name}</h2>
            {item.current && <Pill tone="ok">当前</Pill>}
          </div>
          <p className="text-sm text-muted">{item.ip} · {item.time}</p>
        </article>
      ))}
    </Screen>
  );
}

export function AdminsScreen() {
  const back = useAdmin((s) => s.back);
  const admins = useAdmin((s) => s.admins);
  const invites = useAdmin((s) => s.invites);
  const createInvite = useAdmin((s) => s.createInvite);
  const revokeInvite = useAdmin((s) => s.revokeInvite);
  const revokeAdmin = useAdmin((s) => s.revokeAdmin);
  const [latest, setLatest] = useState<string | null>(null);
  return (
    <Screen title="管理员" onBack={back}>
      <DemoBanner />
      <DataHint>后端尚无管理员账号接口。这里只显示本机操作员 admin。邀请码功能在未打开演示时不会生成服务器账号。</DataHint>
      {admins.map((item) => (
        <article key={item.id} className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{item.name}</div>
            <div className="text-sm text-muted">{item.role === "root" ? "根管理员" : "审核管理员"}</div>
          </div>
          {item.active ? <Pill tone="ok">有效</Pill> : <Pill tone="muted">已撤销</Pill>}
          {item.role !== "root" && item.active && (
            <button type="button" className="text-sm font-semibold text-danger" onClick={() => revokeAdmin(item.id)}>
              撤销
            </button>
          )}
        </article>
      ))}
      <div className="p-4">
        <PrimaryButton onClick={() => setLatest(createInvite())}>生成一次性邀请码</PrimaryButton>
        {latest && <p className="mt-3 rounded-2xl bg-surface px-3 py-3 text-center font-semibold">{latest}</p>}
      </div>
      {invites.map((item) => (
        <div key={item.code} className="flex items-center justify-between border-t border-line bg-surface px-4 py-3">
          <div>
            <div className="font-semibold">{item.code}</div>
            <div className="text-sm text-muted">未使用 · {item.expires}</div>
          </div>
          <button type="button" className="text-sm text-danger" onClick={() => revokeInvite(item.code)}>
            作废
          </button>
        </div>
      ))}
    </Screen>
  );
}

export function CommunityScreen() {
  const back = useAdmin((s) => s.back);
  const topics = useAdmin((s) => s.topics);
  const boards = useAdmin((s) => s.boards);
  const addTopic = useAdmin((s) => s.addTopic);
  const toggleBoard = useAdmin((s) => s.toggleBoard);
  const demoMode = useAdmin((s) => s.demoMode);
  const communitiesNeedAuth = useAdmin((s) => !!s.connection.authRequired.communities);
  const [tab, setTab] = useState("topic");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  return (
    <Screen
      title="社区管理"
      onBack={back}
      footer={
        tab === "topic" && demoMode ? (
          <div className="border-t border-line bg-surface px-4 py-2 pb-safe">
            <button type="button" className="h-11 w-full rounded-full bg-primary text-[15px] font-semibold text-on-primary" onClick={() => setOpen(true)}>
              + 创建话题
            </button>
          </div>
        ) : tab === "topic" ? (
          <div className="border-t border-line bg-surface px-4 py-2 pb-safe text-center text-[12px] text-muted">创建话题接口待接入</div>
        ) : undefined
      }
    >
      <Seg
        value={tab}
        options={[
          { id: "topic", label: "话题管理" },
          { id: "board", label: "版块管理" },
        ]}
        onChange={setTab}
      />
      <DemoBanner />
      {tab === "topic" && topics.length === 0 && <PendingApi name="社区列表（GET /api/communities）" needsAuth={communitiesNeedAuth} />}
      {tab === "board" && boards.length === 0 && <PendingApi name="社区列表（GET /api/communities）" needsAuth={communitiesNeedAuth} />}
      {tab === "topic" &&
        topics.map((item) => (
          <div key={item.id} className="flex items-center justify-between border-b border-line bg-surface px-4 py-2.5">
            <span className="text-[15px] font-medium">#{item.name}</span>
            <span className="text-[13px] text-muted">{item.heat}</span>
          </div>
        ))}
      {tab === "board" &&
        boards.map((item) => (
          <div key={item.id} className="flex items-center gap-3 border-b border-line bg-surface px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{item.name}</div>
              <div className="text-sm text-muted">{item.members}</div>
            </div>
            <Pill tone={item.locked ? "warn" : "ok"}>{item.locked ? "已锁定" : "开放"}</Pill>
            {item.name !== "公告" && (
              <button type="button" className="text-sm font-semibold text-primary" onClick={() => toggleBoard(item.id)}>
                {item.locked ? "解锁" : "锁定"}
              </button>
            )}
          </div>
        ))}
      <Sheet open={open} title="创建话题" onClose={() => setOpen(false)}>
        <Field label="话题名">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="例如 城市散步" />
        </Field>
        <PrimaryButton
          onClick={() => {
            addTopic(name);
            setName("");
            setOpen(false);
          }}
        >
          创建
        </PrimaryButton>
      </Sheet>
    </Screen>
  );
}

function fmtEntValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "boolean") return value ? "有" : "无";
  if (typeof value === "number" || typeof value === "string") return String(value);
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k} ${v}`)
      .join(" · ");
  }
  return String(value);
}

function readCatalog(catalog: unknown) {
  if (!catalog || typeof catalog !== "object") return { plans: [] as Record<string, unknown>[], entitlements: [] as Record<string, unknown>[] };
  const raw = catalog as Record<string, unknown>;
  const root = (raw.plans ? raw : (raw.data as Record<string, unknown> | undefined) || raw) as Record<string, unknown>;
  const plansObj = root.plans;
  const plans = Array.isArray(plansObj)
    ? (plansObj as Record<string, unknown>[])
    : plansObj && typeof plansObj === "object"
      ? (Object.values(plansObj) as Record<string, unknown>[])
      : [];
  const ents = root.entitlements;
  return { plans, entitlements: Array.isArray(ents) ? (ents as Record<string, unknown>[]) : [] };
}

export function VipScreen() {
  const back = useAdmin((s) => s.back);
  const members = useAdmin((s) => s.members);
  const entitlements = useAdmin((s) => s.entitlements);
  const toggleEntitlement = useAdmin((s) => s.toggleEntitlement);
  const go = useAdmin((s) => s.go);
  const demoMode = useAdmin((s) => s.demoMode);
  const catalog = useAdmin((s) => s.connection.catalog);
  const reachable = useAdmin((s) => s.connection.reachable);
  const hasUserApi = useAdmin((s) => !!s.connection.available.adminUsers);
  const parsed = readCatalog(catalog);
  const groups = {
    soon: members.filter((item) => vipPhase(item) === "soon"),
    active: members.filter((item) => vipPhase(item) === "active"),
    expired: members.filter((item) => vipPhase(item) === "expired"),
  };
  return (
    <Screen title="会员权益" onBack={back}>
      <DemoBanner />
      {parsed.plans.length > 0 ? (
        <>
          <p className="px-4 pt-2 pb-1.5 text-[12px] text-muted">以下套餐与权益来自后端 GET /api/vip/catalog，是真实目录。</p>
          <div className="mx-4 mb-2 overflow-hidden rounded-card bg-surface shadow-card">
            {parsed.plans.map((plan) => {
              const prices = Array.isArray(plan.prices) ? (plan.prices as Record<string, unknown>[]) : [];
              const purchase = plan.purchase && typeof plan.purchase === "object" ? (plan.purchase as Record<string, unknown>) : null;
              return (
                <div key={String(plan.id || plan.name)} className="border-b border-line px-3.5 py-2.5 last:border-b-0">
                  <div className="text-[15px] font-medium">{String(plan.name || plan.id)}</div>
                  {plan.tagline ? <div className="text-[13px] leading-5 text-muted">{String(plan.tagline)}</div> : null}
                  {prices.length > 0 && (
                    <div className="mt-1 text-[13px] text-fg">
                      {prices.map((pr) => String(pr.label || `${pr.period} ${pr.amountCents}`)).join(" · ")}
                    </div>
                  )}
                  {plan.priceNote ? <div className="mt-0.5 text-[12px] text-muted">{String(plan.priceNote)}</div> : null}
                  {purchase && (
                    <div className="mt-0.5 text-[12px] text-muted">
                      {purchase.enabled ? String(purchase.label || "可购买") : String(purchase.label || purchase.reason || "暂未开放")}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {parsed.entitlements.length > 0 && (
            <div className="mx-4 mb-3 overflow-hidden rounded-card bg-surface shadow-card">
              {parsed.entitlements.map((item) => (
                <div key={String(item.key)} className="border-b border-line px-3.5 py-2.5 last:border-b-0">
                  <div className="text-[15px] font-medium">{String(item.title || item.label || item.key)}</div>
                  <div className="text-[13px] text-muted">
                    Basic {fmtEntValue(item.basic)} · VIP {fmtEntValue(item.vip)}
                    {item.status ? ` · ${String(item.status)}` : ""}
                  </div>
                  {item.description ? <div className="mt-0.5 text-[12px] leading-4 text-muted">{String(item.description)}</div> : null}
                </div>
              ))}
            </div>
          )}
        </>
      ) : reachable ? (
        <DataHint>已连接后端，但未能读取 /api/vip/catalog。</DataHint>
      ) : (
        <DataHint>未连接后端，无法读取 VIP 目录。公开预览无法访问你电脑上的服务。</DataHint>
      )}
      {demoMode && (
        <div className="mx-4 overflow-hidden rounded-card bg-surface shadow-card">
          {ENTITLEMENTS.map((item) => {
            const on = entitlements[item.key] !== false;
            return (
              <div key={item.key} className="flex items-center gap-3 border-b border-line px-3.5 py-2.5 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-medium">{item.label}</div>
                  <div className="text-[13px] text-muted">Basic {item.basic} · VIP {item.vip}</div>
                </div>
                <button type="button" role="switch" aria-checked={on} aria-label={item.label} onClick={() => toggleEntitlement(item.key)} className={`h-7 w-11 shrink-0 rounded-full p-0.5 ${on ? "bg-primary" : "bg-line"}`}>
                  <span className={`block size-6 rounded-full bg-surface ${on ? "translate-x-4" : ""}`} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      {demoMode || hasUserApi ? (
        <>
          <Group title="即将到期" empty="10 天内没有到期账号" rows={groups.soon} onOpen={(id) => go("user", id)} />
          <Group title="有效" empty="没有其他有效会员" rows={groups.active} onOpen={(id) => go("user", id)} />
          <Group title="已过期" empty="没有过期记录" rows={groups.expired} onOpen={(id) => go("user", id)} />
        </>
      ) : (
        <PendingApi name="会员账号列表（需用户列表接口）" />
      )}
    </Screen>
  );
}

function Group({
  title,
  rows,
  empty,
  onOpen,
}: {
  title: string;
  rows: { id: string; name: string; vipUntil: number | null }[];
  empty: string;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="mt-4">
      <h2 className="px-4 pb-2 text-sm font-semibold text-muted">{title}</h2>
      {rows.length === 0 && <p className="px-4 text-sm text-muted">{empty}</p>}
      {rows.map((item) => (
        <button key={item.id} type="button" onClick={() => onOpen(item.id)} className="flex w-full items-center justify-between border-b border-line bg-surface px-4 py-3 text-left">
          <span className="font-semibold">{item.name}</span>
          <span className="text-sm text-muted">{fmtUntil(item.vipUntil)}</span>
        </button>
      ))}
    </div>
  );
}

export function AnnounceScreen() {
  const back = useAdmin((s) => s.back);
  const announcements = useAdmin((s) => s.announcements);
  const saveAnnouncement = useAdmin((s) => s.saveAnnouncement);
  const deleteAnnouncement = useAdmin((s) => s.deleteAnnouncement);
  const refreshAnnouncements = useAdmin((s) => s.refreshAnnouncements);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { void refreshAnnouncements(); }, [refreshAnnouncements]);
  return (
    <Screen
      title="公告通知"
      onBack={back}
      footer={
        <div className="border-t border-line bg-surface px-4 py-3 pb-safe">
          <button
            type="button"
            className="h-11 w-full rounded-full bg-primary font-semibold text-on-primary"
            onClick={() => {
              setTitle("");
              setBody("");
              setError("");
              setOpen(true);
            }}
          >
            发布公告
          </button>
        </div>
      }
    >
      <DemoBanner />
      <p className="px-4 py-2 text-[13px] text-muted">发布即生效。后端不支持编辑或撤回，需要撤下请删除。外部推送通道未接。</p>
      {announcements.length === 0 && <EmptyState title="暂无公告" hint="点下方按钮发布第一条。" />}
      {announcements.map((item) => (
        <article key={item.id} className="border-b border-line bg-surface px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">{item.title}</h2>
            <Pill tone={item.status === "published" ? "ok" : "muted"}>
              {item.status === "published" ? "已发布" : "未发布"}
            </Pill>
          </div>
          <p className="mt-1 text-sm text-muted">{item.body}</p>
          <p className="mt-1 text-xs text-muted">{item.time}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="h-9 rounded-full nova-danger-soft px-3 text-sm font-semibold"
              onClick={() => void deleteAnnouncement(item.id)}
            >
              删除
            </button>
          </div>
        </article>
      ))}
      <Sheet open={open} title="发布公告" onClose={() => setOpen(false)}>
        <Field label="标题">
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="标题" />
        </Field>
        <Field label="正文">
          <textarea className="min-h-24 w-full rounded-2xl border border-line bg-subtle px-3 py-2 text-[16px] outline-none" value={body} onChange={(e) => setBody(e.target.value)} placeholder="正文" />
        </Field>
        {error && <p className="mb-2 text-sm text-danger">{error}</p>}
        <PrimaryButton
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void saveAnnouncement({ title, body }).then((msg) => {
              setBusy(false);
              setError(msg ?? "");
              if (!msg) setOpen(false);
            });
          }}
        >
          {busy ? "正在发布…" : "发布"}
        </PrimaryButton>
      </Sheet>
    </Screen>
  );
}
