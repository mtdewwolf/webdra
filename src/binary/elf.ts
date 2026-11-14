import type { ArchInfo, ExportRecord, HeaderField, ImportRecord, ParsedBinary, Region, SymbolRecord } from '../ir/types';
import { ParseError, Reader, hex } from './reader';

const ET_REL = 1;
const ET_EXEC = 2;
const ET_DYN = 3;
const SHT_PROGBITS = 1;
const SHT_SYMTAB = 2;
const SHT_STRTAB = 3;
const SHT_NOTE = 7;
const SHT_NOBITS = 8;
const SHT_DYNSYM = 11;
const SHF_WRITE = 0x1;
const SHF_ALLOC = 0x2;
const SHF_EXECINSTR = 0x4;
const PT_LOAD = 1;
const PF_X = 1;
const PF_W = 2;
const PF_R = 4;
const STT_OBJECT = 1;
const STT_FUNC = 2;
const STT_SECTION = 3;
const STT_FILE = 4;
const STT_GNU_IFUNC = 10;
const STB_LOCAL = 0;
const STB_GLOBAL = 1;
const STB_WEAK = 2;
const SHN_UNDEF = 0;
const DT_NEEDED = 1;
const DT_STRTAB = 5;
const DT_STRSZ = 10;

interface ElfHeader {
  classBits: 32 | 64;
  little: boolean;
  type: number;
  machine: number;
  entry: number;
  phoff: number;
  shoff: number;
  flags: number;
  phentsize: number;
  phnum: number;
  shentsize: number;
  shnum: number;
  shstrndx: number;
}

interface RawSection {
  nameOffset: number;
  type: number;
  flags: number;
  address: number;
  offset: number;
  size: number;
  link: number;
  info: number;
  entsize: number;
}

export function parseElf(bytes: Uint8Array, lenient: boolean): ParsedBinary {
  const warnings: string[] = [];
  if (bytes.length < 16 || bytes[0] !== 0x7f || bytes[1] !== 0x45 || bytes[2] !== 0x4c || bytes[3] !== 0x46) {
    throw new ParseError('Not an ELF file');
  }
  const klass = bytes[4];
  const data = bytes[5];
  if ((klass !== 1 && klass !== 2) || (data !== 1 && data !== 2)) {
    throw new ParseError('Unsupported ELF class or endianness', true);
  }
  const little = data === 1;
  const classBits: 32 | 64 = klass === 1 ? 32 : 64;
  const headerSize = classBits === 64 ? 64 : 52;
  const reader = new Reader(bytes, little);
  if (bytes.length < headerSize) {
    if (!lenient) throw new ParseError('ELF header is truncated', true);
    return partialElf(bytes.length, classBits, little, warnings.concat('ELF header is truncated; only the identification bytes were recovered.'));
  }

  let header: ElfHeader;
  try {
    header = readHeader(reader, classBits, little);
  } catch (error) {
    if (!lenient) throw error;
    warnings.push(error instanceof Error ? error.message : 'ELF header could not be read');
    return partialElf(bytes.length, classBits, little, warnings);
  }

  const arch = archFromMachine(header.machine, classBits, little);
  const segments: Region[] = [];
  try {
    readProgramHeaders(reader, header, segments, warnings, lenient);
  } catch (error) {
    if (!lenient) throw error;
    warnings.push(error instanceof Error ? error.message : 'Program headers could not be read');
  }

  const rawSections: RawSection[] = [];
  try {
    readSectionHeaders(reader, header, rawSections, warnings, lenient);
  } catch (error) {
    if (!lenient) throw error;
    warnings.push(error instanceof Error ? error.message : 'Section headers could not be read');
  }

  const shstr = readStringTable(reader, rawSections[header.shstrndx], warnings);
  const sections: Region[] = rawSections.map((section, index) => toRegion(section, index === 0 ? '' : lookupString(shstr, section.nameOffset), segments));

  const symbols: SymbolRecord[] = [];
  const imports: ImportRecord[] = [];
  const exports: ExportRecord[] = [];
  const libraries: string[] = [];
  try {
    readSymbols(reader, rawSections, sections, symbols, imports, exports, libraries, warnings, lenient);
  } catch (error) {
    if (!lenient) throw error;
    warnings.push(error instanceof Error ? error.message : 'Symbol tables could not be read');
  }

  const notes = readNotes(reader, rawSections, segments, warnings);
  const fields: HeaderField[] = [
    { label: 'Class', value: `ELF${classBits}` },
    { label: 'Endianness', value: little ? 'little' : 'big' },
    { label: 'Type', value: elfType(header.type) },
    { label: 'Machine', value: `${machineName(header.machine)} (${header.machine})` },
    { label: 'Entry', value: header.entry ? hex(header.entry) : 'none' },
    { label: 'Flags', value: hex(header.flags) },
    { label: 'Program headers', value: String(segments.length) },
    { label: 'Sections', value: String(sections.length) },
  ];
  if (libraries.length) fields.push({ label: 'Needed', value: libraries.join(', ') });
  for (const note of notes) fields.push({ label: 'Note', value: note });

  return {
    format: 'elf',
    arch,
    entryPoint: header.entry || null,
    imageBase: segments.find((segment) => segment.executable)?.address ?? segments[0]?.address ?? 0,
    sections: sections.filter((section) => section.name.length > 0 || section.size > 0 || section.fileSize > 0),
    segments,
    symbols,
    imports,
    exports,
    libraries,
    headerFields: fields,
    slices: [],
    selectedSlice: 0,
    warnings,
    partial: warnings.length > 0,
    fileSize: bytes.length,
  };
}

