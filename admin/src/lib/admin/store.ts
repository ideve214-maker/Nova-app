import { create } from "zustand";
import {
  emptyConnection,
  extractList,
  loadConfig,
  mapCatalogEntitlements,
  mapRemoteUser,
  probeConnection,
  saveConfig,
  setUnauthorizedHandler,
  type ConnectionStatus,
  type EndpointMap,
  type MappedAdmin,
  type MappedPayment,
  type MappedStats,
} from "./backend";
import { readInitialNav, startHashListener, writeHash, isWritingHash } from "./hash-route";
import * as remote from "./remote";

export type { ConnectionStatus } from "./backend";

export function markAppBooted() {
  if (typeof window === "undefined") return;
  (window as unknown as { __NOVA_BOOTED__?: boolean }).__NOVA_BOOTED__ = true;
  try {
    const el = document.getElementById("nova-boot-error");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  } catch {
    /* ignore */
  }
}

export type Presence = "online" | "away" | "offline";
export type UserStatus = "active" | "banned";
export type VipPhase = "none" | "active" | "soon" | "expired";
export type PageName =
  | "home"
  | "manage"
  | "messages"
  | "me"
  | "users"
  | "user"
  | "content"
  | "reports"
  | "stats"
  | "settings"
  | "audit"
  | "security"
  | "community"
  | "vip"
  | "announce"
  | "devices"
  | "admins"
  | "payments";

export type Nav = { name: PageName; userId?: string };

export type Member = {
  id: string;
  name: string;
  email: string;
  avatar: string;
  status: UserStatus;
  presence: Presence;
  vipUntil: number | null;
  joinedAt: string;
  lastLogin: string;
  violations: number;
  bio: string;
  posts: number;
  canPost: boolean;
  canComment: boolean;
  tempCode: string | null;
  mustChangePw?: boolean;
  username?: string;
};

export type PostItem = {
  id: string;
  title: string;
  authorId: string;
  image: string;
  time: string;
  kind: "post" | "comment";
  status: "pending" | "approved" | "removed";
  excerpt: string;
  adminReason?: string;
  authorName?: string;
  postId?: string;
};

export type ReportItem = {
  id: string;
  title: string;
  reason: string;
  reporter: string;
  target: string;
  time: string;
  status: "open" | "done";
  resolution?: string;
  postId?: string;
  userId?: string;
};

export type AuditItem = {
  id: string;
  kind: "admin" | "security";
  action: string;
  target: string;
  time: string;
  ip: string;
};

export type NoticeItem = {
  id: string;
  kind: "system" | "review" | "violation";
  title: string;
  body: string;
  time: string;
  read: boolean;
};

export type Announcement = {
  id: string;
  title: string;
  body: string;
  status: "draft" | "published" | "withdrawn";
  time: string;
};

export type Topic = { id: string; name: string; heat: string };
export type Board = { id: string; name: string; members: string; locked: boolean };
export type Device = { id: string; name: string; current: boolean; ip: string; time: string };
export type AdminAccount = { id: string; name: string; role: "root" | "moderator"; active: boolean };
export type Invite = { code: string; used: boolean; expires: string };
export type Flags = {
  loginProtect: boolean;
  registrationOpen: boolean;
  maintenance: boolean;
  reviewRequired: boolean;
};

export const ENTITLEMENTS = [
  { key: "badge.vip", label: "会员标识", basic: "不展示", vip: "香槟金标识" },
  { key: "theme.profile", label: "资料主题", basic: "默认", vip: "香槟金主题" },
  { key: "quota.save", label: "个人收藏", basic: "50 条", vip: "500 条" },
  { key: "quota.post", label: "发帖长度", basic: "500 字", vip: "2000 字" },
  { key: "pack.sticker", label: "表情贴纸", basic: "基础包", vip: "专属包" },
  { key: "safety.core", label: "举报 / 拉黑 / 好友", basic: "可用", vip: "可用，不设付费门槛" },
] as const;

export const TREND_7 = [
  { d: "11/6", active: 980, added: 86 },
  { d: "11/7", active: 1040, added: 92 },
  { d: "11/8", active: 1010, added: 110 },
  { d: "11/9", active: 1180, added: 124 },
  { d: "11/10", active: 1120, added: 108 },
  { d: "11/11", active: 1260, added: 141 },
  { d: "11/12", active: 1248, added: 156 },
];

export const TREND_30 = [
  { d: "10/14", active: 760, added: 64 },
  { d: "10/21", active: 840, added: 78 },
  { d: "10/28", active: 910, added: 90 },
  { d: "11/4", active: 1020, added: 104 },
  { d: "11/11", active: 1248, added: 156 },
];

export const TREND_90 = [
  { d: "8月", active: 420, added: 40 },
  { d: "9月", active: 610, added: 58 },
  { d: "10月", active: 880, added: 86 },
  { d: "11月", active: 1248, added: 156 },
];

const KEY = "nova-admin-v2";

function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

function tempCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const chunk = (n: number) =>
    Array.from({ length: n }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  return `NV-${chunk(4)}-${chunk(4)}`;
}

function makeAudit(partial: Omit<AuditItem, "id" | "time" | "ip">): AuditItem {
  return { id: uid("a"), time: stamp(), ip: "192.168.1.1", ...partial };
}

export function maskEmail(email: string) {
  const [name, domain] = email.split("@");
  if (!domain || !name) return "已隐藏";
  return `${name.slice(0, 1)}***@${domain}`;
}

export function isVip(member: Member, entitlements: Record<string, boolean>) {
  if (!entitlements["badge.vip"]) return false;
  return !!member.vipUntil && member.vipUntil > Date.now();
}

export function vipPhase(member: Member): VipPhase {
  if (!member.vipUntil) return "none";
  const left = member.vipUntil - Date.now();
  if (left <= 0) return "expired";
  if (left <= 10 * 86400000) return "soon";
  return "active";
}

