// Offline buffer for GPS-derived cell writes.
//
// When the device has no network, painted and erased cells are persisted here
// in localStorage instead of being dropped. On reconnect (or app load), the
// queues are flushed to the server in the correct order: erases first, then
// paints — so that a cell erased offline is not re-added by a pending paint.
//
// The upsert schema (onConflict: user_id,h3_index) makes repeated sends safe;
// the server just refreshes last_visited_at on duplicate paints.

const PAINT_KEY = 'bt_offline_paint';
const ERASE_KEY = 'bt_offline_erase';

function readQueue(key: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]');
  } catch {
    return [];
  }
}

function writeQueue(key: string, cells: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(cells));
  } catch {
    // localStorage full or unavailable — silently skip
  }
}

export function getOfflinePaintQueue(): string[] {
  return readQueue(PAINT_KEY);
}

export function getOfflineEraseQueue(): string[] {
  return readQueue(ERASE_KEY);
}

export function appendOfflinePaintQueue(cells: string[]): void {
  const existing = new Set(readQueue(PAINT_KEY));
  cells.forEach((c) => existing.add(c));
  writeQueue(PAINT_KEY, [...existing]);
}

export function appendOfflineEraseQueue(cells: string[]): void {
  const existing = new Set(readQueue(ERASE_KEY));
  cells.forEach((c) => existing.add(c));
  writeQueue(ERASE_KEY, [...existing]);
}

export function clearOfflinePaintQueue(): void {
  localStorage.removeItem(PAINT_KEY);
}

export function clearOfflineEraseQueue(): void {
  localStorage.removeItem(ERASE_KEY);
}

export function hasOfflineQueued(): boolean {
  return getOfflinePaintQueue().length > 0 || getOfflineEraseQueue().length > 0;
}