function partialElf(fileSize: number, bits: 32 | 64, little: boolean, warnings: string[]): ParsedBinary {
  return {
    format: 'elf',
    arch: { arch: 'unknown', bits, endian: little ? 'little' : 'big' },
    entryPoint: null,
    imageBase: 0,
    sections: [],
    segments: [],
    symbols: [],
    imports: [],
    exports: [],
    libraries: [],
    headerFields: [
      { label: 'Class', value: `ELF${bits}` },
      { label: 'Endianness', value: little ? 'little' : 'big' },
    ],
    slices: [],
    selectedSlice: 0,
    warnings,
    partial: true,
    fileSize,
  };
}

function readHeader(reader: Reader, classBits: 32 | 64, little: boolean): ElfHeader {
  if (classBits === 64) {
    return {
      classBits,
      little,
      type: reader.u16(16),
      machine: reader.u16(18),
      entry: reader.u64(24),
      phoff: reader.u64(32),
      shoff: reader.u64(40),
      flags: reader.u32(48),
      phentsize: reader.u16(54),
      phnum: reader.u16(56),
      shentsize: reader.u16(58),
      shnum: reader.u16(60),
      shstrndx: reader.u16(62),
    };
  }
  return {
    classBits,
    little,
    type: reader.u16(16),
    machine: reader.u16(18),
    entry: reader.u32(24),
    phoff: reader.u32(28),
    shoff: reader.u32(32),
    flags: reader.u32(36),
    phentsize: reader.u16(42),
    phnum: reader.u16(44),
    shentsize: reader.u16(46),
    shnum: reader.u16(48),
    shstrndx: reader.u16(50),
  };
}

