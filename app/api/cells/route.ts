import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase-server";
import { resolutionForZoom } from "@/lib/h3";
import { aggregateVisitRows, type VisitMetricRow } from "@/lib/cell-metrics";
import { applyVisitCellsBatch } from "@/lib/visit-cells-batch";

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

  const [rowsRes, recentRes] = await Promise.all([
    supabase
      .from("visit_cells")
      .select("h3_index, first_visited_at, last_visited_at, visit_count")
      .eq("user_id", user.id),
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

  const data = rowsRes.data;
  const recentData = recentRes.data;
  const rawRows = (data ?? []) as VisitMetricRow[];
  const aggregated = aggregateVisitRows(rawRows, renderResolution);
  const cells = aggregated.map((r) => r.h3_index);

  return NextResponse.json({
    cells,
    resolution: renderResolution,
    recentCell: recentData?.h3_index ?? null,
    cellMetrics: aggregated,
  });
}

/**
 * POST /api/cells
 * Body: { cells: string[] }
 * Records visits: visit_count increments only when the cell differs from the user's
 * current most-recent last_visited_at cell; revisits to that cell refresh last_visited_at only.
 * Implemented in Node (see lib/visit-cells-batch) — migrations stay table-only.
 */
export async function POST(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
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
  return NextResponse.json({ ok: true, count: unique.length });
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
