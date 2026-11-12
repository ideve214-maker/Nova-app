import { useEffect, useState } from "react";
import { Bell, Home, LayoutGrid, UserRound } from "lucide-react";
import { hydrateAdmin, markAppBooted, useAdmin, type PageName } from "@/lib/admin/store";
import { Frame, StarMark } from "./ui";
import { LoginScreen } from "./login";
import { HomeScreen, ManageScreen, MeScreen, MessagesScreen } from "./browse";
import { UserScreen, UsersScreen } from "./people";
import { ContentScreen, ReportsScreen } from "./queue";
import {
  AdminsScreen,
  AnnounceScreen,
  AuditScreen,
  CommunityScreen,
  DevicesScreen,
  SecurityScreen,
  SettingsScreen,
  StatsScreen,
  VipScreen,
} from "./system";

const tabs: { id: PageName; label: string; icon: typeof Home }[] = [
  { id: "home", label: "首页", icon: Home },
  { id: "manage", label: "管理", icon: LayoutGrid },
  { id: "messages", label: "消息", icon: Bell },
  { id: "me", label: "我的", icon: UserRound },
];

const SPLASH_TIMEOUT_MS = 2500;

export function AdminApp() {
  const booted = useAdmin((s) => s.booted);
  const bootError = useAdmin((s) => s.bootError);
  const authed = useAdmin((s) => s.authed);
  const name = useAdmin((s) => s.nav.name);
  const toast = useAdmin((s) => s.toast);
  const tab = useAdmin((s) => s.tab);
  const unread = useAdmin((s) => s.notices.filter((item) => !item.read).length);
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    hydrateAdmin();
    const t = window.setTimeout(() => {
      if (!useAdmin.getState().booted) {
        useAdmin.setState({
          booted: true,
          bootError: "启动时间过长，已进入应用。若一直停在星星页，请用预览链接或单文件 HTML 打开，不要用系统文件预览。",
        });
        markAppBooted();
        setStalled(true);
      }
    }, SPLASH_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (booted) markAppBooted();
  }, [booted]);

  if (!booted) {
    return (
      <Frame>
        <div className="nova-login grid flex-1 place-items-center px-6 text-on-primary" style={{ paddingTop: "max(var(--nova-safe-top, 0px), env(safe-area-inset-top, 0px))", paddingBottom: "max(var(--nova-safe-bottom, 0px), env(safe-area-inset-bottom, 0px))" }}>
          <div className="flex flex-col items-center text-center">
            <StarMark className="size-9" />
            <p className="mt-4 text-[15px] text-on-primary/85">正在进入 NOVA 管理端…</p>
            {(stalled || bootError) && (
              <>
                <p className="mt-3 max-w-xs text-[13px] leading-5">{bootError || "启动较慢"}</p>
                <button
                  type="button"
                  className="mt-4 h-11 rounded-full bg-surface px-6 text-[16px] font-semibold text-primary-deep"
                  onClick={() => {
                    useAdmin.setState({ booted: true, bootError: bootError || "已跳过启动等待" });
                    markAppBooted();
                  }}
                >
                  进入应用
                </button>
              </>
            )}
          </div>
        </div>
      </Frame>
    );
  }

  if (!authed) {
    return (
      <Frame>
        <LoginScreen />
      </Frame>
    );
  }

  const showTabs = name === "home" || name === "manage" || name === "messages" || name === "me";

  return (
    <Frame>
      <div className="flex min-h-0 flex-1 flex-col">
        {name === "home" && <HomeScreen />}
        {name === "manage" && <ManageScreen />}
        {name === "messages" && <MessagesScreen />}
        {name === "me" && <MeScreen />}
        {name === "users" && <UsersScreen />}
        {name === "user" && <UserScreen />}
        {name === "content" && <ContentScreen />}
        {name === "reports" && <ReportsScreen />}
        {name === "stats" && <StatsScreen />}
        {name === "settings" && <SettingsScreen />}
        {name === "audit" && <AuditScreen />}
        {name === "security" && <SecurityScreen />}
        {name === "community" && <CommunityScreen />}
        {name === "vip" && <VipScreen />}
        {name === "announce" && <AnnounceScreen />}
        {name === "devices" && <DevicesScreen />}
        {name === "admins" && <AdminsScreen />}
      </div>
      {showTabs && (
        <nav className="nova-tabbar grid shrink-0 grid-cols-4 border-t border-line bg-surface">
          {tabs.map((item) => {
            const Icon = item.icon;
            const on = name === item.id;
            return (
              <button key={item.id} type="button" onClick={() => tab(item.id)} className={`relative flex h-[49px] flex-col items-center justify-center gap-px ${on ? "font-semibold text-primary" : "text-muted"}`}>
                <Icon className="size-[22px]" strokeWidth={on ? 2.2 : 1.8} />
                <span className="text-[10px] leading-3">{item.label}</span>
                {item.id === "messages" && unread > 0 && (
                  <span className="absolute right-[18%] top-0.5 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] font-semibold text-on-primary">
                    {unread}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      )}
      {toast && (
        <div className="nova-toast pointer-events-none absolute inset-x-0 z-40 flex justify-center px-6">
          <div className="rounded-full bg-ink px-3.5 py-1.5 text-[13px] text-on-primary shadow-card">{toast}</div>
        </div>
      )}
    </Frame>
  );
}
