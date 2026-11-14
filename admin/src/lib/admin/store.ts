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
  type MappedCommunity,
  type MappedBlockword,
  type MappedChannelMessage,
  type MappedChannel,
  type MappedAppeal,
  type MappedSecurityEvent,
  formatAdminTime,
  resolveBase,
} from "./backend";
import { readInitialNav, startHashListener, writeHash, isWritingHash } from "./hash-route";
import { captureCurrentScroll } from "./scroll-restore";
import * as remote from "./remote";
import { resolveAvatar } from "./avatar";
import { ANNOUNCEMENT_BODY_MAX, ANNOUNCEMENT_TITLE_MAX, countChars } from "./backend";
import { SESSION_KEY, STORE_KEY, clearAuthStorage, migrateAdminStorage } from "./storage-keys";

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
  | "hot"
  | "devices"
  | "admins"
  | "payments"
  | "communities"
  | "channel"
  | "blockwords"
  | "marketing"
  | "events"
  | "appeals";

export type Nav = { name: PageName; userId?: string; channelId?: string };

export type Member = {
  id: string;
  name: string;
  email: string;
  avatar: string;
  avatarColor?: string;
  avatarLetter?: string;
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
  parentId?: string;
  rootId?: string;
  depth?: number;
  replyToName?: string;
  replyToText?: string;
  replyCount?: number;
  audience?: import("./backend").PostAudience;
  audienceLabel?: string;
  mood?: string;
  location?: string;
  media?: import("./backend").MappedMedia[];
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
  targetType?: string;
  targetId?: string;
  targetName?: string;
  messageIds?: string[];
  media?: import("./backend").MappedMedia[];
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
  published?: boolean;
  publishedAt?: string;
};

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


const KEY = STORE_KEY;

function clearLocalAuth() {
  try {
    clearAuthStorage(window.localStorage, window.sessionStorage);
  } catch {
    try {
      saveConfig({ token: "" });
    } catch {
      /* private mode */
    }
  }
}

function stamp() {
  return formatAdminTime(Date.now());
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
  return { id: uid("a"), time: stamp(), ip: "", ...partial };
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
  return formatAdminTime(ms, "未开通");
}

export function daysLeft(ms: number | null) {
  if (!ms) return null;
  return Math.ceil((ms - Date.now()) / 86400000);
}

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
  boards: Board[];
  devices: Device[];
  admins: AdminAccount[];
  invites: Invite[];
  flags: Flags;
  entitlements: Record<string, boolean>;
  failedLogins: number;
  lockedUntil: number;
};

export type FeedState = "idle" | "ok" | "error";

const idleFeeds = (): AdminState["feeds"] => ({ stats: "idle", appeals: "idle", audit: "idle", events: "idle" });

