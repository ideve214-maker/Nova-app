import { useState } from "react";
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
import { Field, inputClass, Pill, PrimaryButton, RowLink, Screen, Seg, Sheet } from "./ui";
import { ServerPanel } from "./server-panel";

export function StatsScreen() {
  const back = useAdmin((s) => s.back);
  const members = useAdmin((s) => s.members);
  const posts = useAdmin((s) => s.posts);
  const [period, setPeriod] = useState<"7" | "30" | "90">("7");
  const data = period === "7" ? TREND_7 : period === "30" ? TREND_30 : TREND_90;
  const added = data.reduce((sum, item) => sum + item.added, 0);
  const active = data[data.length - 1]?.active ?? 0;
  return (
    <Screen title="数据统计" onBack={back}>
      <div className="flex gap-2 bg-surface px-4 py-3">
        {(
          [
            ["7", "近 7 天"],
            ["30", "近 30 天"],
            ["90", "近 90 天"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setPeriod(id)} className={`h-9 flex-1 rounded-full text-sm font-semibold ${period === id ? "bg-primary text-on-primary" : "bg-subtle text-muted"}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 p-4">
        <Card label="新增用户" value={added.toLocaleString("zh-CN")} delta="+12%" />
        <Card label="活跃用户" value={active.toLocaleString("zh-CN")} delta="+8%" />
      </div>
      <div className="mx-4 rounded-card bg-surface p-4 shadow-card">
        <h2 className="mb-2 font-semibold">用户增长趋势</h2>
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <XAxis dataKey="d" tick={{ fill: "var(--color-muted)", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(value) => [String(value), "新增"]} contentStyle={{ borderRadius: 12, border: "1px solid var(--color-line)", fontSize: 12 }} />
              <Bar dataKey="added" fill="var(--color-primary)" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="mx-4 mt-3 overflow-hidden rounded-card bg-surface shadow-card">
        <Info label="帖子" value={String(posts.filter((item) => item.kind === "post").length)} hint="当前预览队列" />
        <Info label="待审核" value={String(posts.filter((item) => item.status === "pending").length)} />
        <Info label="账号样本" value={String(members.length)} hint="总用户含历史基数" />
      </div>
    </Screen>
  );
}

function Card({ label, value, delta }: { label: string; value: string; delta: string }) {
  return (
    <div className="rounded-card bg-surface p-4 shadow-card">
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-sm text-ok">{delta}</div>
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
      <p className="px-4 pb-2 pt-4 text-sm text-muted">公开配置。密钥只放环境变量，这里不能查看。</p>
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
  const [tab, setTab] = useState("all");
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
      <p className="px-4 py-2 text-xs text-muted">只读。预览里没有提供修改或删除日志的操作。</p>
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
  const healthy = flags.loginProtect && !flags.maintenance;
  return (
    <Screen title="安全中心" onBack={back}>
      <div className="px-4 py-6 text-center">
        <span className="mx-auto grid size-16 place-items-center rounded-full nova-ok-soft">
          <ShieldCheck className="size-8" />
        </span>
        <h2 className="mt-3 text-lg font-semibold">{healthy ? "系统安全状态良好" : "有项目需要留意"}</h2>
        <p className="text-sm text-muted">最后检查：今天 15:00 · 演示环境</p>
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
          <li>支付未接入，没有收款入口。</li>
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
      <p className="px-4 py-3 text-sm text-muted">当前这台会保留。其他设备的会话会失效。</p>
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
      <p className="px-4 py-3 text-sm text-muted">根管理员不写死在界面密钥里。邀请码一次性、可作废。</p>
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
  const [tab, setTab] = useState("topic");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  return (
    <Screen
      title="社区管理"
      onBack={back}
      footer={
        tab === "topic" ? (
          <div className="border-t border-line bg-surface px-4 py-3 pb-safe">
            <button type="button" className="h-11 w-full rounded-full bg-primary font-semibold text-on-primary" onClick={() => setOpen(true)}>
              + 创建话题
            </button>
          </div>
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
      {tab === "topic" &&
        topics.map((item) => (
          <div key={item.id} className="flex items-center justify-between border-b border-line bg-surface px-4 py-4">
            <span className="font-semibold">#{item.name}</span>
            <span className="text-sm text-muted">{item.heat}</span>
          </div>
        ))}
      {tab === "board" &&
        boards.map((item) => (
          <div key={item.id} className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3">
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

export function VipScreen() {
  const back = useAdmin((s) => s.back);
  const members = useAdmin((s) => s.members);
  const entitlements = useAdmin((s) => s.entitlements);
  const toggleEntitlement = useAdmin((s) => s.toggleEntitlement);
  const go = useAdmin((s) => s.go);
  const groups = {
    soon: members.filter((item) => vipPhase(item) === "soon"),
    active: members.filter((item) => vipPhase(item) === "active"),
    expired: members.filter((item) => vipPhase(item) === "expired"),
  };
  return (
    <Screen title="会员权益" onBack={back}>
      <p className="px-4 py-3 text-sm text-muted">
        客户端不能自己把账号改成 VIP。支付未接入，只能由管理员手动开通、续期或撤销。
      </p>
      <div className="mx-4 overflow-hidden rounded-card bg-surface shadow-card">
        {ENTITLEMENTS.map((item) => {
          const on = entitlements[item.key] !== false;
          return (
            <div key={item.key} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{item.label}</div>
                <div className="text-sm text-muted">Basic {item.basic} · VIP {item.vip}</div>
              </div>
              <button type="button" role="switch" aria-checked={on} aria-label={item.label} onClick={() => toggleEntitlement(item.key)} className={`h-7 w-12 shrink-0 rounded-full p-0.5 ${on ? "bg-primary" : "bg-line"}`}>
                <span className={`block size-6 rounded-full bg-surface ${on ? "translate-x-5" : ""}`} />
              </button>
            </div>
          );
        })}
      </div>
      <Group title="即将到期" empty="10 天内没有到期账号" rows={groups.soon} onOpen={(id) => go("user", id)} />
      <Group title="有效" empty="没有其他有效会员" rows={groups.active} onOpen={(id) => go("user", id)} />
      <Group title="已过期" empty="没有过期记录" rows={groups.expired} onOpen={(id) => go("user", id)} />
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
  const setAnnouncement = useAdmin((s) => s.setAnnouncement);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState<string | undefined>(undefined);
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
              setEditing(undefined);
              setTitle("");
              setBody("");
              setOpen(true);
            }}
          >
            新建公告
          </button>
        </div>
      }
    >
      <p className="px-4 py-3 text-sm text-muted">发布后出现在消息中心。撤回不会删除审计记录。外部推送通道未接。</p>
      {announcements.map((item) => (
        <article key={item.id} className="border-b border-line bg-surface px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">{item.title}</h2>
            <Pill tone={item.status === "published" ? "ok" : item.status === "draft" ? "warn" : "muted"}>
              {item.status === "published" ? "已发布" : item.status === "draft" ? "草稿" : "已撤回"}
            </Pill>
          </div>
          <p className="mt-1 text-sm text-muted">{item.body}</p>
          <p className="mt-1 text-xs text-muted">{item.time}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="h-9 rounded-full bg-subtle px-3 text-sm"
              onClick={() => {
                setEditing(item.id);
                setTitle(item.title);
                setBody(item.body);
                setOpen(true);
              }}
            >
              编辑
            </button>
            {item.status !== "published" && (
              <button type="button" className="h-9 rounded-full nova-ok-soft px-3 text-sm font-semibold" onClick={() => setAnnouncement(item.id, "published")}>
                发布
              </button>
            )}
            {item.status === "published" && (
              <button type="button" className="h-9 rounded-full nova-danger-soft px-3 text-sm font-semibold" onClick={() => setAnnouncement(item.id, "withdrawn")}>
                撤回
              </button>
            )}
          </div>
        </article>
      ))}
      <Sheet open={open} title={editing ? "编辑公告" : "新建公告"} onClose={() => setOpen(false)}>
        <Field label="标题">
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="正文">
          <textarea className="min-h-24 w-full rounded-2xl border border-line bg-subtle px-3 py-2 outline-none" value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <PrimaryButton
          onClick={() => {
            saveAnnouncement({ id: editing, title, body });
            setOpen(false);
          }}
        >
          保存草稿
        </PrimaryButton>
      </Sheet>
    </Screen>
  );
}
