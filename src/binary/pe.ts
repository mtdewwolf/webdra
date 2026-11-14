import type { ArchInfo, ExportRecord, HeaderField, ImportRecord, ParsedBinary, Region, SymbolRecord } from '../ir/types';
import { ParseError, Reader, asciiZ, hex } from './reader';

const IMAGE_FILE_MACHINE_I386 = 0x14c;
const IMAGE_FILE_MACHINE_AMD64 = 0x8664;
const IMAGE_FILE_MACHINE_ARM64 = 0xaa64;
const IMAGE_FILE_MACHINE_ARMNT = 0x1c4;
const IMAGE_SCN_CNT_CODE = 0x20;
const IMAGE_SCN_MEM_EXECUTE = 0x20000000;
const IMAGE_SCN_MEM_READ = 0x40000000;
const IMAGE_SCN_MEM_WRITE = 0x80000000;
const IMAGE_SYM_CLASS_EXTERNAL = 2;
const DIRECTORY_EXPORT = 0;
const DIRECTORY_IMPORT = 1;

interface SectionRaw {
  name: string;
  virtualSize: number;
  virtualAddress: number;
  rawSize: number;
  rawPointer: number;
  characteristics: number;
}

export function parsePe(bytes: Uint8Array, lenient: boolean): ParsedBinary {
  const warnings: string[] = [];
  const reader = new Reader(bytes, true);
  if (bytes.length >= 2 && reader.u16(0) === 0x5a4d) return parseImage(reader, lenient, warnings);
  if (looksLikeCoff(reader)) return parseCoffObject(reader, lenient, warnings);
  throw new ParseError('Not a PE or COFF file');
}

function looksLikeCoff(reader: Reader): boolean {
  if (reader.length < 20) return false;
  const machine = reader.u16(0);
  if (!knownMachine(machine)) return false;
  const sections = reader.u16(2);
  const optional = reader.u16(16);
  return sections > 0 && sections <= 96 && (optional === 0 || optional === 224 || optional === 240);
}

function parseImage(reader: Reader, lenient: boolean, warnings: string[]): ParsedBinary {
  let lfanew = 0;
  try {
    lfanew = reader.u32(0x3c);
  } catch (error) {
    if (!lenient) throw new ParseError('DOS header is truncated', true);
    warnings.push(error instanceof Error ? error.message : 'DOS header is truncated');
    return emptyPe(reader.length, warnings);
  }
  if (lfanew <= 0 || lfanew > reader.length - 24) {
    const message = 'PE header offset is outside the file';
    if (!lenient) throw new ParseError(message, true);
    warnings.push(message);
    return emptyPe(reader.length, warnings);
  }
  let signature = 0;
  try {
    signature = reader.u32(lfanew);
  } catch (error) {
    if (!lenient) throw error;
    warnings.push('PE signature is truncated');
    return emptyPe(reader.length, warnings);
  }
  if (signature !== 0x4550) throw new ParseError('Missing PE signature');
  return parseCoffAt(reader, lfanew + 4, true, lenient, warnings);
}

function parseCoffObject(reader: Reader, lenient: boolean, warnings: string[]): ParsedBinary {
  warnings.push('COFF object: virtual addresses are synthesized from section layout.');
  return parseCoffAt(reader, 0, false, lenient, warnings);
}

