import { latLngToCell, cellToParent, cellToBoundary, gridDisk } from "h3-js";

export const DRAW_RESOLUTION = 9;

/**
 * Convert a lat/lng to the H3 res-9 cell index at that point.
 */
export function snapToCell(lat: number, lng: number): string {
  return latLngToCell(lat, lng, DRAW_RESOLUTION);
}

/**
 * Get the parent cell at a coarser resolution (for zoomed-out views).
 * Clamps to valid H3 resolution range 0–15.
 */
export function getParentCell(h3Index: string, resolution: number): string {
  const clamped = Math.max(0, Math.min(15, resolution));
  return cellToParent(h3Index, clamped);
}

/**
 * Get the boundary polygon for a cell as [lng, lat] pairs for GeoJSON.
 */
export function getCellBoundary(h3Index: string): [number, number][] {
  const boundary = cellToBoundary(h3Index);
  return boundary.map(([lat, lng]) => [lng, lat]);
}

// Average H3 cell edge lengths in metres, indexed by resolution 0–9.
// Source: h3-js documentation (averages; vary slightly by latitude).
const H3_EDGE_LENGTHS_M: number[] = [
  1_107_712, // 0 – continental
  418_676,   // 1
  158_244,   // 2
  59_811,    // 3
  22_606,    // 4
  8_544,     // 5
  3_229,     // 6
  1_221,     // 7
  461,       // 8
  174,       // 9 – street block
];

/**
 * Minimum fraction of the viewport width a cell edge must occupy.
 * Below this threshold the cells become too small to see clearly, so we
 * step up to the next coarser resolution.  Tuned so that roughly 30–80
 * cells are visible across a typical 1 000 px viewport at any zoom level.
 */
const MIN_CELL_FRACTION = 0.012;

/**
 * Given a map zoom level, return the H3 resolution that keeps cell size
 * roughly proportional to the viewport — using all resolutions 0–9 for
 * smooth, consistent transitions rather than large jumps.
 */
export function resolutionForZoom(zoom: number): number {
  // Metres per pixel at latitude ≈ 37° (SF default); good enough for a
  // resolution choice that only has 10 discrete steps.
  const metersPerPx = 78_271.5 / Math.pow(2, zoom);
  const viewportMeters = metersPerPx * 1_000; // assume ~1 000 px reference width

  // Walk from finest to coarsest; pick the finest resolution where the cell
  // edge still meets the minimum visible fraction of the viewport.
  for (let res = DRAW_RESOLUTION; res >= 0; res--) {
    if (H3_EDGE_LENGTHS_M[res] / viewportMeters >= MIN_CELL_FRACTION) {
      return res;
    }
  }
  return 0;
}

/**
 * Get all cells within radius `k` rings of a center cell (for brush expansion later).
 */
export function getCellsInRadius(h3Index: string, k: number): string[] {
  return gridDisk(h3Index, k);
}