export function fmtUntil(ms: number | null) {
  if (!ms) return "未开通";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function daysLeft(ms: number | null) {
  if (!ms) return null;
  return Math.ceil((ms - Date.now()) / 86400000);
}

const seedMembers: Member[] = [
  {
    id: "10004",
    name: "AliceWang",
    email: "alice@nova.com",
    avatar: "/media/av-pei.jpg",
    status: "active",
    presence: "online",
    vipUntil: Date.parse("2026-11-20T23:59:00"),
    joinedAt: "2025-10-20 14:30",
    lastLogin: "2026-11-12 09:45",
    violations: 0,
    bio: "喜欢旅行和摄影",
    posts: 36,
    canPost: true,
    canComment: true,
    tempCode: null,
  },
  {
    id: "10001",
    name: "Sunny123",
    email: "sunny@nova.com",
    avatar: "/media/av-su.jpg",
    status: "active",
    presence: "online",
    vipUntil: null,
    joinedAt: "2025-08-02 11:20",
    lastLogin: "2026-11-12 10:02",
    violations: 0,
    bio: "收集海边日落",
    posts: 128,
    canPost: true,
    canComment: true,
    tempCode: null,
  },
  {
    id: "10002",
    name: "NOVA_fan",
    email: "fan@nova.com",
    avatar: "/media/av-jiang.jpg",
    status: "active",
    presence: "online",
    vipUntil: null,
    joinedAt: "2025-09-18 19:12",
    lastLogin: "2026-11-12 08:16",
    violations: 1,
    bio: "社区日常",
    posts: 54,
    canPost: true,
    canComment: true,
    tempCode: null,
  },
  {
    id: "10003",
    name: "TechDream",
    email: "tech@nova.com",
    avatar: "/media/av-he.jpg",
    status: "active",
    presence: "offline",
    vipUntil: null,
    joinedAt: "2025-06-11 09:40",
    lastLogin: "2026-11-11 22:18",
    violations: 2,
    bio: "科技与产品",
    posts: 77,
    canPost: true,
    canComment: true,
    tempCode: null,
  },
  {
    id: "10005",
    name: "MikeChen",
    email: "mike@nova.com",
    avatar: "/media/av-chen.jpg",
    status: "active",
    presence: "online",
    vipUntil: null,
    joinedAt: "2026-01-09 16:05",
    lastLogin: "2026-11-12 07:55",
    violations: 0,
    bio: "夜里读书",
    posts: 19,
    canPost: true,
    canComment: true,
    tempCode: null,
  },
  {
    id: "10006",
    name: "NovaUser001",
    email: "user001@nova.com",
    avatar: "/media/av-zhou.jpg",
    status: "active",
    presence: "away",
    vipUntil: Date.parse("2026-12-31T23:59:00"),
    joinedAt: "2025-11-02 13:22",
    lastLogin: "2026-11-12 06:40",
    violations: 0,
    bio: "早起看河",
    posts: 41,
    canPost: true,
    canComment: true,
    tempCode: null,
  },
  {
    id: "10007",
    name: "星空之旅",
    email: "star@nova.com",
    avatar: "/media/av-notice.jpg",
    status: "active",
    presence: "offline",
    vipUntil: null,
    joinedAt: "2026-03-14 20:11",
    lastLogin: "2026-11-10 18:26",
    violations: 0,
    bio: "周末徒步",
    posts: 22,
    canPost: true,
    canComment: true,
    tempCode: null,
  },
  {
    id: "10008",
    name: "快乐的用户",
    email: "happy@nova.com",
    avatar: "/media/av-me.jpg",
    status: "active",
    presence: "online",
    vipUntil: null,
    joinedAt: "2026-04-02 12:48",
    lastLogin: "2026-11-12 09:12",
    violations: 0,
    bio: "分享日常",
    posts: 15,
    canPost: true,
    canComment: true,
    tempCode: null,
  },
  {
    id: "10009",
    name: "旧日星辰",
    email: "old@nova.com",
    avatar: "",
    status: "active",
    presence: "offline",
    vipUntil: Date.parse("2026-11-01T00:00:00"),
    joinedAt: "2025-04-19 08:30",
    lastLogin: "2026-10-28 21:02",
    violations: 0,
    bio: "会员已到期",
    posts: 8,
    canPost: true,
    canComment: true,
    tempCode: null,
  },
];

const seedPosts: PostItem[] = [
  {
    id: "p1",
    title: "美丽的海边风景",
    authorId: "10001",
    image: "/media/post-beach.jpg",
    time: "2小时前",
    kind: "post",
    status: "pending",
    excerpt: "傍晚的海面很安静。",
  },
  {
    id: "p2",
    title: "这个话题有点敏感",
    authorId: "10003",
    image: "/media/post-object.jpg",
    time: "3小时前",
    kind: "post",
    status: "pending",
    excerpt: "想听听大家怎么看。",
  },
  {
    id: "p3",
    title: "分享一下旅行攻略",
    authorId: "10004",
    image: "/media/post-town.jpg",
    time: "昨天",
    kind: "post",
    status: "pending",
    excerpt: "沿海小镇适合慢慢走。",
  },
  {
    id: "p4",
    title: "周末一起去爬山",
    authorId: "10002",
    image: "/media/post-hike.jpg",
    time: "昨天",
    kind: "post",
    status: "approved",
    excerpt: "天气好的话日落很漂亮。",
  },
  {
    id: "p5",
    title: "这条评论不太合适",
    authorId: "10003",
    image: "",
    time: "5小时前",
    kind: "comment",
    status: "pending",
    excerpt: "含有人身攻击，等待处理。",
  },
];

const seedReports: ReportItem[] = [
  {
    id: "r1",
    title: "举报：不当内容",
    reason: "包含广告信息",
    reporter: "user123",
    target: "帖子 · 这个话题有点敏感",
    time: "2小时前",
    status: "open",
    postId: "p2",
    userId: "10003",
  },
  {
    id: "r2",
    title: "举报：恶意言论",
    reason: "人身攻击",
    reporter: "nova_fan",
    target: "评论 · 这条评论不太合适",
    time: "3小时前",
    status: "open",
    postId: "p5",
    userId: "10003",
  },
  {
    id: "r3",
    title: "举报：垃圾营销",
    reason: "重复引流",
    reporter: "star",
    target: "用户 · 旧日星辰",
    time: "昨天",
    status: "done",
    resolution: "已驳回，证据不足",
    userId: "10009",
  },
];

const seedAudits: AuditItem[] = [
  { id: "a1", kind: "security", action: "管理员登录", target: "admin", time: "11-12 08:02", ip: "192.168.1.1" },
  { id: "a2", kind: "admin", action: "通过内容", target: "周末一起去爬山", time: "11-11 19:40", ip: "192.168.1.1" },
  { id: "a3", kind: "security", action: "查看审计日志", target: "近 7 日", time: "11-11 18:12", ip: "192.168.1.1" },
];

const seedNotices: NoticeItem[] = [
  {
    id: "n1",
    kind: "system",
    title: "系统更新通知",
    body: "管理端已更新到 M3 预览，支付仍未接入。",
    time: "今天 08:00",
    read: false,
  },
  {
    id: "n2",
    kind: "review",
    title: "内容审核提醒",
    body: "有新的帖子和评论等待处理。",
    time: "今天 07:30",
    read: false,
  },
  {
    id: "n3",
    kind: "system",
    title: "新用户注册",
    body: "用户 快乐的用户 已完成注册。",
    time: "昨天 19:12",
    read: true,
  },
  {
    id: "n4",
    kind: "violation",
    title: "违规提醒",
    body: "TechDream 有 2 次违规记录，请留意审核队列。",
    time: "昨天 16:20",
    read: true,
  },
];

function entitlementMap() {
  return Object.fromEntries(ENTITLEMENTS.map((item) => [item.key, true]));
}

type Persisted = {
  authed: boolean;
  rememberLogin: boolean;
  password: string;
  adminName: string;
  demoMode: boolean;
  members: Member[];
  posts: PostItem[];
  reports: ReportItem[];
  audits: AuditItem[];
  notices: NoticeItem[];
  announcements: Announcement[];
  topics: Topic[];
  boards: Board[];
  devices: Device[];
  admins: AdminAccount[];
  invites: Invite[];
  flags: Flags;
  entitlements: Record<string, boolean>;
  failedLogins: number;
  lockedUntil: number;
};

export type AdminState = Persisted & {
  booted: boolean;
  bootError: string | null;
  connection: ConnectionStatus;
  nav: Nav;
  history: Nav[];
  toast: string | null;
  flash: (toast: string) => void;
  connectServer: (baseUrl: string, endpoints?: Partial<EndpointMap>) => Promise<ConnectionStatus>;
  go: (name: PageName, userId?: string) => void;
  back: () => void;
  tab: (name: PageName) => void;
  adminProfile: MappedAdmin | null;
  stats: MappedStats | null;
  payments: MappedPayment[];
  attemptLogin: (account: string, password: string, remember?: boolean) => Promise<string | null>;
  confirmTotp: (code: string) => string | null;
  logout: () => Promise<void>;
  changePassword: (current: string, next: string) => string | null;
  resetDemo: () => void;
  setDemoMode: (on: boolean) => void;
  banUser: (id: string, reason?: string) => Promise<string | null>;
  unbanUser: (id: string, reason?: string) => Promise<string | null>;
  updateUser: (id: string, patch: Partial<Pick<Member, "name" | "bio" | "canPost" | "canComment">>) => void;
  revealEmail: (id: string) => void;
  resetPassword: (id: string) => Promise<string | null>;
  addUser: (input: { name: string; email: string; vipDays: number }) => string | null;
  setPostStatus: (id: string, status: PostItem["status"], reason?: string) => Promise<string | null>;
  hideContent: (kind: "post" | "comment", id: string, reason?: string) => Promise<string | null>;
  restoreContent: (kind: "post" | "comment", id: string) => Promise<string | null>;
  refreshContent: (opts?: { type?: string; status?: string; q?: string }) => Promise<void>;
  refreshUsers: (opts?: { status?: string; q?: string }) => Promise<void>;
  refreshPayments: (opts?: { status?: string; q?: string }) => Promise<void>;
  refreshAudit: () => Promise<void>;
  refreshAnnouncements: () => Promise<void>;
  refreshStats: () => Promise<void>;
  refreshReports: () => Promise<void>;
  confirmPayment: (id: string, note?: string) => Promise<string | null>;
  rejectPayment: (id: string, reason: string) => Promise<string | null>;
  refundPayment: (id: string, reason?: string) => Promise<string | null>;
  fetchReceiptUrl: (id: string) => Promise<{ url: string; mime: string } | { error: string }>;
  resolveReport: (id: string, resolution: string) => Promise<string | null>;
  grantVip: (id: string, days: number, reason: string) => Promise<string | null>;
  revokeVip: (id: string, reason: string) => Promise<string | null>;
  deleteAnnouncement: (id: string) => Promise<string | null>;
  toggleEntitlement: (key: string) => void;
  addTopic: (name: string) => void;
  toggleBoard: (id: string) => void;
  saveAnnouncement: (input: { id?: string; title: string; body: string }) => Promise<string | null>;
  setAnnouncement: (id: string, status: Announcement["status"]) => void;
  toggleFlag: (key: keyof Flags) => void;
  createInvite: () => string;
  revokeInvite: (code: string) => void;
  revokeAdmin: (id: string) => void;
  logoutOtherDevices: () => void;
  markNotices: (kind?: NoticeItem["kind"]) => void;
  sendNotice: (userId: string, body: string) => string | null;
};

const emptyPersisted = (): Persisted => ({
  authed: false,
  rememberLogin: true,
  password: "",
  adminName: "",
  demoMode: false,
  members: [],
  posts: [],
  reports: [],
  audits: [],
  notices: [],
  announcements: [],
  topics: [],
  boards: [],
  devices: [{ id: "d1", name: "本机浏览器", current: true, ip: "本机", time: "现在" }],
  admins: [{ id: "root", name: "admin", role: "root", active: true }],
  invites: [],
  flags: {
    loginProtect: true,
    registrationOpen: true,
    maintenance: false,
    reviewRequired: true,
  },
  entitlements: entitlementMap(),
  failedLogins: 0,
  lockedUntil: 0,
});

const demoPersisted = (): Persisted => ({
  authed: false,
  rememberLogin: true,
  password: "",
  adminName: "admin",
  demoMode: true,
  members: seedMembers,
  posts: seedPosts,
  reports: seedReports,
  audits: seedAudits,
  notices: seedNotices,
  announcements: [
    {
      id: "an1",
      title: "社区守则更新",
      body: "请友善交流。禁止骚扰、广告和人身攻击。",
      status: "published",
      time: "11-10 09:00",
    },
    {
      id: "an2",
      title: "周末维护预告",
      body: "11 月 15 日 02:00–04:00 短时维护，聊天记录不受影响。",
      status: "draft",
      time: "11-12 10:00",
    },
  ],
  topics: [
    { id: "t1", name: "旅行分享", heat: "12.5k" },
    { id: "t2", name: "生活日常", heat: "8.7k" },
    { id: "t3", name: "科技前沿", heat: "6.3k" },
    { id: "t4", name: "美食推荐", heat: "5.1k" },
    { id: "t5", name: "运动健康", heat: "4.2k" },
  ],
  boards: [
    { id: "b1", name: "公告", members: "全员", locked: true },
    { id: "b2", name: "闲聊", members: "8.2k", locked: false },
    { id: "b3", name: "摄影", members: "3.4k", locked: false },
    { id: "b4", name: "求助", members: "1.1k", locked: false },
  ],
  devices: [
    { id: "d1", name: "iPhone · Safari", current: true, ip: "本机", time: "现在" },
    { id: "d2", name: "Mac · Chrome", current: false, ip: "192.168.1.18", time: "昨天 21:06" },
  ],
  admins: [
    { id: "root", name: "admin", role: "root", active: true },
    { id: "m1", name: "值班审核", role: "moderator", active: true },
  ],
  invites: [],
  flags: {
    loginProtect: true,
    registrationOpen: true,
    maintenance: false,
    reviewRequired: true,
  },
  entitlements: entitlementMap(),
  failedLogins: 0,
  lockedUntil: 0,
});

function withAudit(state: AdminState, item: Omit<AuditItem, "id" | "time" | "ip">, patch: Partial<AdminState>) {
  return { ...patch, audits: [makeAudit(item), ...state.audits].slice(0, 80) };
}

let toastTimer = 0;

function restoreLocal(): Partial<Persisted> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const data = JSON.parse(raw) as Partial<Persisted>;
    let authed = !!data.authed;
    const rememberLogin = data.rememberLogin !== false;
    if (authed && !rememberLogin) {
      try {
        if (sessionStorage.getItem("nova-admin-session") !== "1") authed = false;
      } catch {
        authed = false;
      }
    }
    return {
      ...data,
      authed,
      rememberLogin,
      demoMode: !!data.demoMode,
      // 未打开演示时不要把上次残留的虚构列表带回来
      ...(!data.demoMode
        ? {
            members: data.members || [],
            posts: data.posts || [],
            reports: data.reports || [],
            notices: data.notices || [],
            announcements: data.announcements || [],
            topics: data.topics || [],
            boards: data.boards || [],
          }
        : {}),
      entitlements: { ...entitlementMap(), ...(data.entitlements || {}) },
      flags: { ...emptyPersisted().flags, ...(data.flags || {}) },
    };
  } catch {
    return {};
  }
}


