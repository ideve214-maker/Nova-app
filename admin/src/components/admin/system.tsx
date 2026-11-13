import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { Bell, ChevronRight, LockKeyhole, Megaphone, ScrollText, Server, ShieldCheck, SlidersHorizontal } from "lucide-react";
import {
  ENTITLEMENTS,
  fmtUntil,
  useAdmin,
  vipPhase,
  type Announcement,
  type Flags,
} from "@/lib/admin/store";
import { ANNOUNCEMENT_BODY_MAX, ANNOUNCEMENT_TITLE_MAX, countChars } from "@/lib/admin/backend";
import { sanitizeText } from "@/lib/admin/sanitize";
import { ConfirmSheet, DataHint, DemoBanner, EmptyState, Field, inputClass, NotOpenYet, PendingApi, Pill, PrimaryButton, RowLink, Screen, Seg, Sheet } from "./ui";
import { ServerPanel } from "./server-panel";
import { getBugsinkDsn, isBugsinkEnabled, setBugsinkConfig } from "@/lib/admin/bugsink";

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
        <PendingApi />
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
            <Info label="可见帖子" value={String(stats?.postsVisible ?? 0)} hint="来自当前统计" />
            <Info label="已删帖子" value={String(stats?.postsRemoved ?? 0)} />
            <Info label="可见评论" value={String(stats?.commentsVisible ?? 0)} />
            <Info label="待处理举报" value={String(stats?.reportsPending ?? 0)} />
            <Info label="待付款订单" value={String(stats?.paymentsPending ?? 0)} />
            <Info label="待审核付款" value={String(stats?.paymentsReview ?? 0)} />
          </div>
          <p className="px-4 py-3 text-[12px] text-muted">暂时没有按日趋势，这里只展示当前汇总。</p>
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


function BugsinkSettings() {
  const [on, setOn] = useState(() => isBugsinkEnabled());
  const [dsn, setDsn] = useState(() => getBugsinkDsn());
  const [saved, setSaved] = useState("");

  function save() {
    if (on && !dsn.trim()) {
      setSaved("打开上报前请填写地址");
      return;
    }
    setBugsinkConfig(on, dsn);
    setSaved(on ? "已打开错误上报" : "已关闭错误上报");
  }

  return (
    <div className="mx-4 mt-3 overflow-hidden rounded-card bg-surface px-4 py-3 shadow-card">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-semibold">错误上报</div>
          <div className="text-sm text-muted">默认关闭。打开后才会把崩溃信息发到你填写的地址。</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="错误上报"
          onClick={() => {
            setOn((v) => !v);
            setSaved("");
          }}
          className={`h-7 w-12 shrink-0 rounded-full p-0.5 ${on ? "bg-primary" : "bg-line"}`}
        >
          <span className={`block size-6 rounded-full bg-surface ${on ? "translate-x-5" : ""}`} />
        </button>
      </div>
      {on && (
        <div className="mt-3">
          <Field label="上报地址">
            <input
              className={inputClass}
              value={dsn}
              onChange={(e) => {
                setDsn(e.target.value);
                setSaved("");
              }}
              placeholder="由技术同事提供"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </Field>
        </div>
      )}
      <button type="button" className="mt-1 h-11 text-[15px] text-primary" onClick={save}>
        保存
      </button>
      {saved && <p className="pb-1 text-[13px] text-muted">{saved}</p>}
    </div>
  );
}

