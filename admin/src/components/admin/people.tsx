import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import {
  daysLeft,
  fmtUntil,
  isVip,
  maskEmail,
  useAdmin,
  vipPhase,
  type Member,
} from "@/lib/admin/store";
import { sanitizeText } from "@/lib/admin/sanitize";
import { VirtualRows } from "./virtual-list";
import { readScroll, saveScroll, scrollKey } from "@/lib/admin/scroll-restore";
import { Avatar, DemoBanner, Field, inputClass, PendingApi, Pill, PrimaryButton, Screen, Seg, Sheet } from "./ui";

type UserTab = "all" | "active" | "banned" | "vip";

export function UsersScreen() {
  const members = useAdmin((s) => s.members);
  const entitlements = useAdmin((s) => s.entitlements);
  const go = useAdmin((s) => s.go);
  const back = useAdmin((s) => s.back);
  const banUser = useAdmin((s) => s.banUser);
  const refreshUsers = useAdmin((s) => s.refreshUsers);
  const connection = useAdmin((s) => s.connection);
  const canMutate = !!connection.available.adminUsers || !!useAdmin.getState().authed;
  useEffect(() => { void refreshUsers(); }, [refreshUsers]);
  const [tab, setTab] = useState<UserTab>("all");
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const list = useMemo(() => {
    return members.filter((member) => {
      if (tab === "active" && member.status !== "active") return false;
      if (tab === "banned" && member.status !== "banned") return false;
      if (tab === "vip" && vipPhase(member) !== "active" && vipPhase(member) !== "soon") return false;
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return member.name.toLowerCase().includes(q) || member.email.toLowerCase().includes(q) || member.id.includes(q);
    });
  }, [members, tab, query]);

  return (
    <Screen
      title="用户管理"
      onBack={back}
      right={
        <button type="button" className="grid size-11 place-items-center" aria-label="搜索" onClick={() => setQuery("")}>
          <Search className="size-5" />
        </button>
      }
      footer={
        canMutate ? (
          <div className="flex gap-2 border-t border-line bg-surface px-4 py-2 pb-safe">
            <button type="button" className="h-11 flex-1 rounded-full bg-subtle text-[15px] font-semibold" onClick={() => setPicking((v) => !v)}>
              {picking ? "取消选择" : "批量封禁"}
            </button>
          </div>
        ) : undefined
      }
    >
      <Seg
        value={tab}
        options={[
          { id: "all", label: "全部" },
          { id: "active", label: "正常" },
          { id: "banned", label: "封禁" },
          { id: "vip", label: "VIP" },
        ]}
        onChange={(id) => setTab(id as UserTab)}
      />
      <DemoBanner />
      <div className="bg-surface px-4 py-2">
        <label className="flex h-11 items-center gap-2 rounded-full bg-subtle px-3">
          <Search className="size-4 text-muted" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索用户名 / 邮箱 / ID"
            className="min-w-0 flex-1 bg-transparent outline-none"
          />
        </label>
      </div>
      {list.length === 0 && (
        members.length === 0 ? (
          connection.available.adminUsers ? (
            <p className="px-4 py-10 text-center text-[15px] text-muted">暂无用户</p>
          ) : (
            <PendingApi />
          )
        ) : (
          <p className="px-4 py-10 text-center text-[15px] text-muted">没有符合条件的用户</p>
        )
      )}
      <VirtualRows
        items={list}
        getKey={(member) => member.id}
        estimateSize={64}
        className="bg-surface"
        initialOffset={readScroll(scrollKey({ name: "users" }))}
        onOffsetChange={(top) => saveScroll(scrollKey({ name: "users" }), top)}
        render={(member) => {
          const selected = picked.includes(member.id);
          return (
            <div className="border-t border-line">
              <button
                type="button"
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left"
                onClick={() => {
                  if (picking) {
                    setPicked((curr) => (curr.includes(member.id) ? curr.filter((id) => id !== member.id) : [...curr, member.id]));
                    return;
                  }
                  go("user", member.id);
                }}
              >
                {picking && (
                  <span className={`grid size-5 place-items-center rounded-full border ${selected ? "border-primary bg-primary text-on-primary" : "border-line"}`}>
                    {selected ? "✓" : ""}
                  </span>
                )}
                <Avatar src={member.avatar} color={member.avatarColor} letter={member.avatarLetter} name={sanitizeText(member.name)} className="size-9" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[15px] font-medium">{sanitizeText(member.name)}</span>
                    {isVip(member, entitlements) && <Pill tone="vip">VIP</Pill>}
                  </span>
                  <span className="block text-[13px] text-muted">ID: {member.id}</span>
                </span>
                <Status member={member} />
              </button>
            </div>
          );
        }}
      />
      {picking && picked.length > 0 && (
        <div className="px-4 py-3">
          <button
            type="button"
            className="h-11 w-full rounded-full bg-danger font-semibold text-on-primary"
            onClick={() => {
              void (async () => {
                for (const id of picked) await banUser(id);
                setPicked([]);
                setPicking(false);
              })();
            }}
          >
            封禁所选 {picked.length} 人
          </button>
        </div>
      )}
      
    </Screen>
  );
}

