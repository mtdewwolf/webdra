export const SCAN_BYTE_BUDGET = 64 * 1024 * 1024;

export interface FileSpan {
  start: number;
  end: number;
  address: number;
  name: string;
}

/** Union of overlapping file ranges, clipped to a byte budget. The first span owns the address mapping. */
export function mergeFileSpans(spans: FileSpan[], budget = SCAN_BYTE_BUDGET): { spans: FileSpan[]; truncated: boolean } {
  const sorted = spans
    .filter((span) => Number.isFinite(span.start) && Number.isFinite(span.end) && span.end > span.start && span.start >= 0)
    .sort((left, right) => left.start - right.start || right.end - left.end);
  const merged: FileSpan[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) {
      if (span.end > last.end) last.end = span.end;
      continue;
    }
    merged.push({ ...span });
  }
  const clipped: FileSpan[] = [];
  let scanned = 0;
  let truncated = false;
  for (const span of merged) {
    const room = budget - scanned;
    if (room <= 0) {
      truncated = true;
      break;
    }
    const end = Math.min(span.end, span.start + room);
    if (end < span.end) truncated = true;
    clipped.push({ ...span, end });
    scanned += end - span.start;
  }
  return { spans: clipped, truncated };
}