function parseCoffAt(reader: Reader, offset: number, image: boolean, lenient: boolean, warnings: string[]): ParsedBinary {
  let machine = 0;
  let sectionCount = 0;
  let symbolPointer = 0;
  let symbolCount = 0;
  let optionalSize = 0;
  let characteristics = 0;
  try {
    machine = reader.u16(offset);
    sectionCount = reader.u16(offset + 2);
    symbolPointer = reader.u32(offset + 8);
    symbolCount = reader.u32(offset + 12);
    optionalSize = reader.u16(offset + 16);
    characteristics = reader.u16(offset + 18);
  } catch (error) {
    if (!lenient) throw new ParseError('COFF header is truncated', true);
    warnings.push(error instanceof Error ? error.message : 'COFF header is truncated');
    return emptyPe(reader.length, warnings);
  }
  if (!knownMachine(machine)) warnings.push(`Uncommon COFF machine 0x${machine.toString(16)}`);
  if (sectionCount > 96) {
    const message = `Implausible section count ${sectionCount}`;
    if (!lenient) throw new ParseError(message, true);
    warnings.push(message);
    sectionCount = 0;
  }

  const optionalOffset = offset + 20;
  let magic = 0;
  let entryRva = 0;
  let imageBase = image ? 0x140000000 : 0;
  let sectionAlignment = 0x1000;
  let pe32plus = true;
  let directories: { rva: number; size: number }[] = [];
  if (optionalSize > 0) {
    try {
      const optional = readOptional(reader, optionalOffset, optionalSize);
      magic = optional.magic;
      entryRva = optional.entryRva;
      imageBase = optional.imageBase;
      sectionAlignment = optional.sectionAlignment || 0x1000;
      pe32plus = optional.pe32plus;
      directories = optional.directories;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Optional header is truncated';
      if (!lenient) throw new ParseError(message, true);
      warnings.push(message);
    }
  }

  const sectionOffset = optionalOffset + optionalSize;
  const rawSections: SectionRaw[] = [];
  for (let index = 0; index < sectionCount; index += 1) {
    const at = sectionOffset + index * 40;
    try {
      rawSections.push({
        name: asciiZ(reader.slice(at, 8)),
        virtualSize: reader.u32(at + 8),
        virtualAddress: reader.u32(at + 12),
        rawSize: reader.u32(at + 16),
        rawPointer: reader.u32(at + 20),
        characteristics: reader.u32(at + 36),
      });
    } catch (error) {
      const message = `Skipped section ${index}: ${error instanceof Error ? error.message : 'unreadable'}`;
      if (!lenient) throw new ParseError(message, true);
      warnings.push(message);
      break;
    }
  }

  let cursor = 0x1000;
  const sections: Region[] = rawSections.map((section) => {
    const synthesized = section.virtualAddress === 0 && !image;
    const address = synthesized ? cursor : imageBase + section.virtualAddress;
    const size = Math.max(section.virtualSize, section.rawSize);
    if (synthesized) cursor += Math.max(16, (size + 15) & ~15);
    const executable = (section.characteristics & (IMAGE_SCN_MEM_EXECUTE | IMAGE_SCN_CNT_CODE)) !== 0;
    return {
      name: section.name,
      address,
      size,
      fileOffset: section.rawPointer,
      fileSize: section.rawSize,
      flags: [
        executable ? 'X' : '',
        section.characteristics & IMAGE_SCN_MEM_READ ? 'R' : '',
        section.characteristics & IMAGE_SCN_MEM_WRITE ? 'W' : '',
      ].filter(Boolean),
      executable,
      writable: (section.characteristics & IMAGE_SCN_MEM_WRITE) !== 0,
      readable: (section.characteristics & IMAGE_SCN_MEM_READ) !== 0 || executable,
    };
  });

  const rvaToVa = (rva: number) => imageBase + rva;
  const symbols: SymbolRecord[] = [];
  const imports: ImportRecord[] = [];
  const exports: ExportRecord[] = [];
  if (symbolPointer && symbolCount) {
    readCoffSymbols(reader, symbolPointer, symbolCount, sections, symbols, imports, warnings, lenient);
  }
  const exportDir = directories[DIRECTORY_EXPORT];
  const importDir = directories[DIRECTORY_IMPORT];
  if (exportDir && exportDir.rva && exportDir.size) {
    readExports(reader, sections, imageBase, exportDir.rva, exportDir.size, exports, warnings, lenient);
  }
  const libraries: string[] = [];
  if (importDir && importDir.rva && importDir.size) {
    readImports(reader, sections, imageBase, importDir.rva, pe32plus, imports, libraries, warnings, lenient);
  }

  const arch = archFromMachine(machine);
  const fields: HeaderField[] = [
    { label: 'Machine', value: `${arch.arch} (${hex(machine)})` },
    { label: 'Characteristics', value: hex(characteristics) },
    { label: 'Magic', value: magic ? hex(magic) : 'COFF' },
    { label: 'Image base', value: hex(imageBase) },
    { label: 'Entry RVA', value: entryRva ? hex(entryRva) : 'none' },
    { label: 'Section alignment', value: hex(sectionAlignment) },
    { label: 'Sections', value: String(sections.length) },
    { label: 'COFF symbols', value: String(symbolCount) },
  ];

  return {
    format: 'pe',
    arch,
    entryPoint: entryRva ? rvaToVa(entryRva) : null,
    imageBase,
    sections,
    segments: sections,
    symbols,
    imports,
    exports,
    libraries,
    headerFields: fields,
    slices: [],
    selectedSlice: 0,
    warnings,
    partial: warnings.length > 0,
    fileSize: reader.length,
  };
}

