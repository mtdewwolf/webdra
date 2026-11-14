/** Service workers may cache the app shell only. User files are never requests. */
export function shouldCacheRequest(method: string, origin: string, selfOrigin: string, path: string, assets: readonly string[]): boolean {
  if (method !== 'GET') return false;
  if (origin !== selfOrigin) return false;
  if (path.endsWith('/_headers')) return false;
  return assets.includes(path);
}
