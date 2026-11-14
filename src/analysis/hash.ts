export async function digestHex(algorithm: 'SHA-1' | 'SHA-256', bytes: Uint8Array): Promise<string> {
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest(algorithm, copy);
  const view = new Uint8Array(digest);
  let hex = '';
  for (let index = 0; index < view.length; index += 1) hex += (view[index] ?? 0).toString(16).padStart(2, '0');
  return hex;
}