function readProgramHeaders(reader: Reader, header: ElfHeader, segments: Region[], warnings: string[], lenient: boolean): void {
  if (header.phoff === 0 || header.phnum === 0) return;
  const expected = header.classBits === 64 ? 56 : 32;
  if (header.phentsize < expected) {
    const message = `Program header entry size ${header.phentsize} is smaller than expected`;
    if (!lenient) throw new ParseError(message, true);
    warnings.push(message);
    return;
  }
  for (let index = 0; index < header.phnum; index += 1) {
    const offset = header.phoff + index * header.phentsize;
    try {
      if (header.classBits === 64) {
        const type = reader.u32(offset);
        const flags = reader.u32(offset + 4);
        const fileOffset = reader.u64(offset + 8);
        const address = reader.u64(offset + 16);
        const fileSize = reader.u64(offset + 32);
        const memSize = reader.u64(offset + 40);
        segments.push(segmentRegion(type, flags, fileOffset, address, fileSize, memSize));
      } else {
        const type = reader.u32(offset);
        const fileOffset = reader.u32(offset + 4);
        const address = reader.u32(offset + 8);
        const fileSize = reader.u32(offset + 16);
        const memSize = reader.u32(offset + 20);
        const flags = reader.u32(offset + 24);
        segments.push(segmentRegion(type, flags, fileOffset, address, fileSize, memSize));
      }
    } catch (error) {
      const message = `Skipped program header ${index}: ${error instanceof Error ? error.message : 'unreadable'}`;
      if (!lenient) throw new ParseError(message, true);
      warnings.push(message);
    }
  }
}

function segmentRegion(type: number, flags: number, fileOffset: number, address: number, fileSize: number, memSize: number): Region {
  const names: Record<number, string> = { 0: 'PT_NULL', 1: 'PT_LOAD', 2: 'PT_DYNAMIC', 3: 'PT_INTERP', 4: 'PT_NOTE', 6: 'PT_PHDR', 7: 'PT_TLS' };
  return {
    name: names[type] ?? `PT_${type}`,
    address,
    size: memSize,
    fileOffset,
    fileSize,
    flags: [`type=${type}`, flags & PF_R ? 'R' : '', flags & PF_W ? 'W' : '', flags & PF_X ? 'X' : ''].filter(Boolean),
    executable: (flags & PF_X) !== 0,
    writable: (flags & PF_W) !== 0,
    readable: (flags & PF_R) !== 0 || type === PT_LOAD,
  };
}

function readSectionHeaders(reader: Reader, header: ElfHeader, sections: RawSection[], warnings: string[], lenient: boolean): void {
  if (header.shoff === 0 || header.shnum === 0) return;
  const expected = header.classBits === 64 ? 64 : 40;
  if (header.shentsize < expected) {
    const message = `Section header entry size ${header.shentsize} is smaller than expected`;
    if (!lenient) throw new ParseError(message, true);
    warnings.push(message);
    return;
  }
  for (let index = 0; index < header.shnum; index += 1) {
    const offset = header.shoff + index * header.shentsize;
    try {
      if (header.classBits === 64) {
        sections.push({
          nameOffset: reader.u32(offset),
          type: reader.u32(offset + 4),
          flags: reader.u64(offset + 8),
          address: reader.u64(offset + 16),
          offset: reader.u64(offset + 24),
          size: reader.u64(offset + 32),
          link: reader.u32(offset + 40),
          info: reader.u32(offset + 44),
          entsize: reader.u64(offset + 56),
        });
      } else {
        sections.push({
          nameOffset: reader.u32(offset),
          type: reader.u32(offset + 4),
          flags: reader.u32(offset + 8),
          address: reader.u32(offset + 12),
          offset: reader.u32(offset + 16),
          size: reader.u32(offset + 20),
          link: reader.u32(offset + 24),
          info: reader.u32(offset + 28),
          entsize: reader.u32(offset + 36),
        });
      }
    } catch (error) {
      const message = `Skipped section header ${index}: ${error instanceof Error ? error.message : 'unreadable'}`;
      if (!lenient) throw new ParseError(message, true);
      warnings.push(message);
      break;
    }
  }
}

function toRegion(section: RawSection, name: string, segments: Region[]): Region {
  const covered = segments.some(
    (segment) => segment.executable && section.address >= segment.address && section.address < segment.address + Math.max(segment.size, segment.fileSize),
  );
  return {
    name,
    address: section.address,
    size: section.size,
    fileOffset: section.offset,
    fileSize: section.type === SHT_NOBITS ? 0 : section.size,
    flags: [section.flags & SHF_ALLOC ? 'A' : '', section.flags & SHF_WRITE ? 'W' : '', section.flags & SHF_EXECINSTR ? 'X' : ''].filter(Boolean),
    executable: (section.flags & SHF_EXECINSTR) !== 0 || covered,
    writable: (section.flags & SHF_WRITE) !== 0,
    readable: (section.flags & SHF_ALLOC) !== 0 || section.type === SHT_PROGBITS,
  };
}

