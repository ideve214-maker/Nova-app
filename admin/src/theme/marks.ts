import type { SkinId } from "@/lib/admin/theme";
import socialMark from "./skins/social-blue/logo/nova-mark.svg?url";
import pulseMark from "./skins/pulse/logo/nova-mark.svg?url";
import starlightMark from "./skins/starlight/logo/mark.svg?url";
import socialHome from "./skins/social-blue/icons/home.svg?raw";
import socialBell from "./skins/social-blue/icons/bell.svg?raw";
import socialProfile from "./skins/social-blue/icons/profile.svg?raw";
import socialCommunity from "./skins/social-blue/icons/community.svg?raw";
import pulseHome from "./skins/pulse/icons/home.svg?raw";
import pulseBell from "./skins/pulse/icons/bell.svg?raw";
import pulseProfile from "./skins/pulse/icons/profile.svg?raw";
import pulseCommunity from "./skins/pulse/icons/community.svg?raw";

const MARKS: Record<SkinId, string> = {
  starlight: starlightMark,
  "social-blue": socialMark,
  pulse: pulseMark,
};

const ICONS: Record<SkinId, Record<"home" | "bell" | "profile" | "community", string>> = {
  starlight: { home: socialHome, bell: socialBell, profile: socialProfile, community: socialCommunity },
  "social-blue": { home: socialHome, bell: socialBell, profile: socialProfile, community: socialCommunity },
  pulse: { home: pulseHome, bell: pulseBell, profile: pulseProfile, community: pulseCommunity },
};

export type SkinIconName = keyof (typeof ICONS)["social-blue"];

export function skinMarkUrl(skin: SkinId) {
  return MARKS[skin] || MARKS["social-blue"];
}

export function skinIconSvg(skin: SkinId, name: SkinIconName) {
  return (ICONS[skin] || ICONS["social-blue"])[name];
}