export type AdminState = Persisted & {
  booted: boolean;
  bootError: string | null;
  connection: ConnectionStatus;
  nav: Nav;
  history: Nav[];
  toast: string | null;
  flash: (toast: string) => void;
  connectServer: (baseUrl: string, endpoints?: Partial<EndpointMap>) => Promise<ConnectionStatus>;
  go: (name: PageName, userId?: string, channelId?: string) => void;
  back: () => void;
  /** 返回到指定页面：上一页正好是它就出栈，否则原地替换当前页（不往历史里再压一层，避免来回循环）。 */
  backTo: (name: PageName, userId?: string, channelId?: string) => void;
  tab: (name: PageName) => void;
  adminProfile: MappedAdmin | null;
  stats: MappedStats | null;
  payments: MappedPayment[];
  mediaReview: import("./backend").MappedMedia[];
  mediaReviewFeed: FeedState;
  communities: MappedCommunity[];
  communityDetail: MappedCommunity | null;
  channelMessages: MappedChannelMessage[];
  channelInfo: MappedChannel | null;
  blockwords: MappedBlockword[];
  securityEvents: MappedSecurityEvent[];
  appeals: MappedAppeal[];
  appealsTruncated: boolean;
  feeds: { stats: FeedState; appeals: FeedState; audit: FeedState; events: FeedState };
  /** 公告列表的读取状态；missing 表示服务器暂未开放。 */
  announcementsFeed: "idle" | "ok" | "error" | "missing";
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
  refreshMediaReview: () => Promise<void>;
  fetchMediaObjectUrl: (id: string, kind?: "preview" | "file") => Promise<{ url: string; mime: string } | { error: string }>;
  confirmPayment: (id: string, note?: string) => Promise<string | null>;
  rejectPayment: (id: string, reason: string) => Promise<string | null>;
  refundPayment: (id: string, reason?: string) => Promise<string | null>;
  fetchReceiptUrl: (id: string) => Promise<{ url: string; mime: string } | { error: string }>;
  resolveReport: (id: string, resolution: string) => Promise<string | null>;
  grantVip: (id: string, days: number, reason: string) => Promise<string | null>;
  revokeVip: (id: string, reason: string) => Promise<string | null>;
  deleteAnnouncement: (id: string) => Promise<string | null>;
  withdrawAnnouncement: (id: string) => Promise<string | null>;
  refreshCommunities: () => Promise<void>;
  openCommunity: (id: string, navigate?: boolean) => Promise<string | null>;
  openChannel: (communityId: string, channelId: string, navigate?: boolean) => Promise<string | null>;
  moderateCommunity: (action: remote.CommunityAction, id: string, body: { reason?: string; confirm?: string }) => Promise<string | null>;
  moderateMember: (action: remote.CommunityMemberAction, id: string, userId: string, body: { reason?: string; hours?: number; ban?: boolean }) => Promise<string | null>;
  refreshBlockwords: () => Promise<void>;
  refreshFlags: () => Promise<void>;
  addBlockword: (word: string, note?: string) => Promise<string | null>;
  deleteBlockword: (id: string) => Promise<string | null>;
  refreshSecurityEvents: (opts?: { kind?: string }) => Promise<void>;
  refreshAppeals: (opts?: { status?: string }) => Promise<void>;
  decideAppeal: (id: string, action: "accept" | "reject", note?: string) => Promise<string | null>;
  openContentItem: (type: "post" | "comment", id: string) => Promise<import("./backend").MappedContent | null>;
  toggleEntitlement: (key: string) => void;
  toggleBoard: (id: string) => void;
  saveAnnouncement: (input: { id?: string; title: string; body: string; publish?: boolean }) => Promise<string | null>;
  publishAnnouncement: (id: string) => Promise<string | null>;
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
        if (sessionStorage.getItem(SESSION_KEY) !== "1") authed = false;
      } catch {
        authed = false;
      }
    }
    return {
      ...data,
      authed,
      rememberLogin,
      demoMode: false,
      members: [],
      posts: [],
      reports: [],
      notices: [],
      announcements: [],
      boards: [],
      audits: [],
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
    avatar: resolveAvatar(m.avatar).url || "",
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
    parentId: c.parentId || undefined,
    rootId: c.rootId || undefined,
    depth: c.depth || 0,
    replyToName: c.replyTo && !c.replyTo.deleted ? c.replyTo.authorName : c.replyTo ? "已删除的评论" : undefined,
    replyToText: c.replyTo && !c.replyTo.deleted ? c.replyTo.text : undefined,
    replyCount: c.replyCount || 0,
    audience: c.audience,
    audienceLabel: c.audienceLabel,
    mood: c.mood,
    location: c.location,
    media: c.media,
  };
}