function Status({ member }: { member: Member }) {
  if (member.status === "banned") return <Pill tone="danger">封禁</Pill>;
  if (member.presence === "online") return <Pill tone="ok">在线</Pill>;
  if (member.presence === "away") return <Pill tone="warn">离开</Pill>;
  return <Pill tone="muted">离线</Pill>;
}

export function UserScreen() {
  const userId = useAdmin((s) => s.nav.userId);
  const member = useAdmin((s) => s.members.find((item) => item.id === userId));
  const entitlements = useAdmin((s) => s.entitlements);
  const audits = useAdmin((s) => s.audits);
  const back = useAdmin((s) => s.back);
  const banUser = useAdmin((s) => s.banUser);
  const unbanUser = useAdmin((s) => s.unbanUser);
  const updateUser = useAdmin((s) => s.updateUser);
  const revealEmail = useAdmin((s) => s.revealEmail);
  const resetPassword = useAdmin((s) => s.resetPassword);
  const grantVip = useAdmin((s) => s.grantVip);
  const revokeVip = useAdmin((s) => s.revokeVip);
  const sendNotice = useAdmin((s) => s.sendNotice);
  const [tab, setTab] = useState("info");
  const [revealed, setRevealed] = useState(false);
  const [askReveal, setAskReveal] = useState(false);
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [notice, setNotice] = useState(false);
  const [note, setNote] = useState("");
  const [vipOpen, setVipOpen] = useState(false);
  const [days, setDays] = useState(30);
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState("");

  if (!member) {
    return (
      <Screen title="用户详情" onBack={back}>
        <p className="px-4 py-10 text-center text-sm text-muted">用户不存在</p>
      </Screen>
    );
  }

  const phase = vipPhase(member);
  const left = daysLeft(member.vipUntil);
  const logs = audits.filter((item) => item.target.includes(member.name)).slice(0, 8);

  return (
    <Screen
      title="用户详情"
      onBack={back}
      footer={
        <div className="grid grid-cols-2 gap-2 border-t border-line bg-surface px-4 py-3 pb-safe">
          {member.status === "banned" ? (
            <button type="button" className="h-11 rounded-full nova-ok-soft font-semibold" onClick={() => void unbanUser(member.id)}>
              解除封禁
            </button>
          ) : (
            <button type="button" className="h-11 rounded-full nova-danger-soft font-semibold" onClick={() => void banUser(member.id)}>
              封禁账号
            </button>
          )}
          <button type="button" className="h-11 rounded-full bg-subtle font-semibold text-muted" disabled>
            发送通知（未接入）
          </button>
        </div>
      }
    >
      <div className="bg-surface px-4 pb-4 pt-5 text-center">
        <Avatar src={member.avatar} color={member.avatarColor} letter={member.avatarLetter} name={sanitizeText(member.name)} className="mx-auto size-20 text-[28px]" />
        <div className="mt-3 flex items-center justify-center gap-2">
          <h2 className="text-xl font-semibold">{sanitizeText(member.name)}</h2>
          {isVip(member, entitlements) && <Pill tone="vip">VIP</Pill>}
        </div>
        <p className="text-sm text-muted">ID: {member.id} · 注册于 {member.joinedAt.slice(0, 10)}</p>
      </div>
      <Seg
        value={tab}
        options={[
          { id: "info", label: "基本信息" },
          { id: "activity", label: "行为记录" },
          { id: "access", label: "权限设置" },
          { id: "vip", label: "VIP 记录" },
        ]}
        onChange={setTab}
      />
      {tab === "info" && (
        <div className="mt-2 bg-surface">
          <Info label="用户名" value={sanitizeText(member.name)} />
          <Info
            label="邮箱"
            value={revealed ? member.email : maskEmail(member.email)}
            action={revealed ? undefined : "查看"}
            onAction={() => setAskReveal(true)}
          />
          <Info label="状态" value={member.status === "banned" ? "封禁" : member.presence === "online" ? "正常（在线）" : "正常"} />
          <Info label="VIP 到期" value={phase === "none" ? "未开通" : `${fmtUntil(member.vipUntil)}${phase === "expired" ? " · 已过期" : phase === "soon" ? ` · 剩 ${left} 天` : ""}`} />
          <Info label="违规记录" value={`${member.violations} 次`} />
          <Info label="简介" value={sanitizeText(member.bio) || "未填写"} />
          <Info label="最后登录" value={member.lastLogin} />
          <div className="grid grid-cols-2 gap-2 px-4 py-3">
            <button type="button" className="h-11 rounded-full bg-subtle font-semibold text-muted" disabled>
              编辑资料（未接入）
            </button>
            <button type="button" className="h-11 rounded-full bg-subtle font-semibold" onClick={() => { void resetPassword(member.id).then((c) => { if (c) setCode(c); }); }}>
              重置密码
            </button>
          </div>
          {member.mustChangePw && <p className="px-4 pb-4 text-sm text-muted">该用户下次登录须修改密码。</p>}
        </div>
      )}
      {tab === "activity" && (
        <div className="mt-2 bg-surface">
          {logs.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted">还没有针对该用户的操作记录</p>}
          {logs.map((item) => (
            <div key={item.id} className="border-b border-line px-4 py-3">
              <div className="font-semibold">{item.action}</div>
              <div className="text-sm text-muted">{item.time} · {item.ip}</div>
            </div>
          ))}
          <Info label="发帖" value={`${member.posts} 条`} />
        </div>
      )}
      {tab === "access" && (
        <div className="mt-2 bg-surface px-4 py-2">
          <ToggleRow label="允许发帖" on={member.canPost} disabled={member.status === "banned"} onClick={() => updateUser(member.id, { canPost: !member.canPost })} />
          <ToggleRow label="允许评论" on={member.canComment} disabled={member.status === "banned"} onClick={() => updateUser(member.id, { canComment: !member.canComment })} />
          <p className="py-3 text-sm text-muted">暂时不能单独开关发帖或评论。封禁后该用户会立即退出。</p>
        </div>
      )}
      {tab === "vip" && (
        <div className="mt-2 bg-surface px-4 py-4">
          <p className="text-sm text-muted">
            {phase === "none" && "当前是 Basic。到期或撤销后，权益由服务端立即回落。"}
            {phase === "active" && `有效会员，到期 ${fmtUntil(member.vipUntil)}。`}
            {phase === "soon" && `即将到期，还剩 ${left} 天。`}
            {phase === "expired" && `已于 ${fmtUntil(member.vipUntil)} 过期，已回落 Basic。`}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" className="h-11 rounded-full bg-primary font-semibold text-on-primary" onClick={() => { setReason(""); setFormError(""); setVipOpen(true); }}>
              {phase === "active" || phase === "soon" ? "续期" : "手动开通"}
            </button>
            <button
              type="button"
              className="h-11 rounded-full bg-subtle font-semibold"
              onClick={() => {
                void revokeVip(member.id, "管理员在详情页撤销").then((message) => setFormError(message ?? ""));
              }}
            >
              撤销会员
            </button>
          </div>
          {formError && <p className="mt-2 text-sm text-danger">{formError}</p>}
          <p className="mt-3 text-sm text-muted">此处为管理员手动开通（须填写原因）。用户自行付款请到「付款审核」核对后再开通。月卡 30 天 ¥9.9，年卡 365 天 ¥99。</p>
        </div>
      )}

      <Sheet open={askReveal} title="查看完整邮箱" onClose={() => setAskReveal(false)}>
        <p className="mb-4 text-sm text-muted">完整邮箱默认脱敏。继续查看会写入审计日志，且只对本次打开有效。</p>
        <PrimaryButton
          onClick={() => {
            revealEmail(member.id);
            setRevealed(true);
            setAskReveal(false);
          }}
        >
          确认查看
        </PrimaryButton>
      </Sheet>
      <Sheet open={edit} title="编辑资料" onClose={() => setEdit(false)}>
        <Field label="昵称">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="简介">
          <textarea className="min-h-24 w-full rounded-2xl border border-line bg-subtle px-3 py-2 text-[16px] outline-none" value={bio} onChange={(e) => setBio(e.target.value)} />
        </Field>
        <PrimaryButton
          onClick={() => {
            if (name.trim().length < 2) return;
            updateUser(member.id, { name: name.trim(), bio: bio.trim() });
            setEdit(false);
          }}
        >
          保存
        </PrimaryButton>
      </Sheet>
      <Sheet open={!!code} title="临时密码" onClose={() => setCode(null)}>
        <p className="mb-2 text-sm text-muted">原密码已失效。请把下面的临时密码交给用户，登录后必须修改。请立刻复制，关闭后无法再从服务器取回。</p>
        <p className="mb-4 break-all rounded-2xl bg-subtle px-3 py-4 text-center text-[18px] font-semibold tracking-wider">{code}</p>
        <PrimaryButton
          onClick={() => {
            if (code) void navigator.clipboard?.writeText(code);
            setCode(null);
          }}
        >
          复制并关闭
        </PrimaryButton>
      </Sheet>
      <Sheet open={notice} title="站内通知" onClose={() => setNotice(false)}>
        <Field label={`发给 ${sanitizeText(member.name)}`}>
          <textarea className="min-h-24 w-full rounded-2xl border border-line bg-subtle px-3 py-2 text-[16px] outline-none" value={note} onChange={(e) => setNote(e.target.value)} placeholder="通知内容" />
        </Field>
        {formError && <p className="mb-2 text-sm text-danger">{formError}</p>}
        <PrimaryButton
          onClick={() => {
            const message = sendNotice(member.id, note);
            setFormError(message ?? "");
            if (!message) {
              setNote("");
              setNotice(false);
            }
          }}
        >
          写入通知队列
        </PrimaryButton>
      </Sheet>
      <Sheet open={vipOpen} title="会员时长" onClose={() => setVipOpen(false)}>
        <div className="mb-3 grid grid-cols-4 gap-2">
          {[7, 30, 90, 365].map((item) => (
            <button key={item} type="button" onClick={() => setDays(item)} className={`h-10 rounded-full text-sm font-semibold ${days === item ? "bg-primary text-on-primary" : "bg-subtle"}`}>
              {item} 天
            </button>
          ))}
        </div>
        <Field label="原因">
          <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例如 朋友体验" />
        </Field>
        {formError && <p className="mb-2 text-sm text-danger">{formError}</p>}
        <PrimaryButton
          onClick={() => {
            void grantVip(member.id, days, reason).then((message) => {
              setFormError(message ?? "");
              if (!message) setVipOpen(false);
            });
          }}
        >
          确认
        </PrimaryButton>
      </Sheet>
    </Screen>
  );
}

function Info({ label, value, action, onAction }: { label: string; value: string; action?: string; onAction?: () => void }) {
  return (
    <div className="flex items-center gap-3 border-b border-line px-4 py-3">
      <span className="w-20 shrink-0 text-sm text-muted">{label}</span>
      <span className="min-w-0 flex-1 text-sm">{value}</span>
      {action && (
        <button type="button" className="text-sm font-semibold text-primary" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  );
}

function ToggleRow({ label, on, onClick, disabled }: { label: string; on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-line py-3">
      <span>{label}</span>
      <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={onClick} className={`h-7 w-12 rounded-full p-0.5 ${on ? "bg-primary" : "bg-line"} disabled:opacity-40`}>
        <span className={`block size-6 rounded-full bg-surface ${on ? "translate-x-5" : ""}`} />
      </button>
    </div>
  );
}
