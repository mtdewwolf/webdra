import type { EntropyIR, ParsedBinary } from '../ir/types';

export function shannonEntropy(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  const counts = new Uint32Array(256);
  for (let index = 0; index < bytes.length; index += 1) counts[bytes[index] ?? 0] += 1;
  let entropy = 0;
  const total = bytes.length;
  for (let value = 0; value < 256; value += 1) {
    const count = counts[value] ?? 0;
    if (count === 0) continue;
    const probability = count / total;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

export function sectionEntropy(bytes: Uint8Array, binary: ParsedBinary): EntropyIR[] {
  return binary.sections
    .filter((section) => section.fileSize > 0)
    .map((section) => {
      const start = Math.max(0, section.fileOffset);
      const end = Math.min(bytes.length, start + section.fileSize);
      const slice = bytes.subarray(start, end);
      return { name: section.name || '(unnamed)', entropy: shannonEntropy(slice), size: slice.length };
    });
}
