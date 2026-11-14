import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { foldStringConcat, scanBundleText } from '../../scripts/bundle-scan.mjs';
import { headersForPath, parseHeadersFile } from '../../scripts/serve-dist.mjs';

describe('bundle scan heuristic', () => {
  it('folds concatenated literals before looking for origins and APIs', () => {
    expect(foldStringConcat(`'fe'+'tch'`)).toContain('fetch');
    const fetchCall = scanBundleText('app.js', `globalThis['fe'+'tch']('htt'+'ps:/'+'/evil.example')`);
    expect(fetchCall.some((failure) => failure.includes('https://evil.example'))).toBe(true);
    const beacon = scanBundleText('app.js', `navigator.sendBeacon(atob('aHR0cHM6Ly9ldmls'))`);
    expect(beacon.some((failure) => failure.includes('sendBeacon'))).toBe(true);
    const image = scanBundleText('app.js', `new Image().src='ht'+'tp://evil.example/x'`);
    expect(image.some((failure) => failure.includes('new Image'))).toBe(true);
    expect(image.some((failure) => failure.includes('http://evil.example'))).toBe(true);
    expect(scanBundleText('app.css', `@import url(//evil.example/a.css);`).length).toBeGreaterThan(0);
    expect(scanBundleText('app.css', `background: url(//evil.example/a.png);`).length).toBeGreaterThan(0);
    expect(scanBundleText('app.js', `new EventSource('/events')`).some((failure) => failure.includes('EventSource'))).toBe(true);
    expect(scanBundleText('app.js', `new WebSocket('wss://evil.example')`).some((failure) => failure.includes('WebSocket'))).toBe(true);
    expect(scanBundleText('sw.js', `importScripts('helper.js')`).some((failure) => failure.includes('importScripts'))).toBe(true);
  });

  it('allows same-origin fetch and relative CSS', () => {
    expect(scanBundleText('sw.js', `fetch(event.request)`)).toEqual([]);
    expect(scanBundleText('app.css', `background: url(/icon-192.png);`)).toEqual([]);
    expect(scanBundleText('app.css', `@import "./local.css";`)).toEqual([]);
  });
});

describe('_headers parsing', () => {
  it('applies the wildcard rule to app paths', () => {
    const rules = parseHeadersFile(readFileSync('public/_headers', 'utf8'));
    const headers = headersForPath(rules, '/index.html');
    const csp = headers['Content-Security-Policy'] ?? '';
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("default-src 'none'");
    expect(headers['Referrer-Policy']).toBe('no-referrer');
    expect(headers['X-Frame-Options']).toBe('DENY');
  });
});
