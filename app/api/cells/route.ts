import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase-server";
import { resolutionForZoom } from "@/lib/h3";
import { aggregateVisitRows, type VisitMetricRow } from "@/lib/cell-metrics";
import {
  applyVisitCellsBatch,
  applyVisitEventsBatch,
  type VisitCellEvent,
} from "@/lib/visit-cells-batch";

/** Matches PostgREST default max rows; fetch in pages so we return the full set in one response. */
const VISIT_CELLS_PAGE_SIZE = 1000;
const MAX_VISIT_EVENTS_PER_REQUEST = 5000;

function normalizeVisitEvents(input: unknown): VisitCellEvent[] {
  if (!Array.isArray(input)) return [];
  const events: VisitCellEvent[] = [];

  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const clientEventId = record.clientEventId ?? record.client_event_id;
    const h3Index = record.h3Index ?? record.h3_index ?? record.cell;
    const visitedAt = record.visitedAt ?? record.visited_at;

    if (
      typeof clientEventId !== "string" ||
      typeof h3Index !== "string" ||
      typeof visitedAt !== "string"
    ) {
      continue;
    }

    const visitedAtMs = Date.parse(visitedAt);
    if (Number.isNaN(visitedAtMs)) continue;

    events.push({
      clientEventId,
      h3Index,
      visitedAt: new Date(visitedAtMs).toISOString(),
    });
  }

  return events.slice(0, MAX_VISIT_EVENTS_PER_REQUEST);
}

/**
 * GET /api/cells?zoom=<n>
 * Returns visited cells for the current user at the H3 resolution for zoom,
 * plus optional intelligence metrics per displayed cell.
 */
export async function GET(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const zoom = Number(request.nextUrl.searchParams.get("zoom") ?? "13");
  const renderResolution = resolutionForZoom(zoom);

  const fetchAllRows = async () => {
    const all: VisitMetricRow[] = [];
    let offset = 0;
    for (;;) {
      const { data, error } = await supabase
        .from("visit_cells")
        .select("h3_index, first_visited_at, last_visited_at, visit_count")
        .eq("user_id", user.id)
        .order("id", { ascending: true })
        .range(offset, offset + VISIT_CELLS_PAGE_SIZE - 1);
      if (error) return { data: null as VisitMetricRow[] | null, error };
      const page = (data ?? []) as VisitMetricRow[];
      all.push(...page);
      if (page.length < VISIT_CELLS_PAGE_SIZE) break;
      offset += VISIT_CELLS_PAGE_SIZE;
    }
    return { data: all, error: null };
  };

  const [rowsRes, recentRes] = await Promise.all([
    fetchAllRows(),
    supabase
      .from("visit_cells")
      .select("h3_index")
      .eq("user_id", user.id)
      .order("last_visited_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (rowsRes.error) {
    return NextResponse.json({ error: rowsRes.error.message }, { status: 500 });
  }
  if (recentRes.error) {
    return NextResponse.json({ error: recentRes.error.message }, { status: 500 });
  }

  const rawRows = rowsRes.data ?? [];
  const recentData = recentRes.data;
  const aggregated = aggregateVisitRows(rawRows, renderResolution);
  const cells = aggregated.map((r) => r.h3_index);

  let recentCell = recentData?.h3_index ?? null;
  if (!recentCell && rawRows.length > 0) {
    let best = rawRows[0];
    for (const row of rawRows) {
      if (row.last_visited_at > best.last_visited_at) best = row;
    }
    recentCell = best.h3_index;
  }

  return NextResponse.json({
    cells,
    resolution: renderResolution,
    recentCell,
    cellMetrics: aggregated,
  });
}

/**
 * POST /api/cells
 * Body: { cells: string[] } or { visits: VisitCellEvent[] }
 * Records ordered visits. Stable visit clientEventIds make offline replay idempotent.
 */
export async function POST(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const visits = normalizeVisitEvents(body.visits);
  if (Array.isArray(body.visits)) {
    if (visits.length === 0) {
      return NextResponse.json({ error: "No valid visits provided" }, { status: 400 });
    }

    const result = await applyVisitEventsBatch(supabase, visits);
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      count: visits.length,
      applied: result.applied,
      duplicates: result.duplicates,
    });
  }

  const cells: string[] = body.cells ?? [];
  if (!Array.isArray(cells) || cells.length === 0) {
    return NextResponse.json({ error: "No cells provided" }, { status: 400 });
  }

  const seen = new Set<string>();
  const unique = cells.filter((c) => {
    if (seen.has(c)) return false;
    seen.add(c);
    return true;
  });

  const result = await applyVisitCellsBatch(supabase, user.id, unique);
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    count: unique.length,
    applied: result.applied,
    duplicates: result.duplicates,
  });
}

/**
 * DELETE /api/cells
 * Body: { cells: string[] }
 * Removes a batch of H3 cell indexes from visited.
 */
export async function DELETE(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const cells: string[] = body.cells ?? [];
  if (!Array.isArray(cells) || cells.length === 0) {
    return NextResponse.json({ error: "No cells provided" }, { status: 400 });
  }

  const { error } = await supabase
    .from("visit_cells")
    .delete()
    .eq("user_id", user.id)
    .in("h3_index", cells);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