function readOptional(reader: Reader, offset: number, size: number): {
  magic: number;
  entryRva: number;
  imageBase: number;
  sectionAlignment: number;
  pe32plus: boolean;
  directories: { rva: number; size: number }[];
} {
  reader.need(offset, Math.min(size, 24));
  const magic = reader.u16(offset);
  const pe32plus = magic === 0x20b;
  if (magic !== 0x10b && magic !== 0x20b) throw new ParseError(`Unknown optional header magic ${hex(magic)}`, true);
  const entryRva = reader.u32(offset + 16);
  const imageBase = pe32plus ? reader.u64(offset + 24) : reader.u32(offset + 28);
  const sectionAlignment = reader.u32(pe32plus ? offset + 32 : offset + 32);
  const numberOffset = pe32plus ? offset + 108 : offset + 92;
  const directoryOffset = pe32plus ? offset + 112 : offset + 96;
  let count = 0;
  if (numberOffset + 4 <= offset + size) count = reader.u32(numberOffset);
  const directories: { rva: number; size: number }[] = [];
  const available = Math.max(0, Math.floor((offset + size - directoryOffset) / 8));
  const limit = Math.min(count, available, 16);
  for (let index = 0; index < limit; index += 1) {
    const at = directoryOffset + index * 8;
    directories.push({ rva: reader.u32(at), size: reader.u32(at + 4) });
  }
  return { magic, entryRva, imageBase, sectionAlignment, pe32plus, directories };
}

function readCoffSymbols(
  reader: Reader,
  pointer: number,
  count: number,
  sections: Region[],
  symbols: SymbolRecord[],
  imports: ImportRecord[],
  warnings: string[],
  lenient: boolean,
): void {
  const stringTable = pointer + count * 18;
  for (let index = 0; index < count; index += 1) {
    const at = pointer + index * 18;
    try {
      reader.need(at, 18);
      const name = coffName(reader, at, stringTable);
      const value = reader.u32(at + 8);
      const sectionNumber = reader.i16(at + 12);
      const type = reader.u16(at + 14);
      const storage = reader.u8(at + 16);
      const aux = reader.u8(at + 17);
      const derived = (type >> 4) & 0xf;
      const kind = derived === 2 || type === 0x20 ? 'function' : type === 0 ? 'other' : 'object';
      const section = sectionNumber > 0 ? sections[sectionNumber - 1] : undefined;
      const address = section ? section.address + value : value;
      const imported = sectionNumber === 0 && storage === IMAGE_SYM_CLASS_EXTERNAL && name.length > 0;
      if (name && sectionNumber !== -2) {
        symbols.push({
          name,
          address,
          size: 0,
          kind: kind === 'function' ? 'function' : kind === 'object' ? 'object' : 'other',
          binding: storage === IMAGE_SYM_CLASS_EXTERNAL ? 'global' : 'local',
          section: section?.name ?? '',
          imported,
          exported: false,
        });
        if (imported) imports.push({ library: '', name, address: null, ordinal: null });
      }
      index += aux;
    } catch (error) {
      const message = `Skipped COFF symbol ${index}: ${error instanceof Error ? error.message : 'unreadable'}`;
      if (!lenient) throw new ParseError(message, true);
      warnings.push(message);
      break;
    }
  }
}

function coffName(reader: Reader, offset: number, stringTable: number): string {
  const first = reader.u32(offset);
  if (first === 0) {
    const nameOffset = reader.u32(offset + 4);
    if (stringTable + 4 > reader.length) return '';
    return reader.cstr(stringTable + nameOffset, 512);
  }
  return asciiZ(reader.slice(offset, 8));
}

function readExports(
  reader: Reader,
  sections: Region[],
  imageBase: number,
  rva: number,
  size: number,
  exports: ExportRecord[],
  warnings: string[],
  lenient: boolean,
): void {
  const offset = rvaToOffset(sections, imageBase, rva);
  if (offset === null) {
    warnings.push('Export directory RVA is not in a section');
    return;
  }
  try {
    const nameRva = reader.u32(offset + 12);
    const base = reader.u32(offset + 16);
    const functionCount = reader.u32(offset + 20);
    const nameCount = reader.u32(offset + 24);
    const functionsRva = reader.u32(offset + 28);
    const namesRva = reader.u32(offset + 32);
    const ordinalsRva = reader.u32(offset + 36);
    const functions = rvaToOffset(sections, imageBase, functionsRva);
    const names = rvaToOffset(sections, imageBase, namesRva);
    const ordinals = rvaToOffset(sections, imageBase, ordinalsRva);
    if (functions === null || names === null || ordinals === null) {
      warnings.push('Export tables are outside the file');
      return;
    }
    const dllName = nameRva ? safeCstr(reader, rvaToOffset(sections, imageBase, nameRva)) : '';
    if (dllName) warnings.push(`Export library name: ${dllName}`);
    const limit = Math.min(nameCount, 10000);
    for (let index = 0; index < limit; index += 1) {
      const ordinalIndex = reader.u16(ordinals + index * 2);
      if (ordinalIndex >= functionCount) continue;
      const funcRva = reader.u32(functions + ordinalIndex * 4);
      const nameOffset = rvaToOffset(sections, imageBase, reader.u32(names + index * 4));
      const name = safeCstr(reader, nameOffset);
      const forwarded = funcRva >= rva && funcRva < rva + size;
      exports.push({
        name: forwarded ? `${name} (forwarder)` : name,
        address: forwarded ? 0 : imageBase + funcRva,
        ordinal: base + ordinalIndex,
      });
    }
  } catch (error) {
    const message = `Export directory is truncated: ${error instanceof Error ? error.message : 'unreadable'}`;
    if (!lenient) throw new ParseError(message, true);
    warnings.push(message);
  }
}

