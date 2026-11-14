import type { ProjectData } from '../ir/types';

const DB_NAME = 'webdra';
const DB_VERSION = 1;

export interface StoredBinary {
  sha256: string;
  bytes: ArrayBuffer;
  savedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'sha256' });
      if (!db.objectStoreNames.contains('binaries')) db.createObjectStore('binaries', { keyPath: 'sha256' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB failed to open'));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export async function loadProject(sha256: string): Promise<ProjectData | null> {
  const db = await openDb();
  try {
    const result = await requestToPromise(db.transaction('projects').objectStore('projects').get(sha256));
    return (result as ProjectData | undefined) ?? null;
  } finally {
    db.close();
  }
}

export async function saveProject(project: ProjectData): Promise<void> {
  const db = await openDb();
  try {
    await requestToPromise(db.transaction('projects', 'readwrite').objectStore('projects').put(project));
  } finally {
    db.close();
  }
}

export async function saveBinary(record: StoredBinary): Promise<void> {
  const db = await openDb();
  try {
    await requestToPromise(db.transaction('binaries', 'readwrite').objectStore('binaries').put(record));
  } finally {
    db.close();
  }
}

export async function loadBinary(sha256: string): Promise<StoredBinary | null> {
  const db = await openDb();
  try {
    const result = await requestToPromise(db.transaction('binaries').objectStore('binaries').get(sha256));
    return (result as StoredBinary | undefined) ?? null;
  } finally {
    db.close();
  }
}

export async function listBinaries(): Promise<{ sha256: string; savedAt: number }[]> {
  const db = await openDb();
  try {
    const all = (await requestToPromise(db.transaction('binaries').objectStore('binaries').getAll())) as StoredBinary[];
    return all.map((item) => ({ sha256: item.sha256, savedAt: item.savedAt }));
  } finally {
    db.close();
  }
}

export async function deleteAllLocalData(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Could not delete local data'));
    request.onblocked = () => resolve();
  });
  localStorage.clear();
  sessionStorage.clear();
  if ('caches' in globalThis) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
}

export function emptyProject(sha256: string): ProjectData {
  return { version: 1, sha256, renames: {}, comments: {}, bookmarks: [] };
}
