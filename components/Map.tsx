"use client";

import { useEffect, useRef, useCallback } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, MapMouseEvent, MapTouchEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import Supercluster from "supercluster";
import { getCellBoundary, getParentCell, snapToCell, resolutionForZoom, DRAW_RESOLUTION } from "@/lib/h3";
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
  currentLocation?: { lat: number; lng: number } | null;
  /** Debug: K+click on the map fires this with the clicked lat/lng as a fake location ping. */
  onDebugLocation?: (lat: number, lng: number) => void;
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

function makeCellGeoJSON(displayCells: string[]): GeoJSON.FeatureCollection {
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
        properties: { h3Index },
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
  currentLocation,
  onDebugLocation,
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

  // The source-update function is stored in a ref so that event handlers
  // registered once (during map init) always call the latest version.
  // It's assigned every render so it always closes over the latest refs.
  const updateSourcesRef = useRef<() => void>(() => {});
  updateSourcesRef.current = () => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const dc = computeDisplayCells(visitedCellsRef.current, internalResRef.current);
    (map.getSource(CELL_SOURCE) as GeoJSONSource | undefined)?.setData(makeCellGeoJSON(dc));
    (map.getSource(DESAT_SOURCE) as GeoJSONSource | undefined)?.setData(makeDesatMask(dc));
  };

  // Keep visitedCells ref in sync and immediately push a source update.
  // This is the only React-cycle update path — it fires when cells are painted
  // or erased, not on every zoom change.
  useEffect(() => {
    visitedCellsRef.current = visitedCells;
    updateSourcesRef.current();
  }, [visitedCells]);

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

      map.addSource(CELL_SOURCE, { type: "geojson", data: makeCellGeoJSON([]) });
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
      updateSourcesRef.current();
    });

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
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

        const el = document.createElement("div");
        el.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer;";
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

        const el = document.createElement("div");
        el.className = "polaroid-marker";
        el.style.cssText = `width:48px;background:white;padding:3px 3px 10px 3px;box-shadow:0 2px 8px rgba(0,0,0,0.18);border-radius:2px;cursor:pointer;transform:rotate(${rotation}deg);position:relative;`;

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
        el.appendChild(imgContainer);
        el.addEventListener("click", () => onPinClickRef.current(photo));

        markersRef.current[photo.id] = new maplibregl.Marker({ element: el, anchor: "bottom" })
          .setLngLat([photo.lng, photo.lat]).addTo(map);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      const outer = document.createElement("div");
      outer.style.cssText = "position:relative;width:14px;height:14px;";
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
