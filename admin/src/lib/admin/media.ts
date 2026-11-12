/** Resolve demo media paths for both http(s) servers and a single-file / file:// build. */
export function mediaUrl(src?: string | null): string | undefined {
  if (!src) return undefined;
  if (typeof window !== "undefined") {
    const table = (window as unknown as { __NOVA_MEDIA__?: Record<string, string> }).__NOVA_MEDIA__;
    if (table && table[src]) return table[src];
  }
  if (typeof window !== "undefined" && window.location.protocol === "file:" && src.startsWith("/")) {
    return `.${src}`;
  }
  return src;
}
