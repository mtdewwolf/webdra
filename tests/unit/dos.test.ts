import { describe, expect, it } from 'vitest';
import { analyzeImage } from '../../src/analysis/analyze';
import { disassembleFunction } from '../../src/analysis/disasm';
import { detectFormat, parseBinary } from '../../src/binary/parse';
import type { ParsedBinary } from '../../src/ir/types';

const TIME_BUDGET_MS = 1000;
const HEAP_BUDGET = 48 * 1024 * 1024;

describe('parser bounds', () => {
  it('finishes a cyclic Mach-O export trie', () => {
    withinBudget(() => {
      const parsed = parseBinary(cyclicTrie(), { lenient: true });
      expect(parsed.exports.length).toBeLessThan(10);
    });
  });

  it('does not allocate a section per claimed nsects', () => {
    withinBudget(() => {
      const parsed = parseBinary(hugeNsects(), { lenient: true });
      expect(parsed.sections.length).toBeLessThan(8);
    });
  });

  it('rejects a one-byte symbol entry size and repeated symbol tables', () => {
    withinBudget(() => {
      const bad = parseBinary(elfWithSymbols({ entrySize: 1, tables: 1, span: 4096 }), { lenient: true });
      expect(bad.symbols.length).toBe(0);
      const many = parseBinary(elfWithSymbols({ entrySize: 24, tables: 400, span: 240 }), { lenient: true });
      expect(many.symbols.length).toBeLessThan(50);
    });
  });

  it('scans overlapping sections and notes once', async () => {
    await withinBudget(async () => {
      const exec = await analyzeImage(elfSections(300, 1, 6), { lenient: true });
      expect(exec.entropy.length).toBeLessThan(5);
      const notes = parseBinary(elfSections(300, 7, 0), { lenient: true });
      expect(notes.headerFields.filter((field) => field.label === 'Note').length).toBeLessThan(80);
    });
  });

  it('keeps sections when the entry point does not fit in a safe integer', () => {
    withinBudget(() => {
      const parsed = parseBinary(highEntryElf(), { lenient: true });
      expect(parsed.sections.length).toBeGreaterThan(0);
      expect(parsed.entryPoint).toBeNull();
      expect(parsed.warnings.some((warning) => warning.includes('safe integer'))).toBe(true);
      expect(parsed.headerFields.some((field) => field.value.includes('ffffffff81000000'))).toBe(true);
    });
  });

  it('does not treat a Java class file as a fat Mach-O', () => {
    const java = new Uint8Array([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x3d]);
    expect(detectFormat(java)).toBe('unknown');
  });

  it('reads an extended ELF section count', () => {
    const parsed = parseBinary(xindexElf(), { lenient: true });
    expect(parsed.sections.some((section) => section.name === '.text')).toBe(true);
  });

  it('disassembles Thumb when the address is odd', async () => {
    const binary: ParsedBinary = {
      format: 'elf',
      arch: { arch: 'arm', bits: 32, endian: 'little' },
      entryPoint: 0x1001,
      imageBase: 0x1000,
      sections: [{
        name: '.text',
        address: 0x1000,
        size: 2,
        fileOffset: 0,
        fileSize: 2,
        flags: ['X'],
        executable: true,
        writable: false,
        readable: true,
      }],
      segments: [],
      symbols: [],
      imports: [],
      exports: [],
      libraries: [],
      headerFields: [],
      slices: [],
      selectedSlice: 0,
      warnings: [],
      partial: false,
      fileSize: 2,
    };
    const fn = await disassembleFunction(new Uint8Array([0x2a, 0x20]), binary, 0x1001);
    expect(fn.instructions[0]?.mnemonic).toMatch(/mov/);
  });
});

function withinBudget(run: () => void | Promise<void>): Promise<void> | void {
  const started = performance.now();
  const before = process.memoryUsage().heapUsed;
  const result = run();
  if (result && typeof (result as Promise<void>).then === 'function') {
    return (result as Promise<void>).then(() => checkBudget(started, before));
  }
  checkBudget(started, before);
  return undefined;
}

function checkBudget(started: number, before: number): void {
  expect(performance.now() - started).toBeLessThan(TIME_BUDGET_MS);
  expect(process.memoryUsage().heapUsed - before).toBeLessThan(HEAP_BUDGET);
}

