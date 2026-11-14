import { AnalysisCancelled, analyzeImage, disassembleAt } from '../analysis/analyze';
import { parseBytePattern, searchBytePattern } from '../analysis/pattern';
import { openEngine, type CsEngine } from '../analysis/capstone';
import { ParseError } from '../binary/parse';
import type { FunctionSummary, ParsedBinary } from '../ir/types';
import type { WorkerRequest, WorkerResponse } from './protocol';

interface Session {
  bytes: Uint8Array;
  binary: ParsedBinary;
  engine: CsEngine | null;
  functions: FunctionSummary[];
}

let session: Session | null = null;
let activeId = 0;

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse) => void;
};

scope.onmessage = (event) => {
  const message = event.data;
  if (message.kind === 'cancel') {
    activeId = message.id;
    scope.postMessage({ kind: 'cancelled', id: message.id });
    return;
  }
  if (message.kind === 'analyze') {
    activeId = message.id;
    void runAnalyze(message.id, message.buffer, message.lenient, message.sliceOffset);
    return;
  }
  if (message.kind === 'disassemble') {
    void runDisassemble(message.id, message.address);
    return;
  }
  if (message.kind === 'pattern') {
    runPattern(message.id, message.pattern);
  }
};

async function runAnalyze(id: number, buffer: ArrayBuffer, lenient: boolean, sliceOffset: number | null): Promise<void> {
  const signal = { aborted: false };
  const timer = setInterval(() => {
    signal.aborted = id !== activeId;
  }, 30);
  try {
    session?.engine?.close();
    session = null;
    const bytes = new Uint8Array(buffer);
    const result = await analyzeImage(bytes, {
      lenient,
      sliceOffset,
      signal,
      onProgress: (phase, ratio) => {
        if (id === activeId) scope.postMessage({ kind: 'progress', id, phase, ratio });
      },
    });
    if (id !== activeId) {
      scope.postMessage({ kind: 'cancelled', id });
      return;
    }
    const engine = await openEngine(result.binary.arch, false);
    session = { bytes, binary: result.binary, engine, functions: result.functions };
    scope.postMessage({ kind: 'analyzed', id, result });
  } catch (error) {
    if (id !== activeId || error instanceof AnalysisCancelled) {
      scope.postMessage({ kind: 'cancelled', id });
      return;
    }
    scope.postMessage({
      kind: 'error',
      id,
      message: error instanceof Error ? error.message : 'Analysis failed',
      recoverable: error instanceof ParseError ? error.recoverable : false,
    });
  } finally {
    clearInterval(timer);
  }
}

async function runDisassemble(id: number, address: number): Promise<void> {
  if (!session?.engine) {
    scope.postMessage({ kind: 'error', id, message: 'Open a file before disassembling.', recoverable: false });
    return;
  }
  try {
    const outcome = await disassembleAt(session.engine, session.bytes, session.binary, session.functions, address);
    session.functions.push(...outcome.discovered);
    scope.postMessage({ kind: 'function', id, fn: outcome.fn, xrefs: outcome.xrefs, discovered: outcome.discovered });
  } catch (error) {
    scope.postMessage({
      kind: 'error',
      id,
      message: error instanceof Error ? error.message : 'Disassembly failed',
      recoverable: false,
    });
  }
}

function runPattern(id: number, pattern: string): void {
  if (!session) {
    scope.postMessage({ kind: 'error', id, message: 'Open a file before searching.', recoverable: false });
    return;
  }
  try {
    const parsed = parseBytePattern(pattern);
    scope.postMessage({ kind: 'pattern', id, matches: searchBytePattern(session.bytes, parsed) });
  } catch (error) {
    scope.postMessage({
      kind: 'error',
      id,
      message: error instanceof Error ? error.message : 'Pattern search failed',
      recoverable: false,
    });
  }
}
