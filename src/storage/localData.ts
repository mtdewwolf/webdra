export const WEBDRA_DB_NAME = 'webdra';
export const WEBDRA_CACHE_PREFIX = 'webdra-shell-';
export const WEBDRA_STORAGE_PREFIX = 'webdra.';

export function storageKeysToRemove(keys: readonly string[]): string[] {
  return keys.filter((key) => key.startsWith(WEBDRA_STORAGE_PREFIX));
}

export function cacheNamesToRemove(names: readonly string[]): string[] {
  return names.filter((name) => name.startsWith(WEBDRA_CACHE_PREFIX));
}

/** True when a service-worker registration belongs to this deployment, not another site on the same origin. */
export function isOurServiceWorkerScope(scope: string, baseHref: string): boolean {
  try {
    const scopeUrl = new URL(scope);
    const baseUrl = new URL(baseHref);
    if (scopeUrl.origin !== baseUrl.origin) return false;
    const basePath = baseUrl.pathname.endsWith('/') ? baseUrl.pathname : `${baseUrl.pathname}/`;
    const scopePath = scopeUrl.pathname.endsWith('/') ? scopeUrl.pathname : `${scopeUrl.pathname}/`;
    return scopePath.startsWith(basePath);
  } catch {
    return false;
  }
}