function toAnnouncement(a: import("./backend").MappedAnnouncement): Announcement {
  return {
    id: a.id,
    title: a.title,
    body: a.body,
    status: a.status,
    time: a.time,
    published: a.published,
    publishedAt: a.publishedAt,
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
    clearLocalAuth();
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
  connection: emptyConnection(resolveBase()),
  adminProfile: null,
  stats: null,
  payments: [],
  mediaReview: [],
  mediaReviewFeed: "idle",
  communities: [],
  communityDetail: null,
  channelMessages: [],
  channelInfo: null,
  blockwords: [],
  securityEvents: [],
  appeals: [],
  appealsTruncated: false,
  feeds: idleFeeds(),
  announcementsFeed: "idle",
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
    get().flash(status.reachable ? (status.mode === "live" ? "已连接服务器" : "已连上服务器，部分功能暂不可用") : "网络不太好，请稍后再试");
    return status;
  },
  go: (name, userId, channelId) => {
    captureCurrentScroll(get().nav);
    set((s) => ({ history: [...s.history, s.nav], nav: { name, userId, channelId } }));
    writeHash({ name, userId, channelId });
  },
  back: () => {
    captureCurrentScroll(get().nav);
    set((s) => {
      const history = [...s.history];
      const prev = history.pop();
      return { history, nav: prev ?? { name: "home" } };
    });
    writeHash(useAdmin.getState().nav);
  },
  backTo: (name, userId, channelId) => {
    const s = get();
    const prev = s.history[s.history.length - 1];
    if (prev && prev.name === name && (userId === undefined || prev.userId === userId)) {
      s.back();
      return;
    }
    captureCurrentScroll(s.nav);
    set({ nav: { name, userId, channelId } });
    writeHash({ name, userId, channelId });
  },
  tab: (name) => {
    captureCurrentScroll(get().nav);
    set({ nav: { name }, history: [] });
    writeHash({ name });
  },
  attemptLogin: async (account, password, remember = true) => {
    const s = get();
    if (s.lockedUntil > Date.now()) {
      const sec = Math.max(1, Math.ceil((s.lockedUntil - Date.now()) / 1000));
      const pretty = sec >= 60 ? `${Math.ceil(sec / 60)} 分钟` : `${sec} 秒`;
      return `尝试次数过多，请 ${pretty} 后再试`;
    }
    const name = account.trim();
    if (!name || !password) return "请输入管理员账号和密码";
    const result = await remote.remoteLogin(name, password);
    if (!result.ok) {
      const retryMs = result.retryAfter != null && result.retryAfter > 0 ? result.retryAfter * 1000 : 0;
      const serverLock = result.status === 429 || result.status === 423 || retryMs > 0;
      const failedLogins = serverLock ? s.failedLogins : s.failedLogins + 1;
      const localLock = !serverLock && failedLogins >= 5;
      set({
        failedLogins: localLock ? 0 : failedLogins,
        lockedUntil: retryMs > 0 ? Date.now() + retryMs : localLock ? Date.now() + 30_000 : s.lockedUntil,
      });
      if (serverLock) return result.error;
      return localLock ? "连续失败 5 次，已锁定 30 秒" : result.error;
    }
    saveConfig({ token: result.data.token });
    try {
      if (remember) sessionStorage.removeItem(SESSION_KEY);
      else sessionStorage.setItem(SESSION_KEY, "1");
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
      clearLocalAuth();
    }
    clearLocalAuth();
    set({
      authed: false,
      adminProfile: null,
      nav: { name: "home" },
      history: [],
      members: [],
      posts: [],
      reports: [],
      audits: [],
      announcements: [],
      payments: [],
      mediaReview: [],
      mediaReviewFeed: "idle",
      stats: null,
      securityEvents: [],
      appeals: [],
      appealsTruncated: false,
      feeds: idleFeeds(),
    });
    writeHash({ name: "home" });
  },
  changePassword: (_current, _next) => {
    return "管理员密码请联系技术人员修改";
  },
  resetDemo: () => {
    clearLocalAuth();
    const fresh = emptyPersisted();
    set({
      ...fresh,
      demoMode: false,
      authed: false,
      adminProfile: null,
      payments: [],
      mediaReview: [],
      mediaReviewFeed: "idle",
      stats: null,
      communities: [],
      communityDetail: null,
      channelMessages: [],
      blockwords: [],
      nav: { name: "home" },
      history: [],
      booted: true,
      connection: get().connection,
    });
    writeHash({ name: "home" });
    get().flash("已退出并清空本机会话");
  },
  setDemoMode: (_on) => {
    get().flash("演示模式已移除，只展示服务器真实数据");
  },
  banUser: async (id, reason) => {
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
    get().flash("暂时不能改资料");
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
    get().flash("内容只有可见或已删除两种状态");
    return "没有待审状态";
  },
  refreshContent: async (opts) => {
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
    const result = await remote.remoteUsers({ status: opts?.status, q: opts?.q, limit: 100 });
    if (!result.ok) {
      get().flash(result.error);
      return;
    }
    set({ members: result.data.map(toMember) });
  },
  refreshPayments: async (opts) => {
    const result = await remote.remotePayments({ status: opts?.status, q: opts?.q, limit: 50 });
    if (!result.ok) {
      get().flash(result.error);
      return;
    }
    set({ payments: result.data });
  },
  refreshAudit: async () => {
    const result = await remote.remoteAudit({ limit: 80 });
    if (!result.ok) {
      set((s) => ({ feeds: { ...s.feeds, audit: "error" } }));
      return;
    }
    set((s) => ({ audits: result.data.map(toAudit), feeds: { ...s.feeds, audit: "ok" } }));
  },
  refreshAnnouncements: async () => {
    const result = await remote.remoteAnnouncements();
    if (!result.ok) {
      set({ announcementsFeed: result.missing ? "missing" : "error" });
      return;
    }
    set({ announcements: result.data.map(toAnnouncement), announcementsFeed: "ok" });
  },
  refreshStats: async () => {
    const result = await remote.remoteStats();
    if (!result.ok) {
      set((s) => ({ feeds: { ...s.feeds, stats: "error" } }));
      return;
    }
    set((s) => ({ stats: result.data, feeds: { ...s.feeds, stats: "ok" } }));
  },
  refreshReports: async () => {
    const result = await remote.remoteReports({ limit: 50 });
    if (!result.ok) return;
    set({ reports: result.data.map(toReport) });
  },
  refreshMediaReview: async () => {
    const result = await remote.remoteMediaReview({ limit: 50 });
    if (!result.ok) {
      const missing = result.status === 404 || result.status === 405;
      set({ mediaReview: [], mediaReviewFeed: missing ? "error" : "error" });
      if (!missing) get().flash(result.error);
      return;
    }
    set({ mediaReview: result.data, mediaReviewFeed: "ok" });
  },
  fetchMediaObjectUrl: async (id, kind = "preview") => {
    const result = await remote.remoteMediaFile(id, kind);
    if (!result.ok) return { error: result.error };
    return { url: result.data.objectUrl, mime: result.data.mime };
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
      get().flash("已标记退款。如需撤销会员，请到用户详情手动操作");
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
  saveAnnouncement: async ({ id, title, body, publish }) => {
    const t = title.trim();
    const b = body.trim();
    if (!t || !b) {
      get().flash("标题和正文都要填写");
      return "标题和正文都要填写";
    }
    if (countChars(t) > ANNOUNCEMENT_TITLE_MAX) return `标题最多 ${ANNOUNCEMENT_TITLE_MAX} 个字`;
    if (countChars(b) > ANNOUNCEMENT_BODY_MAX) return `正文最多 ${ANNOUNCEMENT_BODY_MAX} 个字`;
    const before = get().announcements;
    const withdrawnNames = (ids: string[] | undefined) =>
      before.filter((item) => (ids || []).includes(item.id)).map((item) => `《${item.title}》`);
    if (id) {
      const result = await remote.remoteEditAnnouncement(id, t, b);
      if (!result.ok) {
        const msg = result.missing ? "服务器暂未开放此功能" : result.error;
        get().flash(msg);
        return msg;
      }
      const ids = result.withdrawnIds || [];
      set((s) => ({
        announcements: s.announcements.map((item) =>
          item.id === id
            ? toAnnouncement(result.data)
            : ids.includes(item.id)
              ? { ...item, status: "withdrawn" as const, published: false }
              : item,
        ),
      }));
      const names = withdrawnNames(ids);
      get().flash(names.length ? `公告已保存，并自动下线${names.join("、")}` : "公告已保存");
      if (ids.length) void get().refreshAnnouncements();
      void get().refreshAudit();
      return null;
    }
    const result = await remote.remoteAddAnnouncement(t, b, !!publish);
    if (!result.ok) {
      const msg = result.missing ? "服务器暂未开放此功能" : result.error;
      get().flash(msg);
      return msg;
    }
    if (result.data.list.length) set({ announcements: result.data.list.map(toAnnouncement), announcementsFeed: "ok" });
    else void get().refreshAnnouncements();
    const names = withdrawnNames(result.data.withdrawnIds);
    get().flash(publish ? (names.length ? `公告已发布，并自动下线${names.join("、")}` : "公告已发布") : "已存为草稿");
    void get().refreshAudit();
    return null;
  },
  publishAnnouncement: async (id) => {
    const before = get().announcements;
    const result = await remote.remotePublishAnnouncement(id);
    if (!result.ok) {
      const msg = result.missing ? "服务器暂未开放此功能" : result.error;
      get().flash(msg);
      return msg;
    }
    const { announcement, already, withdrawnIds } = result.data;
    set((s) => ({
      announcements: s.announcements.map((item) =>
        item.id === id
          ? toAnnouncement(announcement)
          : withdrawnIds.includes(item.id)
            ? { ...item, status: "withdrawn" as const, published: false }
            : item,
      ),
    }));
    const names = before.filter((item) => withdrawnIds.includes(item.id)).map((item) => `《${item.title}》`);
    get().flash(already ? "这条公告已在发布中" : names.length ? `已发布，并自动下线${names.join("、")}` : "公告已发布");
    void get().refreshAnnouncements();
    void get().refreshAudit();
    return null;
  },
  setAnnouncement: (id, status) => {
    if (status === "withdrawn") void get().withdrawAnnouncement(id);
  },
  withdrawAnnouncement: async (id) => {
    const result = await remote.remoteWithdrawAnnouncement(id);
    if (!result.ok) {
      get().flash(result.error);
      return result.error;
    }
    set((s) => ({
      announcements: s.announcements.map((item) => (item.id === id ? toAnnouncement(result.data) : item)),
    }));
    get().flash(result.json && (result.json as { already?: boolean }).already ? "公告本来就已下线" : "公告已下线");
    void get().refreshAudit();
    return null;
  },
  refreshCommunities: async () => {
    const result = await remote.remoteCommunities();
    if (!result.ok) {
      get().flash(result.error);
      return;
    }
    set({ communities: result.data });
  },
  openCommunity: async (id, navigate = true) => {
    const result = await remote.remoteCommunity(id);
    if (!result.ok) {
      get().flash(result.error);
      return result.error;
    }
    set({ communityDetail: result.data });
    const nav = get().nav;
    if (navigate && (nav.name !== "community" || nav.userId !== id)) get().go("community", id);
    return null;
  },
  openChannel: async (communityId, channelId, navigate = true) => {
    const result = await remote.remoteChannelMessages(channelId);
    if (!result.ok) {
      get().flash(result.error);
      return result.error;
    }
    set({ channelMessages: result.data.messages, channelInfo: result.data.channel });
    const nav = get().nav;
    if (navigate && (nav.name !== "channel" || nav.channelId !== channelId)) get().go("channel", communityId, channelId);
    return null;
  },
  moderateCommunity: async (action, id, body) => {
    const result = await remote.remoteCommunityAction(action, id, body);
    if (!result.ok) {
      get().flash(result.error);
      return result.error;
    }
    if (action === "delete") {
      set((s) => ({ communities: s.communities.filter((c) => c.id !== id), communityDetail: s.communityDetail?.id === id ? null : s.communityDetail }));
    } else if (result.data) {
      const item = result.data;
      set((s) => ({
        communityDetail: item,
        communities: s.communities.map((c) => (c.id === id ? { ...c, status: item.status, takedownReason: item.takedownReason, takenDownAt: item.takenDownAt, memberCount: item.memberCount } : c)),
      }));
    }
    get().flash({ takedown: "社区已下架，已通知所有者", restore: "社区已恢复上架", warn: "已向社区所有者发送警告", delete: "社区已删除" }[action]);
    void get().refreshAudit();
    return null;
  },
  moderateMember: async (action, id, userId, body) => {
    const result = await remote.remoteCommunityMemberAction(action, id, userId, body);
    if (!result.ok) {
      get().flash(result.error);
      return result.error;
    }
    const item = result.data;
    set((s) => ({ communityDetail: item, communities: s.communities.map((c) => (c.id === id ? { ...c, memberCount: item.memberCount } : c)) }));
    get().flash(action === "remove" ? (body.ban ? "已移出并禁止再加入" : "已移出社区") : action === "mute" ? "已禁言" : "已解除禁言");
    void get().refreshAudit();
    return null;
  },
  refreshBlockwords: async () => {
    const result = await remote.remoteBlockwords();
    if (!result.ok) {
      get().flash(result.error);
      return;
    }
    set({ blockwords: result.data });
  },
  refreshFlags: async () => {
    if (get().demoMode) return;
    const result = await remote.remoteFlags();
    if (!result.ok) return;
    set((s) => ({ flags: { ...s.flags, ...result.data } }));
  },
  addBlockword: async (word, note) => {
    const w = (word || "").trim();
    if (!w) return "请填写屏蔽词";
    const result = await remote.remoteAddBlockword(w, note);
    if (!result.ok) {
      get().flash(result.error);
      return result.error;
    }
    get().flash(result.data.existed ? "该屏蔽词已存在" : "已添加平台屏蔽词");
    await get().refreshBlockwords();
    void get().refreshAudit();
    return null;
  },
  deleteBlockword: async (id) => {
    const result = await remote.remoteDeleteBlockword(id);
    if (!result.ok) {
      get().flash(result.error);
      return result.error;
    }
    set((s) => ({ blockwords: s.blockwords.filter((item) => item.id !== id) }));
    get().flash("已删除屏蔽词");
    void get().refreshAudit();
    return null;
  },
  refreshSecurityEvents: async (opts) => {
    const result = await remote.remoteSecurityEvents({ limit: 80, kind: opts?.kind || undefined });
    if (!result.ok) {
      set((s) => ({ feeds: { ...s.feeds, events: "error" } }));
      return;
    }
    set((s) => ({ securityEvents: result.data, feeds: { ...s.feeds, events: "ok" } }));
  },
  refreshAppeals: async (opts) => {
    const limit = 100;
    const result = await remote.remoteAppeals({ limit, status: opts?.status && opts.status !== "all" ? opts.status : undefined });
    if (!result.ok) {
      set((s) => ({ feeds: { ...s.feeds, appeals: "error" } }));
      return;
    }
    set((s) => ({
      appeals: result.data,
      appealsTruncated: !!result.truncated,
      feeds: { ...s.feeds, appeals: "ok" },
    }));
  },
  decideAppeal: async (id, action, note) => {
    const result = await remote.remoteDecideAppeal(id, action, note);
    if (!result.ok) {
      get().flash(result.error);
      return result.error;
    }
    set((s) => {
      const i = s.appeals.findIndex((a) => a.id === id);
      const next = s.appeals.slice();
      if (i < 0) next.unshift(result.data);
      else next[i] = result.data;
      return { appeals: next };
    });
    get().flash(action === "accept" ? "已通过该申诉" : "已驳回该申诉");
    void get().refreshAudit();
    if (action === "accept") void get().refreshUsers();
    return null;
  },
  openContentItem: async (type, id) => {
    const result = await remote.remoteContentItem(type, id);
    if (!result.ok) {
      get().flash(result.error);
      return null;
    }
    set((s) => ({ posts: upsertPost(s.posts, toPost(result.data)) }));
    return result.data;
  },
  toggleFlag: (key) => {
    const prev = get().flags[key];
    const next = !prev;
    const labels: Record<keyof Flags, string> = {
      loginProtect: "登录保护",
      registrationOpen: "开放注册",
      maintenance: "维护模式",
      reviewRequired: "内容先审后发",
    };
    set((s) =>
      withAudit(s, { kind: "admin", action: next ? `开启${labels[key]}` : `关闭${labels[key]}`, target: "系统配置" }, {
        flags: { ...s.flags, [key]: next },
      }),
    );
    if (get().demoMode) return;
    void (async () => {
      const result = await remote.remoteSetFlags({ [key]: next });
      if (!result.ok) {
        set((s) => ({ flags: { ...s.flags, [key]: prev } }));
        get().flash(result.error || "没有同步到服务器，已改回");
        return;
      }
      set((s) => ({ flags: { ...s.flags, ...result.data } }));
    })();
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
    get().flash("已写入站内通知");
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

/** 某类管理数据是否有真实来源；演示模式不算真实。 */
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
  if (!s.authed) return;
  await Promise.all([
    s.refreshUsers(),
    s.refreshContent({ type: "all", status: "all" }),
    s.refreshPayments(),
    s.refreshAudit(),
    s.refreshAnnouncements(),
    s.refreshStats(),
    s.refreshReports(),
    s.refreshCommunities(),
    s.refreshBlockwords(),
    s.refreshFlags(),
    s.refreshSecurityEvents(),
    s.refreshAppeals({ status: "pending" }),
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
    try {
      migrateAdminStorage(window.localStorage, window.sessionStorage);
    } catch {
      /* private mode */
    }
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
        if (s.nav.name === next.name && s.nav.userId === next.userId && s.nav.channelId === next.channelId) return;
        captureCurrentScroll(s.nav);
        useAdmin.setState({ nav: { name: next.name, userId: next.userId, channelId: next.channelId }, history: s.history });
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
        bootError: "启动超时。默认服务器仍会在后台重试；列表在未登录时保持为空。",
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
          sessionOk = sessionStorage.getItem(SESSION_KEY) === "1";
        } catch {
          sessionOk = false;
        }
      }
      if (token && sessionOk) {
        const me = await remote.remoteMe();
        if (me.ok) {
          useAdmin.setState({ authed: true, adminProfile: me.data, adminName: me.data.username, booted: true });
        } else {
          clearLocalAuth();
          useAdmin.setState({ authed: false, adminProfile: null, nav: { name: "home" }, history: [] });
          writeHash({ name: "home" });
        }
      } else if (useAdmin.getState().authed && !token) {
        useAdmin.setState({ authed: false, adminProfile: null, nav: { name: "home" }, history: [] });
        writeHash({ name: "home" });
      }

      const base = resolveBase();
      if (base) {
        const status = await Promise.race([
          probeConnection(base, 8000, false),
          new Promise<ConnectionStatus>((resolve) =>
            setTimeout(() => resolve({ ...emptyConnection(base), message: "网络不太好，请稍后再试", lastChecked: Date.now() }), 8000),
          ),
        ]);
        applyConnection(status);
        if (useAdmin.getState().authed) {
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
        bootError: err instanceof Error ? err.message : "网络不太好，请稍后再试",
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