function readStringTable(reader: Reader, section: RawSection | undefined, warnings: string[]): Uint8Array {
  if (!section || section.type !== SHT_STRTAB || section.size === 0) return new Uint8Array();
  try {
    return reader.slice(section.offset, section.size);
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : 'String table is truncated');
    return new Uint8Array();
  }
}

function lookupString(table: Uint8Array, offset: number): string {
  if (offset < 0 || offset >= table.length) return '';
  let end = offset;
  while (end < table.length && table[end] !== 0) end += 1;
  return new TextDecoder('utf-8', { fatal: false }).decode(table.subarray(offset, end));
}

function readSymbols(
  reader: Reader,
  rawSections: RawSection[],
  sections: Region[],
  symbols: SymbolRecord[],
  imports: ImportRecord[],
  exports: ExportRecord[],
  libraries: string[],
  warnings: string[],
  lenient: boolean,
): void {
  const dynamic = findDynamic(reader, rawSections, warnings);
  for (const needed of dynamic.needed) libraries.push(needed);

  for (const section of rawSections) {
    if (section.type !== SHT_SYMTAB && section.type !== SHT_DYNSYM) continue;
    const strings = readStringTable(reader, rawSections[section.link], warnings);
    const ent = section.entsize || (reader.bytes.length > 4 && reader.bytes[4] === 2 ? 24 : 16);
    const is64 = ent >= 24;
    const count = ent > 0 ? Math.floor(section.size / ent) : 0;
    for (let index = 0; index < count; index += 1) {
      const offset = section.offset + index * ent;
      try {
        const nameOffset = reader.u32(offset);
        let info: number;
        let shndx: number;
        let value: number;
        let size: number;
        if (is64) {
          info = reader.u8(offset + 4);
          shndx = reader.u16(offset + 6);
          value = reader.u64(offset + 8);
          size = reader.u64(offset + 16);
        } else {
          value = reader.u32(offset + 4);
          size = reader.u32(offset + 8);
          info = reader.u8(offset + 12);
          shndx = reader.u16(offset + 14);
        }
        const name = lookupString(strings, nameOffset);
        if (!name && index === 0) continue;
        const type = info & 0xf;
        const bind = info >> 4;
        const kind = symbolKind(type);
        const imported = shndx === SHN_UNDEF && name.length > 0;
        const exported = section.type === SHT_DYNSYM && !imported && (bind === STB_GLOBAL || bind === STB_WEAK) && kind !== 'file' && kind !== 'section';
        const sectionName = shndx > 0 && shndx < sections.length ? sections[shndx]?.name ?? '' : '';
        symbols.push({
          name,
          address: value,
          size,
          kind,
          binding: bind === STB_LOCAL ? 'local' : bind === STB_GLOBAL ? 'global' : bind === STB_WEAK ? 'weak' : 'other',
          section: sectionName,
          imported,
          exported,
        });
        if (imported) {
          imports.push({
            library: libraries.find((item) => !item.includes('ld-linux') && !item.includes('ld-musl')) ?? libraries[0] ?? '',
            name,
            address: null,
            ordinal: null,
          });
        }
        if (exported && (kind === 'function' || kind === 'object')) {
          exports.push({ name, address: value, ordinal: null });
        }
      } catch (error) {
        const message = `Skipped symbol ${index}: ${error instanceof Error ? error.message : 'unreadable'}`;
        if (!lenient) throw new ParseError(message, true);
        warnings.push(message);
        break;
      }
    }
  }
}

