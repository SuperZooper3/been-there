// Append-only visit event batches for idempotent server replay.

import {
  getOfflineStorageItem,
  setOfflineStorageItem,
} from "@/lib/offline-storage";
import {
  ensureOfflineBufferReady,
  getOfflinePaintQueue,
  getOfflineEraseQueue,
  removeFromOfflinePaintQueue,
  removeFromOfflineEraseQueue,
} from "@/lib/offline-buffer";

const BATCHES_KEY = "bt_visit_batches";
const OPEN_BATCH_KEY = "bt_visit_open_batch";
const LEGACY_MIGRATED_KEY = "bt_visit_legacy_batches_migrated";

export type VisitEvent =
  | { op: "paint"; h3: string; t: string }
  | { op: "erase"; h3: string; t: string };

export type SealedVisitBatch = {
  clientBatchId: string;
  sealedAt: string;
  events: VisitEvent[];
};

type OpenBatch = {
  events: VisitEvent[];
};

function newBatchId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `batch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function readSealedBatches(): Promise<SealedVisitBatch[]> {
  await ensureOfflineBufferReady();
  try {
    const raw = await getOfflineStorageItem(BATCHES_KEY);
    return JSON.parse(raw ?? "[]") as SealedVisitBatch[];
  } catch {
    return [];
  }
}

async function writeSealedBatches(batches: SealedVisitBatch[]): Promise<void> {
  await setOfflineStorageItem(BATCHES_KEY, JSON.stringify(batches));
}

async function readOpenBatch(): Promise<OpenBatch> {
  await ensureOfflineBufferReady();
  try {
    const raw = await getOfflineStorageItem(OPEN_BATCH_KEY);
    if (!raw) return { events: [] };
    return JSON.parse(raw) as OpenBatch;
  } catch {
    return { events: [] };
  }
}

async function writeOpenBatch(batch: OpenBatch): Promise<void> {
  await setOfflineStorageItem(OPEN_BATCH_KEY, JSON.stringify(batch));
}

export async function appendPaintEvent(h3: string): Promise<void> {
  const open = await readOpenBatch();
  open.events.push({ op: "paint", h3, t: new Date().toISOString() });
  await writeOpenBatch(open);
}

export async function appendEraseEvent(h3: string): Promise<void> {
  const open = await readOpenBatch();
  open.events.push({ op: "erase", h3, t: new Date().toISOString() });
  await writeOpenBatch(open);
}

/** Move open batch into sealed list (if non-empty). */
export async function sealOpenBatch(): Promise<void> {
  const open = await readOpenBatch();
  if (open.events.length === 0) return;
  const sealed: SealedVisitBatch = {
    clientBatchId: newBatchId(),
    sealedAt: new Date().toISOString(),
    events: open.events,
  };
  const batches = await readSealedBatches();
  batches.push(sealed);
  await writeSealedBatches(batches);
  await writeOpenBatch({ events: [] });
}

export async function getSealedBatches(): Promise<SealedVisitBatch[]> {
  return readSealedBatches();
}

export async function removeSealedBatch(clientBatchId: string): Promise<void> {
  const batches = await readSealedBatches();
  await writeSealedBatches(batches.filter((b) => b.clientBatchId !== clientBatchId));
}

/** Cells implied by all unsynced batches (open + sealed) for map union. */
export async function getPendingCellsFromBatches(): Promise<{
  paints: Set<string>;
  erases: Set<string>;
}> {
  const paints = new Set<string>();
  const erases = new Set<string>();
  const open = await readOpenBatch();
  const sealed = await readSealedBatches();
  const allEvents = [...sealed.flatMap((b) => b.events), ...open.events];
  for (const ev of allEvents) {
    if (ev.op === "paint") {
      paints.add(ev.h3);
      erases.delete(ev.h3);
    } else {
      erases.add(ev.h3);
      paints.delete(ev.h3);
    }
  }
  return { paints, erases };
}

export async function hasUnsyncedBatches(): Promise<boolean> {
  const open = await readOpenBatch();
  const sealed = await readSealedBatches();
  return open.events.length > 0 || sealed.length > 0;
}

export async function countUnsyncedEvents(): Promise<number> {
  const open = await readOpenBatch();
  const sealed = await readSealedBatches();
  return open.events.length + sealed.reduce((n, b) => n + b.events.length, 0);
}

/** Most recent local paint event (open + sealed batches), if any. */
export async function getLatestPaintCell(): Promise<{ h3: string; t: string } | null> {
  const open = await readOpenBatch();
  const sealed = await readSealedBatches();
  const paints = [...sealed.flatMap((b) => b.events), ...open.events].filter(
    (ev): ev is Extract<VisitEvent, { op: "paint" }> => ev.op === "paint"
  );
  if (paints.length === 0) return null;
  let best = paints[0];
  for (const ev of paints) {
    if (Date.parse(ev.t) > Date.parse(best.t)) best = ev;
  }
  return { h3: best.h3, t: best.t };
}

/** One-time: legacy paint cells → sealed batch (RPC); legacy erases stay for DELETE /api/cells. */
export async function migrateLegacyQueuesToBatch(paintCells: string[]): Promise<void> {
  const flag = await getOfflineStorageItem(LEGACY_MIGRATED_KEY);
  if (flag === "1") return;
  if (paintCells.length === 0) {
    await setOfflineStorageItem(LEGACY_MIGRATED_KEY, "1");
    return;
  }
  const now = new Date().toISOString();
  // Only paints go through batch RPC; erases stay on legacy DELETE /api/cells sync.
  const events: VisitEvent[] = paintCells.map((h3) => ({ op: "paint" as const, h3, t: now }));
  const sealed: SealedVisitBatch = {
    clientBatchId: newBatchId(),
    sealedAt: now,
    events,
  };
  const batches = await readSealedBatches();
  if (events.length > 0) {
    batches.push(sealed);
    await writeSealedBatches(batches);
    await removeFromOfflinePaintQueue(paintCells);
  }
  await setOfflineStorageItem(LEGACY_MIGRATED_KEY, "1");
}

/** On app load: move any legacy cell queues into sealed batches once. */
export async function migrateLegacyQueuesIfNeeded(): Promise<void> {
  const paints = await getOfflinePaintQueue();
  await migrateLegacyQueuesToBatch(paints);
}
