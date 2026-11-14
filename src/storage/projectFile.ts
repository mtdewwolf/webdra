import type { ProjectData } from '../ir/types';

const SHA256 = /^[0-9a-f]{64}$/;
const HEX_ADDRESS = /^[0-9a-f]{1,16}$/;
const MAX_MAP_ENTRIES = 10000;
const MAX_BOOKMARKS = 1000;
const MAX_NAME = 256;
const MAX_COMMENT = 4000;

export function parseProjectFile(value: unknown, openSha256: string | null): ProjectData {
  if (!openSha256) throw new Error('Open the matching file before importing notes.');
  if (!isPlainObject(value)) throw new Error('This is not a Webdra project file.');
  if (value.version !== 1) throw new Error('Unsupported project version.');
  if (typeof value.sha256 !== 'string' || !SHA256.test(value.sha256)) throw new Error('Project is missing a SHA-256.');
  if (value.sha256 !== openSha256) throw new Error('Project hash does not match the open file.');
  return {
    version: 1,
    sha256: value.sha256,
    renames: stringMap(value.renames, MAX_NAME, 'Renames'),
    comments: stringMap(value.comments, MAX_COMMENT, 'Comments'),
    bookmarks: bookmarkList(value.bookmarks),
  };
}

function stringMap(value: unknown, maxLength: number, label: string): Record<string, string> {
  if (!isPlainObject(value)) throw new Error(`${label} must be an object.`);
  const entries = Object.entries(value);
  if (entries.length > MAX_MAP_ENTRIES) throw new Error(`${label} has too many entries.`);
  const out: Record<string, string> = {};
  for (const [key, item] of entries) {
    if (!HEX_ADDRESS.test(key)) throw new Error(`${label} has an invalid address.`);
    if (typeof item !== 'string') throw new Error(`${label} values must be text.`);
    if (item.length > maxLength) throw new Error(`${label} value is too long.`);
    out[key.toLowerCase()] = item;
  }
  return out;
}

function bookmarkList(value: unknown): ProjectData['bookmarks'] {
  if (!Array.isArray(value)) throw new Error('Bookmarks must be an array.');
  if (value.length > MAX_BOOKMARKS) throw new Error('Too many bookmarks.');
  return value.map((item) => {
    if (typeof item === 'number') {
      if (!Number.isSafeInteger(item) || item < 0) throw new Error('Bookmark address is invalid.');
      return { address: item.toString(16), label: '' };
    }
    if (!isPlainObject(item)) throw new Error('Bookmark is invalid.');
    const address = item.address;
    const label = item.label;
    const hex = typeof address === 'number'
      ? (Number.isSafeInteger(address) && address >= 0 ? address.toString(16) : '')
      : (typeof address === 'string' && HEX_ADDRESS.test(address) ? address.toLowerCase() : '');
    if (!hex) throw new Error('Bookmark address is invalid.');
    if (typeof label !== 'string' || label.length > MAX_NAME) throw new Error('Bookmark label is invalid.');
    return { address: hex, label };
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
