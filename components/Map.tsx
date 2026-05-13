"use client";

import { useEffect, useRef, useCallback } from "react";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, MapMouseEvent, MapTouchEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import Supercluster from "supercluster";
import { getCellBoundary, getParentCell, snapToCell, resolutionForZoom, DRAW_RESOLUTION } from "@/lib/h3";
import { aggregateVisitRows, type VisitMetricRow } from "@/lib/cell-metrics";
import type { IntelligenceVariant } from "@/lib/intelligence";
import type { MapMode } from "./MapApp";

const STADIA_STYLE =
  "https://tiles.stadiamaps.com/styles/alidade_smooth.json";

interface Props {
  mode: MapMode;
  visitedCells: Set<string>;
  photos: PhotoPin[];
  onCellPaint: (h3Index: string) => void;
  onCellErase: (h3Index: string) => void;
  onPinDrop: (lat: number, lng: number) => void;
  onPinClick: (photo: PhotoPin) => void;
  onZoomChange: (zoom: number) => void;
  centerOn?: { lat: number; lng: number } | null;
  /** Increment `seq` to ease the map to this point at the default street zoom (13). */
  recenterTrackerAt?: { lat: number; lng: number; seq: number } | null;
  currentLocation?: { lat: number; lng: number } | null;
  /** Debug: K+click on the map fires this with the clicked lat/lng as a fake location ping. */
  onDebugLocation?: (lat: number, lng: number) => void;
  intelligenceVariant?: IntelligenceVariant;
  /** Full res-9 metrics from API — Map aggregates to the current H3 render resolution */
  cellMetricsRes9?: VisitMetricRow[];
}

export interface PhotoPin {
  id: string;
  lat: number;
  lng: number;
  h3_index: string;
  url: string;
  caption: string | null;
}

const CELL_SOURCE = "visited-cells";
const CELL_LAYER = "visited-cells-fill";
const CELL_BORDER_LAYER = "visited-cells-border";
const DESAT_SOURCE = "desaturation-source";
const DESAT_LAYER = "desaturation-layer";

// Blue (low / oldest) → yellow → red (high / newest) — consistent across all three overlays.
const INTEL_RAMP_COLD = "#1d4ed8"; // blue
const INTEL_RAMP_MID  = "#f59e0b"; // amber
const INTEL_RAMP_HOT  = "#dc2626"; // red

function applyIntelligenceLayerPaint(
  map: maplibregl.Map,
  variant: IntelligenceVariant
) {
  if (!map.getLayer(CELL_LAYER)) return;
  if (variant === "none") {
    map.setPaintProperty(CELL_LAYER, "fill-color", "rgba(0,0,0,0)");
    map.setPaintProperty(CELL_LAYER, "fill-opacity", 0);
    return;
  }
  // All three overlays use the same blue → amber → red ramp driven by `intelNorm` (0–1).
  map.setPaintProperty(CELL_LAYER, "fill-color", [
    "interpolate", ["linear"], ["get", "intelNorm"],
    0,   INTEL_RAMP_COLD,
    0.5, INTEL_RAMP_MID,
    1,   INTEL_RAMP_HOT,
  ]);
  map.setPaintProperty(CELL_LAYER, "fill-opacity", 0.65);
}

// ---------------------------------------------------------------------------
// Pure GeoJSON helpers — defined at module level so they have no closure
// dependencies and can be called directly from event handlers without going
// through React's render / useEffect pipeline.
// ---------------------------------------------------------------------------

function computeDisplayCells(cells: Set<string>, resolution: number): string[] {
  if (resolution < DRAW_RESOLUTION) {
    return [...new Set([...cells].map((h) => getParentCell(h, resolution)))];
  }
  return [...cells];
}

