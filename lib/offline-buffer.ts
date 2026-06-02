// Offline buffer for local cell writes and GPS pings.
//
// Manual paints/erases are preserved as cell sets. GPS tracking is preserved as
// ordered pings with stable client event IDs, so a retry after a flaky sync
// response cannot double-count a visit on the backend.
//
// On reconnect (or app load), queues are flushed erases first, then paints,
// then GPS pings.

const PAINT_KEY = 'bt_offline_paint';
const ERASE_KEY = 'bt_offline_erase';
const GPS_PINGS_KEY = 'bt_offline_gps_pings_v1';
const OFFLINE_TRANSFER_PREFIX = 'bt-offline-transfer-v1:';

export interface OfflineGpsPing {
  id: string;
  recordedAt: string;
  lat: number;
  lng: number;
  cells: string[];
}

export interface OfflineVisitEvent {
  clientEventId: string;
  h3Index: string;
  visitedAt: string;
}

export interface OfflineQueueStats {
  gpsPingCount: number;
  gpsVisitEventCount: number;
  gpsUniqueCellCount: number;
  manualPaintCellCount: number;
  manualEraseCellCount: number;
  totalQueuedCount: number;
  lastRecordedAt: string | null;
}

interface LegacyVisitBatch {
  clientBatchId?: string;
  events?: Array<{
    op?: string;
    h3?: string;
    t?: string;
  }>;
}

interface OfflineTransferPayload {
  gpsPings?: unknown;
  paints?: unknown;
  erases?: unknown;
  visitBatches?: unknown;
  openBatch?: unknown;
}

function readQueue(key: string): string[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const parsed = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function writeQueue(key: string, cells: string[]): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(key, JSON.stringify(cells));
    return true;
  } catch {
    // localStorage full or unavailable — caller keeps in-memory state only
    return false;
  }
}

