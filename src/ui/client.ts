import type { WorkerRequest, WorkerResponse } from '../workers/protocol';

interface Pending {
  resolve: (message: WorkerResponse) => void;
  reject: (error: Error) => void;
  onProgress?: (phase: string, ratio: number) => void;
}

export class AnalysisClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor() {
    this.worker = this.spawn();
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
      this.pending.set(id, { resolve, reject, onProgress });
      const message: WorkerRequest = { kind: 'analyze', id, buffer: copy, lenient, sliceOffset };
      this.worker.postMessage(message, [copy]);
    });
  }

  disassemble(address: number): Promise<WorkerResponse> {
    return this.send({ kind: 'disassemble', id: this.nextId++, address });
  }

  pattern(pattern: string): Promise<WorkerResponse> {
    return this.send({ kind: 'pattern', id: this.nextId++, pattern });
  }

  cancel(): void {
    const worker = this.worker;
    for (const [id, pending] of this.pending) pending.resolve({ kind: 'cancelled', id });
    this.pending.clear();
    worker.terminate();
    this.worker = this.spawn();
  }

  private send(message: WorkerRequest): Promise<WorkerResponse> {
    return new Promise((resolve, reject) => {
      this.pending.set(message.id, { resolve, reject });
      this.worker.postMessage(message);
    });
  }

  private spawn(): Worker {
    const worker = new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
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
      for (const [id, pending] of this.pending) {
        pending.reject(new Error('The analysis worker stopped.'));
        this.pending.delete(id);
      }
    };
    return worker;
  }
}
