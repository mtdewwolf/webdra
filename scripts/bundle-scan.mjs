/**
 * Heuristic scan of built text files. It folds a few rounds of string-literal
 * concatenation and looks for network APIs and off-origin CSS. It is not a
 * deobfuscator: encoded strings, computed property names built at runtime, and
 * WebAssembly internals can hide a call. The end-to-end test is the backstop.
 */

/** Reviewed exceptions. Add one only when a dependency names an API and does not call it. */
export const apiAllowlist = [];

const BARE_APIS = [
  { name: 'sendBeacon', pattern: /\bsendBeacon\b/g },
  { name: 'EventSource', pattern: /\bEventSource\b/g },
  { name: 'WebSocket', pattern: /\bWebSocket\b/g },
  { name: 'importScripts', pattern: /\bimportScripts\b/g },
  { name: 'new Image', pattern: /\bnew\s+Image\b/g },
];

const ANALYTICS = [
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

const ALLOWED_NAMESPACES = new Set([
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1998/Math/MathML',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/XML/1998/namespace',
]);

export function foldStringConcat(input) {
  let text = input;
  for (let round = 0; round < 6; round += 1) {
    const next = foldOnce(text);
    if (next === text) return text;
    text = next;
  }
  return text;
}

function foldOnce(input) {
  let out = '';
  let index = 0;
  while (index < input.length) {
    const quote = input[index];
    if (quote !== '"' && quote !== "'") {
      out += input[index];
      index += 1;
      continue;
    }
    const literal = readString(input, index);
    if (!literal) {
      out += input[index];
      index += 1;
      continue;
    }
    let cursor = skipSpace(input, literal.end);
    if (input[cursor] !== '+') {
      out += input.slice(index, literal.end);
      index = literal.end;
      continue;
    }
    cursor = skipSpace(input, cursor + 1);
    const nextQuote = input[cursor];
    if (nextQuote !== '"' && nextQuote !== "'") {
      out += input.slice(index, literal.end);
      index = literal.end;
      continue;
    }
    const second = readString(input, cursor);
    if (!second) {
      out += input.slice(index, literal.end);
      index = literal.end;
      continue;
    }
    out += `${quote}${literal.body}${second.body}${quote}`;
    index = second.end;
  }
  return out;
}

function readString(input, start) {
  const quote = input[start];
  if (quote !== '"' && quote !== "'") return null;
  let body = '';
  let index = start + 1;
  while (index < input.length) {
    const char = input[index];
    if (char === '\\') {
      body += char + (input[index + 1] ?? '');
      index += 2;
      continue;
    }
    if (char === quote) return { body, end: index + 1 };
    body += char;
    index += 1;
  }
  return null;
}

function skipSpace(input, index) {
  while (index < input.length && (input[index] === ' ' || input[index] === '\n' || input[index] === '\t' || input[index] === '\r')) index += 1;
  return index;
}

function allowedApi(relative, name) {
  return apiAllowlist.some((entry) => entry.api === name && relative.endsWith(entry.fileSuffix));
}

function isRelativeCssTarget(value) {
  const target = value.trim();
  return target.startsWith('/') || target.startsWith('./') || target.startsWith('../') || target.startsWith('#');
}

export function scanBundleText(relative, source) {
  const failures = [];
  const folded = foldStringConcat(source);
  const urls = folded.match(/https?:\/\/[^\s"'`)<>]+/g) ?? [];
  for (const url of urls) {
    const bare = url.replace(/[),.;]+$/, '');
    if (!ALLOWED_NAMESPACES.has(bare)) failures.push(`${relative} references ${url}`);
  }
  const protocolRelative = folded.match(/["'`]\/\/[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [];
  for (const url of protocolRelative) failures.push(`${relative} references protocol-relative ${url}`);
  if (/rel\s*=\s*["']?(?:preconnect|dns-prefetch)\b/i.test(folded)) {
    failures.push(`${relative} contains a preconnect or dns-prefetch hint`);
  }
  const lower = folded.toLowerCase();
  for (const name of ANALYTICS) {
    if (lower.includes(name)) failures.push(`${relative} references analytics marker ${name}`);
  }
  if (/(?:fetch|xmlhttprequest)\s*\(\s*['"`]https?:\/\//i.test(folded)) {
    failures.push(`${relative} calls fetch or XHR with an external URL`);
  }
  for (const api of BARE_APIS) {
    api.pattern.lastIndex = 0;
    if (api.pattern.test(folded) && !allowedApi(relative, api.name)) {
      failures.push(`${relative} uses ${api.name}`);
    }
  }
  if (/url\(\s*['"]?(?:\/\/|https?:|data:|blob:)/i.test(folded)) {
    failures.push(`${relative} has a CSS url() that is not a relative path`);
  }
  if (/\.(css|html)$/.test(relative)) {
    for (const match of folded.matchAll(/@import\s+(?:url\(\s*)?['"]?([^'")\s;]+)/gi)) {
      const target = match[1] ?? '';
      if (!isRelativeCssTarget(target)) failures.push(`${relative} @import targets ${target || 'an empty path'}`);
    }
  }
  return failures;
}