function newLocalId(prefix: string): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return `${prefix}-${cryptoObj.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function readGpsPings(): OfflineGpsPing[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const parsed = JSON.parse(localStorage.getItem(GPS_PINGS_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];

    const seen = new Set<string>();
    const pings: OfflineGpsPing[] = [];
    for (const item of parsed) {
      if (
        item &&
        typeof item.id === 'string' &&
        !seen.has(item.id) &&
        typeof item.recordedAt === 'string' &&
        typeof item.lat === 'number' &&
        Number.isFinite(item.lat) &&
        typeof item.lng === 'number' &&
        Number.isFinite(item.lng) &&
        Array.isArray(item.cells)
      ) {
        const cells: string[] = item.cells.filter((cell: unknown): cell is string => typeof cell === 'string');
        if (cells.length === 0) continue;
        seen.add(item.id);
        pings.push({
          id: item.id,
          recordedAt: item.recordedAt,
          lat: item.lat,
          lng: item.lng,
          cells: [...new Set<string>(cells)],
        });
      }
    }
    return pings;
  } catch {
    return [];
  }
}

function writeGpsPings(pings: OfflineGpsPing[]): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(GPS_PINGS_KEY, JSON.stringify(pings));
    return true;
  } catch {
    return false;
  }
}

function normalizeGpsPing(item: unknown): OfflineGpsPing | null {
  if (!item || typeof item !== 'object') return null;
  const record = item as Record<string, unknown>;
  if (
    typeof record.id !== 'string' ||
    typeof record.recordedAt !== 'string' ||
    typeof record.lat !== 'number' ||
    !Number.isFinite(record.lat) ||
    typeof record.lng !== 'number' ||
    !Number.isFinite(record.lng) ||
    !Array.isArray(record.cells)
  ) {
    return null;
  }
  const cells: string[] = record.cells.filter((cell: unknown): cell is string => typeof cell === 'string');
  if (cells.length === 0) return null;
  return {
    id: record.id,
    recordedAt: record.recordedAt,
    lat: record.lat,
    lng: record.lng,
    cells: [...new Set<string>(cells)],
  };
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function legacyBatchesToGpsPings(value: unknown): OfflineGpsPing[] {
  if (!Array.isArray(value)) return [];
  const pings: OfflineGpsPing[] = [];

  value.forEach((batch: LegacyVisitBatch, batchIndex) => {
    const batchId = typeof batch?.clientBatchId === 'string'
      ? batch.clientBatchId
      : `legacy-batch-${batchIndex}`;
    const events = Array.isArray(batch?.events) ? batch.events : [];
    events.forEach((event, eventIndex) => {
      if (event?.op !== 'paint' || typeof event.h3 !== 'string') return;
      const visitedAt = typeof event.t === 'string' && !Number.isNaN(Date.parse(event.t))
        ? new Date(Date.parse(event.t)).toISOString()
        : new Date().toISOString();
      pings.push({
        id: `legacy:${batchId}:${eventIndex}`,
        recordedAt: visitedAt,
        lat: 0,
        lng: 0,
        cells: [event.h3],
      });
    });
  });

  return pings;
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

/** Remove only the specified cells from a queue, leaving any newly-appended items intact. */
export function removeFromOfflinePaintQueue(cells: string[]): void {
  const toRemove = new Set(cells);
  const remaining = readQueue(PAINT_KEY).filter((c) => !toRemove.has(c));
  if (remaining.length === 0) {
    localStorage.removeItem(PAINT_KEY);
  } else {
    writeQueue(PAINT_KEY, remaining);
  }
}

export function removeFromOfflineEraseQueue(cells: string[]): void {
  const toRemove = new Set(cells);
  const remaining = readQueue(ERASE_KEY).filter((c) => !toRemove.has(c));
  if (remaining.length === 0) {
    localStorage.removeItem(ERASE_KEY);
  } else {
    writeQueue(ERASE_KEY, remaining);
  }
}

export function createOfflineGpsPing(input: {
  lat: number;
  lng: number;
  cells: string[];
  recordedAtMs?: number;
}): OfflineGpsPing {
  const recordedAtMs =
    typeof input.recordedAtMs === 'number' &&
    Number.isFinite(input.recordedAtMs) &&
    input.recordedAtMs > 0
      ? input.recordedAtMs
      : Date.now();

  return {
    id: newLocalId('gps'),
    recordedAt: new Date(recordedAtMs).toISOString(),
    lat: input.lat,
    lng: input.lng,
    cells: [...new Set(input.cells)],
  };
}

export function getOfflineGpsPings(): OfflineGpsPing[] {
  return readGpsPings();
}

export function appendOfflineGpsPing(ping: OfflineGpsPing): boolean {
  if (ping.cells.length === 0) return true;
  const existing = readGpsPings();
  if (existing.some((p) => p.id === ping.id)) return true;
  return writeGpsPings([...existing, ping]);
}

export function removeOfflineGpsPings(ids: string[]): void {
  const toRemove = new Set(ids);
  const remaining = readGpsPings().filter((p) => !toRemove.has(p.id));
  if (remaining.length === 0) {
    localStorage.removeItem(GPS_PINGS_KEY);
  } else {
    writeGpsPings(remaining);
  }
}

export function importOfflineTransferPayload(payload: OfflineTransferPayload): boolean {
  const paints = normalizeStringArray(payload.paints);
  const incomingPings = [
    ...(Array.isArray(payload.gpsPings)
      ? payload.gpsPings
          .map(normalizeGpsPing)
          .filter((ping): ping is OfflineGpsPing => ping !== null)
      : []),
    ...legacyBatchesToGpsPings(payload.visitBatches),
    ...legacyBatchesToGpsPings(Array.isArray(payload.openBatch) ? payload.openBatch : [payload.openBatch]),
  ];
  const erases = normalizeStringArray(payload.erases);

  let changed = false;
  if (incomingPings.length > 0) {
    const existing = readGpsPings();
    const byId = new Map(existing.map((ping) => [ping.id, ping] as [string, OfflineGpsPing]));
    for (const ping of incomingPings) {
      if (!byId.has(ping.id)) {
        byId.set(ping.id, ping);
        changed = true;
      }
    }
    if (changed) writeGpsPings([...byId.values()]);
  }

  if (paints.length > 0) {
    appendOfflinePaintQueue(paints);
    changed = true;
  }

  if (erases.length > 0) {
    appendOfflineEraseQueue(erases);
    changed = true;
  }

  return changed;
}

export function importOfflineTransferFromWindowName(): boolean {
  if (typeof window === 'undefined') return false;
  const raw = window.name;
  if (typeof raw !== 'string' || !raw.startsWith(OFFLINE_TRANSFER_PREFIX)) return false;

  try {
    const payload = JSON.parse(raw.slice(OFFLINE_TRANSFER_PREFIX.length)) as OfflineTransferPayload;
    const changed = importOfflineTransferPayload(payload);
    window.name = '';
    return changed;
  } catch {
    return false;
  }
}

export function offlineGpsPingsToVisitEvents(pings: OfflineGpsPing[]): OfflineVisitEvent[] {
  const events: OfflineVisitEvent[] = [];
  for (const ping of pings) {
    ping.cells.forEach((cell, index) => {
      events.push({
        clientEventId: `${ping.id}:${index.toString().padStart(4, '0')}`,
        h3Index: cell,
        visitedAt: ping.recordedAt,
      });
    });
  }
  return events;
}

export function getOfflineGpsCellSet(): Set<string> {
  const cells = new Set<string>();
  for (const ping of readGpsPings()) {
    ping.cells.forEach((cell) => cells.add(cell));
  }
  return cells;
}

export function getLatestOfflineGpsVisit(): { h3: string; t: string } | null {
  let latest: { h3: string; t: string } | null = null;
  let latestMs = 0;
  for (const ping of readGpsPings()) {
    const ms = Date.parse(ping.recordedAt);
    if (!Number.isNaN(ms) && ms >= latestMs) {
      latestMs = ms;
      latest = { h3: ping.cells[ping.cells.length - 1], t: ping.recordedAt };
    }
  }
  return latest;
}

export function getOfflineQueueStats(): OfflineQueueStats {
  const pings = readGpsPings();
  const gpsCells = new Set<string>();
  let gpsVisitEventCount = 0;
  let lastRecordedAt: string | null = null;
  let lastRecordedAtMs = 0;

  for (const ping of pings) {
    gpsVisitEventCount += ping.cells.length;
    ping.cells.forEach((cell) => gpsCells.add(cell));
    const ms = Date.parse(ping.recordedAt);
    if (!Number.isNaN(ms) && ms >= lastRecordedAtMs) {
      lastRecordedAtMs = ms;
      lastRecordedAt = ping.recordedAt;
    }
  }

  const manualPaintCellCount = getOfflinePaintQueue().length;
  const manualEraseCellCount = getOfflineEraseQueue().length;

  return {
    gpsPingCount: pings.length,
    gpsVisitEventCount,
    gpsUniqueCellCount: gpsCells.size,
    manualPaintCellCount,
    manualEraseCellCount,
    totalQueuedCount: gpsVisitEventCount + manualPaintCellCount + manualEraseCellCount,
    lastRecordedAt,
  };
}

export function hasOfflineQueued(): boolean {
  return (
    getOfflinePaintQueue().length > 0 ||
    getOfflineEraseQueue().length > 0 ||
    getOfflineGpsPings().length > 0
  );
}
