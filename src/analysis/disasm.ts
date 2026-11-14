import { executableSpan, isExecutableAddress, readVirtual } from '../binary/address';
import type { ArchInfo, FunctionIR, FunctionSummary, InstructionIR, ParsedBinary, XrefIR } from '../ir/types';
import { openEngine, type CsEngine, type CsInstruction } from './capstone';
import { buildCfg } from './cfg';
import { demangle } from './demangle';

export const MAX_INSTRUCTIONS = 4000;

const CONDITIONAL = /^(j(?!mp$)[a-z]+|loop|loope|loopne|b\.[a-z]+|cbz|cbnz|tbz|tbnz)$/;

export async function disassembleFunction(
  bytes: Uint8Array,
  binary: ParsedBinary,
  address: number,
  endLimit?: number,
  engine?: CsEngine | null,
): Promise<FunctionIR> {
  const owned = engine === undefined;
  const active = engine === undefined ? await openEngine(binary.arch, (address & 1) === 1 && binary.arch.arch === 'arm') : engine;
  const start = binary.arch.arch === 'arm' ? address & ~1 : address;
  const span = executableSpan(binary, start);
  const limit = endLimit ?? span?.end ?? start + 0x4000;
  try {
    if (!active) {
      return { address: start, name: `sub_${start.toString(16)}`, size: 0, instructions: [], blocks: [] };
    }
    const decoded = decodeFunction(active, bytes, binary, start, limit);
    const instructions = [...decoded.values()].sort((a, b) => a.address - b.address);
    const size = instructions.length ? (instructions[instructions.length - 1]?.address ?? start) + (instructions[instructions.length - 1]?.size ?? 0) - start : 0;
    return {
      address: start,
      name: `sub_${start.toString(16)}`,
      size,
      instructions,
      blocks: buildCfg(instructions),
    };
  } finally {
    if (owned) active?.close();
  }
}

export function decodeFunction(
  engine: CsEngine,
  bytes: Uint8Array,
  binary: ParsedBinary,
  start: number,
  endLimit: number,
): Map<number, InstructionIR> {
  const instructions = new Map<number, InstructionIR>();
  const queue = [start];
  const queued = new Set<number>([start]);
  while (queue.length && instructions.size < MAX_INSTRUCTIONS) {
    const popped = queue.pop();
    if (popped === undefined) break;
    let address: number = popped;
    while (address < endLimit && instructions.size < MAX_INSTRUCTIONS && !instructions.has(address)) {
      const instruction = decodeOne(engine, bytes, binary, address);
      if (!instruction) break;
      instructions.set(address, instruction);
      const next = address + instruction.size;
      if (instruction.flow === 'ret') break;
      if (instruction.flow === 'jump') {
        enqueue(queue, queued, instruction.target, start, endLimit);
        break;
      }
      if (instruction.flow === 'cjump') {
        enqueue(queue, queued, instruction.target, start, endLimit);
        address = next;
        continue;
      }
      address = next;
    }
  }
  return instructions;
}

export function xrefsFrom(instructions: Iterable<InstructionIR>): XrefIR[] {
  const xrefs: XrefIR[] = [];
  for (const instruction of instructions) {
    if (instruction.flow === 'call' && instruction.target !== null) {
      xrefs.push({ from: instruction.address, to: instruction.target, kind: 'call' });
    } else if ((instruction.flow === 'jump' || instruction.flow === 'cjump') && instruction.target !== null) {
      xrefs.push({ from: instruction.address, to: instruction.target, kind: 'jump' });
    }
    if (instruction.dataTarget !== null) {
      xrefs.push({ from: instruction.address, to: instruction.dataTarget, kind: 'data' });
    }
  }
  return xrefs;
}

export function discoverCalls(binary: ParsedBinary, xrefs: XrefIR[], known: Set<number>): FunctionSummary[] {
  const found: FunctionSummary[] = [];
  for (const xref of xrefs) {
    if (xref.kind !== 'call' || known.has(xref.to) || !isExecutableAddress(binary, xref.to)) continue;
    known.add(xref.to);
    const name = `sub_${xref.to.toString(16)}`;
    found.push({ address: xref.to, name, demangled: name, size: 0, exported: false, imported: false });
  }
  return found;
}

export function functionEnd(binary: ParsedBinary, addresses: number[], start: number): number {
  const span = executableSpan(binary, start);
  let end = span?.end ?? start + 0x2000;
  for (const address of addresses) {
    if (address > start && address < end) end = address;
  }
  return end;
}

function enqueue(queue: number[], queued: Set<number>, target: number | null, start: number, end: number): void {
  if (target === null || target < start || target >= end || queued.has(target)) return;
  queued.add(target);
  queue.push(target);
}

function decodeOne(engine: CsEngine, bytes: Uint8Array, binary: ParsedBinary, address: number): InstructionIR | null {
  const window = readVirtual(bytes, binary, address, 16);
  if (!window || window.length === 0) return null;
  let decoded: CsInstruction[] = [];
  try {
    decoded = engine.disasm(window, address);
  } catch {
    return null;
  }
  const first = decoded[0];
  if (!first || Number(first.address) !== address || first.size <= 0 || first.size > window.length) return null;
  return toInstruction(first);
}

export function toInstruction(instruction: CsInstruction): InstructionIR {
  const address = Number(instruction.address);
  const size = instruction.size;
  const bytes = instruction.bytes.slice(0, size).map((value) => value & 0xff);
  const mnemonic = instruction.mnemonic || 'invalid';
  const opStr = instruction.op_str || '';
  const flow = classify(mnemonic);
  const target = flow === 'seq' || flow === 'ret' ? null : absoluteTarget(opStr);
  return {
    address,
    size,
    bytes,
    mnemonic,
    opStr,
    flow,
    target,
    dataTarget: ripTarget(opStr, address, size),
    indirect: (flow === 'call' || flow === 'jump' || flow === 'cjump') && target === null,
  };
}

function classify(mnemonic: string): InstructionIR['flow'] {
  const name = mnemonic.toLowerCase();
  if (name === 'ret' || name === 'retq' || name === 'retf' || name.startsWith('ret ')) return 'ret';
  if (name === 'call' || name === 'bl' || name === 'blr') return 'call';
  if (name === 'jmp' || name === 'b' || name === 'br') return 'jump';
  if (CONDITIONAL.test(name)) return 'cjump';
  return 'seq';
}

function absoluteTarget(opStr: string): number | null {
  if (/\[rip\b/.test(opStr)) return null;
  const matches = [...opStr.matchAll(/#?(0x[0-9a-fA-F]+)\b/g)];
  const last = matches[matches.length - 1]?.[1];
  if (!last) return null;
  const value = Number(BigInt(last));
  return Number.isSafeInteger(value) ? value : null;
}

function ripTarget(opStr: string, address: number, size: number): number | null {
  const match = opStr.match(/\[rip\s*([+-])\s*(0x[0-9a-fA-F]+|\d+)\]/);
  if (!match) return null;
  const raw = match[2] ?? '0';
  const displacement = raw.startsWith('0x') ? Number(BigInt(raw)) : Number(raw);
  const signed = match[1] === '-' ? -displacement : displacement;
  return address + size + signed;
}

export function archLabel(arch: ArchInfo): string {
  return `${arch.arch} ${arch.bits}-bit ${arch.endian}`;
}

export { demangle };