export function SettingsScreen() {
  const back = useAdmin((s) => s.back);
  const flags = useAdmin((s) => s.flags);
  const toggleFlag = useAdmin((s) => s.toggleFlag);
  const go = useAdmin((s) => s.go);
  const detectedVersion = useAdmin((s) => s.connection.detectedVersion);
  const [server, setServer] = useState(false);
  return (
    <Screen title="系统设置" onBack={back}>
      <DataHint>这些开关只保存在这台设备上，还不会同步到服务器。密钥不会出现在此页面。</DataHint>
      <div className="mx-4 overflow-hidden rounded-card bg-surface shadow-card">
        <RowLink icon={<Megaphone className="size-5" />} title="公告管理" desc="草稿、发布、下线" onClick={() => go("announce")} extra={<ChevronRight className="size-4 text-muted" />} />
        <RowLink icon={<SlidersHorizontal className="size-5" />} title="权益开关" desc="套餐能力由配置控制" onClick={() => go("vip")} extra={<ChevronRight className="size-4 text-muted" />} />
        <RowLink icon={<ScrollText className="size-5" />} title="内容规则" desc="举报、删除和审计都留记录" onClick={() => go("reports")} extra={<ChevronRight className="size-4 text-muted" />} />
        <RowLink icon={<Server className="size-5" />} title="高级设置" desc="服务器地址，已填入默认" onClick={() => setServer(true)} extra={<ChevronRight className="size-4 text-muted" />} />
        <RowLink icon={<ShieldCheck className="size-5" />} title="安全事件" desc="限流与异常" onClick={() => go("events")} extra={<ChevronRight className="size-4 text-muted" />} />
        <RowLink icon={<Bell className="size-5" />} title="申诉处理" desc="通过或驳回" onClick={() => go("appeals")} extra={<ChevronRight className="size-4 text-muted" />} />
      </div>
      {detectedVersion && <p className="px-4 pt-3 text-[12px] text-muted">服务器 {detectedVersion}</p>}
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
      <BugsinkSettings />
      <Sheet open={server} title="高级设置" onClose={() => setServer(false)}>
        <p className="mb-3 text-xs text-muted">密钥不会显示在这里。服务器地址已预填，一般不用改。</p>
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
      <p className="px-4 py-2 text-[12px] text-muted">这里是实际发生过的操作记录。</p>
      {list.length === 0 && <EmptyState title="暂无审计记录" hint="登录、封禁、开通 VIP、审核付款等操作会出现在这里。" />}
      {list.map((item) => (
        <article key={item.id} className="flex gap-3 border-b border-line bg-surface px-4 py-3">
          <span className={`mt-1 grid size-9 place-items-center rounded-2xl ${item.kind === "security" ? "nova-warn-soft" : "nova-soft"}`}>
            {item.kind === "security" ? <LockKeyhole className="size-4" /> : <ScrollText className="size-4" />}
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold">{item.action}</h2>
            <p className="truncate text-sm text-muted">对象：{item.target}</p>
            <p className="text-xs text-muted">{item.time}{item.ip ? ` · IP ${item.ip}` : ""}</p>
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
      <DataHint>管理员密码请联系技术人员修改。付款请到「付款审核」里人工核对。</DataHint>
      <div className="px-4 py-4 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-full nova-soft">
          <ShieldCheck className="size-6" />
        </span>
        <h2 className="mt-2 text-[17px] font-semibold">安全中心</h2>
        <p className="text-[13px] text-muted">暂时还没有服务器体检信息。</p>
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
        <RowLink icon={<ShieldCheck className="size-5" />} title="安全事件" desc="限流与异常记录" onClick={() => go("events")} extra={<ChevronRight className="size-4 text-muted" />} />
        <RowLink icon={<Bell className="size-5" />} title="申诉处理" desc="通过或驳回" onClick={() => go("appeals")} extra={<ChevronRight className="size-4 text-muted" />} />
        <RowLink icon={<Bell className="size-5" />} title="登录设备" onClick={() => go("devices")} extra={<ChevronRight className="size-4 text-muted" />} />
        <RowLink icon={<LockKeyhole className="size-5" />} title="管理员与邀请码" onClick={() => go("admins")} extra={<ChevronRight className="size-4 text-muted" />} />
      </div>
      <Sheet open={report} title="安全报告" onClose={() => setReport(false)}>
        <p className="mb-3 text-sm text-muted">这是预览摘要，不是渗透测试结论。</p>
        <ul className="mb-4 space-y-2 text-sm">
          <li>用户密码不会显示在这里。</li>
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
      <p className="px-4 py-2 text-[13px] text-muted">目前只能看到这台设备上的登录会话。</p>
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
      <DataHint>这里显示当前登录的管理员。暂时还不能在这里管理其他管理员账号。</DataHint>
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
          <p className="px-4 pt-2 pb-1.5 text-[12px] text-muted">以下套餐与权益来自服务器上的目录。</p>
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
        <DataHint>暂时没有数据</DataHint>
      ) : (
        <DataHint>网络不太好，请稍后再试</DataHint>
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
        <PendingApi />
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

const ANN_STATUS: Record<Announcement["status"], { label: string; tone: "ok" | "muted" | "warn" }> = {
  draft: { label: "草稿", tone: "muted" },
  published: { label: "发布中", tone: "ok" },
  withdrawn: { label: "已下线", tone: "warn" },
};

function Counter({ value, max }: { value: string; max: number }) {
  const n = countChars(value);
  return <span className={`text-[12px] tabular-nums ${n > max ? "text-danger" : "text-muted"}`}>{n}/{max}</span>;
}

/** 模拟用户打开应用时看到的公告弹窗。 */
function AnnouncementPreview({ title, body, onClose }: { title: string; body: string; onClose: () => void }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/50 px-8" data-nova-modal="" role="presentation" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="预览弹窗" className="w-full max-w-[340px] rounded-2xl bg-surface p-5 shadow-card" onClick={(e) => e.stopPropagation()}>
        <p className="mb-1 text-center text-[12px] text-muted">用户看到的样子</p>
        <h2 className="text-center text-[18px] font-semibold">{sanitizeText(title) || "（未填写标题）"}</h2>
        <div className="mt-3 max-h-[50dvh] overflow-y-auto whitespace-pre-wrap text-[15px] leading-6">{sanitizeText(body) || "（未填写正文）"}</div>
        <button type="button" className="mt-4 h-11 w-full rounded-full bg-primary text-[16px] font-semibold text-on-primary" onClick={onClose}>
          知道了
        </button>
      </div>
    </div>,
    document.body,
  );
}

export function AnnounceScreen() {
  const back = useAdmin((s) => s.back);
  const announcements = useAdmin((s) => s.announcements);
  const feed = useAdmin((s) => s.announcementsFeed);
  const saveAnnouncement = useAdmin((s) => s.saveAnnouncement);
  const publishAnnouncement = useAdmin((s) => s.publishAnnouncement);
  const deleteAnnouncement = useAdmin((s) => s.deleteAnnouncement);
  const withdrawAnnouncement = useAdmin((s) => s.withdrawAnnouncement);
  const refreshAnnouncements = useAdmin((s) => s.refreshAnnouncements);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ title: string; body: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Announcement | null>(null);
  const [confirmPublish, setConfirmPublish] = useState<{ item: Announcement; others: Announcement[] } | null>(null);
  useEffect(() => { void refreshAnnouncements(); }, [refreshAnnouncements]);

  const live = announcements.filter((item) => item.status === "published");
  const tooLong = countChars(title.trim()) > ANNOUNCEMENT_TITLE_MAX || countChars(body.trim()) > ANNOUNCEMENT_BODY_MAX;
  const empty = !title.trim() || !body.trim();

  const startNew = () => {
    setEditing(null);
    setTitle("");
    setBody("");
    setError("");
    setOpen(true);
  };
  const submit = (publish: boolean) => {
    setBusy(true);
    void saveAnnouncement({ id: editing?.id, title, body, publish }).then((msg) => {
      setBusy(false);
      setError(msg ?? "");
      if (!msg) setOpen(false);
    });
  };
  const askPublish = (item: Announcement) => {
    const others = live.filter((x) => x.id !== item.id);
    if (others.length) setConfirmPublish({ item, others });
    else void publishAnnouncement(item.id);
  };

  return (
    <Screen
      title="公告通知"
      onBack={back}
      footer={
        feed === "missing" ? undefined : (
          <div className="border-t border-line bg-surface px-4 py-3 pb-safe">
            <button type="button" className="h-11 w-full rounded-full bg-primary font-semibold text-on-primary" onClick={startNew}>
              新建公告
            </button>
          </div>
        )
      }
    >
      {feed === "missing" ? (
        <NotOpenYet what="公告" />
      ) : (
        <>
          <p className="px-4 py-2 text-[13px] leading-5 text-muted">发布中的公告会在用户打开应用时弹出，同一时间只有一条。草稿只有你能看到。</p>
          {announcements.length === 0 && (
            feed === "error" ? <PendingApi /> : <EmptyState title="暂无公告" hint="点下方“新建公告”写第一条。" />
          )}
          {announcements.map((item) => {
            const st = ANN_STATUS[item.status] || ANN_STATUS.withdrawn;
            return (
              <article key={item.id} className="border-b border-line bg-surface px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="min-w-0 truncate font-semibold">{sanitizeText(item.title)}</h2>
                  <Pill tone={st.tone}>{st.label}</Pill>
                </div>
                <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-muted">{sanitizeText(item.body)}</p>
                <p className="mt-1 text-xs text-muted">{item.status === "published" && item.publishedAt ? `发布于 ${item.publishedAt}` : item.time}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="h-9 rounded-full bg-subtle px-3 text-sm font-semibold"
                    onClick={() => {
                      setEditing(item);
                      setTitle(item.title);
                      setBody(item.body);
                      setError("");
                      setOpen(true);
                    }}
                  >
                    编辑
                  </button>
                  <button type="button" className="h-9 rounded-full bg-subtle px-3 text-sm font-semibold" onClick={() => setPreview({ title: item.title, body: item.body })}>
                    预览
                  </button>
                  {item.status === "published" ? (
                    <button type="button" className="h-9 rounded-full bg-subtle px-3 text-sm font-semibold" onClick={() => void withdrawAnnouncement(item.id)}>
                      下线
                    </button>
                  ) : (
                    <button type="button" className="h-9 rounded-full bg-primary px-3 text-sm font-semibold text-on-primary" onClick={() => askPublish(item)}>
                      发布
                    </button>
                  )}
                  <button type="button" className="h-9 rounded-full nova-danger-soft px-3 text-sm font-semibold" onClick={() => setConfirmDelete(item)}>
                    删除
                  </button>
                </div>
              </article>
            );
          })}
        </>
      )}

      <Sheet open={open} title={editing ? "编辑公告" : "新建公告"} onClose={() => setOpen(false)}>
        {editing?.status === "published" && (
          <p className="mb-2 rounded-xl nova-warn-soft px-3 py-2 text-[13px] leading-5">这条公告正在发布中，保存后用户会再次看到弹窗。</p>
        )}
        <Field label="标题">
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="一句话说明公告内容" />
          <span className="mt-1 flex justify-end"><Counter value={title.trim()} max={ANNOUNCEMENT_TITLE_MAX} /></span>
        </Field>
        <Field label="正文">
          <textarea
            className="min-h-32 w-full rounded-2xl border border-line bg-subtle px-3 py-2 text-[16px] outline-none focus:border-primary"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="用户会在弹窗里看到这段文字"
          />
          <span className="mt-1 flex justify-end"><Counter value={body.trim()} max={ANNOUNCEMENT_BODY_MAX} /></span>
        </Field>
        {tooLong && <p className="mb-2 text-sm text-danger">字数超出上限，请删减后再保存。</p>}
        {error && <p className="mb-2 text-sm text-danger">{error}</p>}
        <button type="button" className="mb-2 h-10 w-full text-[15px] font-semibold text-primary" onClick={() => setPreview({ title, body })}>
          预览弹窗
        </button>
        {editing ? (
          <PrimaryButton disabled={busy || empty || tooLong} onClick={() => submit(false)}>
            {busy ? "正在保存…" : "保存"}
          </PrimaryButton>
        ) : (
          <div className="flex gap-2 pb-2">
            <button
              type="button"
              disabled={busy || empty || tooLong}
              className="h-11 flex-1 rounded-full bg-subtle text-[15px] font-semibold disabled:opacity-50"
              onClick={() => submit(false)}
            >
              存为草稿
            </button>
            <button
              type="button"
              disabled={busy || empty || tooLong}
              className="h-11 flex-1 rounded-full bg-primary text-[15px] font-semibold text-on-primary disabled:opacity-50"
              onClick={() => submit(true)}
            >
              {busy ? "请稍候…" : "发布"}
            </button>
          </div>
        )}
        {!editing && live.length > 0 && (
          <p className="pb-2 text-center text-[12px] text-muted">发布后，正在发布的《{sanitizeText(live[0].title)}》会自动下线。</p>
        )}
      </Sheet>

      <ConfirmSheet
        open={!!confirmPublish}
        title="发布这条公告？"
        message={confirmPublish ? `发布后，${confirmPublish.others.map((x) => `《${sanitizeText(x.title)}》`).join("、")}会自动下线。` : undefined}
        confirmText="发布"
        onClose={() => setConfirmPublish(null)}
        onConfirm={() => {
          const target = confirmPublish;
          setConfirmPublish(null);
          if (target) void publishAnnouncement(target.item.id);
        }}
      />
      <ConfirmSheet
        open={!!confirmDelete}
        title="删除这条公告？"
        message={confirmDelete ? `《${sanitizeText(confirmDelete.title)}》删除后不能恢复。` : undefined}
        confirmText="删除"
        danger
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          const target = confirmDelete;
          setConfirmDelete(null);
          if (target) void deleteAnnouncement(target.id);
        }}
      />
      {preview && <AnnouncementPreview title={preview.title} body={preview.body} onClose={() => setPreview(null)} />}
    </Screen>
  );
}
