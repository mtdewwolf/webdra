import type { ParsedBinary, Region } from '../ir/types';

export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export function assertFileSize(size: number): void {
  if (size > MAX_FILE_BYTES) {
    throw new Error('This file is larger than 50 MB. Webdra stops at that size so the tab stays responsive.');
  }
}

export function fileOffsetForVa(binary: ParsedBinary, va: number): number | null {
  const region = regionContainingVa(binary.sections, va) ?? regionContainingVa(binary.segments, va);
  if (!region || region.fileSize <= 0) return null;
  const delta = va - region.address;
  if (delta < 0 || delta >= region.fileSize) return null;
  return region.fileOffset + delta;
}

export function vaForFileOffset(binary: ParsedBinary, offset: number): number | null {
  for (const region of binary.sections) {
    if (region.fileSize <= 0) continue;
    if (offset >= region.fileOffset && offset < region.fileOffset + region.fileSize) {
      return region.address + (offset - region.fileOffset);
    }
  }
  return null;
}

export function executableSpan(binary: ParsedBinary, va: number): { start: number; end: number } | null {
  const region = binary.sections.find((section) => section.executable && va >= section.address && va < section.address + section.size);
  if (!region) {
    const segment = binary.segments.find((item) => item.executable && va >= item.address && va < item.address + item.size);
    if (!segment) return null;
    return { start: segment.address, end: segment.address + segment.size };
  }
  return { start: region.address, end: region.address + Math.max(region.size, 1) };
}

export function isExecutableAddress(binary: ParsedBinary, va: number): boolean {
  return executableSpan(binary, va) !== null;
}

function regionContainingVa(regions: Region[], va: number): Region | null {
  for (const region of regions) {
    const size = Math.max(region.size, region.fileSize);
    if (size > 0 && va >= region.address && va < region.address + size) return region;
  }
  return null;
}

export function readVirtual(bytes: Uint8Array, binary: ParsedBinary, va: number, size: number): Uint8Array | null {
  const offset = fileOffsetForVa(binary, va);
  if (offset === null || offset < 0 || offset >= bytes.length) return null;
  const available = Math.min(size, bytes.length - offset);
  if (available <= 0) return null;
  return bytes.subarray(offset, offset + available);
}
