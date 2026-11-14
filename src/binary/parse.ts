import type { ParsedBinary } from '../ir/types';
import { parseElf } from './elf';
import { isMacho, parseMacho } from './macho';
import { parsePe } from './pe';
import { ParseError } from './reader';

export interface ParseOptions {
  lenient?: boolean;
  sliceOffset?: number | null;
}

export type DetectedFormat = 'elf' | 'pe' | 'macho' | 'unknown';

export function detectFormat(bytes: Uint8Array): DetectedFormat {
  if (bytes.length >= 4 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) return 'elf';
  if (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) return 'pe';
  if (isMacho(bytes)) return 'macho';
  if (bytes.length >= 20) {
    const machine = bytes[0] | ((bytes[1] ?? 0) << 8);
    const sections = bytes[2] | ((bytes[3] ?? 0) << 8);
    if ((machine === 0x14c || machine === 0x8664 || machine === 0xaa64 || machine === 0x1c4) && sections > 0 && sections < 96) {
      return 'pe';
    }
  }
  return 'unknown';
}

export function parseBinary(bytes: Uint8Array, options: ParseOptions = {}): ParsedBinary {
  const lenient = options.lenient ?? false;
  const format = detectFormat(bytes);
  if (format === 'elf') return parseElf(bytes, lenient);
  if (format === 'pe') return parsePe(bytes, lenient);
  if (format === 'macho') return parseMacho(bytes, lenient, options.sliceOffset ?? null);
  throw new ParseError('Unrecognized file format. Webdra reads ELF, PE/COFF, and Mach-O.');
}

export { ParseError };