function buildCellFeatures(
  displayCells: string[],
  variant: IntelligenceVariant,
  cellMetricsRes9: VisitMetricRow[],
  internalRes: number
): GeoJSON.FeatureCollection {
  const agg = aggregateVisitRows(cellMetricsRes9, internalRes);
  const lookup = new globalThis.Map(agg.map((r) => [r.h3_index, r] as [string, VisitMetricRow]));
  const present = displayCells
    .map((id) => lookup.get(id))
    .filter((x): x is VisitMetricRow => !!x);

  const norms = new globalThis.Map<string, number>();
  if (variant === "none" || present.length === 0) {
    for (const id of displayCells) norms.set(id, 0);
  } else {
    const now = Date.now();
    if (variant === "lastBeen") {
      const ts = present.map((p) => +new Date(p.last_visited_at).getTime());
      const min = Math.min(...ts);
      const max = Math.max(...ts);
      if (min === max) {
        for (const id of displayCells) {
          norms.set(id, lookup.get(id) ? 1 : 0);
        }
      } else {
        const den = max - min;
        for (const id of displayCells) {
          const r = lookup.get(id);
          norms.set(
            id,
            r ? (+new Date(r.last_visited_at).getTime() - min) / den : 0
          );
        }
      }
    } else if (variant === "mostBeen") {
      const logs = present.map((p) => Math.log10(1 + p.visit_count));
      const min = Math.min(...logs);
      const max = Math.max(...logs);
      if (min === max) {
        for (const id of displayCells) {
          norms.set(id, lookup.get(id) ? 1 : 0);
        }
      } else {
        const den = max - min;
        for (const id of displayCells) {
          const r = lookup.get(id);
          norms.set(
            id,
            r ? (Math.log10(1 + r.visit_count) - min) / den : 0
          );
        }
      }
    } else {
      const stals = present.map(
        (p) => now - +new Date(p.first_visited_at).getTime()
      );
      const minS = Math.min(...stals);
      const maxS = Math.max(...stals);
      if (minS === maxS) {
        for (const id of displayCells) {
          norms.set(id, lookup.get(id) ? 1 : 0);
        }
      } else {
        const denS = maxS - minS;
        for (const id of displayCells) {
          const r = lookup.get(id);
          const s = r ? now - +new Date(r.first_visited_at).getTime() : minS;
          norms.set(id, (s - minS) / denS);
        }
      }
    }
  }

  return {
    type: "FeatureCollection",
    features: displayCells.map((h3Index) => {
      const boundary = getCellBoundary(h3Index);
      return {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [[...boundary, boundary[0]]],
        },
        properties: {
          h3Index,
          intelNorm: norms.get(h3Index) ?? 0,
        },
      };
    }),
  };
}

function makeDesatMask(displayCells: string[]): GeoJSON.Feature {
  const world = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
  const holes = displayCells.map((h3Index) => {
    const b = getCellBoundary(h3Index);
    return [...b, b[0]];
  });
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [world, ...holes] },
    properties: {},
  };
}

