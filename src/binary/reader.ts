export class ParseError extends Error {
  readonly recoverable: boolean;

  constructor(message: string, recoverable = false) {
    super(message);
    this.name = 'ParseError';
    this.recoverable = recoverable;
  }
}

export class Reader {
  readonly view: DataView;

  constructor(
    readonly bytes: Uint8Array,
    readonly little: boolean,
  ) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get length(): number {
    return this.bytes.length;
  }

  need(offset: number, size: number): void {
    if (!Number.isFinite(offset) || !Number.isFinite(size) || offset < 0 || size < 0 || offset + size > this.bytes.length) {
      throw new ParseError('Truncated or out-of-range read', true);
    }
  }

  u8(offset: number): number {
    this.need(offset, 1);
    return this.bytes[offset] ?? 0;
  }

  u16(offset: number): number {
    this.need(offset, 2);
    return this.view.getUint16(offset, this.little);
  }

  u32(offset: number): number {
    this.need(offset, 4);
    return this.view.getUint32(offset, this.little);
  }

  i16(offset: number): number {
    this.need(offset, 2);
    return this.view.getInt16(offset, this.little);
  }

  i32(offset: number): number {
    this.need(offset, 4);
    return this.view.getInt32(offset, this.little);
  }

  u64Parts(offset: number): { hi: number; lo: number } {
    this.need(offset, 8);
    const lo = this.view.getUint32(this.little ? offset : offset + 4, this.little);
    const hi = this.view.getUint32(this.little ? offset + 4 : offset, this.little);
    return { hi, lo };
  }

  u64Maybe(offset: number): { value: number | null; hex: string } {
    const { hi, lo } = this.u64Parts(offset);
    const hex = `0x${hi.toString(16).padStart(8, '0')}${lo.toString(16).padStart(8, '0')}`;
    const value = hi * 0x100000000 + lo;
    return { value: Number.isSafeInteger(value) ? value : null, hex };
  }

  u64(offset: number): number {
    const field = this.u64Maybe(offset);
    if (field.value === null) {
      throw new ParseError(`64-bit value ${field.hex} exceeds the safe integer range`, true);
    }
    return field.value;
  }

  /** Big-endian unsigned integers, used by Mach-O fat headers. */
  u16be(offset: number): number {
    this.need(offset, 2);
    return this.view.getUint16(offset, false);
  }

  u32be(offset: number): number {
    this.need(offset, 4);
    return this.view.getUint32(offset, false);
  }

  i32be(offset: number): number {
    this.need(offset, 4);
    return this.view.getInt32(offset, false);
  }

  cstr(offset: number, max: number): string {
    if (offset < 0 || offset >= this.bytes.length) return '';
    const endLimit = Math.min(this.bytes.length, offset + max);
    let end = offset;
    while (end < endLimit && this.bytes[end] !== 0) end += 1;
    return decodeUtf8(this.bytes.subarray(offset, end));
  }

  slice(offset: number, size: number): Uint8Array {
    this.need(offset, size);
    return this.bytes.subarray(offset, offset + size);
  }
}

export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

export function asciiZ(bytes: Uint8Array): string {
  let end = 0;
  while (end < bytes.length && bytes[end] !== 0) end += 1;
  let out = '';
  for (let i = 0; i < end; i += 1) out += String.fromCharCode(bytes[i] ?? 0);
  return out;
}

export function hex(value: number, width = 0): string {
  if (!Number.isFinite(value) || value < 0) return '0x0';
  const text = value.toString(16);
  return `0x${width > 0 ? text.padStart(width, '0') : text}`;
}

export function uleb(bytes: Uint8Array, offset: number): { value: number; next: number } {
  let result = 0;
  let shift = 0;
  let index = offset;
  for (let i = 0; i < 8; i += 1) {
    if (index >= bytes.length) throw new ParseError('Truncated ULEB128', true);
    const byte = bytes[index] ?? 0;
    index += 1;
    result += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) {
      if (!Number.isSafeInteger(result)) throw new ParseError('ULEB128 is too large', true);
      return { value: result, next: index };
    }
    shift += 7;
  }
  throw new ParseError('ULEB128 is too long', true);
}
