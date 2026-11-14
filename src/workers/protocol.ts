import type { AnalyzeResult, FunctionIR, FunctionSummary, XrefIR } from '../ir/types';

export type WorkerRequest =
  | { kind: 'analyze'; id: number; buffer: ArrayBuffer; lenient: boolean; sliceOffset: number | null }
  | { kind: 'disassemble'; id: number; address: number }
  | { kind: 'pattern'; id: number; pattern: string }
  | { kind: 'restore'; id: number; buffer: ArrayBuffer; lenient: boolean; sliceOffset: number | null }
  | { kind: 'cancel'; id: number };

export type WorkerResponse =
  | { kind: 'progress'; id: number; phase: string; ratio: number }
  | { kind: 'analyzed'; id: number; result: AnalyzeResult }
  | { kind: 'function'; id: number; fn: FunctionIR; xrefs: XrefIR[]; discovered: FunctionSummary[] }
  | { kind: 'pattern'; id: number; matches: number[] }
  | { kind: 'error'; id: number; message: string; recoverable: boolean }
  | { kind: 'cancelled'; id: number }
  | { kind: 'restored'; id: number };
