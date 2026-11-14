/** Subsequence fuzzy score. Higher is better. Null means no match. */
export function fuzzyScore(query: string, text: string): number | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return 1;
  const hay = text.toLowerCase();
  let score = 0;
  let streak = 0;
  let from = 0;
  for (const ch of needle) {
    const at = hay.indexOf(ch, from);
    if (at < 0) return null;
    const prev = hay[at - 1];
    streak = at === from ? streak + 1 : 1;
    score += streak * 3;
    if (at === 0 || prev === '_' || prev === ':' || prev === '.' || prev === ' ') score += 4;
    from = at + 1;
  }
  score -= Math.max(0, hay.length - needle.length) * 0.05;
  return score;
}

export function fuzzyFilter<T>(query: string, items: T[], text: (item: T) => string): T[] {
  const ranked = items
    .map((item) => ({ item, score: fuzzyScore(query, text(item)) }))
    .filter((entry): entry is { item: T; score: number } => entry.score !== null);
  ranked.sort((a, b) => b.score - a.score);
  return ranked.map((entry) => entry.item);
}
