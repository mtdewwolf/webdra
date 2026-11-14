/** @vitest-environment jsdom */
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalyzeResult } from '../../src/ir/types';
import type { WorkerResponse } from '../../src/workers/protocol';
import { saveBinary } from '../../src/storage/db';
import { WorkspaceProvider, useWorkspace, type WorkspaceApi } from '../../src/ui/workspace';

const gate = vi.hoisted(() => ({
  resolve: null as ((message: WorkerResponse) => void) | null,
}));

vi.mock('../../src/storage/db', () => ({
  saveBinary: vi.fn(async () => undefined),
  loadProject: vi.fn(async () => null),
  saveProject: vi.fn(async () => undefined),
  deleteAllLocalData: vi.fn(async () => undefined),
  listBinaries: vi.fn(async () => []),
  loadBinary: vi.fn(async () => null),
}));

vi.mock('../../src/ui/client', () => ({
  ANALYSIS_TIMEOUT_MS: 45_000,
  AnalysisClient: class {
    analyze(): Promise<WorkerResponse> {
      return new Promise((resolve) => {
        gate.resolve = resolve;
      });
    }

    hasSession(): boolean {
      return false;
    }

    cancel(): void {}

    fail(): void {}
  },
}));

const analyzed: WorkerResponse = {
  kind: 'analyzed',
  id: 1,
  result: {
    binary: { entryPoint: null },
    strings: [],
    functions: [],
    entryFunction: null,
    xrefs: [],
    sha256: 'ab'.repeat(32),
    sha1: 'cd'.repeat(20),
    entropy: [],
    truncatedStrings: false,
  } as unknown as AnalyzeResult,
};

describe('in-flight persistence', () => {
  beforeEach(() => {
    gate.resolve = null;
    sessionStorage.clear();
    vi.mocked(saveBinary).mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('does not store the binary after Session-only is turned on mid-analysis', async () => {
    const api = await mount();
    act(() => api.setStoreBinary(true));
    const pending = api.openFile(new File([Uint8Array.from([1, 2, 3, 4])], 'sample.bin'));
    await waitFor(() => expect(gate.resolve).toBeTypeOf('function'));
    act(() => api.setSessionOnly(true));
    await finish(pending);
    expect(saveBinary).not.toHaveBeenCalled();
  });

  it('does not store the binary after Keep a local copy is unchecked mid-analysis', async () => {
    const api = await mount();
    act(() => api.setStoreBinary(true));
    const pending = api.openFile(new File([Uint8Array.from([1, 2, 3, 4])], 'sample.bin'));
    await waitFor(() => expect(gate.resolve).toBeTypeOf('function'));
    act(() => api.setStoreBinary(false));
    await finish(pending);
    expect(saveBinary).not.toHaveBeenCalled();
  });

  it('stores the binary when the copy option is still on at completion', async () => {
    const api = await mount();
    act(() => api.setStoreBinary(true));
    const pending = api.openFile(new File([Uint8Array.from([1, 2, 3, 4])], 'sample.bin'));
    await waitFor(() => expect(gate.resolve).toBeTypeOf('function'));
    await finish(pending);
    expect(saveBinary).toHaveBeenCalledTimes(1);
  });
});

function Probe({ onReady }: { onReady: (api: WorkspaceApi) => void }) {
  const api = useWorkspace();
  useEffect(() => {
    onReady(api);
  }, [api, onReady]);
  return null;
}

async function mount(): Promise<WorkspaceApi> {
  let api: WorkspaceApi | null = null;
  render(
    <WorkspaceProvider>
      <Probe onReady={(next) => {
        api = next;
      }}
      />
    </WorkspaceProvider>,
  );
  await waitFor(() => expect(api).not.toBeNull());
  return api!;
}

async function finish(pending: Promise<void>): Promise<void> {
  await act(async () => {
    gate.resolve?.(analyzed);
    await pending;
  });
}
