export interface PatternByte {
  value: number;
  wild: boolean;
}

export function parseBytePattern(text: string): PatternByte[] {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) throw new Error('Enter a byte pattern such as "48 8b ?? c3".');
  if (tokens.length > 64) throw new Error('Patterns are limited to 64 bytes.');
  return tokens.map((token) => {
    if (token === '??' || token === '?') return { value: 0, wild: true };
    if (!/^[0-9a-fA-F]{1,2}$/.test(token)) throw new Error(`"${token}" is not a hex byte or ??.`);
    return { value: Number.parseInt(token, 16), wild: false };
  });
}

export function searchBytePattern(bytes: Uint8Array, pattern: PatternByte[], limit = 200): number[] {
  if (!pattern.length || bytes.length < pattern.length) return [];
  const hits: number[] = [];
  const last = bytes.length - pattern.length;
  for (let offset = 0; offset <= last; offset += 1) {
    let matched = true;
    for (let index = 0; index < pattern.length; index += 1) {
      const part = pattern[index];
      if (!part || part.wild) continue;
      if (bytes[offset + index] !== part.value) {
        matched = false;
        break;
      }
    }
    if (matched) {
      hits.push(offset);
      if (hits.length >= limit) break;
    }
  }
  return hits;
}
