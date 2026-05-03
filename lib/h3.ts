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

/**
 * Given a zoom level, return which H3 resolution to use for rendering.
 * Fine at street level, coarser at city/region/world.
 */
export function resolutionForZoom(zoom: number): number {
  if (zoom >= 13) return 9;
  if (zoom >= 10) return 7;
  if (zoom >= 7)  return 5;
  if (zoom >= 4)  return 3;
  return 1;
}

/**
 * Get all cells within radius `k` rings of a center cell (for brush expansion later).
 */
export function getCellsInRadius(h3Index: string, k: number): string[] {
  return gridDisk(h3Index, k);
}
