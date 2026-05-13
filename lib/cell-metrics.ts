import { getParentCell, DRAW_RESOLUTION } from "@/lib/h3";

export type VisitMetricRow = {
  h3_index: string;
  first_visited_at: string;
  last_visited_at: string;
  visit_count: number;
};

function cmpIso(a: string, b: string): number {
  return new Date(a).getTime() - new Date(b).getTime();
}

/**
 * Aggregate res-9 rows to parent resolution for map + intelligence overlays.
 * - last_visited_at: MAX (recency)
 * - visit_count: SUM (total visits in region)
 * - first_visited_at: MIN (earliest footprint in region)
 */
export function aggregateVisitRows(
  rows: VisitMetricRow[],
  renderResolution: number
): VisitMetricRow[] {
  if (renderResolution >= DRAW_RESOLUTION) return rows;

  const byParent = new Map<
    string,
    { last: string; first: string; sum: number }
  >();

  for (const r of rows) {
    const parent = getParentCell(r.h3_index, renderResolution);
    const cur = byParent.get(parent);
    if (!cur) {
      byParent.set(parent, {
        last: r.last_visited_at,
        first: r.first_visited_at,
        sum: r.visit_count,
      });
    } else {
      cur.last = cmpIso(r.last_visited_at, cur.last) > 0 ? r.last_visited_at : cur.last;
      cur.first = cmpIso(r.first_visited_at, cur.first) < 0 ? r.first_visited_at : cur.first;
      cur.sum += r.visit_count;
    }
  }

  return [...byParent.entries()].map(([h3_index, v]) => ({
    h3_index,
    last_visited_at: v.last,
    first_visited_at: v.first,
    visit_count: v.sum,
  }));
}
