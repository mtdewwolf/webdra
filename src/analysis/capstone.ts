import type { ArchInfo } from '../ir/types';

export interface CsInstruction {
  address: number | bigint;
  size: number;
  bytes: number[];
  mnemonic: string;
  op_str: string;
}

export interface CsEngine {
  option(option: number, value: number): void;
  disasm(buffer: Uint8Array, address: number): CsInstruction[];
  close(): void;
}

export interface CsNamespace {
  ARCH_ARM: number;
  ARCH_ARM64: number;
  ARCH_X86: number;
  MODE_LITTLE_ENDIAN: number;
  MODE_ARM: number;
  MODE_THUMB: number;
  MODE_32: number;
  MODE_64: number;
  OPT_SYNTAX: number;
  OPT_SYNTAX_INTEL: number;
  Capstone: new (arch: number, mode: number) => CsEngine;
}

type Factory = (options?: { locateFile?: (path: string) => string }) => Promise<CsNamespace>;

let factoryPromise: Promise<Factory> | null = null;

export async function loadCapstone(): Promise<CsNamespace> {
  const factory = await loadFactory();
  const options: { locateFile?: (path: string) => string } = {};
  const scope = globalThis as { location?: Location };
  if (scope.location && /^https?:$/.test(scope.location.protocol)) {
    options.locateFile = (path) => new URL(`${import.meta.env.BASE_URL}${path}`, scope.location?.href).href;
  }
  return factory(options);
}

async function loadFactory(): Promise<Factory> {
  if (!factoryPromise) {
    factoryPromise = import('@alexaltea/capstone-js').then((mod) => {
      const record = mod as { default?: Factory };
      return record.default ?? (mod as unknown as Factory);
    });
  }
  return factoryPromise;
}

export async function openEngine(arch: ArchInfo, thumb = false): Promise<CsEngine | null> {
  if (arch.arch === 'unknown') return null;
  const cs = await loadCapstone();
  const pair = modeFor(cs, arch, thumb);
  if (!pair) return null;
  const engine = new cs.Capstone(pair.arch, pair.mode);
  try {
    engine.option(cs.OPT_SYNTAX, cs.OPT_SYNTAX_INTEL);
  } catch {
    // Intel syntax is unavailable in some builds; mnemonics still decode.
  }
  return engine;
}

function modeFor(cs: CsNamespace, arch: ArchInfo, thumb: boolean): { arch: number; mode: number } | null {
  if (arch.arch === 'x86') return { arch: cs.ARCH_X86, mode: cs.MODE_32 };
  if (arch.arch === 'x86-64') return { arch: cs.ARCH_X86, mode: cs.MODE_64 };
  if (arch.arch === 'arm64') return { arch: cs.ARCH_ARM64, mode: cs.MODE_LITTLE_ENDIAN };
  if (arch.arch === 'arm') return { arch: cs.ARCH_ARM, mode: thumb ? cs.MODE_THUMB : cs.MODE_ARM };
  return null;
}
