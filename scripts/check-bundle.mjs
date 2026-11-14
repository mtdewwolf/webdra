import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { headerCsp, metaCsp } from '../privacy/csp.mjs';

const dist = path.resolve('dist');
const textExtensions = new Set(['.js', '.css', '.html', '.json', '.webmanifest', '.svg', '.map', '.txt', '.mjs']);
const analytics = [
  'google-analytics',
  'googletagmanager',
  'google-analytics.com',
  'gtag(',
  'mixpanel',
  'segment.com',
  'segment.io',
  'sentry.io',
  'amplitude.com',
  'hotjar',
  'fullstory',
  'plausible.io',
  'posthog',
  'datadoghq',
  'newrelic',
  'facebook.net',
  'doubleclick.net',
  'cloudflareinsights',
  'mc.yandex',
];

// React compares these DOM namespace URIs. They are not requested.
const allowedNamespaces = new Set([
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1998/Math/MathML',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/XML/1998/namespace',
]);

const failures = [];
for (const file of walk(dist)) {
  const ext = path.extname(file);
  if (!textExtensions.has(ext) && ext !== '') continue;
  if (ext === '.wasm' || ext === '.png') continue;
  const text = readFileSync(file, 'utf8');
  const relative = path.relative(dist, file);
  const urls = text.match(/https?:\/\/[^\s"'`)<>]+/g) ?? [];
  for (const url of urls) {
    const bare = url.replace(/[),.;]+$/, '');
    if (!allowedNamespaces.has(bare)) failures.push(`${relative} references ${url}`);
  }
  const protocolRelative = text.match(/["'`]\/\/[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [];
  for (const url of protocolRelative) failures.push(`${relative} references protocol-relative ${url}`);
  if (/rel\s*=\s*["']?(?:preconnect|dns-prefetch)\b/i.test(text)) {
    failures.push(`${relative} contains a preconnect or dns-prefetch hint`);
  }
  for (const name of analytics) {
    if (text.toLowerCase().includes(name)) failures.push(`${relative} references analytics marker ${name}`);
  }
  const externalCall = text.match(/(?:fetch|sendBeacon|XMLHttpRequest|WebSocket|EventSource)\s*\(\s*['"`]https?:\/\//g) ?? [];
  for (const call of externalCall) failures.push(`${relative} calls the network with ${call}`);
}

const indexHtml = readFileSync(path.join(dist, 'index.html'), 'utf8');
const headers = readFileSync(path.join(dist, '_headers'), 'utf8');
if (!indexHtml.includes(metaCsp)) failures.push('dist/index.html meta CSP does not match privacy/csp.mjs');
if (!headers.includes(headerCsp)) failures.push('dist/_headers CSP does not match privacy/csp.mjs');
if (indexHtml.includes('frame-ancestors')) failures.push('meta CSP must not include frame-ancestors');
if (!headers.includes("frame-ancestors 'none'")) failures.push('header CSP is missing frame-ancestors');
if (/report-uri|report-to/.test(indexHtml + headers)) failures.push('CSP reporting endpoints are not allowed');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`Bundle privacy check passed (${walk(dist).length} files).`);

function walk(directory) {
  const found = [];
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else found.push(full);
  }
  return found;
}
