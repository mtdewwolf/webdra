import { describe, expect, it } from 'vitest';
import { demangle } from '../../src/analysis/demangle';
import { shannonEntropy } from '../../src/analysis/entropy';
import { fuzzyScore } from '../../src/analysis/fuzzy';
import { parseBytePattern, searchBytePattern } from '../../src/analysis/pattern';
import { buildCfg } from '../../src/analysis/cfg';
import { assertFileSize, MAX_FILE_BYTES } from '../../src/binary/address';
import { pushHistory, stepHistory } from '../../src/ui/history';
import { shouldCacheRequest } from '../../src/privacy/cachePolicy';
import { renderServiceWorker } from '../../src/privacy/serviceWorkerSource';
import type { InstructionIR } from '../../src/ir/types';

describe('demangle', () => {
  it('decodes Itanium nested names', () => {
    expect(demangle('_ZN3foo3barEi')).toBe('foo::bar(int)');
    expect(demangle('_Z3foov')).toBe('foo()');
  });

  it('decodes simple MSVC names', () => {
    expect(demangle('?add@@YAHHH@Z')).toBe('int add(int, int)');
    expect(demangle('?bar@foo@@YAHH@Z')).toBe('int foo::bar(int)');
  });
});

describe('helpers', () => {
  it('scores fuzzy matches and rejects misses', () => {
    expect(fuzzyScore('mn', 'main')).not.toBeNull();
    expect(fuzzyScore('zzz', 'main')).toBeNull();
  });

  it('searches byte patterns with wildcards', () => {
    const bytes = new Uint8Array([0x00, 0xb8, 0x2a, 0x00, 0x00, 0x00, 0xc3]);
    expect(searchBytePattern(bytes, parseBytePattern('b8 2a ?? ?? ?? c3'))).toEqual([1]);
  });

  it('computes entropy and rejects oversized files', () => {
    expect(shannonEntropy(new Uint8Array(32).fill(0))).toBe(0);
    expect(() => assertFileSize(MAX_FILE_BYTES + 1)).toThrow(/50 MB/);
  });

  it('tracks navigation history without touching the URL', () => {
    const first = pushHistory([], -1, 0x1000);
    const second = pushHistory(first.history, first.index, 0x2000);
    expect(second.history).toEqual([0x1000, 0x2000]);
    expect(stepHistory(second.history, second.index, -1)).toBe(0);
  });

  it('caches only listed same-origin GET assets', () => {
    const assets = ['/', '/assets/app.js'];
    expect(shouldCacheRequest('GET', 'https://webdra.test', 'https://webdra.test', '/assets/app.js', assets)).toBe(true);
    expect(shouldCacheRequest('POST', 'https://webdra.test', 'https://webdra.test', '/assets/app.js', assets)).toBe(false);
    expect(shouldCacheRequest('GET', 'https://evil.test', 'https://webdra.test', '/assets/app.js', assets)).toBe(false);
    expect(shouldCacheRequest('GET', 'https://webdra.test', 'https://webdra.test', '/blob', assets)).toBe(false);
    const source = renderServiceWorker(assets);
    expect(source).toContain('"/assets/app.js"');
    expect(source).not.toContain('https://');
  });

  it('splits a conditional branch into two CFG edges', () => {
    const instructions: InstructionIR[] = [
      instruction(0x1000, 2, 'cmp', 'seq'),
      instruction(0x1002, 2, 'je', 'cjump', 0x1010),
      instruction(0x1004, 1, 'ret', 'ret'),
      instruction(0x1010, 1, 'ret', 'ret'),
    ];
    const blocks = buildCfg(instructions);
    const branch = blocks.find((block) => block.address === 0x1000);
    expect(branch?.successors.map((edge) => edge.kind).sort()).toEqual(['fallthrough', 'taken']);
  });
});

function instruction(address: number, size: number, mnemonic: string, flow: InstructionIR['flow'], target: number | null = null): InstructionIR {
  return { address, size, bytes: [0], mnemonic, opStr: '', flow, target, dataTarget: null, indirect: false };
}
