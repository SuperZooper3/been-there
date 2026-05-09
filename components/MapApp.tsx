"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { App } from "@capacitor/app";
import type { BackgroundGeolocationPlugin, Location as BGLocation, CallbackError } from "@capacitor-community/background-geolocation";
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
import NativeOnboardingModal, { hasCompletedNativeOnboarding } from "./NativeOnboardingModal";
import PolaroidPin from "./PolaroidPin";
import PinDropDialog from "./PinDropDialog";
import GeoUploadDialog from "./GeoUploadDialog";
import {
  appendOfflinePaintQueue,
  appendOfflineEraseQueue,
  getOfflinePaintQueue,
  getOfflineEraseQueue,
  removeFromOfflinePaintQueue,
  removeFromOfflineEraseQueue,
} from "@/lib/offline-buffer";

// Pure-native Capacitor plugin — no JS bundle to import; accessed via the native bridge.
// Safe to register at module level: returns a no-op proxy on web (never called outside isNativePlatform()).
const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>("BackgroundGeolocation");

/** Native background tracking: fewer GPS wakeups (larger = less frequent fixes, better battery). */
const NATIVE_DISTANCE_FILTER_M = 48;
/** How often to POST batched cell paints while native tracking (also flushes on app foreground / pause / stop). */
const NATIVE_TRACK_FLUSH_MS = 10 * 60 * 1000;

export type MapMode = "browse" | "draw" | "erase" | "pin";