function cyclicTrie(): Uint8Array {
  const trie = [0, 4];
  for (let index = 0; index < 4; index += 1) trie.push(0x61 + index, 0, 0);
  const command = new Uint8Array(48);
  const view = new DataView(command.buffer);
  view.setUint32(0, 0x80000022, true);
  view.setUint32(4, 48, true);
  const trieAt = 32 + 48;
  view.setUint32(40, trieAt, true);
  view.setUint32(44, trie.length, true);
  const header = machoHeader(1, 48);
  const out = new Uint8Array(trieAt + trie.length);
  out.set(header);
  out.set(command, 32);
  out.set(trie, trieAt);
  return out;
}

function hugeNsects(): Uint8Array {
  const command = new Uint8Array(72);
  const view = new DataView(command.buffer);
  view.setUint32(0, 0x19, true);
  view.setUint32(4, 72, true);
  view.setUint32(64, 0xffffffff, true);
  const header = machoHeader(1, 72);
  const out = new Uint8Array(32 + 72);
  out.set(header);
  out.set(command, 32);
  return out;
}

function machoHeader(commands: number, commandBytes: number): Uint8Array {
  const header = new Uint8Array(32);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0xfeedfacf, true);
  view.setInt32(4, 0x0100000c, true);
  view.setUint32(12, 2, true);
  view.setUint32(16, commands, true);
  view.setUint32(20, commandBytes, true);
  return header;
}

function elfWithSymbols(options: { entrySize: number; tables: number; span: number }): Uint8Array {
  const shnum = options.tables + 1;
  const shoff = 64;
  const size = Math.max(shoff + shnum * 64, options.span);
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
  view.setUint16(16, 2, true);
  view.setUint16(18, 62, true);
  view.setBigUint64(40, BigInt(shoff), true);
  view.setUint16(52, 64, true);
  view.setUint16(58, 64, true);
  view.setUint16(60, shnum, true);
  for (let index = 1; index < shnum; index += 1) {
    const at = shoff + index * 64;
    view.setUint32(at + 4, 2, true);
    view.setBigUint64(at + 32, BigInt(options.span), true);
    view.setBigUint64(at + 56, BigInt(options.entrySize), true);
  }
  return bytes;
}

function elfSections(count: number, type: number, flags: number): Uint8Array {
  const shnum = count + 1;
  const shoff = 64;
  const size = shoff + shnum * 64;
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
  view.setUint16(16, 2, true);
  view.setUint16(18, 62, true);
  view.setBigUint64(40, BigInt(shoff), true);
  view.setUint16(52, 64, true);
  view.setUint16(58, 64, true);
  view.setUint16(60, shnum, true);
  for (let index = 1; index < shnum; index += 1) {
    const at = shoff + index * 64;
    view.setUint32(at + 4, type, true);
    view.setBigUint64(at + 8, BigInt(flags), true);
    view.setBigUint64(at + 16, 0x400000n, true);
    view.setBigUint64(at + 32, BigInt(size), true);
  }
  return bytes;
}

function highEntryElf(): Uint8Array {
  const bytes = elfSections(1, 1, 6);
  new DataView(bytes.buffer).setBigUint64(24, 0xffffffff81000000n, true);
  return bytes;
}

function xindexElf(): Uint8Array {
  const shoff = 64;
  const nameAt = shoff + 3 * 64;
  const bytes = new Uint8Array(nameAt + 16);
  const view = new DataView(bytes.buffer);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
  view.setUint16(16, 2, true);
  view.setUint16(18, 62, true);
  view.setBigUint64(40, BigInt(shoff), true);
  view.setUint16(52, 64, true);
  view.setUint16(58, 64, true);
  view.setUint16(60, 0, true);
  view.setUint16(62, 0xffff, true);
  view.setBigUint64(shoff + 32, 3n, true);
  view.setUint32(shoff + 40, 2, true);
  bytes[nameAt + 1] = 0x2e;
  bytes[nameAt + 2] = 0x74;
  bytes[nameAt + 3] = 0x65;
  bytes[nameAt + 4] = 0x78;
  bytes[nameAt + 5] = 0x74;
  const text = shoff + 64;
  view.setUint32(text, 1, true);
  view.setUint32(text + 4, 1, true);
  view.setBigUint64(text + 8, 6n, true);
  view.setBigUint64(text + 16, 0x400000n, true);
  view.setBigUint64(text + 32, 4n, true);
  const strings = shoff + 128;
  view.setUint32(strings + 4, 3, true);
  view.setBigUint64(strings + 24, BigInt(nameAt), true);
  view.setBigUint64(strings + 32, 16n, true);
  return bytes;
}
