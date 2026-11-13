import { useEffect, useState } from "react";
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
  onClose,
}: {
  media: MappedMedia | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={!!media} title={sanitizeText(media?.name) || "查看图片"} onClose={onClose}>
      {media && (
        <div>
          <AdminMediaThumb media={media} full className="max-h-[70vh] w-full rounded-xl object-contain bg-subtle" />
          <MediaScanMeta media={media} />
          {(media.width || media.height) && (
            <p className="mt-1 text-[12px] text-muted">{[media.width, media.height].filter(Boolean).join(" × ")}</p>
          )}
        </div>
      )}
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
