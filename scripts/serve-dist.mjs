import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const dist = path.resolve('dist');
const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? '127.0.0.1';
const basePath = normalizeBase(process.env.BASE_PATH ?? '/');

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

export function parseHeadersFile(text) {
  const rules = [];
  let current = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) {
      current = { pattern: line.trim(), headers: {} };
      rules.push(current);
      continue;
    }
    if (!current) continue;
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    current.headers[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return rules;
}

export function headersForPath(rules, pathname) {
  const headers = {};
  for (const rule of rules) {
    if (!ruleMatches(rule.pattern, pathname)) continue;
    Object.assign(headers, rule.headers);
  }
  return headers;
}

function ruleMatches(pattern, pathname) {
  if (pattern === '/*') return true;
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -1);
    return pathname === prefix.slice(0, -1) || pathname.startsWith(prefix);
  }
  return pathname === pattern;
}

function normalizeBase(value) {
  if (!value || value === '/') return '/';
  const withSlash = value.startsWith('/') ? value : `/${value}`;
  return withSlash.endsWith('/') ? withSlash : `${withSlash}/`;
}

function fileForRequest(pathname) {
  const prefix = basePath === '/' ? '' : basePath.slice(0, -1);
  if (prefix && pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return null;
  let relative = prefix ? pathname.slice(prefix.length) : pathname;
  if (relative === '' || relative === '/') relative = '/index.html';
  else if (relative.endsWith('/')) relative += 'index.html';
  const parts = relative.split('/').filter((part) => part.length > 0);
  if (parts.some((part) => part === '..' || part === '.')) return null;
  return path.join(dist, ...parts);
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === path.resolve(new URL(import.meta.url).pathname);
}

if (isMainModule()) {
  const headerRules = parseHeadersFile(readFileSync(path.join(dist, '_headers'), 'utf8'));
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${host}`);
    const file = fileForRequest(decodeURIComponent(url.pathname));
    const headers = { ...headersForPath(headerRules, url.pathname) };
    if (!file) {
      response.writeHead(404, headers);
      response.end('Not found');
      return;
    }
    try {
      const body = readFileSync(file);
      statSync(file);
      headers['Content-Type'] = types[path.extname(file)] ?? 'application/octet-stream';
      headers['Content-Length'] = String(body.length);
      response.writeHead(200, headers);
      response.end(body);
    } catch {
      response.writeHead(404, headers);
      response.end('Not found');
    }
  });
  server.listen(port, host, () => {
    console.log(`Serving ${dist} at http://${host}:${port}${basePath}`);
  });
}
