import { useEffect, useMemo, useState, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { fuzzyFilter } from '../analysis/fuzzy';
import { formatAddress } from '../analysis/format';
import { CfgPane, DisassemblyPane, FunctionPane, HeadersPane, HexPane, MetadataPane, StringsPane, XrefsPane } from './views';
import { useWorkspace } from './workspace';

type PanelId = 'hex' | 'strings' | 'cfg' | 'headers' | 'metadata' | 'xrefs';
type Dialog = 'goto' | 'rename' | 'comment' | 'pattern' | 'help' | 'wipe' | null;

const PANELS: { id: PanelId; label: string }[] = [
  { id: 'hex', label: 'Hex' },
  { id: 'strings', label: 'Strings' },
  { id: 'cfg', label: 'Graph' },
  { id: 'headers', label: 'Headers' },
  { id: 'metadata', label: 'Metadata' },
  { id: 'xrefs', label: 'Xrefs' },
];

export function Shell() {
  const workspace = useWorkspace();
  const { state } = workspace;
  const [side, setSide] = useState<PanelId[]>(['metadata', 'headers', 'xrefs']);
  const [bottom, setBottom] = useState<PanelId[]>(['hex', 'strings', 'cfg']);
  const [sideActive, setSideActive] = useState<PanelId>('metadata');
  const [bottomActive, setBottomActive] = useState<PanelId>('hex');
  const [leftWidth, setLeftWidth] = useState(280);
  const [rightWidth, setRightWidth] = useState(320);
  const [bottomHeight, setBottomHeight] = useState(220);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [palette, setPalette] = useState(false);
  const [draft, setDraft] = useState('');
  const [dragging, setDragging] = useState(false);
  const [patternHits, setPatternHits] = useState<number[]>([]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPalette(true);
        return;
      }
      if (typing) return;
      if (event.key === 'g' || event.key === 'G') {
        event.preventDefault();
        setDraft(state.selectedVa?.toString(16) ?? '');
        setDialog('goto');
      } else if (event.key === 'n' || event.key === 'N') {
        event.preventDefault();
        setDraft('');
        setDialog('rename');
      } else if (event.key === ';') {
        event.preventDefault();
        setDraft(state.selectedVa !== null ? state.comments[state.selectedVa.toString(16)] ?? '' : '');
        setDialog('comment');
      } else if (event.key === 'x' || event.key === 'X') {
        focusPanel('xrefs');
      } else if (event.key === 'b' || event.key === 'B') {
        if (state.selectedVa !== null) workspace.bookmark(state.selectedVa);
      } else if (event.key === '?') {
        setDialog('help');
      } else if (event.altKey && event.key === 'ArrowLeft') {
        workspace.back();
      } else if (event.altKey && event.key === 'ArrowRight') {
        workspace.forward();
      } else if (event.key === 'Escape') {
        setDialog(null);
        setPalette(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.selectedVa, state.comments, workspace]);

  useEffect(() => {
    const over = (event: Event) => {
      const drag = event as globalThis.DragEvent;
      if (![...(drag.dataTransfer?.types ?? [])].includes('Files')) return;
      event.preventDefault();
      setDragging(true);
    };
    const leave = () => setDragging(false);
    const drop = (event: Event) => {
      const drag = event as globalThis.DragEvent;
      if (!drag.dataTransfer?.files?.length) return;
      event.preventDefault();
      setDragging(false);
      const file = drag.dataTransfer.files[0];
      if (file) void workspace.openFile(file);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [workspace]);

  const focusPanel = (id: PanelId) => {
    if (side.includes(id)) setSideActive(id);
    else {
      setBottom((current) => (current.includes(id) ? current : [...current, id]));
      setSide((current) => current.filter((item) => item !== id));
      setBottomActive(id);
    }
  };

  const movePanel = (id: PanelId, zone: 'side' | 'bottom') => {
    setSide((current) => current.filter((item) => item !== id));
    setBottom((current) => current.filter((item) => item !== id));
    if (zone === 'side') {
      setSide((current) => [...current.filter((item) => item !== id), id]);
      setSideActive(id);
    } else {
      setBottom((current) => [...current.filter((item) => item !== id), id]);
      setBottomActive(id);
    }
  };

  const commands = useMemo(
    () => [
      { id: 'goto', label: 'Go to address', run: () => setDialog('goto') },
      { id: 'rename', label: 'Rename function', run: () => setDialog('rename') },
      { id: 'comment', label: 'Comment instruction', run: () => setDialog('comment') },
      { id: 'xrefs', label: 'Show cross-references', run: () => focusPanel('xrefs') },
      { id: 'hex', label: 'Show hex view', run: () => focusPanel('hex') },
      { id: 'strings', label: 'Show strings', run: () => focusPanel('strings') },
      { id: 'cfg', label: 'Show control-flow graph', run: () => focusPanel('cfg') },
      { id: 'pattern', label: 'Search byte pattern', run: () => setDialog('pattern') },
      { id: 'session', label: 'Toggle session-only mode', run: () => workspace.setSessionOnly(!state.sessionOnly) },
      { id: 'contrast', label: 'Toggle high contrast', run: () => workspace.setContrast(!state.contrast) },
      { id: 'export', label: 'Export project JSON', run: () => workspace.exportProject() },
      { id: 'wipe', label: 'Delete all local data', run: () => setDialog('wipe') },
      ...state.functions.slice(0, 200).map((item) => ({
        id: `fn-${item.address}`,
        label: `Function ${item.demangled || item.name}`,
        run: () => {
          workspace.selectVa(item.address);
          void workspace.ensureFunction(item.address);
        },
      })),
    ],
    [state.functions, state.sessionOnly, state.contrast, workspace],
  );

  return (
    <div className="app" style={{ ['--left' as string]: `${leftWidth}px`, ['--right' as string]: `${rightWidth}px`, ['--bottom' as string]: `${bottomHeight}px` }}>
      <header className="menubar">
        <strong className="brand">Webdra</strong>
        <label className="file-button">
          Open
          <input id="open-file" aria-label="Open binary" type="file" onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void workspace.openFile(file);
            event.target.value = '';
          }} />
        </label>
        <button type="button" onClick={() => workspace.exportProject()} disabled={!state.sha256}>Export notes</button>
        <label className="file-button">
          Import notes
          <input aria-label="Import project" type="file" accept="application/json" onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void workspace.importProject(file).catch((error: unknown) => {
              window.alert(error instanceof Error ? error.message : 'Import failed');
            });
            event.target.value = '';
          }} />
        </label>
        <button type="button" onClick={() => workspace.back()} disabled={state.historyIndex <= 0}>Back</button>
        <button type="button" onClick={() => workspace.forward()} disabled={state.historyIndex >= state.history.length - 1}>Forward</button>
        <label className="check">
          <input type="checkbox" checked={state.sessionOnly} onChange={(event) => workspace.setSessionOnly(event.target.checked)} />
          Session-only
        </label>
        <label className="check">
          <input type="checkbox" checked={state.storeBinary && !state.sessionOnly} disabled={state.sessionOnly || !state.sha256} onChange={(event) => workspace.setStoreBinary(event.target.checked)} />
          Keep a local copy
        </label>
        {state.binary && state.binary.slices.length > 1 && (
          <label>
            Slice
            <select aria-label="Mach-O slice" value={state.sliceOffset ?? state.binary.slices[0]?.offset ?? 0} onChange={(event) => void workspace.selectSlice(Number(event.target.value))}>
              {state.binary.slices.map((slice) => (
                <option key={slice.offset} value={slice.offset}>{slice.label}</option>
              ))}
            </select>
          </label>
        )}
        <span className="spacer" />
        <button type="button" aria-label="Decrease font size" onClick={() => workspace.setFontScale(state.fontScale - 0.1)}>A-</button>
        <button type="button" aria-label="Increase font size" onClick={() => workspace.setFontScale(state.fontScale + 0.1)}>A+</button>
        <button type="button" aria-pressed={state.contrast} onClick={() => workspace.setContrast(!state.contrast)}>Contrast</button>
        <button type="button" onClick={() => setDialog('wipe')}>Delete local data</button>
      </header>
      <p className="privacy-note">Data stays on this device. Webdra has no server and does not upload files. {state.sessionOnly ? 'Session-only mode is on, so nothing is saved.' : 'Names and comments are saved in this browser only.'} The host can still see your IP.</p>
      {state.notice ? <p className="notice">{state.notice}</p> : null}
      {state.binary?.warnings.length ? (
        <div className="warn-banner" role="status">
          {state.binary.warnings.slice(0, 4).map((warning) => <span key={warning}>{warning}</span>)}
        </div>
      ) : null}
      {state.phase === 'error' && (
        <div className="warn-banner" role="alert">
          <span>{state.error}</span>
          {state.recoverable && <button type="button" onClick={() => void workspace.parseAnyway()}>Parse anyway</button>}
        </div>
      )}
      <div className="workspace">
        <FunctionPane />
        <div className="gutter gutter-v" role="separator" aria-orientation="vertical" aria-label="Resize functions" onPointerDown={(event) => startResize(event, leftWidth, (value) => setLeftWidth(clamp(value, 180, 520)))} />
        <DisassemblyPane />
        <div className="gutter gutter-v" role="separator" aria-orientation="vertical" aria-label="Resize side panel" onPointerDown={(event) => startResize(event, rightWidth, (value) => setRightWidth(clamp(value, 220, 560)), true)} />
        <section className="pane side" aria-label="Side panels" onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropPanel(event, 'side', movePanel)}>
          <TabBar panels={side} active={sideActive} onSelect={setSideActive} />
          <div className="pane-body">{renderPanel(sideActive)}</div>
        </section>
        <div className="gutter gutter-h" role="separator" aria-orientation="horizontal" aria-label="Resize bottom panel" onPointerDown={(event) => startResize(event, bottomHeight, (value) => setBottomHeight(clamp(value, 120, 480)), true, true)} />
        <section className="pane bottom" aria-label="Bottom panels" onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropPanel(event, 'bottom', movePanel)}>
          <TabBar panels={bottom} active={bottomActive} onSelect={setBottomActive} />
          <div className="pane-body">{renderPanel(bottomActive)}</div>
        </section>
      </div>
      <footer className="statusbar">
        <span>{state.fileLabel || 'No file'}</span>
        <span>{state.binary ? `${state.binary.format} ${state.binary.arch.arch} ${state.binary.arch.bits}-bit ${state.binary.arch.endian}` : 'idle'}</span>
        <span>{state.selectedVa !== null ? formatAddress(state.selectedVa, state.binary?.arch.bits) : ''}</span>
        <span className="spacer" />
        {state.phase === 'running' && (
          <>
            <span>{state.progress?.phase}</span>
            <progress value={state.progress?.ratio ?? 0} max={1} aria-label="Analysis progress" />
            <button type="button" onClick={() => workspace.cancel()}>Cancel</button>
          </>
        )}
      </footer>
      {dragging && <div className="drop-mask">Drop a binary to analyze it locally</div>}
      {state.phase === 'empty' && <div className="welcome"><p>Open an ELF, PE, or Mach-O file. Analysis runs in a worker on this machine.</p></div>}
      {dialog && (
        <DialogBox
          dialog={dialog}
          draft={draft}
          setDraft={setDraft}
          onClose={() => setDialog(null)}
          onSubmit={() => {
            if (dialog === 'goto') {
              const address = Number.parseInt(draft.replace(/^0x/i, ''), 16);
              if (Number.isFinite(address)) {
                workspace.selectVa(address);
                void workspace.ensureFunction(address);
              }
            } else if (dialog === 'rename' && state.selectedVa !== null) {
              workspace.rename(state.selectedVa, draft);
            } else if (dialog === 'comment' && state.selectedVa !== null) {
              workspace.comment(state.selectedVa, draft);
            } else if (dialog === 'pattern') {
              void workspace.searchPattern(draft).then((hits) => {
                setPatternHits(hits);
                const first = hits[0];
                if (first !== undefined) workspace.selectFileOffset(first);
              }).catch((error: unknown) => {
                setPatternHits([]);
                setDraft(error instanceof Error ? error.message : 'Search failed');
              });
              return;
            } else if (dialog === 'wipe') {
              void workspace.wipe();
            }
            setDialog(null);
          }}
          hits={patternHits}
        />
      )}
      {palette && <CommandPalette commands={commands} onClose={() => setPalette(false)} />}
    </div>
  );
}

