"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { resolutionForZoom } from "@/lib/h3";
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

  // Batch paint queue: flush to API every 500ms
  const pendingPaintRef = useRef<Set<string>>(new Set());
  const pendingEraseRef = useRef<Set<string>>(new Set());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Erase a single cell
  const handleCellErase = useCallback(
    (h3Index: string) => {
      setVisitedCells((prev) => {
        if (!prev.has(h3Index)) return prev;
        const next = new Set(prev);
        next.delete(h3Index);
        return next;
      });
      setUndoStack((s) => {
        const last = s.past[s.past.length - 1];
        if (last?.type === "erase") {
          if (last.cells.includes(h3Index)) return s;
          return {
            ...s,
            past: [
              ...s.past.slice(0, -1),
              { type: "erase", cells: [...last.cells, h3Index] },
            ],
          };
        }
        return pushAction(s, { type: "erase", cells: [h3Index] });
      });
      pendingEraseRef.current.add(h3Index);
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
    setMode("browse");
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
      />

      <StatsPanel
        cellCount={visitedCells.size}
        photoCount={photos.length}
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
          onConfirm={handlePinConfirm}
          onCancel={() => { setPendingPin(null); setMode("browse"); }}
        />
      )}
    </div>
  );
}