function readImports(
  reader: Reader,
  sections: Region[],
  imageBase: number,
  rva: number,
  pe32plus: boolean,
  imports: ImportRecord[],
  libraries: string[],
  warnings: string[],
  lenient: boolean,
): void {
  const offset = rvaToOffset(sections, imageBase, rva);
  if (offset === null) {
    warnings.push('Import directory RVA is not in a section');
    return;
  }
  const thunkSize = pe32plus ? 8 : 4;
  try {
    for (let index = 0; index < 256; index += 1) {
      const at = offset + index * 20;
      reader.need(at, 20);
      const original = reader.u32(at);
      const nameRva = reader.u32(at + 12);
      const first = reader.u32(at + 16);
      if (original === 0 && nameRva === 0 && first === 0) break;
      const library = safeCstr(reader, rvaToOffset(sections, imageBase, nameRva));
      if (library) libraries.push(library);
      const thunkRva = original || first;
      const thunkOff = rvaToOffset(sections, imageBase, thunkRva);
      if (thunkOff === null) continue;
      for (let slot = 0; slot < 4096; slot += 1) {
        const slotAt = thunkOff + slot * thunkSize;
        const thunk = pe32plus ? reader.u64Parts(slotAt) : { hi: 0, lo: reader.u32(slotAt) };
        if (thunk.hi === 0 && thunk.lo === 0) break;
        const ordinalFlag = pe32plus ? (thunk.hi & 0x80000000) !== 0 : (thunk.lo & 0x80000000) !== 0;
        if (ordinalFlag) {
          const ordinal = thunk.lo & 0xffff;
          imports.push({ library, name: `#${ordinal}`, address: imageBase + first + slot * thunkSize, ordinal });
        } else {
          const hintRva = thunk.hi * 0x100000000 + thunk.lo;
          const hintOff = Number.isSafeInteger(hintRva) ? rvaToOffset(sections, imageBase, hintRva) : null;
          const name = hintOff === null ? '' : reader.cstr(hintOff + 2, 512);
          imports.push({ library, name, address: imageBase + first + slot * thunkSize, ordinal: null });
        }
      }
    }
  } catch (error) {
    const message = `Import directory is truncated: ${error instanceof Error ? error.message : 'unreadable'}`;
    if (!lenient) throw new ParseError(message, true);
    warnings.push(message);
  }
}

function rvaToOffset(sections: Region[], imageBase: number, rva: number): number | null {
  for (const section of sections) {
    const sectionRva = section.address - imageBase;
    const size = Math.max(section.size, section.fileSize);
    if (sectionRva < 0 || size <= 0) continue;
    if (rva >= sectionRva && rva < sectionRva + size) {
      const delta = rva - sectionRva;
      if (delta < 0 || delta >= section.fileSize) return null;
      return section.fileOffset + delta;
    }
  }
  return null;
}

function safeCstr(reader: Reader, offset: number | null): string {
  if (offset === null) return '';
  try {
    return reader.cstr(offset, 512);
  } catch {
    return '';
  }
}

function knownMachine(machine: number): boolean {
  return (
    machine === IMAGE_FILE_MACHINE_I386 ||
    machine === IMAGE_FILE_MACHINE_AMD64 ||
    machine === IMAGE_FILE_MACHINE_ARM64 ||
    machine === IMAGE_FILE_MACHINE_ARMNT
  );
}

function archFromMachine(machine: number): ArchInfo {
  if (machine === IMAGE_FILE_MACHINE_I386) return { arch: 'x86', bits: 32, endian: 'little' };
  if (machine === IMAGE_FILE_MACHINE_AMD64) return { arch: 'x86-64', bits: 64, endian: 'little' };
  if (machine === IMAGE_FILE_MACHINE_ARM64) return { arch: 'arm64', bits: 64, endian: 'little' };
  if (machine === IMAGE_FILE_MACHINE_ARMNT) return { arch: 'arm', bits: 32, endian: 'little' };
  return { arch: 'unknown', bits: 64, endian: 'little' };
}

function emptyPe(fileSize: number, warnings: string[]): ParsedBinary {
  return {
    format: 'pe',
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
