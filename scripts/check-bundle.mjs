import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { headerCsp, metaCsp } from '../privacy/csp.mjs';
import { scanBundleText } from './bundle-scan.mjs';

const dist = path.resolve('dist');
const textExtensions = new Set(['.js', '.css', '.html', '.json', '.webmanifest', '.svg', '.txt', '.mjs']);

const failures = [];
for (const file of walk(dist)) {
  const ext = path.extname(file);
  if (!textExtensions.has(ext)) continue;
  const relative = path.relative(dist, file);
  failures.push(...scanBundleText(relative, readFileSync(file, 'utf8')));
}

const indexHtml = readFileSync(path.join(dist, 'index.html'), 'utf8');
const headers = readFileSync(path.join(dist, '_headers'), 'utf8');
if (!indexHtml.includes(metaCsp)) failures.push('dist/index.html meta CSP does not match privacy/csp.mjs');
if (!headers.includes(headerCsp)) failures.push('dist/_headers CSP does not match privacy/csp.mjs');
if (indexHtml.includes('frame-ancestors')) failures.push('meta CSP must not include frame-ancestors');
if (!headers.includes("frame-ancestors 'none'")) failures.push('header CSP is missing frame-ancestors');
if (/report-uri|report-to/.test(indexHtml + headers)) failures.push('CSP reporting endpoints are not allowed');
if (metaCsp.includes('blob:') || headerCsp.includes('blob:') || metaCsp.includes('data:')) {
  failures.push('Shipped CSP still allows blob: or data:');
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`Bundle privacy check passed (${walk(dist).length} files). This check is a heuristic.`);

function walk(directory) {
  const found = [];
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else found.push(full);
  }
  return found;
}
