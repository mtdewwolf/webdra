import { useEffect, useMemo, useState } from 'react';
import { formatAddress, formatBytes, addressKey } from '../analysis/format';
import { fuzzyFilter } from '../analysis/fuzzy';
import { xrefsToString } from '../analysis/strings';
import type { FunctionIR, InstructionIR } from '../ir/types';
import { displayName } from './names';
import { OperandText } from './syntax';
import { useWorkspace } from './workspace';
import { VirtualList } from './VirtualList';

export function BinaryText({ value }: { value: string }) {
  return <span>{value}</span>;
}

export function FunctionPane() {
  const { state, selectVa, ensureFunction } = useWorkspace();
  const [query, setQuery] = useState('');
  const rows = useMemo(
    () => fuzzyFilter(query, state.functions, (item) => `${displayName(item.address, state.functions, state.renames)} ${item.name}`),
    [query, state.functions, state.renames],
  );
  const selectedIndex = rows.findIndex((item) => item.address === state.selectedVa);
  return (
    <section className="pane" aria-label="Functions">
      <header className="pane-title">Functions</header>
      <input className="search" aria-label="Filter functions" placeholder="Filter symbols" value={query} onChange={(event) => setQuery(event.target.value)} />
      <VirtualList count={rows.length} rowHeight={22} scrollToIndex={selectedIndex >= 0 ? selectedIndex : null}>
        {(index) => {
          const item = rows[index];
          if (!item) return null;
          const active = item.address === state.selectedVa;
          return (
            <button
              type="button"
              className={active ? 'row active' : 'row'}
              onClick={() => {
                selectVa(item.address);
                void ensureFunction(item.address);
              }}
            >
              <span className="addr">{formatAddress(item.address, state.binary?.arch.bits)}</span>
              <span>{displayName(item.address, state.functions, state.renames)}</span>
            </button>
          );
        }}
      </VirtualList>
      {state.bookmarks.length > 0 && (
        <div className="bookmark-list" aria-label="Bookmarks">
          {state.bookmarks.map((item) => (
            <button key={item.address} type="button" className="row" onClick={() => selectVa(Number.parseInt(item.address, 16))}>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export function DisassemblyPane() {
  const { state, selectVa, ensureFunction } = useWorkspace();
  const fn = currentFunction(state.loaded, state.selectedVa);
  useEffect(() => {
    if (state.selectedVa === null || fn) return;
    const owner = state.functions.find((item) => item.address === state.selectedVa) ?? nearestFunction(state.functions, state.selectedVa);
    if (owner) void ensureFunction(owner.address);
  }, [state.selectedVa, state.functions, fn, ensureFunction]);
  const instructions = fn?.instructions ?? [];
  const index = instructions.findIndex((item) => state.selectedVa !== null && state.selectedVa >= item.address && state.selectedVa < item.address + item.size);
  return (
    <section className="pane listing" aria-label="Disassembly" data-testid="disassembly">
      <header className="pane-title">
        Disassembly
        {fn ? <span className="subtle"> {displayName(fn.address, state.functions, state.renames)}</span> : null}
      </header>
      {instructions.length === 0 ? (
        <p className="empty">Select a function to disassemble it.</p>
      ) : (
        <VirtualList count={instructions.length} rowHeight={22} scrollToIndex={index >= 0 ? index : 0}>
          {(row) => {
            const instruction = instructions[row];
            if (!instruction) return null;
            return (
              <InstructionRow
                instruction={instruction}
                bits={state.binary?.arch.bits ?? 64}
                selected={index === row}
                comment={state.comments[addressKey(instruction.address)] ?? ''}
                targetName={instruction.target !== null ? displayName(instruction.target, state.functions, state.renames) : ''}
                onSelect={() => selectVa(instruction.address)}
              />
            );
          }}
        </VirtualList>
      )}
    </section>
  );
}

function InstructionRow({
  instruction,
  bits,
  selected,
  comment,
  targetName,
  onSelect,
}: {
  instruction: InstructionIR;
  bits: 16 | 32 | 64;
  selected: boolean;
  comment: string;
  targetName: string;
  onSelect: () => void;
}) {
  const flowClass = instruction.flow === 'call' ? 'mnem call' : 'mnem';
  return (
    <button type="button" className={selected ? 'insn selected' : 'insn'} onClick={onSelect}>
      <span className="addr">{formatAddress(instruction.address, bits)}</span>
      <span className="bytes">{formatBytes(instruction.bytes)}</span>
      <span className={flowClass}>{instruction.mnemonic}</span>
      <span className="ops">
        <OperandText text={instruction.opStr} />
        {instruction.target !== null && targetName ? <span className="target"> {targetName}</span> : null}
      </span>
      {comment ? <span className="comment"> ; {comment}</span> : null}
    </button>
  );
}

export function HexPane() {
  const { state, selectFileOffset } = useWorkspace();
  const bytes = state.bytes;
  const binary = state.binary;
  const rows = bytes ? Math.ceil(bytes.length / 16) : 0;
  const selectedRow = state.selectedFileOff === null ? null : Math.floor(state.selectedFileOff / 16);
  const pageRows = 4096;
  const pageCount = Math.max(1, Math.ceil(rows / pageRows));
  const selectedPage = selectedRow === null ? 0 : Math.min(pageCount - 1, Math.floor(selectedRow / pageRows));
  const [page, setPage] = useState(0);
  const visiblePage = Math.min(page, pageCount - 1);
  useEffect(() => {
    setPage(selectedPage);
  }, [selectedPage]);
  if (!bytes || !binary) return <section className="pane" aria-label="Hex"><header className="pane-title">Hex</header><p className="empty">No file open.</p></section>;
  const pageStart = visiblePage * pageRows;
  const visibleRows = Math.min(pageRows, Math.max(0, rows - pageStart));
  return (
    <section className="pane" aria-label="Hex view" data-testid="hex">
      <header className="pane-title">Hex</header>
      {pageCount > 1 && (
        <div className="hex-pager">
          <button type="button" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={visiblePage === 0}>Prev</button>
          <input
            aria-label="Hex page"
            type="range"
            min={0}
            max={pageCount - 1}
            value={visiblePage}
            onChange={(event) => setPage(Number(event.target.value))}
          />
          <button type="button" onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))} disabled={visiblePage >= pageCount - 1}>Next</button>
          <span>{visiblePage + 1}/{pageCount}</span>
        </div>
      )}
      <VirtualList count={visibleRows} rowHeight={20} scrollToIndex={selectedRow === null ? null : selectedRow - pageStart}>
        {(index) => {
          const offset = (pageStart + index) * 16;
          const va = vaLabel(binary, offset);
          const chunk: number[] = [];
          let ascii = '';
          for (let column = 0; column < 16; column += 1) {
            const value = bytes[offset + column];
            if (value === undefined) break;
            chunk.push(value);
            ascii += value >= 0x20 && value <= 0x7e ? String.fromCharCode(value) : '.';
          }
          const active = selectedRow === pageStart + index;
          return (
            <button type="button" className={active ? 'hex-row selected' : 'hex-row'} onClick={() => selectFileOffset(offset)}>
              <span className="addr">{va}</span>
              <span className="bytes">{formatBytes(chunk)}</span>
              <span className="ascii">{ascii}</span>
            </button>
          );
        }}
      </VirtualList>
    </section>
  );
}

function vaLabel(binary: WorkspaceStateBinary, offset: number): string {
  for (const section of binary.sections) {
    if (offset >= section.fileOffset && offset < section.fileOffset + section.fileSize) {
      return formatAddress(section.address + (offset - section.fileOffset), binary.arch.bits);
    }
  }
  return formatAddress(offset, binary.arch.bits);
}

type WorkspaceStateBinary = NonNullable<ReturnType<typeof useWorkspace>['state']['binary']>;

export function StringsPane() {
  const { state, selectVa } = useWorkspace();
  const [minimum, setMinimum] = useState(4);
  const [encoding, setEncoding] = useState<'both' | 'ascii' | 'utf16'>('both');
  const [pattern, setPattern] = useState('');
  const filtered = useMemo(() => {
    let error = '';
    let matcher: RegExp | null = null;
    if (pattern.trim()) {
      try {
        matcher = new RegExp(pattern.slice(0, 200), 'i');
      } catch {
        error = 'Invalid regular expression';
      }
    }
    const rows = state.strings.filter((item) => {
      if (item.text.length < minimum) return false;
      if (encoding !== 'both' && item.encoding !== encoding) return false;
      if (matcher && !matcher.test(item.text)) return false;
      return true;
    });
    return { rows, error };
  }, [state.strings, minimum, encoding, pattern]);
  const rows = filtered.rows;
  const selected = rows.findIndex((item) => state.selectedVa !== null && state.selectedVa >= item.address && state.selectedVa < item.address + item.text.length);
  return (
    <section className="pane" aria-label="Strings" data-testid="strings">
      <header className="pane-title">Strings</header>
      <div className="toolbar-inline">
        <label>Min <input aria-label="Minimum string length" type="number" min={1} max={64} value={minimum} onChange={(event) => setMinimum(Number(event.target.value) || 4)} /></label>
        <label>
          Encoding
          <select aria-label="String encoding" value={encoding} onChange={(event) => setEncoding(event.target.value as 'both' | 'ascii' | 'utf16')}>
            <option value="both">ASCII and UTF-16</option>
            <option value="ascii">ASCII</option>
            <option value="utf16">UTF-16</option>
          </select>
        </label>
        <input aria-label="String filter" placeholder="Regex filter" value={pattern} onChange={(event) => setPattern(event.target.value)} />
      </div>
      {filtered.error ? <p className="warn">{filtered.error}</p> : null}
      {state.truncatedStrings ? <p className="warn">String list truncated at 20,000 entries.</p> : null}
      <VirtualList count={rows.length} rowHeight={22} scrollToIndex={selected >= 0 ? selected : null}>
        {(index) => {
          const item = rows[index];
          if (!item) return null;
          const refs = xrefsToString(state.xrefs, item);
          return (
            <button type="button" className={selected === index ? 'row selected' : 'row'} onClick={() => selectVa(item.address)}>
              <span className="addr">{formatAddress(item.address, state.binary?.arch.bits)}</span>
              <span className="subtle">{item.encoding}</span>
              <span className="string-text"><BinaryText value={item.text} /></span>
              <span className="subtle">{refs.length ? `${refs.length} xref` : ''}</span>
            </button>
          );
        }}
      </VirtualList>
    </section>
  );
}

export function HeadersPane() {
  const { state } = useWorkspace();
  const binary = state.binary;
  if (!binary) return <section className="pane" aria-label="Headers"><header className="pane-title">Headers</header></section>;
  return (
    <section className="pane scroll-pane" aria-label="Headers" data-testid="headers">
      <header className="pane-title">Headers</header>
      <table>
        <tbody>
          {binary.headerFields.map((field) => (
            <tr key={field.label}>
              <th>{field.label}</th>
              <td><BinaryText value={field.value} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Sections</h3>
      <VirtualList count={binary.sections.length} rowHeight={22}>
        {(index) => {
          const section = binary.sections[index];
          if (!section) return null;
          return (
            <div className="row">
              <span><BinaryText value={section.name} /></span>
              <span className="addr">{formatAddress(section.address, binary.arch.bits)}</span>
              <span>{section.size.toString(16)}</span>
              <span>{section.flags.join('')}</span>
            </div>
          );
        }}
      </VirtualList>
      <h3>Symbols</h3>
      <SymbolTable />
      <h3>Imports</h3>
      <VirtualList count={binary.imports.length} rowHeight={22}>
        {(index) => {
          const item = binary.imports[index];
          if (!item) return null;
          return <div className="row"><BinaryText value={`${item.library ? `${item.library}!` : ''}${item.name}`} /></div>;
        }}
      </VirtualList>
      <h3>Exports</h3>
      <VirtualList count={binary.exports.length} rowHeight={22}>
        {(index) => {
          const item = binary.exports[index];
          if (!item) return null;
          return <div className="row"><BinaryText value={`${item.name} ${formatAddress(item.address, binary.arch.bits)}`} /></div>;
        }}
      </VirtualList>
    </section>
  );
}

function SymbolTable() {
  const { state, selectVa, ensureFunction } = useWorkspace();
  const symbols = state.binary?.symbols ?? [];
  return (
    <VirtualList count={symbols.length} rowHeight={22}>
      {(index) => {
        const symbol = symbols[index];
        if (!symbol) return null;
        return (
          <button
            type="button"
            className="row"
            onClick={() => {
              if (!symbol.imported) {
                selectVa(symbol.address);
                if (symbol.kind === 'function') void ensureFunction(symbol.address);
              }
            }}
          >
            <span className="addr">{formatAddress(symbol.address, state.binary?.arch.bits)}</span>
            <span><BinaryText value={symbol.name} /></span>
            <span className="subtle">{symbol.kind}</span>
          </button>
        );
      }}
    </VirtualList>
  );
}

export function MetadataPane() {
  const { state } = useWorkspace();
  const binary = state.binary;
  if (!binary) return <section className="pane" aria-label="Metadata"><header className="pane-title">Metadata</header></section>;
  return (
    <section className="pane scroll-pane" aria-label="Metadata" data-testid="metadata">
      <header className="pane-title">Metadata</header>
      <dl className="facts">
        <dt>Format</dt><dd>{binary.format}</dd>
        <dt>Architecture</dt><dd>{binary.arch.arch}</dd>
        <dt>Bitness</dt><dd>{binary.arch.bits}</dd>
        <dt>Endianness</dt><dd>{binary.arch.endian}</dd>
        <dt>Entry</dt><dd>{binary.entryPoint === null ? 'none' : formatAddress(binary.entryPoint, binary.arch.bits)}</dd>
        <dt>SHA-256</dt><dd className="hash">{state.sha256}</dd>
        <dt>SHA-1</dt><dd className="hash">{state.sha1}</dd>
      </dl>
      <button type="button" className="text-button" onClick={() => void navigator.clipboard.writeText(state.sha256)}>Copy SHA-256</button>
      <h3>Section entropy</h3>
      {state.entropy.map((item) => (
        <div key={`${item.name}-${item.size}`} className="entropy-row">
          <span>{item.name}</span>
          <svg className="entropy" viewBox="0 0 100 8" role="img" aria-label={`${item.name} entropy ${item.entropy.toFixed(2)} of 8`}>
            <rect className="track" width="100" height="8" />
            <rect className="fill" width={Math.max(0, Math.min(100, (item.entropy / 8) * 100))} height="8" />
          </svg>
          <span>{item.entropy.toFixed(2)}</span>
        </div>
      ))}
    </section>
  );
}

export function XrefsPane() {
  const { state, selectVa, ensureFunction } = useWorkspace();
  const address = state.selectedVa;
  const incoming = state.xrefs.filter((item) => item.to === address);
  const outgoing = state.xrefs.filter((item) => item.from === address);
  return (
    <section className="pane scroll-pane" aria-label="Cross references" data-testid="xrefs">
      <header className="pane-title">Cross-references</header>
      {address === null ? <p className="empty">Select an address.</p> : null}
      <h3>To here</h3>
      <ul className="plain-list">
        {incoming.map((item) => (
          <li key={`in-${item.kind}-${item.from}`}>
            <button type="button" onClick={() => { selectVa(item.from); void ensureFunction(item.from); }}>
              {item.kind} from {formatAddress(item.from, state.binary?.arch.bits)} {displayName(item.from, state.functions, state.renames)}
            </button>
          </li>
        ))}
      </ul>
      <h3>From here</h3>
      <ul className="plain-list">
        {outgoing.map((item) => (
          <li key={`out-${item.kind}-${item.to}`}>
            <button type="button" onClick={() => { selectVa(item.to); void ensureFunction(item.to); }}>
              {item.kind} to {formatAddress(item.to, state.binary?.arch.bits)} {displayName(item.to, state.functions, state.renames)}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CfgPane() {
  const { state, selectVa } = useWorkspace();
  const fn = currentFunction(state.loaded, state.selectedVa);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 20, y: 20 });
  const layout = useMemo(() => layoutBlocks(fn), [fn]);
  return (
    <section className="pane" aria-label="Control flow graph" data-testid="cfg">
      <header className="pane-title">Control flow</header>
      {!fn || fn.blocks.length === 0 ? (
        <p className="empty">Disassemble a function to see its graph.</p>
      ) : (
        <svg
          className="cfg"
          role="img"
          aria-label="Control flow graph"
          onWheel={(event) => {
            event.preventDefault();
            setScale((value) => Math.min(2.4, Math.max(0.4, value + (event.deltaY < 0 ? 0.1 : -0.1))));
          }}
          onPointerDown={(event) => {
            const startX = event.clientX;
            const startY = event.clientY;
            const origin = pan;
            const move = (ev: PointerEvent) => setPan({ x: origin.x + ev.clientX - startX, y: origin.y + ev.clientY - startY });
            const up = () => {
              window.removeEventListener('pointermove', move);
              window.removeEventListener('pointerup', up);
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
          }}
        >
          <g transform={`translate(${pan.x} ${pan.y}) scale(${scale})`}>
            {fn.blocks.flatMap((block) =>
              block.successors.map((edge) => {
                const from = layout.get(block.address);
                const to = layout.get(edge.address);
                if (!from || !to) return null;
                return (
                  <line
                    key={`${block.address}-${edge.address}-${edge.kind}`}
                    x1={from.x + 70}
                    y1={from.y + 36}
                    x2={to.x + 70}
                    y2={to.y}
                    className={edge.kind === 'taken' ? 'edge taken' : 'edge fall'}
                  />
                );
              }),
            )}
            {fn.blocks.map((block) => {
              const pos = layout.get(block.address);
              if (!pos) return null;
              const active = state.selectedVa !== null && state.selectedVa >= block.address && state.selectedVa < block.end;
              return (
                <g key={block.address} transform={`translate(${pos.x} ${pos.y})`} onClick={() => selectVa(block.address)} className="block">
                  <rect width="140" height="36" className={active ? 'node active' : 'node'} />
                  <text x="8" y="22">{formatAddress(block.address, state.binary?.arch.bits)}</text>
                </g>
              );
            })}
          </g>
        </svg>
      )}
    </section>
  );
}

function layoutBlocks(fn: FunctionIR | null): Map<number, { x: number; y: number }> {
  const positions = new Map<number, { x: number; y: number }>();
  if (!fn) return positions;
  const depth = new Map<number, number>();
  const queue = [fn.blocks[0]?.address ?? 0];
  depth.set(queue[0] ?? 0, 0);
  while (queue.length) {
    const address = queue.shift();
    if (address === undefined) break;
    const block = fn.blocks.find((item) => item.address === address);
    for (const edge of block?.successors ?? []) {
      if (!depth.has(edge.address)) {
        depth.set(edge.address, (depth.get(address) ?? 0) + 1);
        queue.push(edge.address);
      }
    }
  }
  const columns = new Map<number, number>();
  for (const block of fn.blocks) {
    const column = depth.get(block.address) ?? 0;
    const row = columns.get(column) ?? 0;
    columns.set(column, row + 1);
    positions.set(block.address, { x: column * 180, y: row * 64 });
  }
  return positions;
}

function currentFunction(loaded: Record<string, FunctionIR>, selected: number | null): FunctionIR | null {
  if (selected === null) return Object.values(loaded)[0] ?? null;
  const direct = loaded[addressKey(selected)];
  if (direct) return direct;
  return (
    Object.values(loaded).find((fn) => selected >= fn.address && selected < fn.address + Math.max(fn.size, 1)) ??
    null
  );
}

function nearestFunction(functions: { address: number }[], address: number): { address: number } | null {
  let best: { address: number } | null = null;
  for (const item of functions) {
    if (item.address <= address && (!best || item.address > best.address)) best = item;
  }
  return best;
}
