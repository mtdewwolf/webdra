import type { ArchInfo, Architecture, ExportRecord, HeaderField, ImportRecord, ParsedBinary, Region, SymbolRecord } from '../ir/types';
import { ParseError, Reader, hex, uleb } from './reader';

const MH_MAGIC = 0xfeedface;
const MH_CIGAM = 0xcefaedfe;
const MH_MAGIC_64 = 0xfeedfacf;
const MH_CIGAM_64 = 0xcffaedfe;
const FAT_MAGIC = 0xcafebabe;
const FAT_CIGAM = 0xbebafeca;
const LC_SEGMENT = 0x1;
const LC_SYMTAB = 0x2;
const LC_UNIXTHREAD = 0x5;
const LC_LOAD_DYLIB = 0xc;
const LC_ID_DYLIB = 0xd;
const LC_SEGMENT_64 = 0x19;
const LC_DYLD_INFO = 0x22;
const LC_DYLD_INFO_ONLY = 0x80000022;
const LC_MAIN = 0x80000028;
const N_EXT = 0x01;
const N_TYPE = 0x0e;
const N_UNDF = 0x0;
const N_SECT = 0x0e;
const CPU_TYPE_X86 = 7;
const CPU_TYPE_X86_64 = 0x01000007;
const CPU_TYPE_ARM = 12;
const CPU_TYPE_ARM64 = 0x0100000c;
const VM_PROT_READ = 1;
const VM_PROT_WRITE = 2;
const VM_PROT_EXECUTE = 4;
const S_ATTR_SOME_INSTRUCTIONS = 0x00000400;
const S_ATTR_PURE_INSTRUCTIONS = 0x80000000;

interface SliceInfo {
  offset: number;
  size: number;
  cpuType: number;
  cpuSubtype: number;
}

interface SecInfo {
  name: string;
  segment: string;
  address: number;
  size: number;
  offset: number;
  flags: number;
  executable: boolean;
}

export function parseMacho(bytes: Uint8Array, lenient: boolean, sliceOffset: number | null): ParsedBinary {
  const warnings: string[] = [];
  const reader = new Reader(bytes, true);
  if (reader.length < 8) throw new ParseError('File is too small to be a Mach-O', true);
  const slices = readFat(reader, warnings, lenient);
  const selected = chooseSlice(slices, sliceOffset);
  const sliceBytes = bytes.subarray(selected.offset, selected.offset + selected.size);
  const parsed = parseThin(sliceBytes, lenient, warnings);
  rebaseFileOffsets(parsed, selected.offset);
  parsed.slices = slices.map((slice) => ({
    offset: slice.offset,
    size: slice.size,
    arch: archFromCpu(slice.cpuType).arch,
    bits: archFromCpu(slice.cpuType).bits,
    cpuType: slice.cpuType,
    label: sliceLabel(slice),
  }));
  parsed.selectedSlice = slices.indexOf(selected);
  parsed.fileSize = bytes.length;
  return parsed;
}

export function isMacho(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const magic = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  return magic === MH_MAGIC || magic === MH_CIGAM || magic === MH_MAGIC_64 || magic === MH_CIGAM_64 || magic === FAT_MAGIC || magic === FAT_CIGAM;
}

function readFat(reader: Reader, warnings: string[], lenient: boolean): SliceInfo[] {
  const big = reader.u32be(0) === FAT_MAGIC;
  const littleFat = reader.u32(0) === FAT_MAGIC;
  if (!big && !littleFat) {
    return [{ offset: 0, size: reader.length, cpuType: 0, cpuSubtype: 0 }];
  }
  const count = big ? reader.u32be(4) : reader.u32(4);
  if (count <= 0 || count > 32) {
    const message = `Implausible fat slice count ${count}`;
    if (!lenient) throw new ParseError(message, true);
    warnings.push(message);
    return [{ offset: 0, size: reader.length, cpuType: 0, cpuSubtype: 0 }];
  }
  const slices: SliceInfo[] = [];
  for (let index = 0; index < count; index += 1) {
    const at = 8 + index * 20;
    try {
      const cpuType = big ? reader.i32be(at) : reader.i32(at);
      const cpuSubtype = big ? reader.i32be(at + 4) : reader.i32(at + 4);
      const offset = big ? reader.u32be(at + 8) : reader.u32(at + 8);
      const size = big ? reader.u32be(at + 12) : reader.u32(at + 12);
      if (offset + size > reader.length) throw new ParseError(`Fat slice ${index} is truncated`, true);
      slices.push({ offset, size, cpuType, cpuSubtype });
    } catch (error) {
      const message = error instanceof Error ? error.message : `Fat slice ${index} is unreadable`;
      if (!lenient) throw new ParseError(message, true);
      warnings.push(message);
    }
  }
  if (!slices.length) throw new ParseError('Fat Mach-O has no readable slices', true);
  return slices;
}

