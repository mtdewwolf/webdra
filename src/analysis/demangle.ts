const ITANIUM_TYPES: Record<string, string> = {
  v: 'void',
  w: 'wchar_t',
  b: 'bool',
  c: 'char',
  a: 'signed char',
  h: 'unsigned char',
  s: 'short',
  t: 'unsigned short',
  i: 'int',
  j: 'unsigned int',
  l: 'long',
  m: 'unsigned long',
  x: 'long long',
  y: 'unsigned long long',
  n: '__int128',
  o: 'unsigned __int128',
  f: 'float',
  d: 'double',
  e: 'long double',
  z: '...',
};

const MSVC_TYPES: Record<string, string> = {
  C: 'signed char',
  D: 'char',
  E: 'unsigned char',
  F: 'short',
  G: 'unsigned short',
  H: 'int',
  I: 'unsigned int',
  J: 'long',
  K: 'unsigned long',
  M: 'float',
  N: 'double',
  X: 'void',
  _J: '__int64',
  _K: 'unsigned __int64',
  _N: 'bool',
  _W: 'wchar_t',
};

/** Best-effort Itanium and MSVC demangling. Unknown names are returned unchanged. */
export function demangle(name: string): string {
  return demangleItanium(name) ?? demangleMsvc(name) ?? name;
}

export function demangleItanium(input: string): string | null {
  if (!input.startsWith('_Z')) return null;
  let index = 2;
  const subs: string[] = [];

  const parseSource = (): string | null => {
    let cursor = index;
    let length = 0;
    if (!/[0-9]/.test(input[cursor] ?? '')) return null;
    while (cursor < input.length && input[cursor]! >= '0' && input[cursor]! <= '9') {
      length = length * 10 + (input.charCodeAt(cursor) - 48);
      cursor += 1;
      if (length > 4096) return null;
    }
    if (cursor + length > input.length) return null;
    const name = input.slice(cursor, cursor + length);
    index = cursor + length;
    return name;
  };

  const parseSubstitution = (): string | null => {
    if (input[index] !== 'S') return null;
    index += 1;
    if (input[index] === '_') {
      index += 1;
      return subs[0] ?? null;
    }
    const abbreviations: Record<string, string> = {
      t: 'std',
      a: 'std::allocator',
      s: 'std::string',
      i: 'std::istream',
      o: 'std::ostream',
      d: 'std::iostream',
    };
    const abbr = abbreviations[input[index] ?? ''];
    if (abbr && input[index + 1] === '_') {
      index += 2;
      return abbr;
    }
    let seq = 0;
    let digits = 0;
    while (index < input.length && /[0-9A-Z]/.test(input[index] ?? '')) {
      const ch = input[index] ?? '0';
      const value = ch >= 'A' ? ch.charCodeAt(0) - 55 : ch.charCodeAt(0) - 48;
      seq = seq * 36 + value;
      index += 1;
      digits += 1;
      if (digits > 8) return null;
    }
    if (input[index] !== '_') return null;
    index += 1;
    return subs[seq + 1] ?? null;
  };

  const parseType = (): string | null => {
    const ch = input[index];
    if (!ch) return null;
    const builtin = ITANIUM_TYPES[ch];
    if (builtin) {
      index += 1;
      return builtin;
    }
    if (ch === 'P' || ch === 'R' || ch === 'O') {
      index += 1;
      const inner = parseType();
      if (!inner) return null;
      return `${inner}${ch === 'P' ? '*' : ch === 'R' ? '&' : '&&'}`;
    }
    if (ch === 'K' || ch === 'V') {
      index += 1;
      const inner = parseType();
      if (!inner) return null;
      return `${inner}${ch === 'K' ? ' const' : ' volatile'}`;
    }
    if (ch === 'S') return parseSubstitution();
    if (/[0-9]/.test(ch)) {
      const name = parseSource();
      if (!name) return null;
      subs.push(name);
      return name;
    }
    if (ch === 'N') return parseNested();
    return null;
  };

  const parseUnqualified = (): string | null => {
    const name = parseSource();
    if (!name) return null;
    if (input[index] !== 'I') return name;
    index += 1;
    const args: string[] = [];
    while (index < input.length && input[index] !== 'E') {
      const arg = parseType();
      if (!arg) return null;
      args.push(arg);
    }
    if (input[index] !== 'E') return null;
    index += 1;
    return `${name}<${args.join(', ')}>`;
  };

  const parseNested = (): string | null => {
    if (input[index] !== 'N') return null;
    index += 1;
    while (input[index] === 'r' || input[index] === 'V' || input[index] === 'K') index += 1;
    const parts: string[] = [];
    while (index < input.length && input[index] !== 'E') {
      if (input[index] === 'S') {
        const sub = parseSubstitution();
        if (!sub) return null;
        parts.push(sub);
        continue;
      }
      if (!/[0-9]/.test(input[index] ?? '')) break;
      const part = parseUnqualified();
      if (!part) return null;
      parts.push(part);
      subs.push(parts.join('::'));
    }
    if (input[index] !== 'E') return null;
    index += 1;
    return parts.join('::');
  };

  let name: string | null = null;
  if (input[index] === 'N') name = parseNested();
  else if (input[index] === 'S') name = parseSubstitution();
  else if (/[0-9]/.test(input[index] ?? '')) {
    name = parseUnqualified();
    if (name) subs.push(name);
  }
  if (!name) return null;
  const params: string[] = [];
  while (index < input.length) {
    const start = index;
    const param = parseType();
    if (!param) {
      index = start;
      break;
    }
    params.push(param);
  }
  if (params.length === 1 && params[0] === 'void') params.pop();
  return `${name}(${params.join(', ')})`;
}

export function demangleMsvc(input: string): string | null {
  if (!input.startsWith('?') || input.startsWith('??')) return null;
  let index = 1;
  const parts: string[] = [];
  let current = '';
  while (index < input.length) {
    if (input[index] === '@') {
      parts.push(current);
      current = '';
      index += 1;
      if (input[index] === '@') {
        index += 1;
        break;
      }
      continue;
    }
    current += input[index];
    index += 1;
  }
  const fn = parts[0];
  if (!fn) return null;
  const scopes = parts.slice(1).filter((part) => part.length > 0).reverse();
  const qualified = scopes.length ? `${scopes.join('::')}::${fn}` : fn;
  const signature = parseMsvcSignature(input.slice(index));
  if (!signature) return qualified;
  return `${signature.ret} ${qualified}(${signature.params.join(', ')})`;
}

function parseMsvcSignature(rest: string): { ret: string; params: string[] } | null {
  const prefixes = ['QEAA', 'QEBA', 'AEAA', 'QAE', 'YA', 'YB'];
  const prefix = prefixes.find((item) => rest.startsWith(item));
  if (!prefix) return null;
  let index = prefix.length;
  const types: string[] = [];
  while (index < rest.length && rest[index] !== '@' && rest[index] !== 'Z') {
    const two = rest.slice(index, index + 2);
    const type = MSVC_TYPES[two] ?? MSVC_TYPES[rest[index] ?? ''];
    if (!type) return types.length ? { ret: types[0] ?? 'void', params: types.slice(1) } : null;
    types.push(type);
    index += MSVC_TYPES[two] ? 2 : 1;
  }
  if (!types.length) return null;
  return { ret: types[0] ?? 'void', params: types.slice(1) };
}
