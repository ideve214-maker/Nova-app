import { useEffect, useState } from "react";
import PhotoSwipe from "photoswipe";
import "photoswipe/style.css";
import { isDirectMediaUrl, scanStatusLabel, type MappedMedia } from "@/lib/admin/backend";
import { sanitizeText } from "@/lib/admin/sanitize";
import { joinUrl, loadConfig, resolveBase } from "@/lib/admin/backend";
import { useAdmin } from "@/lib/admin/store";
import { Pill, Sheet } from "./ui";

function publicSrc(url?: string): string {
  if (!url) return "";
  if (isDirectMediaUrl(url)) return url;
  if (url.startsWith("/api/")) return "";
  const base = resolveBase(loadConfig().baseUrl);
  return base ? joinUrl(base, url) : url;
}

function preferredDirect(media: MappedMedia, full: boolean): string {
  if (full) return publicSrc(media.url) || publicSrc(media.previewUrl);
  return publicSrc(media.previewUrl) || publicSrc(media.url);
}

export function AdminMediaThumb({
  media,
  full = false,
  className = "size-12 rounded-lg object-cover",
  onOpen,
}: {
  media: MappedMedia;
  full?: boolean;
  className?: string;
  onOpen?: (media: MappedMedia) => void;
}) {
  const fetchMediaObjectUrl = useAdmin((s) => s.fetchMediaObjectUrl);
  const [blobUrl, setBlobUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const direct = preferredDirect(media, full);

  useEffect(() => {
    if (direct || !media.id) {
      setBlobUrl("");
      setFailed(!direct && !media.id);
      return;
    }
    let revoke = "";
    let cancelled = false;
    void (async () => {
      const first = await fetchMediaObjectUrl(media.id, full ? "file" : "preview");
      if (cancelled) {
        if ("url" in first) URL.revokeObjectURL(first.url);
        return;
      }
      if ("url" in first) {
        revoke = first.url;
        setBlobUrl(first.url);
        setFailed(false);
        return;
      }
      setFailed(true);
    })();
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [direct, media.id, full, fetchMediaObjectUrl]);

  const src = direct || blobUrl;
  const label = media.kind === "video" ? "视频" : media.kind === "audio" ? "音频" : media.kind || "媒体";
  const body = src ? (
    <img src={src} alt={sanitizeText(media.name)} className={className} />
  ) : (
    <div className={`grid place-items-center bg-subtle text-[10px] text-muted ${className}`}>{failed ? label : "…"}</div>
  );
  if (!onOpen) return body;
  return (
    <button type="button" onClick={() => onOpen(media)} className="relative shrink-0">
      {body}
      {media.scanStatus === "review" && (
        <span className="absolute -right-1 -top-1 rounded-full bg-warn px-1 text-[9px] font-semibold text-on-primary">核</span>
      )}
    </button>
  );
}

export function MediaScanMeta({ media }: { media: MappedMedia }) {
  if (!media.scanStatus && !media.scanDetail && media.score == null) return null;
  return (
    <div className="mt-1 space-y-0.5">
      {media.scanStatus && <Pill tone={media.scanStatus === "review" ? "warn" : media.scanStatus === "blocked" ? "danger" : "muted"}>{scanStatusLabel(media.scanStatus)}</Pill>}
      {media.score != null && <p className="text-[12px] text-muted">分数 {media.score}</p>}
      {media.scanDetail && <p className="text-[12px] leading-5 text-muted">{sanitizeText(media.scanDetail)}</p>}
    </div>
  );
}

export function MediaViewerSheet({
  media,
  gallery,
  onClose,
}: {
  media: MappedMedia | null;
  gallery?: MappedMedia[];
  onClose: () => void;
}) {
  const fetchMediaObjectUrl = useAdmin((s) => s.fetchMediaObjectUrl);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    if (!media) {
      setFallback(false);
      return;
    }
    let cancelled = false;
    let pswp: PhotoSwipe | null = null;
    const objectUrls: string[] = [];
    document.documentElement.setAttribute("data-nova-lightbox", "1");

    const resolveSrc = async (item: MappedMedia, full: boolean) => {
      const direct = preferredDirect(item, full);
      if (direct) return direct;
      if (!item.id) return preferredDirect(item, !full);
      const got = await fetchMediaObjectUrl(item.id, full ? "file" : "preview");
      if ("url" in got) {
        objectUrls.push(got.url);
        return got.url;
      }
      return "";
    };

    void (async () => {
      const items = gallery && gallery.length ? gallery : [media];
      const start = Math.max(0, items.findIndex((x) => (x.id && x.id === media.id) || x === media));
      const dataSource = [];
      for (const item of items) {
        const src = await resolveSrc(item, true) || await resolveSrc(item, false);
        if (cancelled) return;
        if (!src) continue;
        const caption = [scanStatusLabel(item.scanStatus), item.scanDetail, item.score != null ? "分数 " + item.score : ""]
          .filter(Boolean)
          .join(" · ");
        dataSource.push({
          src,
          width: item.width || 1600,
          height: item.height || 1600,
          alt: item.name || "",
          caption: caption || undefined,
        });
      }
      if (!dataSource.length) {
        if (!cancelled) setFallback(true);
        return;
      }
      pswp = new PhotoSwipe({
        dataSource,
        index: Math.min(start, dataSource.length - 1),
        bgOpacity: 0.96,
        wheelToZoom: true,
        pinchToClose: false,
        closeOnVerticalDrag: true,
        paddingFn: () => ({ top: 24, bottom: 48, left: 0, right: 0 }),
      });
      pswp.on("close", () => {
        if (!cancelled) onClose();
      });
      pswp.init();
    })();

    return () => {
      cancelled = true;
      document.documentElement.removeAttribute("data-nova-lightbox");
      try { pswp?.destroy(); } catch { /* already closed */ }
      for (const u of objectUrls) URL.revokeObjectURL(u);
    };
  }, [media, gallery, fetchMediaObjectUrl, onClose]);

  if (!media || !fallback) return null;
  return (
    <Sheet open title={sanitizeText(media.name) || "查看图片"} onClose={onClose}>
      <p className="text-[13px] text-muted">暂时无法打开这张图片。</p>
      <MediaScanMeta media={media} />
    </Sheet>
  );
}

export function MediaStrip({
  items,
  onOpen,
}: {
  items: MappedMedia[];
  onOpen?: (media: MappedMedia) => void;
}) {
  if (!items.length) return null;
  return (
    <div className="nova-scroll-x mt-1.5 flex gap-1">
      {items.slice(0, 6).map((m, i) => (
        <AdminMediaThumb key={m.id || String(i)} media={m} onOpen={onOpen} />
      ))}
      {items.length > 6 && <span className="self-center text-[11px] text-muted">+{items.length - 6}</span>}
    </div>
  );
}
