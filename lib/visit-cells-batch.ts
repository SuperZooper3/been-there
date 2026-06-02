import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";

const EVENT_CHUNK = 500;

export interface VisitCellEvent {
  clientEventId: string;
  h3Index: string;
  visitedAt: string;
}

/**
 * Applies ordered visit events through the DB idempotency ledger.
 * Retrying the same clientEventId is safe: the RPC records and applies it at most once.
 */
export async function applyVisitEventsBatch(
  supabase: SupabaseClient<Database>,
  events: VisitCellEvent[]
): Promise<{ ok: true; applied: number; duplicates: number } | { ok: false; message: string }> {
  let applied = 0;
  let duplicates = 0;

  for (let i = 0; i < events.length; i += EVENT_CHUNK) {
    const chunk = events.slice(i, i + EVENT_CHUNK).map((event) => ({
      client_event_id: event.clientEventId,
      h3_index: event.h3Index,
      visited_at: event.visitedAt,
    }));

    const { data, error } = await supabase.rpc("apply_visit_events_batch", {
      events: chunk as Json,
    });

    if (error) return { ok: false, message: error.message };
    if (data && typeof data === "object" && !Array.isArray(data)) {
      const maybeApplied = data.applied;
      const maybeDuplicates = data.duplicates;
      applied += typeof maybeApplied === "number" ? maybeApplied : 0;
      duplicates += typeof maybeDuplicates === "number" ? maybeDuplicates : 0;
    }
  }

  return { ok: true, applied, duplicates };
}

/**
 * Backwards-compatible wrapper for old callers that only send cells.
 */
export async function applyVisitCellsBatch(
  supabase: SupabaseClient<Database>,
  userId: string,
  cells: string[]
): Promise<{ ok: true; applied: number; duplicates: number } | { ok: false; message: string }> {
  const nowIso = new Date().toISOString();
  const requestId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  return applyVisitEventsBatch(
    supabase,
    cells.map((cell, index) => ({
      clientEventId: `server-cell:${userId}:${requestId}:${index}`,
      h3Index: cell,
      visitedAt: nowIso,
    }))
  );
}
