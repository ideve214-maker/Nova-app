import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

/**
 * 长列表虚拟化。滚动发生在最近的 .nova-scroll 上，和整页锁定兼容。
 * initialOffset / onOffsetChange 供返回时恢复滚动位置使用。
 */
export function VirtualRows<T>({
  items,
  getKey,
  estimateSize = 88,
  render,
  className,
  initialOffset,
  onOffsetChange,
}: {
  items: T[];
  getKey: (item: T, index: number) => string;
  estimateSize?: number;
  render: (item: T, index: number) => ReactNode;
  className?: string;
  initialOffset?: number;
  onOffsetChange?: (offset: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const [margin, setMargin] = useState(0);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const scroller = list.closest(".nova-scroll") as HTMLElement | null;
    setScrollEl(scroller);
    setMargin(list.offsetTop);
  }, [items.length]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => estimateSize,
    overscan: 10,
    initialOffset: initialOffset ?? 0,
    scrollMargin: margin,
    getItemKey: (index) => getKey(items[index], index),
  });

  useLayoutEffect(() => {
    if (!scrollEl || !onOffsetChange) return;
    const onScroll = () => onOffsetChange(scrollEl.scrollTop);
    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    return () => scrollEl.removeEventListener("scroll", onScroll);
  }, [scrollEl, onOffsetChange]);

  if (items.length === 0) return null;

  return (
    <div
      ref={listRef}
      className={className}
      data-nova-virtual=""
      style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}
    >
      {virtualizer.getVirtualItems().map((row) => (
        <div
          key={row.key}
          data-index={row.index}
          ref={virtualizer.measureElement}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            transform: `translateY(${row.start - margin}px)`,
          }}
        >
          {render(items[row.index], row.index)}
        </div>
      ))}
    </div>
  );
}

export const TANSTACK_VIRTUAL_VERSION = "3.14.26";
export const TANSTACK_VIRTUAL_CORE_VERSION = "3.19.11";
