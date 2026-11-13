import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { installFieldScroll, installScrollLock } from "@/lib/admin/scroll-lock";
import { hapticLight, lockNativeViewport, lockWebViewport, syncNativeChrome } from "@/lib/admin/native";
import { getStoredSkin, resolvedTheme, subscribeAppearance } from "@/lib/admin/theme";
import { hydrateAdmin, markAppBooted, useAdmin, type PageName } from "@/lib/admin/store";
import { usePagePullToRefresh } from "@/lib/admin/pull-to-refresh";
import { useRestoreScroll } from "@/lib/admin/scroll-restore";
import { Frame, SkinIcon, StarMark, type SkinIconName } from "./ui";
import { LoginScreen } from "./login";
import { HomeScreen, ManageScreen, MeScreen, MessagesScreen } from "./browse";
import { UserScreen, UsersScreen } from "./people";
import { ContentScreen, ReportsScreen } from "./queue";
import { PaymentsScreen } from "./payments";
import { HotScreen } from "./hot";
import { BlockwordsScreen } from "./blockwords";
import { AppealsScreen, EventsScreen } from "./appeals";
import { ChannelMessagesScreen, CommunitiesScreen, CommunityDetailScreen } from "./communities";
import {
  AdminsScreen,
  AnnounceScreen,
  AuditScreen,
  DevicesScreen,
  SecurityScreen,
  SettingsScreen,
  StatsScreen,
  VipScreen,
} from "./system";

const tabs: { id: PageName; label: string; icon: SkinIconName }[] = [
  { id: "home", label: "首页", icon: "home" },
  { id: "manage", label: "管理", icon: "community" },
  { id: "messages", label: "消息", icon: "bell" },
  { id: "me", label: "我的", icon: "profile" },
];

const SPLASH_TIMEOUT_MS = 2500;

export function AdminApp() {
  const booted = useAdmin((s) => s.booted);
  const bootError = useAdmin((s) => s.bootError);
  const authed = useAdmin((s) => s.authed);
  const name = useAdmin((s) => s.nav.name);
  const userId = useAdmin((s) => s.nav.userId);
  const toast = useAdmin((s) => s.toast);
  const tab = useAdmin((s) => s.tab);
  const unread = useAdmin((s) => s.notices.filter((item) => !item.read).length);
  const [stalled, setStalled] = useState(false);
  usePagePullToRefresh(booted && authed, name);
  const nav = useAdmin((s) => s.nav);
  useRestoreScroll(nav, booted && authed);

  useEffect(() => {
    const unlock = installScrollLock();
    const unfocus = installFieldScroll();
    lockWebViewport();
    void lockNativeViewport();
    const unsubChrome = subscribeAppearance(() => {
      void syncNativeChrome(getStoredSkin(), resolvedTheme());
    });
    return () => {
      unlock();
      unfocus();
      unsubChrome();
    };
  }, []);

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
        <div className="nova-splash nova-scroll grid min-h-0 flex-1 place-items-center px-6 text-fg" style={{ paddingTop: "max(var(--nova-safe-top, 0px), env(safe-area-inset-top, 0px))", paddingBottom: "max(var(--nova-safe-bottom, 0px), env(safe-area-inset-bottom, 0px))" }}>
          <div className="flex flex-col items-center text-center">
            <StarMark className="size-[72px]" />
            <p className="nova-brand mt-5 text-[28px] leading-none">NOVA</p>
            <p className="mt-2 text-[15px] font-bold tracking-[0.12em] text-primary">管理端</p>
            <p className="mt-4 text-[15px] text-muted">正在进入 NOVA 管理端…</p>
            {(stalled || bootError) && (
              <>
                <p className="mt-3 max-w-xs text-[13px] leading-5 text-muted">{bootError || "启动较慢"}</p>
                <button
                  type="button"
                  className="nova-btn-primary mt-4 h-11 px-6 text-[16px]"
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

  const pages = (
    <>
      {name === "home" && <HomeScreen />}
      {name === "manage" && <ManageScreen />}
      {name === "messages" && <MessagesScreen />}
      {name === "me" && <MeScreen />}
      {name === "users" && <UsersScreen />}
      {name === "user" && <UserScreen />}
      {name === "content" && <ContentScreen />}
      {name === "payments" && <PaymentsScreen />}
      {name === "communities" && <CommunitiesScreen />}
      {name === "community" && (userId ? <CommunityDetailScreen /> : <CommunitiesScreen />)}
      {name === "channel" && <ChannelMessagesScreen />}
      {name === "blockwords" && <BlockwordsScreen />}
      {name === "reports" && <ReportsScreen />}
      {name === "stats" && <StatsScreen />}
      {name === "settings" && <SettingsScreen />}
      {name === "audit" && <AuditScreen />}
      {name === "security" && <SecurityScreen />}
      {name === "events" && <EventsScreen />}
      {name === "appeals" && <AppealsScreen />}
      {name === "vip" && <VipScreen />}
      {name === "announce" && <AnnounceScreen />}
      {name === "hot" && <HotScreen />}
      {name === "devices" && <DevicesScreen />}
      {name === "admins" && <AdminsScreen />}
    </>
  );

  return (
    <Frame>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="absolute inset-0 flex flex-col overflow-hidden">{pages}</div>
        {showTabs && (
          <nav data-nova-chrome="tab" className="nova-tabbar nova-bar absolute inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-line">
            {tabs.map((item) => {
              const on = name === item.id;
              return (
                <button key={item.id} type="button" onClick={() => { void hapticLight(); tab(item.id); }} className={`relative flex h-[49px] flex-col items-center justify-center gap-px ${on ? "font-semibold text-primary" : "text-muted"}`}>
                  <span className={`nova-tab-icon ${on ? "is-on" : ""}`}>
                    <SkinIcon name={item.icon} className="size-[22px]" />
                  </span>
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
        {toast && typeof document !== "undefined" && createPortal(
          <div className="nova-toast pointer-events-none fixed inset-x-0 z-[100] flex justify-center px-6">
            <div className="rounded-full bg-ink px-3.5 py-1.5 text-[13px] text-on-primary shadow-card">{toast}</div>
          </div>,
          document.body,
        )}
      </div>
    </Frame>
  );
}
