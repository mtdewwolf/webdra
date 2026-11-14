import type { WorkerRequest, WorkerResponse } from '../workers/protocol';

interface Pending {
  resolve: (message: WorkerResponse) => void;
  reject: (error: Error) => void;
  onProgress?: (phase: string, ratio: number) => void;
}

interface LastGood {
  buffer: ArrayBuffer;
  lenient: boolean;
  sliceOffset: number | null;
}

export const ANALYSIS_TIMEOUT_MS = 45_000;

export class AnalysisClient {
  private worker: Worker;
  private generation = 0;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private lastGood: LastGood | null = null;
  private restoring = false;

  constructor() {
    this.worker = this.spawn();
  }

  hasSession(): boolean {
    return this.lastGood !== null;
  }

  analyze(
    buffer: ArrayBuffer,
    lenient: boolean,
    sliceOffset: number | null,
    onProgress?: (phase: string, ratio: number) => void,
  ): Promise<WorkerResponse> {
    const id = this.nextId++;
    const copy = buffer.slice(0);
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: (message) => {
          if (message.kind === 'analyzed') this.lastGood = { buffer: buffer.slice(0), lenient, sliceOffset };
          resolve(message);
        },
        reject,
        onProgress,
      });
      try {
        this.worker.postMessage({ kind: 'analyze', id, buffer: copy, lenient, sliceOffset } satisfies WorkerRequest, [copy]);
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error('Could not start analysis'));
      }
    });
  }

  disassemble(address: number): Promise<WorkerResponse> {
    return this.send({ kind: 'disassemble', id: this.nextId++, address });
  }

  pattern(pattern: string): Promise<WorkerResponse> {
    return this.send({ kind: 'pattern', id: this.nextId++, pattern });
  }

  cancel(): void {
    this.settlePending('cancelled');
    this.respawn();
  }

  fail(message: string): void {
    this.settlePending('error', message);
    this.respawn();
  }

  private settlePending(kind: 'cancelled' | 'error', message = 'Analysis cancelled'): void {
    for (const [id, pending] of this.pending) {
      if (kind === 'cancelled') pending.resolve({ kind: 'cancelled', id });
      else pending.reject(new Error(message));
    }
    this.pending.clear();
  }

  private respawn(): void {
    const previous = this.worker;
    this.worker = this.spawn();
    previous.terminate();
    this.restore();
  }

  private restore(): void {
    const last = this.lastGood;
    if (!last) return;
    this.restoring = true;
    const id = this.nextId++;
    const copy = last.buffer.slice(0);
    try {
      this.worker.postMessage(
        { kind: 'restore', id, buffer: copy, lenient: last.lenient, sliceOffset: last.sliceOffset } satisfies WorkerRequest,
        [copy],
      );
    } catch {
      this.restoring = false;
      this.lastGood = null;
    }
  }

  private send(message: WorkerRequest): Promise<WorkerResponse> {
    return new Promise((resolve, reject) => {
      this.pending.set(message.id, { resolve, reject });
      try {
        this.worker.postMessage(message);
      } catch (error) {
        this.pending.delete(message.id);
        reject(error instanceof Error ? error : new Error('The analysis worker is unavailable'));
      }
    });
  }

  private spawn(): Worker {
    const generation = ++this.generation;
    const worker = new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (generation !== this.generation) return;
      const message = event.data;
      if (message.kind === 'restored') {
        this.restoring = false;
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      if (message.kind === 'progress') {
        pending.onProgress?.(message.phase, message.ratio);
        return;
      }
      this.pending.delete(message.id);
      pending.resolve(message);
    };
    worker.onerror = () => {
      if (generation !== this.generation) return;
      if (this.restoring) {
        this.restoring = false;
        this.lastGood = null;
        return;
      }
      this.settlePending('error', 'The analysis worker stopped.');
      this.worker = this.spawn();
      this.restore();
    };
    return worker;
  }
}
