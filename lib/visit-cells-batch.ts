import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

const IN_CHUNK = 200;

/**
 * Applies one POST /api/cells batch: snapshot the user's most recently visited cell,
 * then for each cell either refresh last_visited_at only (same as snapshot) or insert / increment visit_count.
 */
export async function applyVisitCellsBatch(
  supabase: SupabaseClient<Database>,
  userId: string,
  cells: string[]
): Promise<{ ok: true } | { ok: false; message: string }> {
  const nowIso = new Date().toISOString();

  const { data: recentRow, error: recentErr } = await supabase
    .from("visit_cells")
    .select("h3_index")
    .eq("user_id", userId)
    .order("last_visited_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recentErr) return { ok: false, message: recentErr.message };

  const lastH3 = recentRow?.h3_index ?? null;

  const byH3 = new Map<string, { visit_count: number }>();
  for (let i = 0; i < cells.length; i += IN_CHUNK) {
    const chunk = cells.slice(i, i + IN_CHUNK);
    const { data: rows, error: selErr } = await supabase
      .from("visit_cells")
      .select("h3_index, visit_count")
      .eq("user_id", userId)
      .in("h3_index", chunk);

    if (selErr) return { ok: false, message: selErr.message };
    for (const r of rows ?? []) {
      byH3.set(r.h3_index, { visit_count: r.visit_count });
    }
  }

  for (const cell of cells) {
    if (lastH3 !== null && cell === lastH3) {
      const { error } = await supabase
        .from("visit_cells")
        .update({ last_visited_at: nowIso })
        .eq("user_id", userId)
        .eq("h3_index", cell);

      if (error) return { ok: false, message: error.message };
      continue;
    }

    const existing = byH3.get(cell);
    if (!existing) {
      const { error } = await supabase.from("visit_cells").insert({
        user_id: userId,
        h3_index: cell,
        first_visited_at: nowIso,
        last_visited_at: nowIso,
        visit_count: 1,
      });

      if (error) return { ok: false, message: error.message };
      byH3.set(cell, { visit_count: 1 });
    } else {
      const nextCount = existing.visit_count + 1;
      const { error } = await supabase
        .from("visit_cells")
        .update({
          visit_count: nextCount,
          last_visited_at: nowIso,
        })
        .eq("user_id", userId)
        .eq("h3_index", cell);

      if (error) return { ok: false, message: error.message };
      byH3.set(cell, { visit_count: nextCount });
    }
  }

  return { ok: true };
}
