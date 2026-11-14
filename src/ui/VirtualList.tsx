import { useEffect, useRef, useState, type ReactNode } from 'react';

interface VirtualListProps {
  count: number;
  rowHeight: number;
  scrollToIndex?: number | null;
  children: (index: number) => ReactNode;
}

export function VirtualList({ count, rowHeight, scrollToIndex, children }: VirtualListProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(320);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (scrollToIndex == null || !ref.current) return;
    const top = Math.max(0, scrollToIndex * rowHeight - height / 3);
    ref.current.scrollTop = top;
  }, [scrollToIndex, rowHeight, height]);

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 8);
  const end = Math.min(count, start + Math.ceil(height / rowHeight) + 16);

  return (
    <div ref={ref} className="virtual" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
      <div style={{ height: count * rowHeight, position: 'relative' }}>
        <div style={{ position: 'absolute', top: start * rowHeight, left: 0, right: 0 }}>
          {Array.from({ length: Math.max(0, end - start) }, (_, offset) => (
            <div key={start + offset} style={{ height: rowHeight }}>
              {children(start + offset)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