function TabBar({ panels, active, onSelect }: { panels: PanelId[]; active: PanelId; onSelect: (id: PanelId) => void }) {
  return (
    <div className="tabs" role="tablist">
      {panels.map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={id === active}
          draggable
          onDragStart={(event) => event.dataTransfer.setData('text/plain', id)}
          className={id === active ? 'tab active' : 'tab'}
          onClick={() => onSelect(id)}
        >
          {PANELS.find((item) => item.id === id)?.label ?? id}
        </button>
      ))}
    </div>
  );
}

function renderPanel(id: PanelId) {
  switch (id) {
    case 'hex':
      return <HexPane />;
    case 'strings':
      return <StringsPane />;
    case 'cfg':
      return <CfgPane />;
    case 'headers':
      return <HeadersPane />;
    case 'metadata':
      return <MetadataPane />;
    case 'xrefs':
      return <XrefsPane />;
    default: {
      const never: never = id;
      return never;
    }
  }
}

function DialogBox({
  dialog,
  draft,
  setDraft,
  onClose,
  onSubmit,
  hits,
}: {
  dialog: Dialog;
  draft: string;
  setDraft: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  hits: number[];
}) {
  const title = dialog === 'goto' ? 'Go to address' : dialog === 'rename' ? 'Rename' : dialog === 'comment' ? 'Comment' : dialog === 'pattern' ? 'Byte pattern' : dialog === 'wipe' ? 'Delete local data' : 'Keyboard';
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
      <div>
        <h2>{title}</h2>
        {dialog === 'wipe' && <p>This removes IndexedDB notes, optional file copies, and UI preferences from this browser.</p>}
        {dialog === 'help' && <p>G go to, N rename, semicolon comment, X xrefs, B bookmark, Ctrl+K commands, Alt+Left/Right history.</p>}
        {dialog !== 'wipe' && dialog !== 'help' && (
          <input autoFocus aria-label={title} value={draft} onChange={(event) => setDraft(event.target.value)} />
        )}
        {dialog === 'pattern' && hits.length > 0 && <p>{hits.length} match(es). First hit selected in the hex view.</p>}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>Close</button>
          {dialog !== 'help' && <button type="button" onClick={onSubmit}>{dialog === 'wipe' ? 'Delete' : 'Apply'}</button>}
        </div>
      </div>
    </div>
  );
}

function CommandPalette({ commands, onClose }: { commands: { id: string; label: string; run: () => void }[]; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const matches = fuzzyFilter(query, commands, (item) => item.label).slice(0, 12);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Command palette">
      <div>
        <input
          autoFocus
          aria-label="Command"
          placeholder="Command or symbol"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              matches[0]?.run();
              onClose();
            }
          }}
        />
        <ul className="plain-list">
          {matches.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => { item.run(); onClose(); }}>{item.label}</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function startResize(event: ReactPointerEvent<HTMLDivElement>, start: number, apply: (value: number) => void, invert = false, vertical = false) {
  event.preventDefault();
  const origin = vertical ? event.clientY : event.clientX;
  const move = (ev: globalThis.PointerEvent) => {
    const delta = (vertical ? ev.clientY : ev.clientX) - origin;
    apply(start + (invert ? -delta : delta));
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function dropPanel(event: ReactDragEvent<HTMLElement>, zone: 'side' | 'bottom', move: (id: PanelId, zone: 'side' | 'bottom') => void) {
  const id = event.dataTransfer.getData('text/plain') as PanelId;
  if (!PANELS.some((item) => item.id === id)) return;
  event.preventDefault();
  move(id, zone);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