function toMember(m: import("./backend").MappedMember): Member {
  return {
    ...m,
    avatar: m.avatar || "",
    username: m.username || m.name,
    mustChangePw: !!m.mustChangePw,
  };
}

function toPost(c: import("./backend").MappedContent): PostItem {
  return {
    id: c.id,
    title: c.title,
    authorId: c.authorId,
    image: c.image || "",
    time: c.time,
    kind: c.type,
    status: c.status,
    excerpt: c.text,
    adminReason: c.adminReason || undefined,
    authorName: c.authorName,
    postId: c.postId || undefined,
  };
}

function toAnnouncement(a: import("./backend").MappedAnnouncement): Announcement {
  return {
    id: a.id,
    title: a.title,
    body: a.body,
    status: a.published ? "published" : "draft",
    time: a.time,
  };
}

function toReport(r: import("./backend").MappedReport): ReportItem {
  return { ...r };
}

function toAudit(a: import("./backend").MappedAudit): AuditItem {
  return { id: a.id, kind: a.kind, action: a.action, target: a.target, time: a.time, ip: a.ip };
}

function upsertMember(list: Member[], m: Member): Member[] {
  const i = list.findIndex((x) => x.id === m.id);
  if (i < 0) return [m, ...list];
  const next = list.slice();
  next[i] = { ...list[i], ...m };
  return next;
}

