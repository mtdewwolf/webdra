import { describe, expect, it } from 'vitest';
import { displayName } from '../../src/ui/names';
import { parseProjectFile } from '../../src/storage/projectFile';
import { cacheNamesToRemove, isOurServiceWorkerScope, storageKeysToRemove } from '../../src/storage/localData';

const sha = 'a'.repeat(64);

describe('project import', () => {
  it('rejects a non-string rename that would crash the listing', () => {
    expect(() => parseProjectFile({ version: 1, sha256: sha, renames: { '401000': {} }, comments: {}, bookmarks: [] }, sha)).toThrow(/text/);
    const renamed = displayName(0x401000, [], { '401000': {} as unknown as string });
    expect(renamed).toBe('sub_401000');
  });

  it('requires an open file with the same SHA-256 and capped string fields', () => {
    expect(() => parseProjectFile({ version: 1, sha256: sha, renames: {}, comments: {}, bookmarks: [] }, null)).toThrow(/Open the matching file/);
    expect(() => parseProjectFile({ version: 1, sha256: 'b'.repeat(64), renames: {}, comments: {}, bookmarks: [] }, sha)).toThrow(/does not match/);
    const project = parseProjectFile({
      version: 1,
      sha256: sha,
      renames: { '401000': 'helper' },
      comments: { '401010': 'note' },
      bookmarks: [0x401000, { address: '401010', label: 'here' }],
    }, sha);
    expect(project.renames['401000']).toBe('helper');
    expect(project.bookmarks.map((item) => item.address)).toEqual(['401000', '401010']);
    expect(() => parseProjectFile({ version: 1, sha256: sha, renames: {}, comments: {}, bookmarks: { '401000': 'nope' } }, sha)).toThrow(/array/);
  });
});

describe('local data scope', () => {
  it('only selects Webdra keys, caches, and worker scopes', () => {
    expect(storageKeysToRemove(['webdra.font', 'other.setting', 'webdra.session'])).toEqual(['webdra.font', 'webdra.session']);
    expect(cacheNamesToRemove(['webdra-shell-abc', 'other-site', 'webdra-shell-v1'])).toEqual(['webdra-shell-abc', 'webdra-shell-v1']);
    expect(isOurServiceWorkerScope('https://mtdewwolf.github.io/webdra/', 'https://mtdewwolf.github.io/webdra/')).toBe(true);
    expect(isOurServiceWorkerScope('https://mtdewwolf.github.io/blog/', 'https://mtdewwolf.github.io/webdra/')).toBe(false);
  });
});
