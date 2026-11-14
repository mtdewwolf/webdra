import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { addressKey } from '../analysis/format';
import { vaForFileOffset, fileOffsetForVa, assertFileSize } from '../binary/address';
import type { AnalyzeResult, FunctionIR, FunctionSummary, ParsedBinary, ProjectData, StringIR, XrefIR } from '../ir/types';
import { deleteAllLocalData, listBinaries, loadBinary, loadProject, saveBinary, saveProject } from '../storage/db';
import { parseProjectFile } from '../storage/projectFile';
import { AnalysisClient } from './client';
import { pushHistory, stepHistory } from './history';

export interface WorkspaceState {
  phase: 'empty' | 'running' | 'ready' | 'error';
  fileLabel: string;
  bytes: Uint8Array | null;
  sha256: string;
  sha1: string;
  binary: ParsedBinary | null;
  strings: StringIR[];
  functions: FunctionSummary[];
  loaded: Record<string, FunctionIR>;
  xrefs: XrefIR[];
  entropy: AnalyzeResult['entropy'];
  truncatedStrings: boolean;
  progress: { phase: string; ratio: number } | null;
  error: string;
  recoverable: boolean;
  lenient: boolean;
  sliceOffset: number | null;
  selectedVa: number | null;
  selectedFileOff: number | null;
  history: number[];
  historyIndex: number;
  renames: Record<string, string>;
  comments: Record<string, string>;
  bookmarks: ProjectData['bookmarks'];
  sessionOnly: boolean;
  storeBinary: boolean;
  fontScale: number;
  contrast: boolean;
  notice: string;
}

const initialState: WorkspaceState = {
  phase: 'empty',
  fileLabel: '',
  bytes: null,
  sha256: '',
  sha1: '',
  binary: null,
  strings: [],
  functions: [],
  loaded: {},
  xrefs: [],
  entropy: [],
  truncatedStrings: false,
  progress: null,
  error: '',
  recoverable: false,
  lenient: false,
  sliceOffset: null,
  selectedVa: null,
  selectedFileOff: null,
  history: [],
  historyIndex: -1,
  renames: {},
  comments: {},
  bookmarks: [],
  sessionOnly: false,
  storeBinary: false,
  fontScale: 1,
  contrast: false,
  notice: '',
};

interface WorkspaceApi {
  state: WorkspaceState;
  openFile: (file: File, lenient?: boolean) => Promise<void>;
  cancel: () => void;
  parseAnyway: () => Promise<void>;
  selectSlice: (offset: number) => Promise<void>;
  selectVa: (address: number, recordHistory?: boolean) => void;
  selectFileOffset: (offset: number) => void;
  back: () => void;
  forward: () => void;
  ensureFunction: (address: number) => Promise<void>;
  rename: (address: number, name: string) => void;
  comment: (address: number, text: string) => void;
  bookmark: (address: number) => void;
  removeBookmark: (address: number) => void;
  setSessionOnly: (value: boolean) => void;
  setStoreBinary: (value: boolean) => void;
  setFontScale: (value: number) => void;
  setContrast: (value: boolean) => void;
  wipe: () => Promise<void>;
  exportProject: () => void;
  importProject: (file: File) => Promise<void>;
  searchPattern: (pattern: string) => Promise<number[]>;
  reloadStored: (sha256: string) => Promise<void>;
  storedCopies: () => Promise<{ sha256: string; savedAt: number }[]>;
}