function upsertPost(list: PostItem[], m: PostItem): PostItem[] {
  const i = list.findIndex((x) => x.id === m.id && x.kind === m.kind);
  if (i < 0) return [m, ...list];
  const next = list.slice();
  next[i] = { ...list[i], ...m };
  return next;
}

function upsertPayment(list: MappedPayment[], m: MappedPayment): MappedPayment[] {
  const i = list.findIndex((x) => x.id === m.id);
  if (i < 0) return [m, ...list];
  const next = list.slice();
  next[i] = { ...list[i], ...m };
  return next;
}

let handling401 = false;
function attachUnauthorized() {
  setUnauthorizedHandler(() => {
    if (handling401) return;
    const s = useAdmin.getState();
    if (!s.authed) return;
    handling401 = true;
    saveConfig({ token: "" });
    try {
      sessionStorage.removeItem("nova-admin-session");
    } catch {
      /* ignore */
    }
    useAdmin.setState({
      authed: false,
      adminProfile: null,
      nav: { name: "home" },
      history: [],
    });
    writeHash({ name: "home" });
    s.flash("登录已过期，请重新登录");
    window.setTimeout(() => {
      handling401 = false;
    }, 800);
  });
}


export const useAdmin = create<AdminState>((set, get) => ({
  ...emptyPersisted(),
  ...restoreLocal(),
  // On the client we start already "booted" so a failed/slow useEffect can never
  // trap the user on the star splash. SSR still starts false (no window).
  booted: typeof window !== "undefined",
  bootError: null,
  connection: emptyConnection(loadConfig().baseUrl),
  adminProfile: null,
  stats: null,
  payments: [],
  nav: { name: "home" },
  history: [],
  toast: null,
  flash: (toast) => {
    set({ toast });
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      if (get().toast === toast) set({ toast: null });
    }, 2200);
  },
  connectServer: async (baseUrl, endpoints) => {
    saveConfig({ baseUrl: (baseUrl || "").trim(), ...(endpoints ? { endpoints } : {}) });
    const status = await probeConnection(baseUrl);
    applyConnection(status);
    get().flash(status.reachable ? (status.mode === "live" ? "已连接服务器" : "后端已通，管理接口仍待接入，列表保持为空") : "后端不可达，列表保持为空（未打开演示模式）");
    return status;
  },
  go: (name, userId) => {
    set((s) => ({ history: [...s.history, s.nav], nav: { name, userId } }));
    writeHash({ name, userId });
  },
  back: () => {
    set((s) => {
      const history = [...s.history];
      const prev = history.pop();
      return { history, nav: prev ?? { name: "home" } };
    });
    writeHash(useAdmin.getState().nav);
  },
  tab: (name) => {
    set({ nav: { name }, history: [] });
    writeHash({ name });
  },
  attemptLogin: async (account, password, remember = true) => {
    const s = get();
    if (s.lockedUntil > Date.now()) return "登录已暂时锁定，请稍后再试";
    const name = account.trim();
    if (!name || !password) return "请输入管理员账号和密码";
    const result = await remote.remoteLogin(name, password);
    if (!result.ok) {
      const failedLogins = s.failedLogins + 1;
      const locked = failedLogins >= 5;
      set({
        failedLogins: locked ? 0 : failedLogins,
        lockedUntil: locked ? Date.now() + 30_000 : 0,
      });
      if (result.status === 429) return result.error;
      return locked ? "连续失败 5 次，已锁定 30 秒" : result.error;
    }
    saveConfig({ token: result.data.token });
    try {
      if (remember) sessionStorage.removeItem("nova-admin-session");
      else sessionStorage.setItem("nova-admin-session", "1");
    } catch {
      /* ignore */
    }
    const initial = remember ? (readInitialNav() || { name: "home" as const }) : { name: "home" as const };
    const nav = initial.name === "home" || !remember ? { name: "home" as const } : initial;
    set({
      authed: true,
      rememberLogin: remember,
      failedLogins: 0,
      lockedUntil: 0,
      adminProfile: result.data.admin,
      adminName: result.data.admin.username,
      nav,
      history: [],
    });
    writeHash(nav);
    try {
      const status = await probeConnection(undefined, 5000);
      applyConnection(status);
    } catch {
      /* 登录已成功，探测失败不挡进入 */
    }
    void refreshLiveData();
    get().flash("已登录 " + result.data.admin.username);
    return null;
  },
  confirmTotp: (_code) => {
    return "当前无需二次验证，请直接使用管理员账号登录";
  },
  logout: async () => {
    try {
      await remote.remoteLogout();
    } catch {
      saveConfig({ token: "" });
    }
    try {
      sessionStorage.removeItem("nova-admin-session");
    } catch {
      /* ignore */
    }
    set({
      authed: false,
      adminProfile: null,
      nav: { name: "home" },
      history: [],
      members: get().demoMode ? get().members : [],
      posts: get().demoMode ? get().posts : [],
      reports: get().demoMode ? get().reports : [],
      audits: get().demoMode ? get().audits : [],
      announcements: get().demoMode ? get().announcements : [],
      payments: [],
      stats: null,
    });
    writeHash({ name: "home" });
  },
  changePassword: (_current, _next) => {
    return "管理员密码请用服务器命令 node server/admin-cli.mjs 管理，管理端不能改口令";
  },
  resetDemo: () => {
    const on = get().demoMode;
    const fresh = on ? demoPersisted() : emptyPersisted();
    saveConfig({ token: "" });
    set({
      ...fresh,
      demoMode: on,
      authed: false,
      adminProfile: null,
      payments: [],
      stats: null,
      nav: { name: "home" },
      history: [],
      booted: true,
      connection: get().connection,
    });
    writeHash({ name: "home" });
    get().flash("已退出并清空本机会话");
  },
  setDemoMode: (on) => {
    const cur = get();
    if (on) {
      const fresh = demoPersisted();
      set({
        ...fresh,
        authed: cur.authed,
        adminProfile: cur.adminProfile,
        adminName: cur.adminName,
        booted: true,
        connection: cur.connection,
        nav: cur.nav,
        history: cur.history,
        demoMode: true,
      });
      get().flash("已打开演示模式：页面数据均为本地虚构，已标明");
      return;
    }
    const fresh = emptyPersisted();
    set({
      ...fresh,
      authed: cur.authed,
      adminProfile: cur.adminProfile,
      adminName: cur.adminName,
      booted: true,
      connection: cur.connection,
      nav: cur.nav,
      history: cur.history,
      demoMode: false,
    });
    get().flash("已关闭演示模式，仅展示后端真实数据");
    if (cur.authed) void refreshLiveData();
  },
  banUser: async (id, reason) => {
    if (get().demoMode) {
      const member = get().members.find((item) => item.id === id);
      if (!member || member.status === "banned") return null;
      set((s) => ({
        members: s.members.map((item) =>
          item.id === id ? { ...item, status: "banned" as const, presence: "offline" as const } : item,
        ),
      }));
      get().flash(`已封禁 ${member.name}`);
      return null;
    }
    const result = await remote.remoteBan(id, reason);
    if (!result.ok) {
      get().flash(result.error);
      return result.error;
    }
    set((s) => ({ members: upsertMember(s.members, toMember(result.data)) }));
    get().flash(`已封禁 ${result.data.name}，其登录会话已失效`);
    void get().refreshAudit();
    return null;
  },
  unbanUser: async (id, reason) => {
    if (get().demoMode) {
      const member = get().members.find((item) => item.id === id);
      if (!member || member.status !== "banned") return null;
      set((s) => ({
        members: s.members.map((item) => (item.id === id ? { ...item, status: "active" as const } : item)),
      }));
      get().flash(`已解除 ${member.name} 的封禁`);
      return null;
    }
    const result = await remote.remoteUnban(id, reason);
    if (!result.ok) {
      get().flash(result.error);
      return result.error;
    }
    set((s) => ({ members: upsertMember(s.members, toMember(result.data)) }));
    get().flash(`已解除 ${result.data.name} 的封禁`);
    void get().refreshAudit();
    return null;
  },
  updateUser: (_id, _patch) => {
    get().flash("编辑资料接口尚未提供，未改动服务器数据");
  },
  revealEmail: (id) => {
    const member = get().members.find((item) => item.id === id);
    if (!member) return;
    set((s) => s);
  },
  resetPassword: async (id) => {
    const result = await remote.remoteResetPassword(id);
    if (!result.ok) {
      get().flash(result.error);
      return null;
    }
    if (result.data.user) {
      const m = toMember(result.data.user);
      m.tempCode = result.data.temporaryPassword;
      m.mustChangePw = result.data.mustChangePw;
      set((s) => ({ members: upsertMember(s.members, m) }));
    } else {
      set((s) => ({
        members: s.members.map((item) =>
          item.id === id ? { ...item, tempCode: result.data.temporaryPassword, mustChangePw: true } : item,
        ),
      }));
    }
    void get().refreshAudit();
    return result.data.temporaryPassword;
  },
  addUser: () => {
    return "管理员不能直接创建用户。请让对方在用户端自行注册。";
  },
  hideContent: async (kind, id, reason) => {
    const result = await remote.remoteHideContent(kind, id, reason);
    if (!result.ok) {
      get().flash(result.error);
      return result.error;
    }
    set((s) => ({ posts: upsertPost(s.posts, toPost(result.data)) }));
    get().flash("已删除（用户端不再展示）");
    void get().refreshAudit();
    return null;
  },
  restoreContent: async (kind, id) => {
    const result = await remote.remoteRestoreContent(kind, id);
    if (!result.ok) {
      get().flash(result.error);
      return result.error;
    }
    set((s) => ({ posts: upsertPost(s.posts, toPost(result.data)) }));
    get().flash("已恢复");
    void get().refreshAudit();
    return null;
  },
  setPostStatus: async (id, status, reason) => {
    const post = get().posts.find((item) => item.id === id);
    if (!post) return "找不到该内容";
    if (status === "removed") return get().hideContent(post.kind, id, reason);
    if (status === "approved") return get().restoreContent(post.kind, id);
    get().flash("后端没有「待审」状态，内容只有可见或已删除");
    return "后端没有待审状态";
  },
  refreshContent: async (opts) => {
    if (get().demoMode) return;
    const type = opts?.type;
    const status = opts?.status || "all";
    const q = opts?.q;
    if (!type || type === "all") {
      const [posts, comments] = await Promise.all([
        remote.remoteContent({ type: "post", status, q, limit: 50 }),
        remote.remoteContent({ type: "comment", status, q, limit: 50 }),
      ]);
      const rows: PostItem[] = [];
      if (posts.ok) rows.push(...posts.data.map(toPost));
      if (comments.ok) rows.push(...comments.data.map(toPost));
      rows.sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));
      if (posts.ok || comments.ok) set({ posts: rows });
      if (!posts.ok && !comments.ok && posts) get().flash(posts.error);
      return;
    }
    const result = await remote.remoteContent({ type, status, q, limit: 50 });
    if (!result.ok) {
      get().flash(result.error);
      return;
    }
    set({ posts: result.data.map(toPost) });
  },
  refreshUsers: async (opts) => {
    if (get().demoMode) return;
    const result = await remote.remoteUsers({ status: opts?.status, q: opts?.q, limit: 100 });
    if (!result.ok) {
      get().flash(result.error);
      return;
    }
    set({ members: result.data.map(toMember) });
  },
  refreshPayments: async (opts) => {
    if (get().demoMode) return;
    const result = await remote.remotePayments({ status: opts?.status, q: opts?.q, limit: 50 });
    if (!result.ok) {
      get().flash(result.error);
      return;
    }
    set({ payments: result.data });
  },
  refreshAudit: async () => {
    if (get().demoMode) return;
    const result = await remote.remoteAudit({ limit: 80 });
    if (!result.ok) return;
    set({ audits: result.data.map(toAudit) });
  },
  refreshAnnouncements: async () => {
    if (get().demoMode) return;
    const result = await remote.remoteAnnouncements();
    if (!result.ok) return;
    set({ announcements: result.data.map(toAnnouncement) });
  },
  refreshStats: async () => {
    if (get().demoMode) return;
    const result = await remote.remoteStats();
    if (!result.ok) return;
    set({ stats: result.data });
  },
  refreshReports: async () => {
    if (get().demoMode) return;
    const result = await remote.remoteReports({ limit: 50 });
    if (!result.ok) return;
    set({ reports: result.data.map(toReport) });
  },
  confirmPayment: async (id, note) => {
    const result = await remote.remoteConfirmPayment(id, note);
    if (!result.ok) {
      get().flash(result.error);
      return result.error;
    }
    set((s) => ({ payments: upsertPayment(s.payments, result.data.payment) }));
    get().flash(result.data.already ? "该订单已经开通过" : "已确认付款并开通 / 续期 VIP");
    void get().refreshUsers();
    void get().refreshAudit();
    void get().refreshStats();
    return null;
  },
  rejectPayment: async (id, reason) => {
    const why = (reason || "").trim();
    if (!why) return "请填写拒绝原因";
    const result = await remote.remoteRejectPayment(id, why);
    if (!result.ok) {
      get().flash(result.error);
      return result.error;
    }
    set((s) => ({ payments: upsertPayment(s.payments, result.data) }));
    get().flash("已拒绝该订单");
    void get().refreshAudit();
    return null;
  },
  refundPayment: async (id, reason) => {
    const result = await remote.remoteRefundPayment(id, reason);
    if (!result.ok) {
      get().flash(result.error);
      return result.error;
    }
    set((s) => ({ payments: upsertPayment(s.payments, result.data.payment) }));
    if (result.data.vipRevoked) {
      get().flash("已退款并撤销该订单开通的 VIP");
    } else {
      get().flash("已标记退款。当前后端尚未自动撤销 VIP，如需撤销请到用户详情手动操作");
    }
    void get().refreshUsers();
    void get().refreshAudit();
    void get().refreshStats();
    return null;
  },
  fetchReceiptUrl: async (id) => {
    const result = await remote.remoteReceipt(id);
    if (!result.ok) return { error: result.error };
    return { url: result.data.objectUrl, mime: result.data.mime };
  },
  resolveReport: async (id, resolution) => {
    const action: "resolve" | "reject" = resolution.includes("驳回") ? "reject" : "resolve";
    const result = await remote.remoteDecideReport(id, action, resolution);
    if (!result.ok) {
      get().flash(result.error);
      return result.error;
    }
    set((s) => ({
      reports: s.reports.map((item) => (item.id === id ? toReport(result.data) : item)),
    }));
    get().flash(action === "reject" ? "已驳回举报" : "已处理举报");
    void get().refreshAudit();
    return null;
  },
  grantVip: async (id, days, reason) => {
    if (!reason.trim()) return "请填写原因";
    if (!(Number.isInteger(days) && days > 0)) return "请填写开通天数";
    const result = await remote.remoteGrantVip(id, days, reason.trim());
    if (!result.ok) {
      get().flash(result.error);
      return result.error;
    }
    set((s) => ({ members: upsertMember(s.members, toMember(result.data)) }));
    get().flash(`${result.data.name} 的会员已更新`);
    void get().refreshAudit();
    void get().refreshStats();
    return null;
  },
  revokeVip: async (id, reason) => {
    if (!reason.trim()) return "请填写原因";
    const result = await remote.remoteRevokeVip(id, reason.trim());
    if (!result.ok) {
      get().flash(result.error);
      return result.error;
    }
    set((s) => ({ members: upsertMember(s.members, toMember(result.data)) }));
    get().flash("会员权益已立即失效");
    void get().refreshAudit();
    void get().refreshStats();
    return null;
  },
  deleteAnnouncement: async (id) => {
    const result = await remote.remoteDeleteAnnouncement(id);
    if (!result.ok) {
      get().flash(result.error);
      return result.error;
    }
    set((s) => ({ announcements: s.announcements.filter((item) => item.id !== id) }));
    get().flash("公告已删除");
    void get().refreshAudit();
    return null;
  },
  toggleEntitlement: (key) => {
    if (key === "safety.core") {
      get().flash("安全、好友和举报不能关闭");
      return;
    }
    set((s) => {
      const next = !s.entitlements[key];
      return withAudit(s, { kind: "admin", action: next ? "开启权益" : "关闭权益", target: key }, {
        entitlements: { ...s.entitlements, [key]: next },
      });
    });
  },
  addTopic: (name) => {
    const trimmed = name.trim().replace(/^#/, "");
    if (trimmed.length < 2) {
      get().flash("话题名至少 2 个字");
      return;
    }
    set((s) =>
      withAudit(s, { kind: "admin", action: "创建话题", target: trimmed }, {
        topics: [{ id: uid("t"), name: trimmed, heat: "新" }, ...s.topics],
      }),
    );
    get().flash("话题已创建");
  },
  toggleBoard: (id) => {
    const board = get().boards.find((item) => item.id === id);
    if (!board) return;
    if (board.name === "公告" && !board.locked) return;
    set((s) =>
      withAudit(s, { kind: "admin", action: board.locked ? "解锁版块" : "锁定版块", target: board.name }, {
        boards: s.boards.map((item) => (item.id === id ? { ...item, locked: !item.locked } : item)),
      }),
    );
  },
  saveAnnouncement: async ({ id, title, body }) => {
    if (title.trim().length < 2 || body.trim().length < 2) {
      get().flash("标题和正文都要填写");
      return "标题和正文都要填写";
    }
    if (id) {
      get().flash("后端不支持编辑公告，请删除后重新发布");
      return "后端不支持编辑公告，请删除后重新发布";
    }
    const result = await remote.remoteAddAnnouncement(title.trim(), body.trim(), true);
    if (!result.ok) {
      get().flash(result.error);
      return result.error;
    }
    set({ announcements: result.data.map(toAnnouncement) });
    get().flash("公告已发布");
    void get().refreshAudit();
    return null;
  },
  setAnnouncement: (_id, _status) => {
    get().flash("后端没有撤回或改草稿接口，需要撤下请直接删除");
  },
  toggleFlag: (key) => {
    set((s) => {
      const next = !s.flags[key];
      const labels: Record<keyof Flags, string> = {
        loginProtect: "登录保护",
        registrationOpen: "开放注册",
        maintenance: "维护模式",
        reviewRequired: "内容先审后发",
      };
      return withAudit(s, { kind: "admin", action: next ? `开启${labels[key]}` : `关闭${labels[key]}`, target: "系统配置" }, {
        flags: { ...s.flags, [key]: next },
      });
    });
  },
  createInvite: () => {
    const code = tempCode();
    set((s) =>
      withAudit(s, { kind: "security", action: "生成邀请码", target: "一次性" }, {
        invites: [{ code, used: false, expires: "24 小时内" }, ...s.invites].slice(0, 8),
      }),
    );
    get().flash("邀请码已生成，只能使用一次");
    return code;
  },
  revokeInvite: (code) => {
    set((s) =>
      withAudit(s, { kind: "security", action: "作废邀请码", target: code }, {
        invites: s.invites.filter((item) => item.code !== code),
      }),
    );
  },
  revokeAdmin: (id) => {
    const admin = get().admins.find((item) => item.id === id);
    if (!admin || admin.role === "root") {
      get().flash("不能撤销根管理员");
      return;
    }
    set((s) =>
      withAudit(s, { kind: "security", action: "撤销管理员", target: admin.name }, {
        admins: s.admins.map((item) => (item.id === id ? { ...item, active: false } : item)),
      }),
    );
    get().flash("权限已立即失效");
  },
  logoutOtherDevices: () => {
    set((s) =>
      withAudit(s, { kind: "security", action: "退出其他设备", target: "admin" }, {
        devices: s.devices.filter((item) => item.current),
      }),
    );
    get().flash("其他设备会话已失效");
  },
  markNotices: (kind) => {
    set((s) => ({
      notices: s.notices.map((item) => (!kind || item.kind === kind ? { ...item, read: true } : item)),
    }));
  },
  sendNotice: (userId, body) => {
    const member = get().members.find((item) => item.id === userId);
    if (!member) return "找不到用户";
    if (body.trim().length < 2) return "请填写通知内容";
    set((s) =>
      withAudit(s, { kind: "admin", action: "发送站内通知", target: member.name }, {
        notices: [
          {
            id: uid("n"),
            kind: "system",
            title: `已排队通知 ${member.name}`,
            body: body.trim(),
            time: "刚刚",
            read: false,
          },
          ...s.notices,
        ],
      }),
    );
    get().flash("已写入站内通知，外部推送未接入");
    return null;
  },
}));

