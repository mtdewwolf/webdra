/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { parseBinary } from '../../src/binary/parse';
import { BinaryText } from '../../src/ui/views';

const payload = '<img src=x onerror=...>';

describe('binary text rendering', () => {
  it('does not turn a crafted symbol name into an element', () => {
    const bytes = new Uint8Array(readFileSync('tests/fixtures/bins/elf64-xss'));
    const binary = parseBinary(bytes);
    const symbol = binary.symbols.find((item) => item.name === payload);
    expect(symbol).toBeTruthy();
    const { container } = render(
      <div>
        <BinaryText value={symbol!.name} />
        <BinaryText value={binary.sections[0]?.name ?? ''} />
      </div>,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain(payload);
  });
});
