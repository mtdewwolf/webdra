import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { headerCsp, metaCsp, renderHeadersFile } from '../../privacy/csp.mjs';

describe('content security policy', () => {
  it('keeps the meta tag and _headers file in sync with the source of truth', () => {
    const html = readFileSync('index.html', 'utf8');
    const headers = readFileSync('public/_headers', 'utf8');
    expect(html).toContain(metaCsp);
    expect(headers).toBe(renderHeadersFile());
    expect(headers).toContain(headerCsp);
    expect(metaCsp.includes('frame-ancestors')).toBe(false);
    expect(headerCsp).toContain("frame-ancestors 'none'");
    expect(headerCsp.startsWith("default-src 'none'")).toBe(true);
    for (const forbidden of ["'unsafe-inline'", 'report-uri', 'report-to']) {
      expect(metaCsp.includes(forbidden)).toBe(false);
      expect(headerCsp.includes(forbidden)).toBe(false);
    }
    expect(metaCsp.includes("'unsafe-eval'")).toBe(false);
    expect(headerCsp).toContain("worker-src 'self'");
    expect(metaCsp.includes('blob:')).toBe(false);
    expect(metaCsp.includes('data:')).toBe(false);
    expect(headerCsp.includes('blob:')).toBe(false);
    expect(headers).toContain('X-Frame-Options: DENY');
    expect(headers).toContain('Referrer-Policy: no-referrer');
    expect(headers).toContain('Cross-Origin-Opener-Policy: same-origin');
    expect(html).toContain('x-dns-prefetch-control');
    expect(html).toContain('no-referrer');
  });
});

describe('source privacy', () => {
  it('does not render binary text as HTML or put files in the URL', () => {
    const source = walk('src')
      .filter((file) => file.endsWith('.ts') || file.endsWith('.tsx'))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    expect(source.includes('dangerouslySetInnerHTML')).toBe(false);
    expect(source.includes('.innerHTML')).toBe(false);
    expect(source.includes('document.title')).toBe(false);
    expect(source.includes('location.hash')).toBe(false);
    expect(source.includes('location.search')).toBe(false);
    expect(source.includes('pushState')).toBe(false);
    expect(source.includes('replaceState')).toBe(false);
    expect(source.includes('clipboard.read')).toBe(false);
    expect(source.includes('console.log')).toBe(false);
    expect(source.includes('console.debug')).toBe(false);
    expect(source.includes('sendBeacon')).toBe(false);
  });
});

function walk(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else found.push(full);
  }
  return found;
}