export function overviewOf(members: Member[], posts: PostItem[]) {
  const online = members.filter((item) => item.status === "active" && item.presence === "online").length;
  return {
    users: members.length,
    active: online,
    posts: posts.filter((item) => item.status !== "removed").length,
  };
}

/** 某类管理数据是否有真实接口；演示模式不算真实。 */
export function hasLiveEndpoint(connection: ConnectionStatus, key: string) {
  return !!connection.available?.[key as keyof ConnectionStatus["available"]];
}

function applyConnection(status: ConnectionStatus) {
  const patch: Partial<AdminState> = { connection: status, booted: true };
  if (status.catalog) {
    patch.entitlements = mapCatalogEntitlements(status.catalog, useAdmin.getState().entitlements);
  }
  // 若未来后端已有用户列表，用服务器真实用户替换列表（保留无法映射的字段默认值）。
  // 探测阶段若只是「路径存在但需要管理员令牌」(401)，不要清空已有用户（例如演示模式下列表）。
  useAdmin.setState(patch);
  markAppBooted();
}

export async function pullRemoteUsers(): Promise<number> {
  const result = await remote.remoteUsers({ limit: 100 });
  if (!result.ok) return 0;
  const members = result.data.map(toMember);
  useAdmin.setState({ members });
  return members.length;
}

