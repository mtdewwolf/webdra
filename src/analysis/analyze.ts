import { assertFileSize, isExecutableAddress } from '../binary/address';
import { ParseError, parseBinary } from '../binary/parse';
import type { AnalyzeResult, FunctionIR, FunctionSummary, ParsedBinary, XrefIR } from '../ir/types';
import { openEngine, type CsEngine } from './capstone';
import { demangle } from './demangle';
import { disassembleFunction, discoverCalls, functionEnd, xrefsFrom } from './disasm';
import { sectionEntropy } from './entropy';
import { digestHex } from './hash';
import { extractStrings } from './strings';

export interface AnalyzeOptions {
  lenient?: boolean;
  sliceOffset?: number | null;
  onProgress?: (phase: string, ratio: number) => void;
  signal?: { aborted: boolean };
}

export class AnalysisCancelled extends Error {
  constructor() {
    super('Analysis cancelled');
    this.name = 'AnalysisCancelled';
  }
}

export async function analyzeImage(bytes: Uint8Array, options: AnalyzeOptions = {}): Promise<AnalyzeResult> {
  assertFileSize(bytes.length);
  const progress = options.onProgress ?? (() => undefined);
  progress('Hashing', 0.08);
  throwIfAborted(options.signal);
  const sha256 = await digestHex('SHA-256', bytes);
  const sha1 = await digestHex('SHA-1', bytes);
  progress('Parsing headers', 0.25);
  throwIfAborted(options.signal);
  const binary = parseBinary(bytes, { lenient: options.lenient, sliceOffset: options.sliceOffset });
  progress('Scanning strings', 0.45);
  throwIfAborted(options.signal);
  const extracted = extractStrings(bytes, binary, 4);
  const entropy = sectionEntropy(bytes, binary);
  progress('Discovering functions', 0.62);
  const functions = seedFunctions(binary);
  const known = new Set(functions.map((item) => item.address));
  let entryFunction: FunctionIR | null = null;
  const xrefs: XrefIR[] = [];
  const engine = await openEngine(binary.arch, false);
  try {
    if (engine && binary.entryPoint !== null && isExecutableAddress(binary, binary.entryPoint)) {
      progress('Disassembling entry', 0.8);
      throwIfAborted(options.signal);
      entryFunction = await disassembleOwned(engine, bytes, binary, binary.entryPoint, functionEnd(binary, [...known], binary.entryPoint));
      const entryXrefs = xrefsFrom(entryFunction.instructions);
      xrefs.push(...entryXrefs);
      functions.push(...discoverCalls(binary, entryXrefs, known));
    }
  } finally {
    engine?.close();
  }
  xrefs.push(...scanStringAddresses(bytes, binary, extracted.strings));
  progress('Done', 1);
  return {
    binary,
    strings: extracted.strings,
    functions: dedupeFunctions(functions),
    entryFunction,
    xrefs: dedupeXrefs(xrefs),
    sha256,
    sha1,
    entropy,
    truncatedStrings: extracted.truncated,
  };
}

export async function disassembleAt(
  engine: CsEngine,
  bytes: Uint8Array,
  binary: ParsedBinary,
  functions: FunctionSummary[],
  address: number,
): Promise<{ fn: FunctionIR; xrefs: XrefIR[]; discovered: FunctionSummary[] }> {
  const start = binary.arch.arch === 'arm' ? address & ~1 : address;
  const known = new Set(functions.map((item) => item.address));
  const fn = await disassembleOwned(engine, bytes, binary, start, functionEnd(binary, [...known], start));
  const summary = functions.find((item) => item.address === start);
  fn.name = summary?.demangled || summary?.name || fn.name;
  const xrefs = xrefsFrom(fn.instructions);
  return { fn, xrefs, discovered: discoverCalls(binary, xrefs, known) };
}

async function disassembleOwned(
  engine: CsEngine,
  bytes: Uint8Array,
  binary: ParsedBinary,
  address: number,
  end: number,
): Promise<FunctionIR> {
  return disassembleFunction(bytes, binary, address, end, engine);
}

export function seedFunctions(binary: ParsedBinary): FunctionSummary[] {
  const byAddress = new Map<number, FunctionSummary>();
  const add = (address: number, name: string, exported: boolean, imported: boolean, size: number) => {
    if (!Number.isFinite(address) || imported || !isExecutableAddress(binary, address)) return;
    const current = byAddress.get(address);
    const demangled = demangle(name);
    if (!current || (current.name.startsWith('sub_') && name && !name.startsWith('sub_'))) {
      byAddress.set(address, { address, name: name || current?.name || `sub_${address.toString(16)}`, demangled, size, exported, imported: false });
    } else if (exported) {
      current.exported = true;
    }
  };
  for (const symbol of binary.symbols) {
    if (symbol.kind === 'function' && symbol.name) add(symbol.address, symbol.name, symbol.exported, symbol.imported, symbol.size);
  }
  for (const item of binary.exports) {
    if (item.name && isExecutableAddress(binary, item.address)) add(item.address, item.name, true, false, 0);
  }
  if (binary.entryPoint !== null) {
    const existing = byAddress.get(binary.entryPoint);
    if (!existing) add(binary.entryPoint, 'entry', false, false, 0);
  }
  return [...byAddress.values()].sort((a, b) => a.address - b.address);
}

function dedupeFunctions(functions: FunctionSummary[]): FunctionSummary[] {
  const byAddress = new Map<number, FunctionSummary>();
  for (const item of functions) {
    const current = byAddress.get(item.address);
    if (!current || current.name.startsWith('sub_') || current.name === 'entry') byAddress.set(item.address, item);
  }
  return [...byAddress.values()].sort((a, b) => a.address - b.address);
}

function dedupeXrefs(xrefs: XrefIR[]): XrefIR[] {
  const seen = new Set<string>();
  const unique: XrefIR[] = [];
  for (const xref of xrefs) {
    const key = `${xref.kind}:${xref.from}:${xref.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(xref);
  }
  return unique;
}

function scanStringAddresses(bytes: Uint8Array, binary: ParsedBinary, strings: { address: number }[]): XrefIR[] {
  if (!strings.length) return [];
  const targets = new Map<number, number>();
  for (const item of strings) targets.set(item.address, item.address);
  const width = binary.arch.bits === 64 ? 8 : 4;
  const xrefs: XrefIR[] = [];
  for (const section of binary.sections) {
    if (!section.executable || section.fileSize < width) continue;
    const start = section.fileOffset;
    const end = Math.min(bytes.length, section.fileOffset + section.fileSize) - width;
    for (let offset = start; offset <= end; offset += 1) {
      const value = readUnsigned(bytes, offset, width);
      const hit = targets.get(value);
      if (hit === undefined) continue;
      xrefs.push({ from: section.address + (offset - section.fileOffset), to: hit, kind: 'data' });
      if (xrefs.length > 50000) return xrefs;
    }
  }
  return xrefs;
}

function readUnsigned(bytes: Uint8Array, offset: number, width: number): number {
  let value = 0;
  for (let index = 0; index < width; index += 1) value += (bytes[offset + index] ?? 0) * 2 ** (8 * index);
  return value;
}

function throwIfAborted(signal: { aborted: boolean } | undefined): void {
  if (signal?.aborted) throw new AnalysisCancelled();
}

export { ParseError };
