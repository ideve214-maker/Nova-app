/**
 * 统一的头像判断逻辑（管理端所有头像都走这里）。
 *
 * 用户端/后端返回的头像字段可能是：
 *   - 图片地址字符串："https://…"、"/media/a.jpg"、"data:image/png;base64,…"
 *   - 颜色文字对象：{ kind: "color", color: "#RRGGBB", letter: "字" }（当前服务器 admin-ops 返回的就是这种）
 *   - 图片对象：{ kind: "image", url: "…" }
 *   - 空值 / 空字符串 / 旧缓存里被 String() 过的 "[object Object]"
 *
 * 只有“像图片地址”的字符串才交给 <img> 加载，其余一律显示颜色 + 文字的默认头像，
 * 避免出现 capacitor://localhost/[object%20Object] 这种请求。
 */

export type ResolvedAvatar = { url: string; color: string; letter: string };

const HEX_COLOR = /^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** 字符串是否像一个可加载的图片地址。 */
export function isImageUrl(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (!s || s.length > 1_000_000) return false;
  if (/\[object\s/i.test(s)) return false;
  if (/^https?:\/\/[^\s]+$/i.test(s)) return true;
  if (/^data:image\/[a-z0-9.+-]+[;,]/i.test(s)) return true;
  if (/^(?:blob|capacitor|file):/i.test(s)) return true;
  // 站内路径：/media/a.jpg、./media/a.jpg、../a.png；排除协议相对的 "//"
  if (/^\.{0,2}\/(?!\/)\S*$/.test(s)) return true;
  return false;
}

export function isHexColor(v: unknown): v is string {
  return typeof v === "string" && HEX_COLOR.test(v.trim());
}

function firstChar(v: unknown): string {
  if (typeof v !== "string") return "";
  return [...v.trim()][0] || "";
}

function firstString(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return undefined;
}

/**
 * 把任意形态的头像字段规范成 { url, color, letter }。
 * url 只会是 isImageUrl 通过的字符串，否则为空。
 */
export function resolveAvatar(v: unknown): ResolvedAvatar {
  const out: ResolvedAvatar = { url: "", color: "", letter: "" };
  if (typeof v === "string") {
    const s = v.trim();
    if (isImageUrl(s)) out.url = s;
    else if (isHexColor(s)) out.color = s;
    return out;
  }
  if (!isRecord(v)) return out;
  const url = firstString(v, ["url", "src", "uri", "imageUrl", "image_url", "path"]);
  if (isImageUrl(url)) out.url = url.trim();
  const color = firstString(v, ["color", "bg", "background"]);
  if (isHexColor(color)) out.color = color.trim();
  out.letter = firstChar(firstString(v, ["letter", "text", "char"]));
  return out;
}

/** 默认头像上显示的字：优先头像自带文字，否则昵称首字。 */
export function avatarLetter(letter: unknown, name: unknown): string {
  return firstChar(letter) || firstChar(name) || "?";
}