export async function refreshLiveData() {
  const s = useAdmin.getState();
  if (!s.authed || s.demoMode) return;
  await Promise.all([
    s.refreshUsers(),
    s.refreshContent({ type: "all", status: "all" }),
    s.refreshPayments(),
    s.refreshAudit(),
    s.refreshAnnouncements(),
    s.refreshStats(),
    s.refreshReports(),
  ]);
}

let didHydrate = false;
let persistUnsub: (() => void) | null = null;

function startPersisting() {
  if (persistUnsub) return;
  persistUnsub = useAdmin.subscribe((state) => {
    const slice: Persisted = {
      authed: state.authed,
      rememberLogin: state.rememberLogin,
      password: "",
      adminName: state.adminName,
      demoMode: state.demoMode,
      members: state.members,
      posts: state.posts,
      reports: state.reports,
      audits: state.audits,
      notices: state.notices,
      announcements: state.announcements,
      topics: state.topics,
      boards: state.boards,
      devices: state.devices,
      admins: state.admins,
      invites: state.invites,
      flags: state.flags,
      entitlements: state.entitlements,
      failedLogins: state.failedLogins,
      lockedUntil: state.lockedUntil,
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(slice));
    } catch {
      /* iOS 无痕模式等可能抛错，忽略以免中断界面 */
    }
  });
}

