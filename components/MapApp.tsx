"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { resolutionForZoom, snapToCell, cellToCenter, getCellsAlongLine, getParentCell, DRAW_RESOLUTION } from "@/lib/h3";
import {
  initialStack,
  pushAction,
  undo,
  redo,
  type UndoRedoStack,
  type CellAction,
} from "@/lib/undoRedo";
import Map, { type PhotoPin } from "./Map";
import DrawControls from "./DrawControls";
import StatsPanel from "./StatsPanel";
import PolaroidPin from "./PolaroidPin";
import PinDropDialog from "./PinDropDialog";
import GeoUploadDialog from "./GeoUploadDialog";

export type MapMode = "browse" | "draw" | "erase" | "pin";

export default function MapApp() {
  // Map state
  const [mode, setMode] = useState<MapMode>("browse");
  const [zoom, setZoom] = useState(13);
  const renderResolution = resolutionForZoom(zoom);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Visited cells: live Set for fast lookup
  const [visitedCells, setVisitedCells] = useState<Set<string>>(new Set());

  // Photos
  const [photos, setPhotos] = useState<PhotoPin[]>([]);

  // Undo/redo
  const [undoStack, setUndoStack] = useState<UndoRedoStack>(initialStack());

  // UI state
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoPin | null>(null);
  const [pendingPin, setPendingPin] = useState<{ lat: number; lng: number } | null>(null);
  const [geoUploadOpen, setGeoUploadOpen] = useState(false);
  const [manualPlaceFile, setManualPlaceFile] = useState<File | null>(null);
  const [initialCenter, setInitialCenter] = useState<{ lat: number; lng: number } | null>(null);

  // Location tracking
  const [isTracking, setIsTracking] = useState(false);
  const [trackingProgress, setTrackingProgress] = useState(0); // 0–100
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [trackingDenied, setTrackingDenied] = useState(false);
  const trackingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const trackingElapsedRef = useRef(0);
  // Previous ping location — used to interpolate cells along the path between pings
  const prevLocationRef = useRef<{ lat: number; lng: number } | null>(null);

  // Batch paint queue: flush to API every 500ms
  const pendingPaintRef = useRef<Set<string>>(new Set());
  const pendingEraseRef = useRef<Set<string>>(new Set());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable refs so handleCellErase can read current values without re-creating
  const renderResolutionRef = useRef(renderResolution);
  useEffect(() => { renderResolutionRef.current = renderResolution; }, [renderResolution]);
  const visitedCellsRef = useRef(visitedCells);
  useEffect(() => { visitedCellsRef.current = visitedCells; }, [visitedCells]);

  // Initial data load
  useEffect(() => {
    async function load() {
      try {
        const [cellsRes, photosRes] = await Promise.all([
          fetch(`/api/cells?zoom=13`),
          fetch("/api/photos"),
        ]);
        const cellsData = await cellsRes.json();
        const photosData = await photosRes.json();
        if (cellsData.error) {
          console.error("cells load error:", cellsData.error);
          if (cellsData.error.includes("relation") || cellsData.error.includes("path")) {
            setLoadError("Database tables not found. Run the migration SQL in Supabase first.");
          }
        } else if (cellsData.cells) {
          setVisitedCells(new Set<string>(cellsData.cells));
          if (cellsData.recentCell) {
            setInitialCenter(cellToCenter(cellsData.recentCell));
          }
        }
        if (!photosData.error && photosData.photos) {
          setPhotos(photosData.photos);
        }
      } catch (e) {
        console.error("Failed to load map data:", e);
      }
    }
    load();
  }, []);

  // Flush pending cell changes to API
  const flushPending = useCallback(async () => {
    const toPaint = [...pendingPaintRef.current];
    const toErase = [...pendingEraseRef.current];
    pendingPaintRef.current = new Set();
    pendingEraseRef.current = new Set();

    if (toPaint.length > 0) {
      await fetch("/api/cells", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cells: toPaint }),
      });
    }
    if (toErase.length > 0) {
      await fetch("/api/cells", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cells: toErase }),
      });
    }
  }, []);

  function scheduleFlushed() {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(flushPending, 500);
  }

  // Paint a single cell
  const handleCellPaint = useCallback(
    (h3Index: string) => {
      setVisitedCells((prev) => {
        if (prev.has(h3Index)) return prev;
        const next = new Set(prev);
        next.add(h3Index);
        return next;
      });
      setUndoStack((s) => {
        const last = s.past[s.past.length - 1];
        // Merge into current stroke if it's a paint action
        if (last?.type === "paint") {
          if (last.cells.includes(h3Index)) return s;
          return {
            ...s,
            past: [
              ...s.past.slice(0, -1),
              { type: "paint", cells: [...last.cells, h3Index] },
            ],
          };
        }
        return pushAction(s, { type: "paint", cells: [h3Index] });
      });
      pendingPaintRef.current.add(h3Index);
      scheduleFlushed();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Erase cells. When zoomed out, erases every res-9 cell under the coarser
  // render-resolution parent — making it easy to bulk-clear whole regions.
  const handleCellErase = useCallback(
    (h3Index: string) => {
      const resolution = renderResolutionRef.current;
      const current = visitedCellsRef.current;

      // Determine which res-9 cells to remove
      let cellsToErase: string[];
      if (resolution >= DRAW_RESOLUTION) {
        // Fully zoomed in — just the single cell
        if (!current.has(h3Index)) return;
        cellsToErase = [h3Index];
      } else {
        // Zoomed out — remove every visited child under the visible parent hex
        const parent = getParentCell(h3Index, resolution);
        cellsToErase = [...current].filter(
          (c) => getParentCell(c, resolution) === parent
        );
        if (cellsToErase.length === 0) return;
      }

      setVisitedCells((prev) => {
        const next = new Set(prev);
        cellsToErase.forEach((c) => next.delete(c));
        return next;
      });

      setUndoStack((s) => {
        const last = s.past[s.past.length - 1];
        if (last?.type === "erase") {
          // Merge into the current erase stroke, skipping already-recorded cells
          const newCells = cellsToErase.filter((c) => !last.cells.includes(c));
          if (newCells.length === 0) return s;
          return {
            ...s,
            past: [
              ...s.past.slice(0, -1),
              { type: "erase", cells: [...last.cells, ...newCells] },
            ],
          };
        }
        return pushAction(s, { type: "erase", cells: cellsToErase });
      });

      cellsToErase.forEach((c) => pendingEraseRef.current.add(c));
      scheduleFlushed();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Undo
  const handleUndo = useCallback(() => {
    setUndoStack((s) => {
      const { stack, action } = undo(s);
      if (!action) return s;
      applyReverse(action);
      return stack;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Redo
  const handleRedo = useCallback(() => {
    setUndoStack((s) => {
      const { stack, action } = redo(s);
      if (!action) return s;
      applyForward(action);
      return stack;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function applyReverse(action: CellAction) {
    if (action.type === "paint") {
      setVisitedCells((prev) => {
        const next = new Set(prev);
        action.cells.forEach((c) => next.delete(c));
        return next;
      });
      action.cells.forEach((c) => pendingEraseRef.current.add(c));
    } else {
      setVisitedCells((prev) => {
        const next = new Set(prev);
        action.cells.forEach((c) => next.add(c));
        return next;
      });
      action.cells.forEach((c) => pendingPaintRef.current.add(c));
    }
    scheduleFlushed();
  }

  function applyForward(action: CellAction) {
    if (action.type === "paint") {
      setVisitedCells((prev) => {
        const next = new Set(prev);
        action.cells.forEach((c) => next.add(c));
        return next;
      });
      action.cells.forEach((c) => pendingPaintRef.current.add(c));
    } else {
      setVisitedCells((prev) => {
        const next = new Set(prev);
        action.cells.forEach((c) => next.delete(c));
        return next;
      });
      action.cells.forEach((c) => pendingEraseRef.current.add(c));
    }
    scheduleFlushed();
  }

  // Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleUndo, handleRedo]);

  // Pin drop
  const handlePinDrop = useCallback((lat: number, lng: number) => {
    setPendingPin({ lat, lng });
  }, []);

  async function handlePinConfirm(file: File, caption: string) {
    if (!pendingPin) return;
    const form = new FormData();
    form.append("lat", String(pendingPin.lat));
    form.append("lng", String(pendingPin.lng));
    form.append("caption", caption);
    form.append("file", file);
    const res = await fetch("/api/photos", { method: "POST", body: form });
    const data = await res.json();
    if (data.photo) setPhotos((prev) => [data.photo, ...prev]);
    setPendingPin(null);
    setManualPlaceFile(null);
    setMode("browse");
  }

  function applyLocation(lat: number, lng: number) {
    setCurrentLocation({ lat, lng });
    const newCell = snapToCell(lat, lng);

    if (prevLocationRef.current) {
      // Fill every cell the straight line between the previous and current ping crosses
      const prevCell = snapToCell(prevLocationRef.current.lat, prevLocationRef.current.lng);
      const pathCells = getCellsAlongLine(prevCell, newCell);
      pathCells.forEach((cell) => handleCellPaint(cell));
    } else {
      handleCellPaint(newCell);
    }

    prevLocationRef.current = { lat, lng };
  }

  function startTracking() {
    if (!navigator.geolocation) { setTrackingDenied(true); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        applyLocation(pos.coords.latitude, pos.coords.longitude);
        setIsTracking(true);
        setTrackingDenied(false);
        trackingElapsedRef.current = 0;
        setTrackingProgress(0);
      },
      () => setTrackingDenied(true),
      { enableHighAccuracy: true, timeout: 10_000 }
    );
  }

  function stopTracking() {
    setIsTracking(false);
    setCurrentLocation(null);
    setTrackingProgress(0);
    trackingElapsedRef.current = 0;
    prevLocationRef.current = null;
    if (trackingTimerRef.current) { clearInterval(trackingTimerRef.current); trackingTimerRef.current = null; }
  }

  useEffect(() => {
    if (!isTracking) return;
    const INTERVAL_MS = 60_000;
    const TICK_MS = 150;
    trackingTimerRef.current = setInterval(() => {
      trackingElapsedRef.current += TICK_MS;
      if (trackingElapsedRef.current >= INTERVAL_MS) {
        trackingElapsedRef.current = 0;
        setTrackingProgress(0);
        navigator.geolocation.getCurrentPosition(
          (pos) => applyLocation(pos.coords.latitude, pos.coords.longitude),
          () => {} // silent miss, keep going
        );
      } else {
        setTrackingProgress((trackingElapsedRef.current / INTERVAL_MS) * 100);
      }
    }, TICK_MS);
    return () => {
      if (trackingTimerRef.current) { clearInterval(trackingTimerRef.current); trackingTimerRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTracking]);

  async function handleGeoUploadSave(file: File, lat: number, lng: number, caption: string) {
    setGeoUploadOpen(false);
    const form = new FormData();
    form.append("lat", String(lat));
    form.append("lng", String(lng));
    form.append("caption", caption);
    form.append("file", file);
    const res = await fetch("/api/photos", { method: "POST", body: form });
    const data = await res.json();
    if (data.photo) setPhotos((prev) => [data.photo, ...prev]);
  }

  function handleGeoUploadPlaceManually(file: File) {
    setGeoUploadOpen(false);
    setManualPlaceFile(file);
    setMode("pin");
  }

  async function handleDeletePhoto(id: string) {
    await fetch(`/api/photos?id=${id}`, { method: "DELETE" });
    setPhotos((prev) => prev.filter((p) => p.id !== id));
    setSelectedPhoto(null);
  }

  return (
    <div style={{ position: "relative", width: "100vw", height: "100dvh", overflow: "hidden" }}>
      {loadError && (
        <div style={{
          position: "absolute",
          top: 0, left: 0, right: 0,
          zIndex: 50,
          background: "#fef3cd",
          borderBottom: "1px solid #f0c040",
          padding: "10px 16px",
          fontSize: 13,
          color: "#7a5c00",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}>
          <span>{loadError}</span>
          <button onClick={() => setLoadError(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#7a5c00" }}>✕</button>
        </div>
      )}

      <Map
        mode={mode}
        visitedCells={visitedCells}
        photos={photos}
        onCellPaint={handleCellPaint}
        onCellErase={handleCellErase}
        onPinDrop={handlePinDrop}
        onPinClick={setSelectedPhoto}
        renderResolution={renderResolution}
        onZoomChange={setZoom}
        centerOn={initialCenter}
        currentLocation={currentLocation}
        onDebugLocation={applyLocation}
      />

      <StatsPanel
        cellCount={visitedCells.size}
        photoCount={photos.length}
        onUpload={() => setGeoUploadOpen(true)}
        isTracking={isTracking}
        trackingProgress={trackingProgress}
        onToggleTracking={isTracking ? stopTracking : startTracking}
      />

      <DrawControls
        mode={mode}
        onModeChange={setMode}
        undoStack={undoStack}
        onUndo={handleUndo}
        onRedo={handleRedo}
      />

      {selectedPhoto && (
        <PolaroidPin
          photo={selectedPhoto}
          onClose={() => setSelectedPhoto(null)}
          onDelete={handleDeletePhoto}
        />
      )}

      {pendingPin && (
        <PinDropDialog
          lat={pendingPin.lat}
          lng={pendingPin.lng}
          initialFile={manualPlaceFile ?? undefined}
          onConfirm={handlePinConfirm}
          onCancel={() => { setPendingPin(null); setManualPlaceFile(null); setMode("browse"); }}
        />
      )}

      {geoUploadOpen && (
        <GeoUploadDialog
          onSave={handleGeoUploadSave}
          onPlaceManually={handleGeoUploadPlaceManually}
          onCancel={() => setGeoUploadOpen(false)}
        />
      )}

      {trackingDenied && (
        <div
          onClick={() => setTrackingDenied(false)}
          style={{
            position: "fixed", inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 200,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "white", borderRadius: 12, padding: "24px 28px",
              maxWidth: 310, width: "90%",
              boxShadow: "0 8px 40px rgba(0,0,0,0.25)", textAlign: "center",
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 10 }}>📍</div>
            <p style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 600, color: "#1a1a1a" }}>
              Location access denied
            </p>
            <p style={{ margin: "0 0 20px", fontSize: 13, color: "#666", lineHeight: 1.5 }}>
              Been There couldn&apos;t access your location. You can paint visited areas manually using the draw tool instead.
            </p>
            <button
              onClick={() => setTrackingDenied(false)}
              style={{
                width: "100%", padding: "10px 0", borderRadius: 8,
                border: "none", background: "var(--color-orange)",
                color: "var(--color-text)", fontWeight: 600, fontSize: 14, cursor: "pointer",
              }}
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
