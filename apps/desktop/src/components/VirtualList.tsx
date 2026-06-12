import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

interface VirtualListProps<T> {
  items: T[];
  /** Fixed pixel pitch per row (row height + the gap below it). */
  rowHeight: number;
  renderRow: (item: T, index: number) => ReactNode;
  getKey?: (item: T, index: number) => string | number;
  className?: string;
  /** Extra rows rendered above/below the viewport to avoid blank flashes while scrolling. */
  overscan?: number;
}

/**
 * Minimal fixed-height list virtualizer (no dependencies). Only the rows near the viewport are
 * mounted, so opening a list of thousands of tracks is as cheap as a list of ten. Assumes a
 * uniform row pitch — fine for the track rows, which are a fixed height with truncated text.
 */
export function VirtualList<T>({
  items,
  rowHeight,
  renderRow,
  getKey,
  className,
  overscan = 6
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  // Measure before paint (avoids a one-frame empty flash) and keep it current on resize.
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    const measure = () => setViewportHeight(element.clientHeight);
    measure();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const totalHeight = items.length * rowHeight;
  const maxScrollTop = Math.max(0, totalHeight - viewportHeight);
  const clampedTop = Math.min(scrollTop, maxScrollTop);
  const start = Math.max(0, Math.floor(clampedTop / rowHeight) - overscan);
  const end = Math.min(items.length, Math.ceil((clampedTop + viewportHeight) / rowHeight) + overscan);

  const rows: ReactNode[] = [];
  for (let index = start; index < end; index++) {
    const item = items[index];
    rows.push(
      <div
        key={getKey ? getKey(item, index) : index}
        style={{ position: "absolute", top: index * rowHeight, left: 0, right: 0 }}
      >
        {renderRow(item, index)}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={className}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div style={{ position: "relative", height: totalHeight }}>{rows}</div>
    </div>
  );
}