const WorkspaceContext = createContext<WorkspaceApi | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WorkspaceState>(() => ({
    ...initialState,
    fontScale: readNumber('webdra.font', 1),
    contrast: localStorage.getItem('webdra.contrast') === '1',
    sessionOnly: sessionStorage.getItem('webdra.session') === '1',
  }));
  const client = useRef<AnalysisClient | null>(null);
  const generation = useRef(0);
  const bytesRef = useRef<ArrayBuffer | null>(null);
  const prefsRef = useRef({
    sessionOnly: sessionStorage.getItem('webdra.session') === '1',
    storeBinary: false,
  });
  if (!client.current) client.current = new AnalysisClient();

  useEffect(() => {
    document.documentElement.style.setProperty('--font-scale', String(state.fontScale));
    document.documentElement.dataset.contrast = state.contrast ? 'high' : 'normal';
    localStorage.setItem('webdra.font', String(state.fontScale));
    localStorage.setItem('webdra.contrast', state.contrast ? '1' : '0');
  }, [state.fontScale, state.contrast]);

  const persist = useCallback((next: WorkspaceState) => {
    if (next.sessionOnly || !next.sha256) return;
    const project: ProjectData = {
      version: 1,
      sha256: next.sha256,
      renames: next.renames,
      comments: next.comments,
      bookmarks: next.bookmarks,
    };
    void saveProject(project).catch(() => {
      setState((current) => ({ ...current, notice: 'Could not save notes in this browser.' }));
    });
  }, []);

  const applyResult = useCallback((result: AnalyzeResult, fileLabel: string, project: ProjectData | null) => {
    const loaded: Record<string, FunctionIR> = {};
    let selected: number | null = result.binary.entryPoint;
    if (result.entryFunction) {
      loaded[addressKey(result.entryFunction.address)] = result.entryFunction;
      selected = result.entryFunction.address;
    }
    const history = selected === null ? [] : [selected];
    setState((current) => ({
      ...current,
      phase: 'ready',
      fileLabel,
      sha256: result.sha256,
      sha1: result.sha1,
      binary: result.binary,
      strings: result.strings,
      functions: result.functions,
      loaded,
      xrefs: result.xrefs,
      entropy: result.entropy,
      truncatedStrings: result.truncatedStrings,
      progress: null,
      error: '',
      recoverable: false,
      selectedVa: selected,
      selectedFileOff: result.binary && selected !== null ? fileOffsetForVa(result.binary, selected) : null,
      history,
      historyIndex: history.length - 1,
      renames: project?.renames ?? {},
      comments: project?.comments ?? {},
      bookmarks: project?.bookmarks ?? [],
      notice: current.sessionOnly ? 'Session-only mode: nothing from this file is written to disk.' : 'Notes for this file are stored only in this browser.',
    }));
  }, []);

  const openBuffer = useCallback(
    async (buffer: ArrayBuffer, fileLabel: string, lenient: boolean, sliceOffset: number | null) => {
      try {
        assertFileSize(buffer.byteLength);
      } catch (error) {
        setState((current) => ({
          ...current,
          phase: 'error',
          error: error instanceof Error ? error.message : 'File is too large',
          recoverable: false,
        }));
        return;
      }
      const id = ++generation.current;
      bytesRef.current = buffer;
      setState((current) => ({
        ...current,
        phase: 'running',
        fileLabel,
        bytes: new Uint8Array(buffer),
        error: '',
        recoverable: false,
        lenient,
        sliceOffset,
        progress: { phase: 'Starting', ratio: 0.02 },
      }));
      const response = await client.current!.analyze(buffer, lenient, sliceOffset, (phase, ratio) => {
        if (generation.current !== id) return;
        setState((current) => ({ ...current, progress: { phase, ratio } }));
      });
      if (generation.current !== id) return;
      if (response.kind === 'cancelled') {
        setState((current) => ({ ...current, phase: current.binary ? 'ready' : 'empty', progress: null, error: '' }));
        return;
      }
      if (response.kind === 'error') {
        setState((current) => ({ ...current, phase: 'error', progress: null, error: response.message, recoverable: response.recoverable }));
        return;
      }
      if (response.kind !== 'analyzed') return;
      let project: ProjectData | null = null;
      if (!prefsRef.current.sessionOnly) {
        try {
          project = await loadProject(response.result.sha256);
        } catch {
          project = null;
        }
      }
      if (generation.current !== id) return;
      if (prefsRef.current.sessionOnly) project = null;
      applyResult(response.result, fileLabel, project);
      if (!prefsRef.current.sessionOnly && prefsRef.current.storeBinary) {
        void saveBinary({ sha256: response.result.sha256, bytes: buffer.slice(0), savedAt: Date.now() }).catch(() => {
          prefsRef.current.storeBinary = false;
          setState((current) => ({ ...current, storeBinary: false, notice: 'The browser refused to store a local copy (quota).' }));
        });
      }
    },
    [applyResult],
  );

  const openFile = useCallback(
    async (file: File, lenient = false) => {
      const buffer = await file.arrayBuffer();
      await openBuffer(buffer, file.name, lenient, null);
    },
    [openBuffer],
  );

  const api = useMemo<WorkspaceApi>(() => {
    const selectVa = (address: number, recordHistory = true) => {
      setState((current) => {
        const moved = recordHistory ? pushHistory(current.history, current.historyIndex, address) : { history: current.history, index: current.historyIndex };
        return {
          ...current,
          selectedVa: address,
          selectedFileOff: current.binary ? fileOffsetForVa(current.binary, address) : current.selectedFileOff,
          history: moved.history,
          historyIndex: moved.index,
        };
      });
    };
    return {
      state,
      openFile,
      cancel: () => {
        generation.current += 1;
        client.current?.cancel();
        setState((current) => ({ ...current, phase: current.binary ? 'ready' : 'empty', progress: null }));
      },
      parseAnyway: async () => {
        const buffer = bytesRef.current;
        if (!buffer) return;
        await openBuffer(buffer.slice(0), state.fileLabel, true, state.sliceOffset);
      },
      selectSlice: async (offset: number) => {
        const buffer = bytesRef.current;
        if (!buffer) return;
        await openBuffer(buffer.slice(0), state.fileLabel, state.lenient, offset);
      },
      selectVa,
      selectFileOffset: (offset: number) => {
        setState((current) => {
          const va = current.binary ? vaForFileOffset(current.binary, offset) : null;
          const moved = va !== null ? pushHistory(current.history, current.historyIndex, va) : { history: current.history, index: current.historyIndex };
          return { ...current, selectedFileOff: offset, selectedVa: va ?? current.selectedVa, history: moved.history, historyIndex: moved.index };
        });
      },
      back: () => {
        setState((current) => {
          const index = stepHistory(current.history, current.historyIndex, -1);
          const address = current.history[index];
          if (address === undefined) return current;
          return {
            ...current,
            historyIndex: index,
            selectedVa: address,
            selectedFileOff: current.binary ? fileOffsetForVa(current.binary, address) : null,
          };
        });
      },
      forward: () => {
        setState((current) => {
          const index = stepHistory(current.history, current.historyIndex, 1);
          const address = current.history[index];
          if (address === undefined) return current;
          return {
            ...current,
            historyIndex: index,
            selectedVa: address,
            selectedFileOff: current.binary ? fileOffsetForVa(current.binary, address) : null,
          };
        });
      },
      ensureFunction: async (address: number) => {
        const key = addressKey(address);
        if (state.loaded[key]) return;
        const response = await client.current!.disassemble(address);
        if (response.kind !== 'function') return;
        setState((current) => {
          const functions = [...current.functions];
          for (const discovered of response.discovered) {
            if (!functions.some((item) => item.address === discovered.address)) functions.push(discovered);
          }
          functions.sort((a, b) => a.address - b.address);
          const xrefs = dedupe([...current.xrefs, ...response.xrefs]);
          return { ...current, functions, xrefs, loaded: { ...current.loaded, [key]: response.fn } };
        });
      },
      rename: (address, name) => {
        setState((current) => {
          const renames = { ...current.renames, [addressKey(address)]: name.trim() };
          const next = { ...current, renames };
          persist(next);
          return next;
        });
      },
      comment: (address, text) => {
        setState((current) => {
          const comments = { ...current.comments };
          const trimmed = text.trim();
          if (trimmed) comments[addressKey(address)] = trimmed;
          else delete comments[addressKey(address)];
          const next = { ...current, comments };
          persist(next);
          return next;
        });
      },
      bookmark: (address) => {
        setState((current) => {
          const key = addressKey(address);
          if (current.bookmarks.some((item) => item.address === key)) return current;
          const bookmarks = [...current.bookmarks, { address: key, label: `bookmark ${key}` }];
          const next = { ...current, bookmarks };
          persist(next);
          return next;
        });
      },
      removeBookmark: (address) => {
        setState((current) => {
          const bookmarks = current.bookmarks.filter((item) => item.address !== addressKey(address));
          const next = { ...current, bookmarks };
          persist(next);
          return next;
        });
      },
      setSessionOnly: (value) => {
        prefsRef.current.sessionOnly = value;
        if (value) prefsRef.current.storeBinary = false;
        sessionStorage.setItem('webdra.session', value ? '1' : '0');
        setState((current) => ({
          ...current,
          sessionOnly: value,
          storeBinary: value ? false : current.storeBinary,
          notice: value ? 'Session-only mode is on. Nothing is written to IndexedDB.' : 'Notes can be saved in this browser again.',
        }));
      },
      setStoreBinary: (value) => {
        const enabled = value && !prefsRef.current.sessionOnly;
        prefsRef.current.storeBinary = enabled;
        setState((current) => ({ ...current, storeBinary: enabled }));
        if (enabled && bytesRef.current && state.sha256) {
          void saveBinary({ sha256: state.sha256, bytes: bytesRef.current.slice(0), savedAt: Date.now() }).catch(() => {
            prefsRef.current.storeBinary = false;
            setState((current) => ({ ...current, storeBinary: false, notice: 'The browser refused to store a local copy.' }));
          });
        }
      },
      setFontScale: (value) => setState((current) => ({ ...current, fontScale: Math.min(1.6, Math.max(0.8, value)) })),
      setContrast: (value) => setState((current) => ({ ...current, contrast: value })),
      wipe: async () => {
        try {
          await deleteAllLocalData();
        } catch (error) {
          setState((current) => ({
            ...current,
            notice: error instanceof Error ? error.message : 'Could not delete local data.',
          }));
          return;
        }
        prefsRef.current = { sessionOnly: false, storeBinary: false };
        bytesRef.current = null;
        setState({ ...initialState, notice: 'Webdra notes, bookmarks, and optional file copies were deleted.' });
      },
      exportProject: () => {
        if (!state.sha256) return;
        const project: ProjectData = {
          version: 1,
          sha256: state.sha256,
          renames: state.renames,
          comments: state.comments,
          bookmarks: state.bookmarks,
        };
        const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'webdra-project.json';
        link.click();
        URL.revokeObjectURL(url);
      },
      importProject: async (file: File) => {
        let parsed: ProjectData;
        try {
          parsed = parseProjectFile(JSON.parse(await file.text()) as unknown, state.sha256 || null);
        } catch (error) {
          setState((current) => ({
            ...current,
            notice: error instanceof Error ? error.message : 'Could not import notes.',
          }));
          return;
        }
        if (!prefsRef.current.sessionOnly) {
          try {
            await saveProject(parsed);
          } catch {
            setState((current) => ({ ...current, notice: 'Could not save imported notes in this browser.' }));
            return;
          }
        }
        setState((current) => ({
          ...current,
          renames: parsed.renames,
          comments: parsed.comments,
          bookmarks: parsed.bookmarks,
          notice: 'Project notes imported.',
        }));
      },
      searchPattern: async (pattern: string) => {
        const response = await client.current!.pattern(pattern);
        if (response.kind === 'error') throw new Error(response.message);
        if (response.kind !== 'pattern') return [];
        return response.matches;
      },
      reloadStored: async (sha256: string) => {
        const record = await loadBinary(sha256);
        if (!record) return;
        await openBuffer(record.bytes.slice(0), 'local copy', false, null);
      },
      storedCopies: () => listBinaries(),
    };
  }, [openBuffer, openFile, persist, state]);

  return <WorkspaceContext.Provider value={api}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceApi {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('Workspace is unavailable');
  return value;
}

function dedupe(xrefs: XrefIR[]): XrefIR[] {
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

function readNumber(key: string, fallback: number): number {
  const raw = localStorage.getItem(key);
  const value = raw ? Number(raw) : fallback;
  return Number.isFinite(value) ? value : fallback;
}
