export function pushHistory(history: number[], index: number, address: number): { history: number[]; index: number } {
  const next = history.slice(0, Math.max(0, index + 1));
  if (next[next.length - 1] === address) return { history: next, index: next.length - 1 };
  next.push(address);
  return { history: next, index: next.length - 1 };
}

export function stepHistory(history: number[], index: number, direction: -1 | 1): number {
  return Math.min(history.length - 1, Math.max(0, index + direction));
}
