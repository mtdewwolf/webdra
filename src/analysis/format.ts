export function formatAddress(value: number, bits: 16 | 32 | 64 = 64): string {
  const width = bits === 64 ? 12 : 8;
  if (!Number.isSafeInteger(value) || value < 0) return '0x0';
  return `0x${value.toString(16).padStart(width, '0')}`;
}

export function formatBytes(bytes: number[]): string {
  return bytes.map((byte) => (byte & 0xff).toString(16).padStart(2, '0')).join(' ');
}

export function addressKey(address: number): string {
  return address.toString(16);
}
