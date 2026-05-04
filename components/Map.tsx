"use client";

import { useEffect, useRef, useCallback } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, IControl, MapMouseEvent, MapTouchEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import Supercluster from "supercluster";

// MapLibre 5.x namespace exports don't expose construct signatures via `import *`.
// Cast to the correct interface to allow `new` calls.
const NavigationControl = maplibregl.NavigationControl as unknown as new () => IControl;
import { getCellBoundary, getParentCell, snapToCell, DRAW_RESOLUTION } from "@/lib/h3";
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
  renderResolution: number;
  onZoomChange: (zoom: number) => void;
  centerOn?: { lat: number; lng: number } | null;
  currentLocation?: { lat: number; lng: number } | null;
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

export default function Map({
  mode,
  visitedCells,
  photos,
  onCellPaint,
  onCellErase,
  onPinDrop,
  onPinClick,
  renderResolution,
  onZoomChange,
  centerOn,
  currentLocation,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  // Use a plain object to avoid collision with maplibre-gl's exported `Map` class name
  const markersRef = useRef<Record<string, maplibregl.Marker>>({});
  const isPaintingRef = useRef(false);

  // Clustering state — all stored in refs so renderMarkers() can be a stable callback
  const clusterIndexRef = useRef<Supercluster<{ photoId: string }> | null>(null);
  // Plain Record to avoid collision with the component's own name shadowing globalThis.Map
  const photosMapRef = useRef<Record<string, PhotoPin>>({});
  // Stable per-photo rotation so polaroids don't spin on re-render
  const rotationRef = useRef<Record<string, number>>({});
  // Stable reference to onPinClick so cluster element listeners never go stale
  const onPinClickRef = useRef(onPinClick);
  // Indirection so map event listeners always call the latest renderMarkers impl
  const renderMarkersRef = useRef<() => void>(() => {});

  // Build GeoJSON from visited cells, aggregating to the current render resolution.
  // All cells are stored at res-9; when zoomed out we derive unique parent cells so
  // any visited child causes its parent hex to light up.
  const buildGeoJSON = useCallback(
    (cells: Set<string>): GeoJSON.FeatureCollection => {
      const displayCells =
        renderResolution < DRAW_RESOLUTION
          ? [...new Set([...cells].map((h) => getParentCell(h, renderResolution)))]
          : [...cells];

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
    },
    [renderResolution]
  );

  // Build desaturation mask: world polygon with holes for visited cells
  const buildDesaturationMask = useCallback(
    (cells: Set<string>): GeoJSON.Feature => {
      const displayCells =
        renderResolution < DRAW_RESOLUTION
          ? [...new Set([...cells].map((h) => getParentCell(h, renderResolution)))]
          : [...cells];

      const worldBounds = [
        [-180, -85],
        [180, -85],
        [180, 85],
        [-180, 85],
        [-180, -85],
      ];

      const holes = displayCells.map((h3Index) => {
        const boundary = getCellBoundary(h3Index);
        return [...boundary, boundary[0]];
      });

      return {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [worldBounds, ...holes],
        },
        properties: {},
      };
    },
    [renderResolution]
  );

  // Initialise map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STADIA_STYLE,
      center: [-122.4194, 37.7749], // San Francisco default
      zoom: 13,
    });

    map.addControl(new NavigationControl(), "top-right");

    map.on("zoomend", () => {
      onZoomChange(map.getZoom());
      renderMarkersRef.current();
    });

    map.on("moveend", () => {
      renderMarkersRef.current();
    });

    map.on("load", () => {
      // Boost saturation of the base map
      map.getCanvas().style.filter = "saturate(2.5) contrast(1.15)";
      
      // Add desaturation mask source
      map.addSource(DESAT_SOURCE, {
        type: "geojson",
        data: buildDesaturationMask(new Set()),
      });

      // Add desaturation layer
      map.addLayer({
        id: DESAT_LAYER,
        type: "fill",
        source: DESAT_SOURCE,
        paint: {
          "fill-color": "#808080",
          "fill-opacity": 0.75,
        },
      });

      map.addSource(CELL_SOURCE, {
        type: "geojson",
        data: buildGeoJSON(new Set()),
      });

      map.addLayer({
        id: CELL_LAYER,
        type: "fill",
        source: CELL_SOURCE,
        paint: {
          "fill-color": "rgba(0, 0, 0, 0)",
          "fill-opacity": 0,
        },
      });

      map.addLayer({
        id: CELL_BORDER_LAYER,
        type: "line",
        source: CELL_SOURCE,
        paint: {
          "line-color": "rgba(255, 255, 255, 0.25)",
          "line-width": 0.75,
        },
      });
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Jump to the most recently visited location once it's known (fires once after initial load)
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

  // Update cell GeoJSON and desaturation mask when visitedCells changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const update = () => {
      const cellSource = map.getSource(CELL_SOURCE) as GeoJSONSource | undefined;
      const desatSource = map.getSource(DESAT_SOURCE) as GeoJSONSource | undefined;
      
      cellSource?.setData(buildGeoJSON(visitedCells));
      desatSource?.setData(buildDesaturationMask(visitedCells));
    };

    if (map.isStyleLoaded()) {
      update();
    } else {
      map.once("load", update);
      return () => { map.off("load", update); };
    }
  }, [visitedCells, buildGeoJSON, buildDesaturationMask]);

  // Lock/unlock map pan and set canvas cursor based on mode.
  // We set cursor on map.getCanvas() directly because MapLibre owns that
  // element and overrides any CSS applied to the wrapper div.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const lock = mode === "draw" || mode === "erase";
    if (lock) {
      map.dragPan.disable();
      map.touchZoomRotate.disable();
    } else {
      map.dragPan.enable();
      map.touchZoomRotate.enable();
    }

    const cursorMap: Record<string, string> = {
      browse: "grab",
      draw:   "crosshair",
      erase:  "cell",
      pin:    "pointer",
    };
    map.getCanvas().style.cursor = cursorMap[mode] ?? "grab";
  }, [mode]);

  // Paint/erase pointer interactions
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    function lngLatToCell(e: MapMouseEvent | MapTouchEvent) {
      return snapToCell(e.lngLat.lat, e.lngLat.lng);
    }

    function handleDown(e: MapMouseEvent | MapTouchEvent) {
      if (mode !== "draw" && mode !== "erase") return;
      isPaintingRef.current = true;
      const cell = lngLatToCell(e);
      if (mode === "draw") onCellPaint(cell);
      else onCellErase(cell);
    }

    function handleMove(e: MapMouseEvent | MapTouchEvent) {
      if (!isPaintingRef.current) return;
      if (mode !== "draw" && mode !== "erase") return;
      const cell = lngLatToCell(e);
      if (mode === "draw") onCellPaint(cell);
      else onCellErase(cell);
    }

    function handleUp() {
      isPaintingRef.current = false;
    }

    function handleClick(e: MapMouseEvent) {
      if (mode !== "pin") return;
      onPinDrop(e.lngLat.lat, e.lngLat.lng);
    }

    map.on("mousedown", handleDown);
    map.on("mousemove", handleMove);
    map.on("mouseup", handleUp);
    map.on("touchstart", handleDown);
    map.on("touchmove", handleMove);
    map.on("touchend", handleUp);
    map.on("click", handleClick);

    return () => {
      map.off("mousedown", handleDown);
      map.off("mousemove", handleMove);
      map.off("mouseup", handleUp);
      map.off("touchstart", handleDown);
      map.off("touchmove", handleMove);
      map.off("touchend", handleUp);
      map.off("click", handleClick);
    };
  }, [mode, onCellPaint, onCellErase, onPinDrop, renderResolution]);

  // Keep onPinClick ref current
  useEffect(() => { onPinClickRef.current = onPinClick; }, [onPinClick]);

  // Core marker render — reads only from refs so it can be called from map event listeners
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

    // Build the set of IDs that should exist after this render
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nextIds = new Set(clusters.map((c: any) =>
      c.properties.cluster
        ? `cluster-${c.properties.cluster_id}`
        : c.properties.photoId
    ));

    // Remove markers no longer needed
    Object.keys(markersRef.current).forEach((id) => {
      if (!nextIds.has(id)) {
        markersRef.current[id].remove();
        delete markersRef.current[id];
      }
    });

    // Add missing markers
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    clusters.forEach((cluster: any) => {
      const isCluster = !!cluster.properties.cluster;
      const markerId = isCluster
        ? `cluster-${cluster.properties.cluster_id}`
        : cluster.properties.photoId;

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
        circle.style.cssText = `
          width: 52px; height: 52px; border-radius: 50%;
          overflow: hidden; border: 3px solid white;
          box-shadow: 0 2px 12px rgba(0,0,0,0.22);
          background: #ccc;
        `;
        if (repPhoto) {
          const img = document.createElement("img");
          img.src = repPhoto.url;
          img.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;";
          circle.appendChild(img);
        }

        const badge = document.createElement("div");
        badge.style.cssText = `
          background: white; border-radius: 10px; padding: 2px 8px;
          font-size: 11px; font-weight: 600; color: #3d3530;
          box-shadow: 0 1px 4px rgba(0,0,0,0.15); line-height: 1.5;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        `;
        badge.textContent = String(count);

        el.appendChild(circle);
        el.appendChild(badge);

        el.addEventListener("click", () => {
          const expansionZoom = Math.min(
            index.getClusterExpansionZoom(clusterId),
            20
          );
          mapRef.current?.easeTo({ center: [lng, lat], zoom: expansionZoom });
        });

        const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
          .setLngLat([lng, lat])
          .addTo(map);
        markersRef.current[markerId] = marker;

      } else {
        const photoId = cluster.properties.photoId as string;
        const photo = photosMapRef.current[photoId];
        if (!photo) return;

        if (rotationRef.current[photo.id] == null) {
          rotationRef.current[photo.id] = parseFloat((Math.random() * 6 - 3).toFixed(1));
        }
        const rotation = rotationRef.current[photo.id];

        const el = document.createElement("div");
        el.className = "polaroid-marker";
        el.style.cssText = `
          width: 48px; background: white;
          padding: 3px 3px 10px 3px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.18);
          border-radius: 2px; cursor: pointer;
          transform: rotate(${rotation}deg);
        `;
        const img = document.createElement("img");
        img.src = photo.url;
        img.style.cssText = "width:100%;height:42px;object-fit:cover;display:block;";
        el.appendChild(img);
        el.addEventListener("click", () => onPinClickRef.current(photo));

        const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
          .setLngLat([photo.lng, photo.lat])
          .addTo(map);
        markersRef.current[photo.id] = marker;
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the indirection ref current so map event listeners always call latest impl
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

    // Build the dot element once (or reuse)
    if (!locationMarkerRef.current) {
      const outer = document.createElement("div");
      outer.style.cssText = "position:relative;width:14px;height:14px;";

      const ring = document.createElement("div");
      ring.className = "location-pulse-ring";
      outer.appendChild(ring);

      const dot = document.createElement("div");
      dot.style.cssText = `
        position:absolute;inset:0;border-radius:50%;
        background:#3b82f6;border:2px solid white;
        box-shadow:0 1px 6px rgba(59,130,246,0.5);
      `;
      outer.appendChild(dot);

      locationMarkerRef.current = new maplibregl.Marker({ element: outer, anchor: "center" })
        .setLngLat([currentLocation.lng, currentLocation.lat])
        .addTo(map);
    } else {
      locationMarkerRef.current.setLngLat([currentLocation.lng, currentLocation.lat]);
    }
  }, [currentLocation]);

  // Rebuild supercluster index whenever photos change, then re-render
  useEffect(() => {
    photosMapRef.current = Object.fromEntries(photos.map((p) => [p.id, p]));

    // Assign stable rotations for any new photos
    photos.forEach((p) => {
      if (rotationRef.current[p.id] == null) {
        rotationRef.current[p.id] = parseFloat((Math.random() * 6 - 3).toFixed(1));
      }
    });

    const index = new Supercluster<{ photoId: string }>({
      radius: 60,
      maxZoom: 14,
    });
    index.load(
      photos.map((p) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
        properties: { photoId: p.id },
      }))
    );
    clusterIndexRef.current = index;

    renderMarkers();
  }, [photos, renderMarkers]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%" }}
    />
  );
}
