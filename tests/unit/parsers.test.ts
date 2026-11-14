import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { disassembleFunction } from '../../src/analysis/disasm';
import { extractStrings } from '../../src/analysis/strings';
import { parseBinary, ParseError } from '../../src/binary/parse';

const load = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/bins/${name}`));

describe('compiled fixtures', () => {
  it('parses and disassembles the ELF64 x86-64 sample', async () => {
    const bytes = load('elf64-x86_64');
    const binary = parseBinary(bytes);
    expect(binary.format).toBe('elf');
    expect(binary.arch).toMatchObject({ arch: 'x86-64', bits: 64, endian: 'little' });
    const main = binary.symbols.find((symbol) => symbol.name === 'main');
    expect(main?.kind).toBe('function');
    expect(binary.imports.some((item) => item.name === 'puts')).toBe(true);
    expect(binary.libraries.some((item) => item.includes('libc'))).toBe(true);
    const decoded = await disassembleFunction(bytes, binary, main!.address);
    expect(decoded.instructions.length).toBeGreaterThan(1);
    expect(decoded.instructions.some((instruction) => instruction.mnemonic === 'ret')).toBe(true);
    expect(decoded.blocks.length).toBeGreaterThan(0);
    const entry = await disassembleFunction(bytes, binary, binary.entryPoint!);
    expect(entry.instructions.length).toBeGreaterThan(0);
    expect(extractStrings(bytes, binary, 4).strings.some((item) => item.text.includes('webdra-fixture-string'))).toBe(true);
  });

  it('parses and disassembles the ELF64 ARM64 sample', async () => {
    const bytes = load('elf64-arm64');
    const binary = parseBinary(bytes);
    expect(binary.arch.arch).toBe('arm64');
    const main = binary.symbols.find((symbol) => symbol.name === 'main');
    expect(main).toBeTruthy();
    const decoded = await disassembleFunction(bytes, binary, main!.address);
    expect(decoded.instructions.map((instruction) => instruction.mnemonic)).toEqual(['mov', 'ret']);
    const entry = await disassembleFunction(bytes, binary, binary.entryPoint!);
    expect(entry.instructions.some((instruction) => instruction.mnemonic === 'bl')).toBe(true);
    expect(entry.instructions[0]?.target).toBe(main!.address);
  });

  it('parses and disassembles the ELF32 x86 sample', async () => {
    const bytes = load('elf32-x86');
    const binary = parseBinary(bytes);
    expect(binary.arch).toMatchObject({ arch: 'x86', bits: 32 });
    const main = binary.symbols.find((symbol) => symbol.name === 'main');
    const decoded = await disassembleFunction(bytes, binary, main!.address);
    expect(decoded.instructions.map((instruction) => instruction.mnemonic)).toEqual(['mov', 'ret']);
  });

  it('parses and disassembles the PE64 sample', async () => {
    const bytes = load('pe64-x86_64');
    const binary = parseBinary(bytes);
    expect(binary.format).toBe('pe');
    expect(binary.arch.arch).toBe('x86-64');
    const exported = binary.exports.find((item) => item.name === 'main');
    expect(exported).toBeTruthy();
    expect(binary.imports.some((item) => item.library === 'KERNEL32.dll' && item.name === 'ExitProcess')).toBe(true);
    const decoded = await disassembleFunction(bytes, binary, exported!.address);
    expect(decoded.instructions.map((instruction) => instruction.mnemonic)).toEqual(['mov', 'ret']);
    expect(binary.entryPoint).toBe(exported!.address);
  });

  it('parses Mach-O slices and disassembles _main', async () => {
    const bytes = load('macho-fat');
    const binary = parseBinary(bytes);
    expect(binary.format).toBe('macho');
    expect(binary.slices.length).toBe(2);
    const main = binary.symbols.find((symbol) => symbol.name === '_main');
    expect(main?.kind).toBe('function');
    const decoded = await disassembleFunction(bytes.subarray(binary.slices[0]!.offset, binary.slices[0]!.offset + binary.slices[0]!.size), parseBinary(bytes), main!.address);
    expect(decoded.instructions.some((instruction) => instruction.mnemonic === 'ret')).toBe(true);
    const arm = parseBinary(bytes, { sliceOffset: binary.slices[1]!.offset });
    expect(arm.arch.arch).toBe('arm64');
    const armMain = arm.symbols.find((symbol) => symbol.name === '_main');
    const armBytes = bytes.subarray(binary.slices[1]!.offset, binary.slices[1]!.offset + binary.slices[1]!.size);
    const armFn = await disassembleFunction(armBytes, arm, armMain!.address);
    expect(armFn.instructions.map((instruction) => instruction.mnemonic)).toEqual(['mov', 'ret']);
  });
});

describe('malformed input', () => {
  it('rejects a truncated ELF until parse-anyway is requested', () => {
    const bytes = load('elf64-truncated');
    expect(() => parseBinary(bytes)).toThrow(ParseError);
    const partial = parseBinary(bytes, { lenient: true });
    expect(partial.partial).toBe(true);
    expect(partial.format).toBe('elf');
    expect(partial.warnings.length).toBeGreaterThan(0);
  });

  it('keeps a crafted symbol name as text', () => {
    const bytes = load('elf64-xss');
    const binary = parseBinary(bytes);
    const payload = '<img src=x onerror=...>';
    expect(binary.symbols.some((symbol) => symbol.name === payload)).toBe(true);
  });
});
