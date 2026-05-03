"use client";

import { useEffect, useRef, useCallback } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, IControl, MapMouseEvent, MapTouchEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// MapLibre 5.x namespace exports don't expose construct signatures via `import *`.
// Cast to the correct interface to allow `new` calls.
const NavigationControl = maplibregl.NavigationControl as unknown as new () => IControl;
import { getCellBoundary, snapToCell } from "@/lib/h3";
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

export default function Map({
  mode,
  visitedCells,
  photos,
  onCellPaint,
  onCellErase,
  onPinDrop,
  onPinClick,
  renderResolution,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  // Use a plain object to avoid collision with maplibre-gl's exported `Map` class name
  const markersRef = useRef<Record<string, maplibregl.Marker>>({});
  const isPaintingRef = useRef(false);

  // Build GeoJSON from visited cells
  const buildGeoJSON = useCallback(
    (cells: Set<string>): GeoJSON.FeatureCollection => ({
      type: "FeatureCollection",
      features: [...cells].map((h3Index) => ({
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [...getCellBoundary(h3Index), getCellBoundary(h3Index)[0]],
          ],
        },
        properties: { h3Index },
      })),
    }),
    []
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

    map.on("load", () => {
      map.addSource(CELL_SOURCE, {
        type: "geojson",
        data: buildGeoJSON(new Set()),
      });

      map.addLayer({
        id: CELL_LAYER,
        type: "fill",
        source: CELL_SOURCE,
        paint: {
          "fill-color": "rgba(126, 200, 200, 0.45)",
          "fill-opacity": 1,
        },
      });

      map.addLayer({
        id: CELL_BORDER_LAYER,
        type: "line",
        source: CELL_SOURCE,
        paint: {
          "line-color": "rgba(126, 200, 200, 0.8)",
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

  // Update cell GeoJSON when visitedCells changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const source = map.getSource(CELL_SOURCE) as GeoJSONSource | undefined;
    source?.setData(buildGeoJSON(visitedCells));
  }, [visitedCells, buildGeoJSON]);

  // Lock/unlock map pan based on mode
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

  // Sync photo markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const currentIds = new Set(photos.map((p) => p.id));

    // Remove stale markers
    Object.entries(markersRef.current).forEach(([id, marker]) => {
      if (!currentIds.has(id)) {
        marker.remove();
        delete markersRef.current[id];
      }
    });

    // Add new markers
    photos.forEach((photo) => {
      if (markersRef.current[photo.id]) return;

      const el = document.createElement("div");
      el.className = "polaroid-marker";
      el.style.cssText = `
        width: 48px;
        background: white;
        padding: 3px 3px 10px 3px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.18);
        border-radius: 2px;
        cursor: pointer;
        transform: rotate(${(Math.random() * 6 - 3).toFixed(1)}deg);
      `;
      const img = document.createElement("img");
      img.src = photo.url;
      img.style.cssText = "width: 100%; height: 42px; object-fit: cover; display: block;";
      el.appendChild(img);
      el.addEventListener("click", () => onPinClick(photo));

      const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([photo.lng, photo.lat])
        .addTo(map);

      markersRef.current[photo.id] = marker;
    });
  }, [photos, onPinClick]);

  const cursor =
    mode === "draw" ? "crosshair" : mode === "erase" ? "cell" : mode === "pin" ? "copy" : "grab";

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", cursor }}
    />
  );
}
