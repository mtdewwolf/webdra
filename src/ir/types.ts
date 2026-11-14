/**
 * Intermediate representation shared by the disassembler and the UI.
 * A v2 decompiler should consume FunctionIR and ImageView and return text.
 * The UI does not import Capstone types.
 */

export type BinaryFormat = 'elf' | 'pe' | 'macho';

export type Architecture = 'x86' | 'x86-64' | 'arm' | 'arm64' | 'unknown';

export type Endian = 'little' | 'big';

export interface ArchInfo {
  arch: Architecture;
  bits: 16 | 32 | 64;
  endian: Endian;
}

export interface Region {
  name: string;
  address: number;
  size: number;
  fileOffset: number;
  fileSize: number;
  flags: string[];
  executable: boolean;
  writable: boolean;
  readable: boolean;
}

export type SymbolKind = 'function' | 'object' | 'section' | 'file' | 'other';

export type SymbolBinding = 'local' | 'global' | 'weak' | 'other';

export interface SymbolRecord {
  name: string;
  address: number;
  size: number;
  kind: SymbolKind;
  binding: SymbolBinding;
  section: string;
  imported: boolean;
  exported: boolean;
}

export interface ImportRecord {
  library: string;
  name: string;
  address: number | null;
  ordinal: number | null;
}

export interface ExportRecord {
  name: string;
  address: number;
  ordinal: number | null;
}

export interface HeaderField {
  label: string;
  value: string;
}

export interface MachoSlice {
  offset: number;
  size: number;
  arch: Architecture;
  bits: 16 | 32 | 64;
  cpuType: number;
  label: string;
}

export interface ParsedBinary {
  format: BinaryFormat;
  arch: ArchInfo;
  entryPoint: number | null;
  imageBase: number;
  sections: Region[];
  segments: Region[];
  symbols: SymbolRecord[];
  imports: ImportRecord[];
  exports: ExportRecord[];
  libraries: string[];
  headerFields: HeaderField[];
  slices: MachoSlice[];
  selectedSlice: number;
  warnings: string[];
  partial: boolean;
  fileSize: number;
}

export type FlowKind = 'seq' | 'jump' | 'cjump' | 'call' | 'ret';

export interface InstructionIR {
  address: number;
  size: number;
  bytes: number[];
  mnemonic: string;
  opStr: string;
  flow: FlowKind;
  /** Direct control-flow target, when Capstone printed one. */
  target: number | null;
  /** Address referenced by a RIP-relative or similar data operand. */
  dataTarget: number | null;
  indirect: boolean;
}

export interface BlockEdge {
  address: number;
  kind: 'fallthrough' | 'taken';
}

export interface BasicBlockIR {
  address: number;
  end: number;
  instructionAddresses: number[];
  successors: BlockEdge[];
}

export interface FunctionIR {
  address: number;
  name: string;
  size: number;
  instructions: InstructionIR[];
  blocks: BasicBlockIR[];
}

export interface FunctionSummary {
  address: number;
  name: string;
  demangled: string;
  size: number;
  exported: boolean;
  imported: boolean;
}

export type XrefKind = 'call' | 'jump' | 'data';

export interface XrefIR {
  from: number;
  to: number;
  kind: XrefKind;
}

export type StringEncoding = 'ascii' | 'utf16';

export interface StringIR {
  address: number;
  fileOffset: number;
  text: string;
  encoding: StringEncoding;
  section: string;
}

export interface EntropyIR {
  name: string;
  entropy: number;
  size: number;
}

export interface AnalyzeResult {
  binary: ParsedBinary;
  strings: StringIR[];
  functions: FunctionSummary[];
  entryFunction: FunctionIR | null;
  xrefs: XrefIR[];
  sha256: string;
  sha1: string;
  entropy: EntropyIR[];
  truncatedStrings: boolean;
}

/** Read-only view a future decompiler can use without touching the UI. */
export interface ImageView {
  arch: ArchInfo;
  read(address: number, size: number): Uint8Array | null;
}

export interface DecompiledFunction {
  address: number;
  text: string;
}

export interface Decompiler {
  readonly id: string;
  decompile(fn: FunctionIR, image: ImageView): Promise<DecompiledFunction>;
}

export interface ProjectData {
  version: 1;
  sha256: string;
  renames: Record<string, string>;
  comments: Record<string, string>;
  bookmarks: { address: string; label: string }[];
}

export function assertNever(value: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
}