function findDynamic(reader: Reader, sections: RawSection[], warnings: string[]): { needed: string[] } {
  const dynamic = sections.find((section) => section.type === 6);
  if (!dynamic) return { needed: [] };
  const ent = dynamic.entsize || (reader.bytes[4] === 2 ? 16 : 8);
  const count = ent > 0 ? Math.floor(dynamic.size / ent) : 0;
  let strtabVa = 0;
  let strsz = 0;
  const neededOffsets: number[] = [];
  try {
    for (let index = 0; index < count; index += 1) {
      const offset = dynamic.offset + index * ent;
      const tag = ent >= 16 ? reader.u64(offset) : reader.u32(offset);
      const value = ent >= 16 ? reader.u64(offset + 8) : reader.u32(offset + 4);
      if (tag === 0) break;
      if (tag === DT_NEEDED) neededOffsets.push(value);
      if (tag === DT_STRTAB) strtabVa = value;
      if (tag === DT_STRSZ) strsz = value;
    }
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : 'Dynamic segment is truncated');
    return { needed: [] };
  }
  const strOff = vaToOffset(sections, strtabVa);
  const needed: string[] = [];
  if (strOff === null) return { needed };
  for (const nameOffset of neededOffsets) {
    try {
      needed.push(reader.cstr(strOff + nameOffset, strsz > 0 ? strsz : 1024));
    } catch {
      warnings.push('A DT_NEEDED entry was truncated');
    }
  }
  return { needed };
}

function vaToOffset(sections: RawSection[], va: number): number | null {
  if (va === 0) return null;
  for (const section of sections) {
    if (section.address === 0 || section.type === SHT_NOBITS) continue;
    if (va >= section.address && va < section.address + section.size) return section.offset + (va - section.address);
  }
  return null;
}

function readNotes(reader: Reader, sections: RawSection[], segments: Region[], warnings: string[]): string[] {
  const notes: string[] = [];
  const sources: { offset: number; size: number }[] = [];
  for (const section of sections) {
    if (section.type === SHT_NOTE && section.size > 0) sources.push({ offset: section.offset, size: section.size });
  }
  for (const segment of segments) {
    if (segment.name === 'PT_NOTE' && segment.fileSize > 0) sources.push({ offset: segment.fileOffset, size: segment.fileSize });
  }
  for (const source of sources) {
    try {
      let cursor = source.offset;
      const end = source.offset + source.size;
      while (cursor + 12 <= end && cursor + 12 <= reader.length) {
        const namesz = reader.u32(cursor);
        const descsz = reader.u32(cursor + 4);
        const type = reader.u32(cursor + 8);
        const name = namesz > 1 ? reader.cstr(cursor + 12, Math.min(namesz, 64)) : '';
        notes.push(`${name || 'note'} type ${type} (${descsz} bytes)`);
        const step = 12 + align4(namesz) + align4(descsz);
        if (step <= 0) break;
        cursor += step;
      }
    } catch {
      warnings.push('A note segment was truncated');
    }
  }
  return notes.slice(0, 8);
}

function align4(value: number): number {
  return (value + 3) & ~3;
}

function symbolKind(type: number): SymbolRecord['kind'] {
  if (type === STT_FUNC || type === STT_GNU_IFUNC) return 'function';
  if (type === STT_OBJECT) return 'object';
  if (type === STT_SECTION) return 'section';
  if (type === STT_FILE) return 'file';
  return 'other';
}

function elfType(type: number): string {
  if (type === ET_REL) return 'REL';
  if (type === ET_EXEC) return 'EXEC';
  if (type === ET_DYN) return 'DYN';
  return String(type);
}

function archFromMachine(machine: number, bits: 32 | 64, little: boolean): ArchInfo {
  const endian = little ? 'little' : 'big';
  if (machine === 3) return { arch: 'x86', bits: 32, endian };
  if (machine === 62) return { arch: 'x86-64', bits: 64, endian };
  if (machine === 183) return { arch: 'arm64', bits: 64, endian };
  if (machine === 40) return { arch: 'arm', bits: 32, endian };
  return { arch: 'unknown', bits, endian };
}

function machineName(machine: number): string {
  const names: Record<number, string> = { 3: 'EM_386', 40: 'EM_ARM', 62: 'EM_X86_64', 183: 'EM_AARCH64' };
  return names[machine] ?? 'EM_UNKNOWN';
}
