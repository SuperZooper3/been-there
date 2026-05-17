// Offline buffer for GPS-derived cell writes (async; Preferences on native, localStorage on web).

import {
  getOfflineStorageItem,
  setOfflineStorageItem,
  removeOfflineStorageItem,
  migrateLegacyOfflineStorage,
} from "@/lib/offline-storage";

const PAINT_KEY = "bt_offline_paint";
const ERASE_KEY = "bt_offline_erase";

let initPromise: Promise<void> | null = null;

export async function ensureOfflineBufferReady(): Promise<void> {
  if (!initPromise) {
    initPromise = migrateLegacyOfflineStorage();
  }
  await initPromise;
}

async function readQueue(key: string): Promise<string[]> {
  await ensureOfflineBufferReady();
  try {
    const raw = await getOfflineStorageItem(key);
    return JSON.parse(raw ?? "[]") as string[];
  } catch {
    return [];
  }
}

async function writeQueue(key: string, cells: string[]): Promise<void> {
  await ensureOfflineBufferReady();
  try {
    if (cells.length === 0) {
      await removeOfflineStorageItem(key);
    } else {
      await setOfflineStorageItem(key, JSON.stringify(cells));
    }
  } catch {
    /* storage full */
  }
}

export async function getOfflinePaintQueue(): Promise<string[]> {
  return readQueue(PAINT_KEY);
}

export async function getOfflineEraseQueue(): Promise<string[]> {
  return readQueue(ERASE_KEY);
}

export async function appendOfflinePaintQueue(cells: string[]): Promise<void> {
  if (cells.length === 0) return;
  const existing = new Set(await readQueue(PAINT_KEY));
  cells.forEach((c) => existing.add(c));
  await writeQueue(PAINT_KEY, [...existing]);
}

export async function appendOfflineEraseQueue(cells: string[]): Promise<void> {
  if (cells.length === 0) return;
  const existing = new Set(await readQueue(ERASE_KEY));
  cells.forEach((c) => existing.add(c));
  await writeQueue(ERASE_KEY, [...existing]);
}

export async function removeFromOfflinePaintQueue(cells: string[]): Promise<void> {
  if (cells.length === 0) return;
  const toRemove = new Set(cells);
  const remaining = (await readQueue(PAINT_KEY)).filter((c) => !toRemove.has(c));
  await writeQueue(PAINT_KEY, remaining);
}

export async function removeFromOfflineEraseQueue(cells: string[]): Promise<void> {
  if (cells.length === 0) return;
  const toRemove = new Set(cells);
  const remaining = (await readQueue(ERASE_KEY)).filter((c) => !toRemove.has(c));
  await writeQueue(ERASE_KEY, remaining);
}

export async function hasOfflineQueued(): Promise<boolean> {
  const [p, e] = await Promise.all([getOfflinePaintQueue(), getOfflineEraseQueue()]);
  return p.length > 0 || e.length > 0;
}

/** Union server cells with pending offline paints, minus pending erases. */
export async function mergeServerCellsWithOfflineQueue(serverCells: string[]): Promise<Set<string>> {
  const [paints, erases] = await Promise.all([getOfflinePaintQueue(), getOfflineEraseQueue()]);
  const merged = new Set(serverCells);
  for (const c of erases) merged.delete(c);
  for (const c of paints) merged.add(c);
  return merged;
}
