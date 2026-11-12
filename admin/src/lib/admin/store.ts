import { create } from "zustand";
import {
  emptyConnection,
  extractList,
  loadConfig,
  mapCatalogEntitlements,
  mapRemoteUser,
  probeConnection,
  saveConfig,
  type ConnectionStatus,
  type EndpointMap,
} from "./backend";

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
  | "admins";

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

const USER_BASE = 8247;
const ACTIVE_BASE = 1243;
const POST_BASE = 3887;

const KEY = "nova-admin-m3-v1";

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
  password: string;
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
  attemptLogin: (account: string, password: string) => string | null;
  confirmTotp: (code: string) => string | null;
  logout: () => void;
  changePassword: (current: string, next: string) => string | null;
  resetDemo: () => void;
  banUser: (id: string) => void;
  unbanUser: (id: string) => void;
  updateUser: (id: string, patch: Partial<Pick<Member, "name" | "bio" | "canPost" | "canComment">>) => void;
  revealEmail: (id: string) => void;
  resetPassword: (id: string) => string | null;
  addUser: (input: { name: string; email: string; vipDays: number }) => string | null;
  setPostStatus: (id: string, status: PostItem["status"]) => void;
  resolveReport: (id: string, resolution: string) => void;
  grantVip: (id: string, days: number, reason: string) => string | null;
  revokeVip: (id: string, reason: string) => string | null;
  toggleEntitlement: (key: string) => void;
  addTopic: (name: string) => void;
  toggleBoard: (id: string) => void;
  saveAnnouncement: (input: { id?: string; title: string; body: string }) => void;
  setAnnouncement: (id: string, status: Announcement["status"]) => void;
  toggleFlag: (key: keyof Flags) => void;
  createInvite: () => string;
  revokeInvite: (code: string) => void;
  revokeAdmin: (id: string) => void;
  logoutOtherDevices: () => void;
  markNotices: (kind?: NoticeItem["kind"]) => void;
  sendNotice: (userId: string, body: string) => string | null;
};

const persistedSeed = (): Persisted => ({
  authed: false,
  password: "nova1234",
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
    return {
      ...data,
      entitlements: { ...entitlementMap(), ...(data.entitlements || {}) },
      flags: { ...persistedSeed().flags, ...(data.flags || {}) },
    };
  } catch {
    return {};
  }
}

