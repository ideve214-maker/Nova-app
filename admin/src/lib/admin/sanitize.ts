/**
 * 管理端展示用户内容（评论、简介、举报、动态等）前用 DOMPurify 清洗。
 * 默认去掉全部标签，只留纯文本，避免把 HTML 写进界面。
 * 没有 window（测试/SSR）时退回去掉标签的简单处理。
 */
import DOMPurify from "dompurify";

export type SanitizeOptions = {
  /** 为 true 时允许常见安全标签，用于已确认是富文本的字段。默认全去掉。 */
  html?: boolean;
};

function stripTags(input: string): string {
  return input.replace(/<[^>]*>/g, "");
}

function run(input: string, allowedTags: string[] | null): string {
  if (typeof window === "undefined") return stripTags(input);
  try {
    if (!allowedTags || allowedTags.length === 0) {
      return DOMPurify.sanitize(input, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
    }
    return DOMPurify.sanitize(input, { ALLOWED_TAGS: allowedTags });
  } catch {
    return stripTags(input);
  }
}

export function sanitizeText(input: unknown, options: SanitizeOptions = {}): string {
  if (input == null) return "";
  const s = String(input);
  if (!s) return "";
  return run(s, options.html ? ["b", "i", "em", "strong", "br", "p"] : []);
}

export const DOMPURIFY_VERSION = "3.4.17";
export const DOMPURIFY_LICENSE = "MPL-2.0 OR Apache-2.0";