export default function MapApp() {
  // Map state
  const [mode, setMode] = useState<MapMode>("browse");
  const [zoom, setZoom] = useState(13);
  const renderResolution = resolutionForZoom(zoom);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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
  // Native-only: true when iOS location permission is "When In Use" rather than "Always"
  const [trackingBackgroundLimited, setTrackingBackgroundLimited] = useState(false);
  // Manual draw mode — hidden by default, revealed when location is denied
  const [drawUnlocked, setDrawUnlocked] = useState(false);
  const [showDrawModal, setShowDrawModal] = useState(false);
  const [showNativeOnboarding, setShowNativeOnboarding] = useState(false);
  /** Android: last GPS sample time from native plugin (ms), mirrors notification “Last GPS fix” */
  const [lastNativeGpsAtMs, setLastNativeGpsAtMs] = useState<number | null>(null);
  const isTrackingRef = useRef(false);
  isTrackingRef.current = isTracking;
  const trackingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const trackingElapsedRef = useRef(0);
  // Previous ping location — used to interpolate cells along the path between pings
  const prevLocationRef = useRef<{ lat: number; lng: number } | null>(null);
  // Native background geolocation watcher ID — kept in ref so stopTracking can remove it
  const nativeWatcherIdRef = useRef<string | null>(null);
  // Stable ref to applyLocation — updated every render so the native plugin callback
  // always calls the latest version without capturing a stale closure.
  const applyLocationRef = useRef<(lat: number, lng: number) => void>(() => {});

  // Batch paint queue: flush to API every 500ms on web / manual draw; native tracking uses a 10 min timer + lifecycle flushes.
  const pendingPaintRef = useRef<Set<string>>(new Set());
  const pendingEraseRef = useRef<Set<string>>(new Set());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushPendingRef = useRef<() => Promise<void>>(async () => {});
  const syncOfflineQueuesRef = useRef<() => Promise<void>>(async () => {});

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
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, []);

  // First launch on native shell: explain notifications + battery before they hit Track.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (hasCompletedNativeOnboarding()) return;
    setShowNativeOnboarding(true);
  }, []);

  // isSyncing prevents the reconnect flush and the 500ms batch from racing (M2)
  const isSyncingRef = useRef(false);

  // Flush the localStorage offline queues to the server.
  // Erases are sent first so a cell erased offline isn't re-added by a pending paint.
  // We snapshot the queues once and remove only those specific cells after each fetch so that
  // cells appended by a concurrent offline flush during the awaits are not accidentally wiped.
  const syncOfflineQueues = useCallback(async () => {
    if (isSyncingRef.current) return;
    const toErase = getOfflineEraseQueue();
    const toPaint = getOfflinePaintQueue();
    if (toErase.length === 0 && toPaint.length === 0) return;
    isSyncingRef.current = true;
    try {
      if (toErase.length > 0) {
        await fetch("/api/cells", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cells: toErase }),
        });
        removeFromOfflineEraseQueue(toErase);
      }
      if (toPaint.length > 0) {
        await fetch("/api/cells", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cells: toPaint }),
        });
        removeFromOfflinePaintQueue(toPaint);
      }
    } catch {
      // Leave queues intact — will retry on next reconnect or load
    } finally {
      isSyncingRef.current = false;
    }
  }, []);

  // Attempt offline queue sync on mount and whenever the device comes back online
  useEffect(() => {
    syncOfflineQueues();
    window.addEventListener("online", syncOfflineQueues);
    return () => window.removeEventListener("online", syncOfflineQueues);
  }, [syncOfflineQueues]);

  // Flush pending cell changes to API, falling back to localStorage when offline (M1, M2)
  const flushPending = useCallback(async () => {
    const toPaint = [...pendingPaintRef.current];
    const toErase = [...pendingEraseRef.current];
    pendingPaintRef.current = new Set();
    pendingEraseRef.current = new Set();

    if (!navigator.onLine) {
      // Offline — persist to localStorage; will be flushed on reconnect
      if (toPaint.length > 0) appendOfflinePaintQueue(toPaint);
      if (toErase.length > 0) appendOfflineEraseQueue(toErase);
      return;
    }

    // Erases first — same ordering rule as syncOfflineQueues
    try {
      if (toErase.length > 0) {
        await fetch("/api/cells", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cells: toErase }),
        });
      }
    } catch {
      if (toErase.length > 0) appendOfflineEraseQueue(toErase);
    }

    try {
      if (toPaint.length > 0) {
        await fetch("/api/cells", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cells: toPaint }),
        });
      }
    } catch {
      if (toPaint.length > 0) appendOfflinePaintQueue(toPaint);
    }
  }, []);

  flushPendingRef.current = flushPending;
  syncOfflineQueuesRef.current = syncOfflineQueues;

  // Native tracking: periodic server sync (cells already update the map locally).
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !isTracking) return;
    const id = window.setInterval(() => {
      void flushPendingRef.current();
    }, NATIVE_TRACK_FLUSH_MS);
    return () => clearInterval(id);
  }, [isTracking]);

  // Native: flush when foregrounding / backgrounding; failed POSTs stay in offline queues until retry.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let cancelled = false;
    let sub: Awaited<ReturnType<typeof App.addListener>> | undefined;
    void App.addListener("appStateChange", ({ isActive }) => {
      void flushPendingRef.current();
      if (isActive) {
        void syncOfflineQueuesRef.current();
      }
    }).then((h) => {
      if (cancelled) {
        void h.remove();
      } else {
        sub = h;
      }
    });
    return () => {
      cancelled = true;
      void sub?.remove();
    };
  }, []);

  function scheduleFlushed() {
    // Native + tracking: cell paints accumulate; interval + app lifecycle call flush (saves battery vs 500ms polling).
    if (Capacitor.isNativePlatform() && isTrackingRef.current) {
      return;
    }
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
  // Keep ref current every render so the native plugin callback never holds a stale closure (M3)
  applyLocationRef.current = applyLocation;

  async function startTracking() {
    if (Capacitor.isNativePlatform()) {
      try {
        if (Capacitor.getPlatform() === "android") {
          try {
            const { LocalNotifications } = await import("@capacitor/local-notifications");
            const perm = await LocalNotifications.checkPermissions();
            if (perm.display !== "granted") {
              await LocalNotifications.requestPermissions();
            }
          } catch {
            /* Older WebView / missing plugin — still try tracking */
          }
        }

        const watcherId = await BackgroundGeolocation.addWatcher(
          {
            backgroundMessage: "Recording your path",
            backgroundTitle: "Been There",
            requestPermissions: true,
            stale: false,
            distanceFilter: NATIVE_DISTANCE_FILTER_M, // metres — larger ⇒ fewer GPS wakeups & better battery (path still interpolated between fixes)
          },
          (location: BGLocation | undefined, error: CallbackError | undefined) => {
            if (error || !location) return;
            // Route through ref so we always call the latest applyLocation (M3)
            applyLocationRef.current(location.latitude, location.longitude);
            if (Capacitor.getPlatform() === "android" && typeof location.time === "number") {
              setLastNativeGpsAtMs(location.time);
            }
          }
        );
        nativeWatcherIdRef.current = watcherId;
        setIsTracking(true);
        setTrackingDenied(false);
        setLastNativeGpsAtMs(null);

        // On iOS, the first OS prompt always grants "When In Use", not "Always".
        // Background tracking silently stops when the screen is locked until the user
        // upgrades to "Always" in Settings. Show a persistent reminder banner.
        if (Capacitor.getPlatform() === "ios") {
          setTrackingBackgroundLimited(true);
        }
      } catch {
        setTrackingDenied(true);
      }
    } else {
      // Web path — unchanged
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
  }

  function handleTrackToggle() {
    if (isTracking) {
      stopTracking();
    } else if (trackingDenied) {
      setShowDrawModal(true);
    } else {
      startTracking();
    }
  }

  function stopTracking() {
    void flushPendingRef.current();
    if (Capacitor.isNativePlatform()) {
      // Capture ID into a local var BEFORE clearing the ref (S2 — avoids null read in async callback)
      const watcherId = nativeWatcherIdRef.current;
      nativeWatcherIdRef.current = null;
      if (watcherId) {
        BackgroundGeolocation.removeWatcher({ id: watcherId });
      }
      setTrackingBackgroundLimited(false);
    }
    setIsTracking(false);
    setCurrentLocation(null);
    setTrackingProgress(0);
    setLastNativeGpsAtMs(null);
    trackingElapsedRef.current = 0;
    prevLocationRef.current = null;
    if (trackingTimerRef.current) { clearInterval(trackingTimerRef.current); trackingTimerRef.current = null; }
  }

  // Web-only polling loop — guarded so it never runs on native (where the plugin handles updates)
  useEffect(() => {
    if (!isTracking || Capacitor.isNativePlatform()) return;
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
      {showNativeOnboarding && (
        <NativeOnboardingModal onClose={() => setShowNativeOnboarding(false)} />
      )}

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
        // On native the plugin fires on movement, not on a 60s timer — progress ring is meaningless
        trackingProgress={Capacitor.isNativePlatform() ? 0 : trackingProgress}
        onToggleTracking={handleTrackToggle}
        isLoading={isLoading}
        trackingDenied={trackingDenied}
        nativeLastGpsAtMs={Capacitor.getPlatform() === "android" ? lastNativeGpsAtMs : null}
        onNativeTipsClick={Capacitor.isNativePlatform() ? () => setShowNativeOnboarding(true) : undefined}
      />

      {/* iOS background location permission warning — shown when only "When In Use" was granted.
          Tracking still works (foreground only) but background recording won't happen. */}
      {trackingBackgroundLimited && isTracking && (
        <div
          style={{
            position: "absolute",
            top: 70,
            left: 12,
            right: 12,
            zIndex: 30,
            background: "var(--color-orange)",
            borderRadius: 12,
            padding: "10px 14px",
            boxShadow: "0 2px 12px rgba(0,0,0,0.15)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <span style={{ fontSize: 12, color: "var(--color-text)", lineHeight: 1.5, flex: 1 }}>
            Background tracking limited. Tap to enable in Settings → Privacy → Location → Been There → Always.
          </span>
          <button
            onClick={() => BackgroundGeolocation.openSettings()}
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--color-text)",
              background: "rgba(0,0,0,0.12)",
              border: "none",
              borderRadius: 8,
              padding: "5px 10px",
              cursor: "pointer",
              whiteSpace: "nowrap",
              touchAction: "manipulation",
            }}
          >
            Open Settings
          </button>
        </div>
      )}

      <DrawControls
        mode={mode}
        onModeChange={setMode}
        undoStack={undoStack}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onUploadPhoto={() => setGeoUploadOpen(true)}
        drawUnlocked={drawUnlocked}
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

      {showDrawModal && (
        <div
          onClick={() => setShowDrawModal(false)}
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
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: 20,
              padding: "28px 28px 24px",
              maxWidth: 320,
              width: "90%",
              boxShadow: "0 8px 40px rgba(0,0,0,0.18)",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 12 }}>📍</div>
            <p style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700, color: "var(--color-text)" }}>
              Location Access Denied
            </p>
            <p style={{ margin: "0 0 24px", fontSize: 13, color: "var(--color-text-muted)", lineHeight: 1.6 }}>
              Been There couldn&apos;t access your location. You can try again, or paint
              visited areas manually using the draw tool.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => { setShowDrawModal(false); startTracking(); }}
                style={{
                  flex: 1,
                  padding: "10px 0",
                  borderRadius: 12,
                  border: "1px solid var(--color-border)",
                  background: "transparent",
                  color: "var(--color-text-muted)",
                  fontSize: 14,
                  cursor: "pointer",
                  touchAction: "manipulation",
                }}
              >
                Try Again
              </button>
              <button
                onClick={() => { setShowDrawModal(false); setTrackingDenied(false); setDrawUnlocked(true); }}
                style={{
                  flex: 2,
                  padding: "10px 0",
                  borderRadius: 12,
                  border: "none",
                  background: "var(--color-orange)",
                  color: "var(--color-text)",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                  touchAction: "manipulation",
                }}
              >
                Draw Manually
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