export const useAdmin = create<AdminState>((set, get) => ({
  ...persistedSeed(),
  ...restoreLocal(),
  // On the client we start already "booted" so a failed/slow useEffect can never
  // trap the user on the star splash. SSR still starts false (no window).
  booted: typeof window !== "undefined",
  bootError: null,
  connection: emptyConnection(loadConfig().baseUrl),
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
    get().flash(status.reachable ? (status.mode === "live" ? "已连接服务器" : "后端已通，部分功能仍用演示数据") : "后端不可达，已保持演示数据");
    return status;
  },
  go: (name, userId) => set((s) => ({ history: [...s.history, s.nav], nav: { name, userId } })),
  back: () =>
    set((s) => {
      const history = [...s.history];
      const prev = history.pop();
      return { history, nav: prev ?? { name: "home" } };
    }),
  tab: (name) => set({ nav: { name }, history: [] }),
  attemptLogin: (account, password) => {
    const s = get();
    if (s.lockedUntil > Date.now()) return "登录已暂时锁定，请稍后再试";
    if (account.trim().toLowerCase() !== "admin" || password !== s.password) {
      const failedLogins = s.failedLogins + 1;
      const locked = failedLogins >= 5;
      set({
        failedLogins: locked ? 0 : failedLogins,
        lockedUntil: locked ? Date.now() + 30_000 : 0,
        audits: [
          makeAudit({ kind: "security", action: locked ? "登录锁定" : "登录失败", target: "admin" }),
          ...s.audits,
        ],
      });
      return locked ? "连续失败 5 次，已锁定 30 秒" : "账号或密码不正确";
    }
    return null;
  },
  confirmTotp: (code) => {
    if (code.trim() !== "246810") return "验证码不正确";
    set((s) =>
      withAudit(s, { kind: "security", action: "管理员登录", target: "admin · 已验证" }, {
        authed: true,
        failedLogins: 0,
        lockedUntil: 0,
        nav: { name: "home" },
        history: [],
      }),
    );
    return null;
  },
  logout: () =>
    set((s) =>
      withAudit(s, { kind: "security", action: "退出登录", target: "admin" }, {
        authed: false,
        nav: { name: "home" },
        history: [],
      }),
    ),
  changePassword: (current, next) => {
    const s = get();
    if (current !== s.password) return "当前密码不正确";
    if (next.length < 8) return "新密码至少 8 位";
    set((state) =>
      withAudit(state, { kind: "security", action: "修改管理员密码", target: "admin" }, { password: next }),
    );
    get().flash("密码已更新，只保存在本机预览");
    return null;
  },
  resetDemo: () => {
    const fresh = persistedSeed();
    set({ ...fresh, authed: false, nav: { name: "home" }, history: [] });
    get().flash("已恢复演示账号");
  },
  banUser: (id) => {
    const member = get().members.find((item) => item.id === id);
    if (!member || member.status === "banned") return;
    set((s) =>
      withAudit(s, { kind: "admin", action: "封禁账号", target: member.name }, {
        members: s.members.map((item) =>
          item.id === id ? { ...item, status: "banned" as const, presence: "offline" as const } : item,
        ),
      }),
    );
    get().flash(`已封禁 ${member.name}，其会话视为失效`);
  },
  unbanUser: (id) => {
    const member = get().members.find((item) => item.id === id);
    if (!member || member.status !== "banned") return;
    set((s) =>
      withAudit(s, { kind: "admin", action: "解除封禁", target: member.name }, {
        members: s.members.map((item) => (item.id === id ? { ...item, status: "active" as const } : item)),
      }),
    );
    get().flash(`已解除 ${member.name} 的封禁`);
  },
  updateUser: (id, patch) => {
    const member = get().members.find((item) => item.id === id);
    if (!member) return;
    set((s) =>
      withAudit(s, { kind: "admin", action: "编辑用户资料", target: member.name }, {
        members: s.members.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      }),
    );
    get().flash("资料已保存");
  },
  revealEmail: (id) => {
    const member = get().members.find((item) => item.id === id);
    if (!member) return;
    set((s) =>
      withAudit(s, { kind: "security", action: "查看完整邮箱", target: member.name }, {}),
    );
  },
  resetPassword: (id) => {
    const member = get().members.find((item) => item.id === id);
    if (!member) return null;
    const code = tempCode();
    set((s) =>
      withAudit(s, { kind: "admin", action: "生成重置码", target: member.name }, {
        members: s.members.map((item) => (item.id === id ? { ...item, tempCode: code } : item)),
      }),
    );
    return code;
  },
  addUser: ({ name, email, vipDays }) => {
    const trimmed = name.trim();
    if (trimmed.length < 2) return "昵称至少 2 个字";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return "邮箱格式不正确";
    if (get().members.some((item) => item.email.toLowerCase() === email.trim().toLowerCase())) {
      return "这个邮箱已经注册";
    }
    const id = String(10000 + get().members.length + 1);
    const member: Member = {
      id,
      name: trimmed,
      email: email.trim(),
      avatar: "",
      status: "active",
      presence: "offline",
      vipUntil: vipDays > 0 ? Date.now() + vipDays * 86400000 : null,
      joinedAt: stamp(),
      lastLogin: "尚未登录",
      violations: 0,
      bio: "",
      posts: 0,
      canPost: true,
      canComment: true,
      tempCode: null,
    };
    set((s) =>
      withAudit(s, { kind: "admin", action: "添加用户", target: trimmed }, {
        members: [member, ...s.members],
      }),
    );
    get().flash("用户已添加");
    return null;
  },
  setPostStatus: (id, status) => {
    const post = get().posts.find((item) => item.id === id);
    if (!post || post.status === status) return;
    const action = status === "approved" ? "通过内容" : status === "removed" ? "删除内容" : "退回待审";
    set((s) =>
      withAudit(s, { kind: "admin", action, target: post.title }, {
        posts: s.posts.map((item) => (item.id === id ? { ...item, status } : item)),
      }),
    );
    get().flash(status === "approved" ? "已通过" : status === "removed" ? "已删除" : "已退回");
  },
  resolveReport: (id, resolution) => {
    const report = get().reports.find((item) => item.id === id);
    if (!report || report.status === "done") return;
    set((s) => {
      let posts = s.posts;
      let members = s.members;
      if (resolution.startsWith("删除") && report.postId) {
        posts = posts.map((item) => (item.id === report.postId ? { ...item, status: "removed" as const } : item));
      }
      if (resolution.startsWith("封禁") && report.userId) {
        members = members.map((item) =>
          item.id === report.userId ? { ...item, status: "banned" as const, presence: "offline" as const, violations: item.violations + 1 } : item,
        );
      } else if (resolution.includes("警告") && report.userId) {
        members = members.map((item) =>
          item.id === report.userId ? { ...item, violations: item.violations + 1 } : item,
        );
      }
      const notice: NoticeItem = {
        id: uid("n"),
        kind: "violation",
        title: "举报处理结论",
        body: `${report.title}：${resolution}。已记录给举报人与被举报对象。`,
        time: "刚刚",
        read: false,
      };
      return withAudit(s, { kind: "admin", action: "处理举报", target: report.title }, {
        posts,
        members,
        notices: [notice, ...s.notices],
        reports: s.reports.map((item) =>
          item.id === id ? { ...item, status: "done" as const, resolution } : item,
        ),
      });
    });
    get().flash("处理结果已记录");
  },
  grantVip: (id, days, reason) => {
    const member = get().members.find((item) => item.id === id);
    if (!member) return "找不到用户";
    if (member.status === "banned") return "封禁账号不能开通会员";
    if (!reason.trim()) return "请填写原因";
    const base = member.vipUntil && member.vipUntil > Date.now() ? member.vipUntil : Date.now();
    const vipUntil = base + days * 86400000;
    const action = member.vipUntil && member.vipUntil > Date.now() ? "续期会员" : "开通会员";
    set((s) =>
      withAudit(s, { kind: "admin", action, target: `${member.name} · ${reason.trim()}` }, {
        members: s.members.map((item) => (item.id === id ? { ...item, vipUntil } : item)),
      }),
    );
    get().flash(`${member.name} 的会员已更新`);
    return null;
  },
  revokeVip: (id, reason) => {
    const member = get().members.find((item) => item.id === id);
    if (!member) return "找不到用户";
    if (!reason.trim()) return "请填写原因";
    set((s) =>
      withAudit(s, { kind: "admin", action: "撤销会员", target: `${member.name} · ${reason.trim()}` }, {
        members: s.members.map((item) => (item.id === id ? { ...item, vipUntil: null } : item)),
      }),
    );
    get().flash("会员权益已立即失效");
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
  saveAnnouncement: ({ id, title, body }) => {
    if (title.trim().length < 2 || body.trim().length < 2) {
      get().flash("标题和正文都要填写");
      return;
    }
    set((s) => {
      if (id) {
        return withAudit(s, { kind: "admin", action: "编辑公告", target: title.trim() }, {
          announcements: s.announcements.map((item) =>
            item.id === id ? { ...item, title: title.trim(), body: body.trim() } : item,
          ),
        });
      }
      const item: Announcement = {
        id: uid("an"),
        title: title.trim(),
        body: body.trim(),
        status: "draft",
        time: stamp(),
      };
      return withAudit(s, { kind: "admin", action: "创建公告草稿", target: item.title }, {
        announcements: [item, ...s.announcements],
      });
    });
    get().flash(id ? "公告已保存" : "已存为草稿");
  },
  setAnnouncement: (id, status) => {
    const item = get().announcements.find((row) => row.id === id);
    if (!item) return;
    const action = status === "published" ? "发布公告" : status === "withdrawn" ? "撤回公告" : "退回草稿";
    set((s) =>
      withAudit(s, { kind: "admin", action, target: item.title }, {
        announcements: s.announcements.map((row) => (row.id === id ? { ...row, status } : row)),
        notices:
          status === "published"
            ? [
                {
                  id: uid("n"),
                  kind: "system" as const,
                  title: "全站公告",
                  body: item.title,
                  time: "刚刚",
                  read: false,
                },
                ...s.notices,
              ]
            : s.notices,
      }),
    );
    get().flash(action);
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
    users: USER_BASE + members.length,
    active: ACTIVE_BASE + online,
    posts: POST_BASE + posts.filter((item) => item.status !== "removed").length,
  };
}

function applyConnection(status: ConnectionStatus) {
  const patch: Partial<AdminState> = { connection: status, booted: true };
  if (status.catalog) {
    patch.entitlements = mapCatalogEntitlements(status.catalog, useAdmin.getState().entitlements);
  }
  // 若未来后端已有用户列表，用服务器数据替换演示用户（保留无法映射的字段默认值）。
  // 探测阶段若只是「路径存在但需要管理员令牌」(401)，不要清空演示用户。
  useAdmin.setState(patch);
  markAppBooted();
}

export async function pullRemoteUsers(): Promise<number> {
  const { apiRequest } = await import("./backend");
  const res = await apiRequest("adminUsers");
  if (!res.ok) return 0;
  const rows = extractList(res.json)
    .map(mapRemoteUser)
    .filter((item): item is NonNullable<typeof item> => !!item);
  if (!rows.length) return 0;
  const members = rows.map((item) => ({
    ...item,
    avatar: item.avatar || "",
  }));
  useAdmin.setState({ members });
  return members.length;
}

let didHydrate = false;
let persistUnsub: (() => void) | null = null;

function startPersisting() {
  if (persistUnsub) return;
  persistUnsub = useAdmin.subscribe((state) => {
    const slice: Persisted = {
      authed: state.authed,
      password: state.password,
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
      useAdmin.setState({ ...restored, booted: true, bootError: null });
    } catch (err) {
      useAdmin.setState({
        booted: true,
        bootError: err instanceof Error ? err.message : "本地数据读取失败，已进入演示模式",
      });
    }
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
        bootError: "启动超时，已进入离线演示模式。可在「设置服务器」填写后端地址后重试。",
      });
      markAppBooted();
    }
  }, 2000);

  void (async () => {
    try {
      const cfg = loadConfig();
      const base = (cfg.baseUrl || "").trim();
      const sameOrigin = !base && window.location.protocol !== "file:";
      if (base || sameOrigin) {
        const status = await Promise.race([
          probeConnection(base, 3500, true),
          new Promise<ConnectionStatus>((resolve) =>
            setTimeout(() => resolve({ ...emptyConnection(base), message: "检测超时，先使用演示数据。", lastChecked: Date.now() }), 3500),
          ),
        ]);
        applyConnection(status);
        if (status.mode === "live") {
          try {
            await pullRemoteUsers();
          } catch {
            /* keep demo members */
          }
        }
      }
    } catch (err) {
      useAdmin.setState({
        booted: true,
        bootError: err instanceof Error ? err.message : "后端检测失败，已使用演示数据",
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
