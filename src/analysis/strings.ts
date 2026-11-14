import { mergeFileSpans } from '../binary/ranges';
import type { ParsedBinary, StringEncoding, StringIR } from '../ir/types';

const MAX_STRINGS = 20000;
const MAX_STRING_LENGTH = 512;

export function extractStrings(bytes: Uint8Array, binary: ParsedBinary, minimum = 4): { strings: StringIR[]; truncated: boolean } {
  const found: StringIR[] = [];
  const regions = binary.sections.filter((section) => section.fileSize > 0);
  const merged = regions.length
    ? mergeFileSpans(regions.map((section) => ({
        name: section.name,
        start: section.fileOffset,
        end: Math.min(bytes.length, section.fileOffset + section.fileSize),
        address: section.address,
      })))
    : { spans: [{ name: '', start: 0, end: bytes.length, address: 0 }], truncated: false };
  const sources = merged.spans.map((span) => ({
    name: span.name,
    offset: span.start,
    size: Math.max(0, span.end - span.start),
    address: span.address,
  }));

  for (const source of sources) {
    if (found.length >= MAX_STRINGS) break;
    collectAscii(bytes, source, minimum, found);
    collectUtf16(bytes, source, minimum, found);
  }
  found.sort((a, b) => a.fileOffset - b.fileOffset);
  return { strings: found.slice(0, MAX_STRINGS), truncated: found.length > MAX_STRINGS || merged.truncated };
}

function collectAscii(
  bytes: Uint8Array,
  source: { name: string; offset: number; size: number; address: number },
  minimum: number,
  found: StringIR[],
): void {
  const end = Math.min(bytes.length, source.offset + source.size);
  let start = source.offset;
  while (start < end && found.length < MAX_STRINGS) {
    while (start < end && !isPrintable(bytes[start] ?? 0)) start += 1;
    let cursor = start;
    while (cursor < end && isPrintable(bytes[cursor] ?? 0) && cursor - start < MAX_STRING_LENGTH) cursor += 1;
    const length = cursor - start;
    if (length >= minimum) {
      found.push({
        address: source.address + (start - source.offset),
        fileOffset: start,
        text: decodeRange(bytes, start, start + length),
        encoding: 'ascii',
        section: source.name,
      });
    }
    start = cursor + 1;
  }
}

function collectUtf16(
  bytes: Uint8Array,
  source: { name: string; offset: number; size: number; address: number },
  minimum: number,
  found: StringIR[],
): void {
  const end = Math.min(bytes.length, source.offset + source.size);
  let index = source.offset;
  while (index + 1 < end && found.length < MAX_STRINGS) {
    if (!isPrintable(bytes[index] ?? 0) || (bytes[index + 1] ?? 1) !== 0) {
      index += 1;
      continue;
    }
    const start = index;
    let length = 0;
    while (index + 1 < end && isPrintable(bytes[index] ?? 0) && bytes[index + 1] === 0 && length < MAX_STRING_LENGTH) {
      length += 1;
      index += 2;
    }
    if (length >= minimum) {
      let text = '';
      for (let step = 0; step < length; step += 1) text += String.fromCharCode(bytes[start + step * 2] ?? 0);
      found.push({
        address: source.address + (start - source.offset),
        fileOffset: start,
        text,
        encoding: 'utf16' satisfies StringEncoding,
        section: source.name,
      });
    }
  }
}

function isPrintable(value: number): boolean {
  return value >= 0x20 && value <= 0x7e;
}

function decodeRange(bytes: Uint8Array, start: number, end: number): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(start, end));
}

export function xrefsToString(xrefs: { to: number; from: number; kind: 'call' | 'jump' | 'data' }[], text: StringIR): { to: number; from: number; kind: 'call' | 'jump' | 'data' }[] {
  const end = text.address + text.text.length * (text.encoding === 'utf16' ? 2 : 1);
  return xrefs.filter((xref) => xref.to >= text.address && xref.to < end);
}