export function hydrateAdmin() {
  if (typeof window === "undefined") return;
  if (!didHydrate) {
    didHydrate = true;
    // 先立刻离开启动画面，再在后台探测后端。绝不为了网络而卡住星星页。
    try {
      const restored = restoreLocal();
      const fromHash = restored.authed ? readInitialNav() : null;
      const nav = fromHash && fromHash.name !== "home" ? fromHash : restored.authed ? (fromHash || useAdmin.getState().nav) : { name: "home" as const };
      useAdmin.setState({ ...restored, nav, booted: true, bootError: null });
      if (restored.authed) writeHash(nav);
      startHashListener((next) => {
        if (isWritingHash()) return;
        const s = useAdmin.getState();
        if (!s.authed) return;
        if (s.nav.name === next.name && s.nav.userId === next.userId) return;
        useAdmin.setState({ nav: { name: next.name, userId: next.userId }, history: s.history });
      });
    } catch (err) {
      useAdmin.setState({
        booted: true,
        bootError: err instanceof Error ? err.message : "本地数据读取失败，已进入应用（列表为空）",
      });
    }
    attachUnauthorized();
    markAppBooted();
    startPersisting();
  } else if (!useAdmin.getState().booted) {
    useAdmin.setState({ booted: true });
    markAppBooted();
  }

  const fallback = window.setTimeout(() => {
    if (!useAdmin.getState().booted) {
      useAdmin.setState({
        booted: true,
        bootError: "启动超时。可在「设置服务器」填写后端地址后重试；列表在未打开演示模式时保持为空。",
      });
      markAppBooted();
    }
  }, 2000);

  void (async () => {
    try {
      const cfg = loadConfig();
      const token = (cfg.token || "").trim();
      const remember = useAdmin.getState().rememberLogin !== false;
      let sessionOk = true;
      if (useAdmin.getState().authed && !remember) {
        try {
          sessionOk = sessionStorage.getItem("nova-admin-session") === "1";
        } catch {
          sessionOk = false;
        }
      }
      if (token && sessionOk) {
        const me = await remote.remoteMe();
        if (me.ok) {
          useAdmin.setState({ authed: true, adminProfile: me.data, adminName: me.data.username, booted: true });
        } else {
          saveConfig({ token: "" });
          useAdmin.setState({ authed: false, adminProfile: null, nav: { name: "home" }, history: [] });
          writeHash({ name: "home" });
        }
      } else if (useAdmin.getState().authed && !token) {
        useAdmin.setState({ authed: false, adminProfile: null, nav: { name: "home" }, history: [] });
        writeHash({ name: "home" });
      }

      const base = (cfg.baseUrl || "").trim();
      const sameOrigin = !base && window.location.protocol !== "file:" && window.location.protocol !== "capacitor:";
      if (base || sameOrigin) {
        const status = await Promise.race([
          probeConnection(base, 5000, false),
          new Promise<ConnectionStatus>((resolve) =>
            setTimeout(() => resolve({ ...emptyConnection(base), message: "检测超时，未连接后端。", lastChecked: Date.now() }), 5000),
          ),
        ]);
        applyConnection(status);
        if (useAdmin.getState().authed && !useAdmin.getState().demoMode) {
          try {
            await refreshLiveData();
          } catch {
            /* keep current */
          }
        }
      }
    } catch (err) {
      useAdmin.setState({
        booted: true,
        bootError: err instanceof Error ? err.message : "后端检测失败，列表保持为空",
        connection: emptyConnection(),
      });
      markAppBooted();
    } finally {
      window.clearTimeout(fallback);
      if (!useAdmin.getState().booted) {
        useAdmin.setState({ booted: true });
        markAppBooted();
      }
    }
  })();
}