/** parseThin offsets are relative to the slice. Callers read the original buffer. */
function rebaseFileOffsets(parsed: ParsedBinary, sliceOffset: number): void {
  if (sliceOffset === 0) return;
  for (const region of [...parsed.sections, ...parsed.segments]) {
    if (region.fileSize > 0) region.fileOffset += sliceOffset;
  }
}

function chooseSlice(slices: SliceInfo[], sliceOffset: number | null): SliceInfo {
  if (sliceOffset === null) return slices[0] ?? { offset: 0, size: 0, cpuType: 0, cpuSubtype: 0 };
  return slices.find((slice) => slice.offset === sliceOffset) ?? slices[0] ?? { offset: 0, size: 0, cpuType: 0, cpuSubtype: 0 };
}

function parseThin(bytes: Uint8Array, lenient: boolean, warnings: string[]): ParsedBinary {
  if (bytes.length < 28) {
    if (!lenient) throw new ParseError('Mach-O header is truncated', true);
    warnings.push('Mach-O header is truncated');
    return emptyMacho(bytes.length, warnings);
  }
  const probe = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  let little = true;
  let bits: 32 | 64 = 32;
  if (probe === MH_MAGIC_64) bits = 64;
  else if (probe === MH_MAGIC) bits = 32;
  else if (probe === MH_CIGAM_64) {
    bits = 64;
    little = false;
  } else if (probe === MH_CIGAM) {
    bits = 32;
    little = false;
  } else {
    throw new ParseError('Not a Mach-O slice');
  }
  const reader = new Reader(bytes, little);
  const headerSize = bits === 64 ? 32 : 28;
  let cpuType = 0;
  let fileType = 0;
  let ncmds = 0;
  let sizeofcmds = 0;
  let flags = 0;
  try {
    cpuType = reader.i32(4);
    fileType = reader.u32(12);
    ncmds = reader.u32(16);
    sizeofcmds = reader.u32(20);
    flags = reader.u32(24);
  } catch (error) {
    if (!lenient) throw new ParseError('Mach-O header is truncated', true);
    warnings.push(error instanceof Error ? error.message : 'Mach-O header is truncated');
    return emptyMacho(bytes.length, warnings);
  }
  if (ncmds > 4096 || sizeofcmds > bytes.length) {
    const message = 'Mach-O load commands are out of range';
    if (!lenient) throw new ParseError(message, true);
    warnings.push(message);
    ncmds = 0;
  }

  const arch = archFromCpu(cpuType);
  const segments: Region[] = [];
  const sectionInfos: SecInfo[] = [];
  const libraries: string[] = [];
  let entry: number | null = null;
  let symOff = 0;
  let nsyms = 0;
  let strOff = 0;
  let strSize = 0;
  let exportOff = 0;
  let exportSize = 0;
  let cursor = headerSize;
  const commandsEnd = headerSize + sizeofcmds;
  for (let index = 0; index < ncmds; index += 1) {
    if (cursor + 8 > bytes.length || cursor >= commandsEnd) {
      warnings.push('Load commands ended early');
      break;
    }
    let cmd = 0;
    let cmdsize = 0;
    try {
      cmd = reader.u32(cursor);
      cmdsize = reader.u32(cursor + 4);
      if (cmdsize < 8 || cursor + cmdsize > bytes.length) throw new ParseError(`Load command ${index} is truncated`, true);
      if (cmd === LC_SEGMENT || cmd === LC_SEGMENT_64) {
        readSegment(reader, cursor, cmd === LC_SEGMENT_64, segments, sectionInfos);
      } else if (cmd === LC_SYMTAB) {
        symOff = reader.u32(cursor + 8);
        nsyms = reader.u32(cursor + 12);
        strOff = reader.u32(cursor + 16);
        strSize = reader.u32(cursor + 20);
      } else if (cmd === LC_LOAD_DYLIB || cmd === LC_ID_DYLIB) {
        const nameOffset = reader.u32(cursor + 8);
        libraries.push(reader.cstr(cursor + nameOffset, cmdsize));
      } else if (cmd === LC_MAIN) {
        const entryoff = reader.u64(cursor + 8);
        entry = fileOffsetToVa(segments, entryoff);
      } else if (cmd === LC_UNIXTHREAD) {
        entry = readThreadEntry(reader, cursor, cmdsize, arch, warnings);
      } else if (cmd === LC_DYLD_INFO || cmd === LC_DYLD_INFO_ONLY) {
        exportOff = reader.u32(cursor + 40);
        exportSize = reader.u32(cursor + 44);
      }
    } catch (error) {
      const message = `Skipped load command ${index}: ${error instanceof Error ? error.message : 'unreadable'}`;
      if (!lenient) throw new ParseError(message, true);
      warnings.push(message);
    }
    cursor += Math.max(cmdsize, 8);
  }

  const sections: Region[] = sectionInfos.map((section) => ({
    name: section.segment && section.name ? `${section.segment},${section.name}` : section.name || section.segment,
    address: section.address,
    size: section.size,
    fileOffset: section.offset,
    fileSize: (section.flags & 0xff) === 1 || section.offset === 0 ? 0 : section.size,
    flags: [section.executable ? 'X' : ''].filter(Boolean),
    executable: section.executable,
    writable: false,
    readable: true,
  }));
  for (const section of sections) {
    const segment = segments.find((item) => section.address >= item.address && section.address < item.address + Math.max(item.size, 1));
    if (!segment) continue;
    section.writable = segment.writable;
    section.readable = segment.readable;
    if (segment.executable) section.executable = true;
  }

  const symbols: SymbolRecord[] = [];
  const imports: ImportRecord[] = [];
  const exports: ExportRecord[] = [];
  if (nsyms > 0) {
    readSymbols(reader, bits === 64, fileType === 1, symOff, nsyms, strOff, strSize, sectionInfos, libraries, symbols, imports, exports, warnings, lenient);
  }
  if (exportOff && exportSize) {
    const imageBase = segments.find((segment) => segment.name === '__TEXT')?.address ?? 0;
    readExportTrie(bytes, exportOff, exportSize, imageBase, exports, warnings);
  }
  if (entry === null) {
    const main = symbols.find((symbol) => symbol.name === '_main' || symbol.name === 'main');
    if (main && !main.imported) entry = main.address;
  }

  const fields: HeaderField[] = [
    { label: 'CPU', value: sliceLabel({ offset: 0, size: 0, cpuType, cpuSubtype: 0 }) },
    { label: 'File type', value: fileTypeName(fileType) },
    { label: 'Flags', value: hex(flags) },
    { label: 'Endianness', value: little ? 'little' : 'big' },
    { label: 'Load commands', value: String(ncmds) },
    { label: 'Entry', value: entry === null ? 'none' : hex(entry) },
    { label: 'Libraries', value: libraries.join(', ') || 'none' },
  ];

  return {
    format: 'macho',
    arch,
    entryPoint: entry,
    imageBase: segments.find((segment) => segment.name === '__TEXT')?.address ?? 0,
    sections,
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

function readSegment(reader: Reader, cursor: number, is64: boolean, segments: Region[], sections: SecInfo[]): void {
  const name = reader.cstr(cursor + 8, 16);
  let vmaddr: number;
  let vmsize: number;
  let fileoff: number;
  let filesize: number;
  let initprot: number;
  let nsects: number;
  let sectionStart: number;
  if (is64) {
    vmaddr = reader.u64(cursor + 24);
    vmsize = reader.u64(cursor + 32);
    fileoff = reader.u64(cursor + 40);
    filesize = reader.u64(cursor + 48);
    initprot = reader.i32(cursor + 60);
    nsects = reader.u32(cursor + 64);
    sectionStart = cursor + 72;
  } else {
    vmaddr = reader.u32(cursor + 24);
    vmsize = reader.u32(cursor + 28);
    fileoff = reader.u32(cursor + 32);
    filesize = reader.u32(cursor + 36);
    initprot = reader.i32(cursor + 44);
    nsects = reader.u32(cursor + 48);
    sectionStart = cursor + 56;
  }
  const executable = (initprot & VM_PROT_EXECUTE) !== 0;
  segments.push({
    name,
    address: vmaddr,
    size: vmsize,
    fileOffset: fileoff,
    fileSize: name === '__PAGEZERO' ? 0 : filesize,
    flags: [initprot & VM_PROT_READ ? 'R' : '', initprot & VM_PROT_WRITE ? 'W' : '', executable ? 'X' : ''].filter(Boolean),
    executable,
    writable: (initprot & VM_PROT_WRITE) !== 0,
    readable: (initprot & VM_PROT_READ) !== 0,
  });
  const sectionSize = is64 ? 80 : 68;
  for (let index = 0; index < nsects; index += 1) {
    const at = sectionStart + index * sectionSize;
    const sectname = reader.cstr(at, 16);
    const segname = reader.cstr(at + 16, 16);
    const address = is64 ? reader.u64(at + 32) : reader.u32(at + 32);
    const size = is64 ? reader.u64(at + (is64 ? 40 : 36)) : reader.u32(at + 36);
    const offset = reader.u32(is64 ? at + 48 : at + 40);
    const flags = reader.u32(is64 ? at + 64 : at + 56);
    const pure = (flags & S_ATTR_PURE_INSTRUCTIONS) !== 0 || (flags & S_ATTR_SOME_INSTRUCTIONS) !== 0;
    sections.push({
      name: sectname,
      segment: segname,
      address,
      size,
      offset,
      flags,
      executable: executable || pure,
    });
  }
}

function readSymbols(
  reader: Reader,
  is64: boolean,
  objectFile: boolean,
  symOff: number,
  nsyms: number,
  strOff: number,
  strSize: number,
  sections: SecInfo[],
  libraries: string[],
  symbols: SymbolRecord[],
  imports: ImportRecord[],
  exports: ExportRecord[],
  warnings: string[],
  lenient: boolean,
): void {
  const ent = is64 ? 16 : 12;
  const limit = Math.min(nsyms, 200000);
  for (let index = 0; index < limit; index += 1) {
    const at = symOff + index * ent;
    try {
      const strx = reader.u32(at);
      const type = reader.u8(at + 4);
      const sect = reader.u8(at + 5);
      const desc = reader.u16(at + 6);
      const value = is64 ? reader.u64(at + 8) : reader.u32(at + 8);
      if ((type & 0xe0) !== 0) continue;
      const name = strx > 0 && strx < strSize ? reader.cstr(strOff + strx, strSize - strx) : '';
      if (!name) continue;
      const ntype = type & N_TYPE;
      const section = sect > 0 ? sections[sect - 1] : undefined;
      const address = objectFile && section ? section.address + value : value;
      const imported = ntype === N_UNDF && value === 0;
      const executable = section?.executable ?? false;
      const kind = executable && ntype === N_SECT ? 'function' : ntype === N_SECT ? 'object' : 'other';
      const ordinal = (desc >> 8) & 0xff;
      const library = ordinal > 0 ? libraries[ordinal - 1] ?? '' : '';
      symbols.push({
        name,
        address,
        size: 0,
        kind,
        binding: type & N_EXT ? 'global' : 'local',
        section: section ? `${section.segment},${section.name}` : '',
        imported,
        exported: !imported && (type & N_EXT) !== 0 && ntype === N_SECT,
      });
      if (imported) imports.push({ library, name, address: null, ordinal: ordinal || null });
      if (!imported && (type & N_EXT) !== 0 && ntype === N_SECT && kind === 'function') {
        exports.push({ name, address, ordinal: null });
      }
    } catch (error) {
      const message = `Skipped Mach-O symbol ${index}: ${error instanceof Error ? error.message : 'unreadable'}`;
      if (!lenient) throw new ParseError(message, true);
      warnings.push(message);
      break;
    }
  }
}

function readExportTrie(bytes: Uint8Array, offset: number, size: number, imageBase: number, exports: ExportRecord[], warnings: string[]): void {
  if (offset + size > bytes.length) {
    warnings.push('Export trie is truncated');
    return;
  }
  const data = bytes.subarray(offset, offset + size);
  const seen = new Set<string>();
  const walk = (node: number, prefix: string, depth: number): void => {
    if (depth > 32 || node < 0 || node >= data.length) return;
    try {
      const terminal = uleb(data, node);
      let cursor = terminal.next;
      if (terminal.value > 0 && prefix) {
        const flags = uleb(data, cursor);
        if ((flags.value & 0x08) === 0) {
          const symbolOffset = uleb(data, flags.next);
          const key = prefix;
          if (!seen.has(key)) {
            seen.add(key);
            exports.push({ name: prefix, address: imageBase + symbolOffset.value, ordinal: null });
          }
        }
      }
      cursor += terminal.value;
      if (cursor >= data.length) return;
      const children = data[cursor] ?? 0;
      cursor += 1;
      for (let index = 0; index < children; index += 1) {
        let edge = '';
        while (cursor < data.length && data[cursor] !== 0) {
          edge += String.fromCharCode(data[cursor] ?? 0);
          cursor += 1;
        }
        cursor += 1;
        const child = uleb(data, cursor);
        cursor = child.next;
        walk(child.value, prefix + edge, depth + 1);
      }
    } catch {
      warnings.push('Export trie node was skipped');
    }
  };
  try {
    walk(0, '', 0);
  } catch {
    warnings.push('Export trie could not be read');
  }
}

function readThreadEntry(reader: Reader, cursor: number, cmdsize: number, arch: ArchInfo, warnings: string[]): number | null {
  if (cmdsize < 16) return null;
  const flavor = reader.u32(cursor + 8);
  if (arch.arch === 'x86-64' && flavor === 4 && cmdsize >= 16 + 16 * 8) {
    return reader.u64(cursor + 16 + 16 * 8);
  }
  if (arch.arch === 'arm64' && flavor === 6 && cmdsize >= 16 + 32 * 8) {
    return reader.u64(cursor + 16 + 32 * 8);
  }
  warnings.push(`Thread state flavor ${flavor} was not decoded`);
  return null;
}

function fileOffsetToVa(segments: Region[], offset: number): number | null {
  for (const segment of segments) {
    if (segment.fileSize <= 0) continue;
    if (offset >= segment.fileOffset && offset < segment.fileOffset + segment.fileSize) {
      return segment.address + (offset - segment.fileOffset);
    }
  }
  return offset;
}

function archFromCpu(cpuType: number): ArchInfo {
  const bits: 32 | 64 = (cpuType & 0x01000000) !== 0 ? 64 : 32;
  let arch: Architecture = 'unknown';
  const base = cpuType & 0xff;
  if (base === CPU_TYPE_X86 || cpuType === CPU_TYPE_X86_64) arch = bits === 64 ? 'x86-64' : 'x86';
  if (base === CPU_TYPE_ARM || cpuType === CPU_TYPE_ARM64) arch = bits === 64 ? 'arm64' : 'arm';
  return { arch, bits, endian: 'little' };
}

function sliceLabel(slice: SliceInfo): string {
  const arch = archFromCpu(slice.cpuType);
  if (slice.cpuType === 0) return 'thin';
  return `${arch.arch} ${arch.bits}-bit`;
}

function fileTypeName(fileType: number): string {
  const names: Record<number, string> = { 1: 'MH_OBJECT', 2: 'MH_EXECUTE', 6: 'MH_DYLIB', 8: 'MH_BUNDLE', 10: 'MH_DYLINKER' };
  return names[fileType] ?? String(fileType);
}

function emptyMacho(fileSize: number, warnings: string[]): ParsedBinary {
  return {
    format: 'macho',
    arch: { arch: 'unknown', bits: 64, endian: 'little' },
    entryPoint: null,
    imageBase: 0,
    sections: [],
    segments: [],
    symbols: [],
    imports: [],
    exports: [],
    libraries: [],
    headerFields: [],
    slices: [],
    selectedSlice: 0,
    warnings,
    partial: true,
    fileSize,
  };
}
