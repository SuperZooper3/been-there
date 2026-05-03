import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase-server";
import { getParentCell, resolutionForZoom } from "@/lib/h3";

/**
 * GET /api/cells?zoom=<n>
 * Returns all visited cells for the current user, coarsened to the
 * appropriate H3 resolution for the given zoom level.
 */
export async function GET(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const zoom = Number(request.nextUrl.searchParams.get("zoom") ?? "13");
  const renderResolution = resolutionForZoom(zoom);

  const { data, error } = await supabase
    .from("visit_cells")
    .select("h3_index")
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Derive parent cells if rendering at coarser resolution
  const cells =
    renderResolution === 9
      ? (data ?? []).map((r) => r.h3_index)
      : [...new Set((data ?? []).map((r) => getParentCell(r.h3_index, renderResolution)))];

  return NextResponse.json({ cells, resolution: renderResolution });
}

/**
 * POST /api/cells
 * Body: { cells: string[] }
 * Upserts a batch of H3 res-9 cell indexes as visited.
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

  const now = new Date().toISOString();
  const rows = cells.map((h3_index) => ({
    user_id: user.id,
    h3_index,
    first_visited_at: now,
    last_visited_at: now,
  }));

  const { error } = await supabase
    .from("visit_cells")
    .upsert(rows, {
      onConflict: "user_id,h3_index",
      ignoreDuplicates: false,
    });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, count: cells.length });
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