export default function Map({
  mode,
  visitedCells,
  photos,
  onCellPaint,
  onCellErase,
  onPinDrop,
  onPinClick,
  onZoomChange,
  centerOn,
  recenterTrackerAt,
  currentLocation,
  onDebugLocation,
  intelligenceVariant = "none",
  cellMetricsRes9 = [],
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Record<string, maplibregl.Marker>>({});
  const isPaintingRef = useRef(false);
  const isKPressedRef = useRef(false);

  // Clustering
  const clusterIndexRef = useRef<Supercluster<{ photoId: string }> | null>(null);
  const photosMapRef = useRef<Record<string, PhotoPin>>({});
  const rotationRef = useRef<Record<string, number>>({});
  const onPinClickRef = useRef(onPinClick);
  const renderMarkersRef = useRef<() => void>(() => {});

  // ---------------------------------------------------------------------------
  // Always-current refs for visitedCells and the current H3 render resolution.
  // These are read directly by event handlers — NO React state cycle involved.
  // ---------------------------------------------------------------------------
  const visitedCellsRef = useRef<Set<string>>(visitedCells);
  const internalResRef = useRef<number>(resolutionForZoom(13));
  const intelligenceVariantRef = useRef<IntelligenceVariant>("none");
  const cellMetricsRes9Ref = useRef<VisitMetricRow[]>([]);
  intelligenceVariantRef.current = intelligenceVariant;
  cellMetricsRes9Ref.current = cellMetricsRes9;

  // The source-update function is stored in a ref so that event handlers
  // registered once (during map init) always call the latest version.
  // It's assigned every render so it always closes over the latest refs.
  const updateSourcesRef = useRef<() => void>(() => {});
  updateSourcesRef.current = () => {
    const map = mapRef.current;
    if (!map) return;
    const cellSource = map.getSource(CELL_SOURCE) as GeoJSONSource | undefined;
    const desatSource = map.getSource(DESAT_SOURCE) as GeoJSONSource | undefined;
    // Sources are added inside the map's 'load' handler. If they don't exist
    // yet, bail — the 'load' handler will call this again once ready.
    if (!cellSource || !desatSource) return;
    const variant = intelligenceVariantRef.current;
    const dc = computeDisplayCells(visitedCellsRef.current, internalResRef.current);
    cellSource.setData(
      buildCellFeatures(dc, variant, cellMetricsRes9Ref.current, internalResRef.current)
    );
    desatSource.setData(makeDesatMask(dc));
    // Always sync paint immediately after data so variant and colours are never split across frames.
    applyIntelligenceLayerPaint(map, variant);
  };

  // Keep visitedCells ref in sync and immediately push a source update.
  // This is the only React-cycle update path — it fires when cells are painted
  // or erased, not on every zoom change.
  useEffect(() => {
    visitedCellsRef.current = visitedCells;
    updateSourcesRef.current();
  }, [visitedCells, intelligenceVariant, cellMetricsRes9]);

  // ---------------------------------------------------------------------------
  // Map initialisation (runs once)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STADIA_STYLE,
      center: [-122.4194, 37.7749],
      zoom: 13,
    });

    // Zoom event: check if H3 resolution would change and update sources
    // DIRECTLY — no React state involved, so cells snap immediately.
    map.on("zoom", () => {
      const z = map.getZoom();
      const newRes = resolutionForZoom(z);
      if (newRes !== internalResRef.current) {
        internalResRef.current = newRes;
        updateSourcesRef.current();
        onZoomChange(z); // also inform MapApp (for erase resolution tracking)
      }
    });

    map.on("zoomend", () => {
      const z = map.getZoom();
      // Ensure final resolution is locked in after animation completes
      const finalRes = resolutionForZoom(z);
      if (finalRes !== internalResRef.current) {
        internalResRef.current = finalRes;
        updateSourcesRef.current();
      }
      onZoomChange(z);
      renderMarkersRef.current();
    });

    map.on("moveend", () => {
      renderMarkersRef.current();
    });

    map.on("load", () => {
      map.getCanvas().style.filter = "saturate(2.5) contrast(1.15)";

      // Add sources with empty initial data; the updateSources call below
      // will fill in real data if visitedCells has already loaded.
      map.addSource(DESAT_SOURCE, { type: "geojson", data: makeDesatMask([]) });
      map.addLayer({
        id: DESAT_LAYER, type: "fill", source: DESAT_SOURCE,
        paint: { "fill-color": "#808080", "fill-opacity": 0.75 },
      });

      map.addSource(CELL_SOURCE, {
        type: "geojson",
        data: buildCellFeatures([], "none", [], internalResRef.current),
      });
      map.addLayer({
        id: CELL_LAYER, type: "fill", source: CELL_SOURCE,
        paint: { "fill-color": "rgba(0,0,0,0)", "fill-opacity": 0 },
      });
      map.addLayer({
        id: CELL_BORDER_LAYER, type: "line", source: CELL_SOURCE,
        paint: { "line-color": "rgba(255,255,255,0.25)", "line-width": 0.75 },
      });

      // Push whatever cells are already in the ref (handles the case where
      // the API response arrived before the map finished loading).
      // applyIntelligenceLayerPaint is called inside updateSourcesRef.
      updateSourcesRef.current();
    });

    mapRef.current = map;

    // On native: recover MapLibre's WebGL context if iOS discards it when the app is backgrounded (H5)
    let appStateHandle: Awaited<ReturnType<typeof CapApp.addListener>> | undefined;
    if (Capacitor.isNativePlatform()) {
      void CapApp.addListener("appStateChange", ({ isActive }) => {
        if (isActive && mapRef.current) {
          mapRef.current.resize();
        }
      }).then((h) => { appStateHandle = h; });
    }

    return () => {
      void appStateHandle?.remove();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Jump to the most recently visited location once (fires once after initial load)
  const hasCenteredRef = useRef(false);
  useEffect(() => {
    if (!centerOn || hasCenteredRef.current) return;
    const map = mapRef.current;
    if (!map) return;
    hasCenteredRef.current = true;
    if (map.isStyleLoaded()) {
      map.jumpTo({ center: [centerOn.lng, centerOn.lat] });
    } else {
      map.once("load", () => map.jumpTo({ center: [centerOn.lng, centerOn.lat] }));
    }
  }, [centerOn]);

  // When tracking starts, parent bumps `seq` on the first GPS fix so the user sees their pin.
  useEffect(() => {
    if (!recenterTrackerAt) return;
    const map = mapRef.current;
    if (!map) return;
    const { lat, lng } = recenterTrackerAt;
    const defaultZoom = 13;
    const run = () => {
      map.easeTo({ center: [lng, lat], zoom: defaultZoom, duration: 500 });
    };
    if (map.isStyleLoaded()) run();
    else map.once("load", run);
  }, [recenterTrackerAt?.seq]);

  // Lock/unlock map pan and set canvas cursor based on mode
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const lock = mode === "draw" || mode === "erase";
    if (lock) { map.dragPan.disable(); map.touchZoomRotate.disable(); }
    else { map.dragPan.enable(); map.touchZoomRotate.enable(); }
    const cursorMap: Record<string, string> = {
      browse: "grab", draw: "crosshair", erase: "cell", pin: "pointer",
    };
    map.getCanvas().style.cursor = cursorMap[mode] ?? "grab";
  }, [mode]);

  // Track K key for debug location pings
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement))
        isKPressedRef.current = true;
    };
    const onKeyUp = (e: KeyboardEvent) => { if (e.key.toLowerCase() === "k") isKPressedRef.current = false; };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); };
  }, []);

  // Paint/erase pointer interactions
  // Note: renderResolution is intentionally NOT a dependency here — cell painting
  // always snaps to res-9 regardless of zoom level.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const lngLatToCell = (e: MapMouseEvent | MapTouchEvent) =>
      snapToCell(e.lngLat.lat, e.lngLat.lng);

    const handleDown = (e: MapMouseEvent | MapTouchEvent) => {
      if (mode !== "draw" && mode !== "erase") return;
      isPaintingRef.current = true;
      const cell = lngLatToCell(e);
      if (mode === "draw") onCellPaint(cell); else onCellErase(cell);
    };
    const handleMove = (e: MapMouseEvent | MapTouchEvent) => {
      if (!isPaintingRef.current || (mode !== "draw" && mode !== "erase")) return;
      const cell = lngLatToCell(e);
      if (mode === "draw") onCellPaint(cell); else onCellErase(cell);
    };
    const handleUp = () => { isPaintingRef.current = false; };
    const handleClick = (e: MapMouseEvent) => {
      if (isKPressedRef.current) { onDebugLocation?.(e.lngLat.lat, e.lngLat.lng); return; }
      if (mode !== "pin") return;
      onPinDrop(e.lngLat.lat, e.lngLat.lng);
    };

    map.on("mousedown", handleDown); map.on("mousemove", handleMove);
    map.on("mouseup", handleUp);     map.on("touchstart", handleDown);
    map.on("touchmove", handleMove); map.on("touchend", handleUp);
    map.on("click", handleClick);

    return () => {
      map.off("mousedown", handleDown); map.off("mousemove", handleMove);
      map.off("mouseup", handleUp);     map.off("touchstart", handleDown);
      map.off("touchmove", handleMove); map.off("touchend", handleUp);
      map.off("click", handleClick);
    };
  }, [mode, onCellPaint, onCellErase, onPinDrop, onDebugLocation]);

  // Keep onPinClick ref current
  useEffect(() => { onPinClickRef.current = onPinClick; }, [onPinClick]);

  // Core marker render — reads only from refs
  const renderMarkers = useCallback(() => {
    const map = mapRef.current;
    const index = clusterIndexRef.current;
    if (!map || !index) return;

    const bounds = map.getBounds();
    const zoom = Math.floor(map.getZoom());
    const bbox: [number, number, number, number] = [
      bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth(),
    ];
    const clusters = index.getClusters(bbox, zoom);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nextIds = new Set(clusters.map((c: any) =>
      c.properties.cluster ? `cluster-${c.properties.cluster_id}` : c.properties.photoId
    ));
    Object.keys(markersRef.current).forEach((id) => {
      if (!nextIds.has(id)) { markersRef.current[id].remove(); delete markersRef.current[id]; }
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    clusters.forEach((cluster: any) => {
      const isCluster = !!cluster.properties.cluster;
      const markerId = isCluster ? `cluster-${cluster.properties.cluster_id}` : cluster.properties.photoId;
      if (markersRef.current[markerId]) return;

      const [lng, lat] = cluster.geometry.coordinates as [number, number];

      if (isCluster) {
        const count = cluster.properties.point_count as number;
        const clusterId = cluster.properties.cluster_id as number;
        const leaves = index.getLeaves(clusterId, 1);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const repId = (leaves[0]?.properties as any)?.photoId as string | undefined;
        const repPhoto = repId ? photosMapRef.current[repId] : undefined;

        // position:absolute;top:0;left:0 is required so all marker elements share the same
        // (0,0) origin in the canvas container. Without it they stack in normal document flow
        // and MapLibre's translate transform is applied on top of each element's stacked
        // position, pushing markers progressively further off their geographic coordinates.
        const el = document.createElement("div");
        el.style.cssText = "position:absolute;top:0;left:0;display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer;";
        const circle = document.createElement("div");
        circle.style.cssText = "width:52px;height:52px;border-radius:50%;overflow:hidden;border:3px solid white;box-shadow:0 2px 12px rgba(0,0,0,0.22);background:#ccc;";
        if (repPhoto) {
          const img = document.createElement("img");
          img.src = repPhoto.url;
          img.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;";
          circle.appendChild(img);
        }
        const badge = document.createElement("div");
        badge.style.cssText = "background:white;border-radius:10px;padding:2px 8px;font-size:11px;font-weight:600;color:#3d3530;box-shadow:0 1px 4px rgba(0,0,0,0.15);line-height:1.5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;";
        badge.textContent = String(count);
        el.appendChild(circle); el.appendChild(badge);
        el.addEventListener("click", () => {
          mapRef.current?.easeTo({ center: [lng, lat], zoom: Math.min(index.getClusterExpansionZoom(clusterId), 20) });
        });
        markersRef.current[markerId] = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([lng, lat]).addTo(map);

      } else {
        const photoId = cluster.properties.photoId as string;
        const photo = photosMapRef.current[photoId];
        if (!photo) return;

        if (rotationRef.current[photo.id] == null)
          rotationRef.current[photo.id] = parseFloat((Math.random() * 6 - 3).toFixed(1));
        const rotation = rotationRef.current[photo.id];

        // Outer element: position:absolute so MapLibre's translate starts from the container
        // origin, not from a stacked flow position. No transform here — MapLibre owns style.transform
        // on this element and would overwrite any rotation we set.
        const el = document.createElement("div");
        el.style.cssText = "position:absolute;top:0;left:0;cursor:pointer;";

        // Inner element carries the visual styling and rotation. MapLibre only touches the
        // outer element's transform, so the inner rotation is never overwritten.
        const inner = document.createElement("div");
        inner.className = "polaroid-marker";
        inner.style.cssText = `width:48px;background:white;padding:3px 3px 10px 3px;box-shadow:0 2px 8px rgba(0,0,0,0.18);border-radius:2px;transform:rotate(${rotation}deg);`;

        const imgContainer = document.createElement("div");
        imgContainer.style.cssText = "width:100%;height:42px;position:relative;display:block;background:#f5f5f5;";

        const spinnerWrapper = document.createElement("div");
        spinnerWrapper.style.cssText = "position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);";
        const spinner = document.createElement("div");
        spinner.style.cssText = "width:16px;height:16px;border:2px solid #e0e0e0;border-top-color:#999;border-radius:50%;animation:spin 0.8s linear infinite;";
        spinnerWrapper.appendChild(spinner);
        imgContainer.appendChild(spinnerWrapper);

        const img = document.createElement("img");
        img.src = photo.url;
        img.style.cssText = "width:100%;height:42px;object-fit:cover;display:block;opacity:0;transition:opacity 0.2s;";
        img.onload = () => { spinnerWrapper.remove(); img.style.opacity = "1"; };
        img.onerror = () => { spinnerWrapper.remove(); img.style.opacity = "1"; };
        imgContainer.appendChild(img);
        inner.appendChild(imgContainer);
        el.appendChild(inner);
        el.addEventListener("click", () => onPinClickRef.current(photo));

        markersRef.current[photo.id] = new maplibregl.Marker({ element: el, anchor: "bottom" })
          .setLngLat([photo.lng, photo.lat]).addTo(map);
      }
    });
  }, []);

  useEffect(() => { renderMarkersRef.current = renderMarkers; }, [renderMarkers]);

  // Blue "you are here" dot
  const locationMarkerRef = useRef<maplibregl.Marker | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!currentLocation) {
      locationMarkerRef.current?.remove();
      locationMarkerRef.current = null;
      return;
    }
    if (!locationMarkerRef.current) {
      // Outer: position:absolute so MapLibre's translate starts from the container origin.
      const outer = document.createElement("div");
      outer.style.cssText = "position:absolute;top:0;left:0;width:14px;height:14px;";
      const ring = document.createElement("div");
      ring.className = "location-pulse-ring";
      outer.appendChild(ring);
      const dot = document.createElement("div");
      dot.style.cssText = "position:absolute;inset:0;border-radius:50%;background:#3b82f6;border:2px solid white;box-shadow:0 1px 6px rgba(59,130,246,0.5);";
      outer.appendChild(dot);
      locationMarkerRef.current = new maplibregl.Marker({ element: outer, anchor: "center" })
        .setLngLat([currentLocation.lng, currentLocation.lat]).addTo(map);
    } else {
      locationMarkerRef.current.setLngLat([currentLocation.lng, currentLocation.lat]);
    }
  }, [currentLocation]);

  // Rebuild supercluster index whenever photos change
  useEffect(() => {
    photosMapRef.current = Object.fromEntries(photos.map((p) => [p.id, p]));
    photos.forEach((p) => {
      if (rotationRef.current[p.id] == null)
        rotationRef.current[p.id] = parseFloat((Math.random() * 6 - 3).toFixed(1));
    });
    const index = new Supercluster<{ photoId: string }>({ radius: 60, maxZoom: 14 });
    index.load(photos.map((p) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
      properties: { photoId: p.id },
    })));
    clusterIndexRef.current = index;
    renderMarkers();
  }, [photos, renderMarkers]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
