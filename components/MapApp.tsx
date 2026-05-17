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
  getOfflinePaintQueue,
  getOfflineEraseQueue,
  removeFromOfflinePaintQueue,
  removeFromOfflineEraseQueue,
  ensureOfflineBufferReady,
} from "@/lib/offline-buffer";
import {
  appendPaintEvent,
  appendEraseEvent,
  sealOpenBatch,
  getSealedBatches,
  removeSealedBatch,
  getPendingCellsFromBatches,
  getLatestPaintCell,
  migrateLegacyQueuesIfNeeded,
  countUnsyncedEvents,
} from "@/lib/visit-batch-log";
import { isTrackingOptedOut, setTrackingOptedOut } from "@/lib/tracking-preference";
import type { VisitMetricRow } from "@/lib/cell-metrics";
import { INTELLIGENCE_LABELS, type IntelligenceVariant } from "@/lib/intelligence";

// Pure-native Capacitor plugin — no JS bundle to import; accessed via the native bridge.
// Safe to register at module level: returns a no-op proxy on web (never called outside isNativePlatform()).
const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>("BackgroundGeolocation");

/** Native background tracking: fewer GPS wakeups (larger = less frequent fixes, better battery). */
const NATIVE_DISTANCE_FILTER_M = 48;
/** How often to POST batched cell paints while native tracking (also flushes on app foreground / pause / stop). */
const NATIVE_TRACK_FLUSH_MS = 10 * 60 * 1000;

export type MapMode = "browse" | "draw" | "erase" | "pin";

function resolveInitialCenter(
  recentCell: string | null,
  metrics: VisitMetricRow[],
  localLatest: { h3: string; t: string } | null
): { lat: number; lng: number } | null {
  let bestH3: string | null = recentCell;
  let bestMs = 0;
  if (recentCell) {
    const row = metrics.find((r) => r.h3_index === recentCell);
    if (row) bestMs = Date.parse(row.last_visited_at);
  }
  for (const row of metrics) {
    const ms = Date.parse(row.last_visited_at);
    if (!Number.isNaN(ms) && ms > bestMs) {
      bestMs = ms;
      bestH3 = row.h3_index;
    }
  }
  if (localLatest) {
    const ms = Date.parse(localLatest.t);
    if (!Number.isNaN(ms) && ms > bestMs) bestH3 = localLatest.h3;
  }
  return bestH3 ? cellToCenter(bestH3) : null;
}

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
  /** Res-9 rows from GET — Map aggregates by zoom for overlays */
  const [cellMetricsRes9, setCellMetricsRes9] = useState<VisitMetricRow[]>([]);
  const [intelligenceVariant, setIntelligenceVariant] = useState<IntelligenceVariant>("none");
  const [intelligenceMenuOpen, setIntelligenceMenuOpen] = useState(false);
  const lastIntelligenceVariantRef = useRef<Exclude<IntelligenceVariant, "none">>("lastBeen");
  const isTrackingRef = useRef(false);
  isTrackingRef.current = isTracking;
  const trackingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const trackingElapsedRef = useRef(0);
  // Previous ping location — used to interpolate cells along the path between pings
  const prevLocationRef = useRef<{ lat: number; lng: number } | null>(null);
  /** Set true when tracking starts; first `applyLocation` consumes it to recenter the map on the tracker pin */
  const shouldRecenterMapOnTrackerFixRef = useRef(false);
  const [trackerRecenterAt, setTrackerRecenterAt] = useState<{ lat: number; lng: number; seq: number } | null>(null);
  const [followTracker, setFollowTracker] = useState(false);
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
  const syncAllRef = useRef<() => Promise<void>>(async () => {});
  const persistPendingRef = useRef<() => Promise<void>>(async () => {});
  const startTrackingRef = useRef<() => Promise<void>>(async () => {});
  const persistPendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFlushingRef = useRef(false);
  const [unsyncedPendingCount, setUnsyncedPendingCount] = useState(0);

  // Stable refs so handleCellErase can read current values without re-creating
  const renderResolutionRef = useRef(renderResolution);
  useEffect(() => { renderResolutionRef.current = renderResolution; }, [renderResolution]);
  const visitedCellsRef = useRef(visitedCells);
  useEffect(() => { visitedCellsRef.current = visitedCells; }, [visitedCells]);

  const refreshUnsyncedCount = useCallback(async () => {
    const [batchEvents, paints, erases] = await Promise.all([
      countUnsyncedEvents(),
      getOfflinePaintQueue(),
      getOfflineEraseQueue(),
    ]);
    setUnsyncedPendingCount(batchEvents + paints.length + erases.length);
  }, []);

  // Initial data load — union server cells with unsynced local paints/erases
  useEffect(() => {
    async function load() {
      try {
        await ensureOfflineBufferReady();
        await migrateLegacyQueuesIfNeeded();

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
          const serverSet = new Set<string>(cellsData.cells as string[]);
          const [paints, erases, batchPending] = await Promise.all([
            getOfflinePaintQueue(),
            getOfflineEraseQueue(),
            getPendingCellsFromBatches(),
          ]);
          const merged = new Set(serverSet);
          for (const c of erases) merged.delete(c);
          for (const c of paints) merged.add(c);
          for (const c of batchPending.erases) merged.delete(c);
          for (const c of batchPending.paints) merged.add(c);
          setVisitedCells(merged);
          const metrics = Array.isArray(cellsData.cellMetrics)
            ? (cellsData.cellMetrics as VisitMetricRow[])
            : [];
          if (metrics.length > 0) {
            setCellMetricsRes9(metrics);
          }
          const localLatest = await getLatestPaintCell();
          const initial = resolveInitialCenter(
            (cellsData.recentCell as string | null) ?? null,
            metrics,
            localLatest
          );
          if (initial) setInitialCenter(initial);
        }
        if (!photosData.error && photosData.photos) {
          setPhotos(photosData.photos);
        }
        await refreshUnsyncedCount();
        void syncAllRef.current();
      } catch (e) {
        console.error("Failed to load map data:", e);
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, [refreshUnsyncedCount]);

  // First launch on native shell: explain notifications + battery before they hit Track.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (hasCompletedNativeOnboarding()) return;
    setShowNativeOnboarding(true);
  }, []);

  // isSyncing prevents the reconnect flush and the 500ms batch from racing (M2)
  const isSyncingRef = useRef(false);

  const refreshCellMetrics = useCallback(async () => {
    try {
      const r = await fetch(`/api/cells?zoom=13`);
      const d = await r.json();
      if (Array.isArray(d.cellMetrics)) {
        setCellMetricsRes9(d.cellMetrics as VisitMetricRow[]);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const persistPendingToStorage = useCallback(async () => {
    const toPaint = [...pendingPaintRef.current];
    const toErase = [...pendingEraseRef.current];
    for (const c of toPaint) await appendPaintEvent(c);
    for (const c of toErase) await appendEraseEvent(c);
    pendingPaintRef.current.clear();
    pendingEraseRef.current.clear();
    await sealOpenBatch();
    await refreshUnsyncedCount();
  }, [refreshUnsyncedCount]);

  const schedulePersistPending = useCallback(() => {
    if (persistPendingTimerRef.current) clearTimeout(persistPendingTimerRef.current);
    persistPendingTimerRef.current = setTimeout(() => {
      void persistPendingRef.current();
    }, 500);
  }, []);

  const syncVisitBatches = useCallback(async () => {
    await sealOpenBatch();
    const batches = await getSealedBatches();
    for (const batch of batches) {
      try {
        const res = await fetch("/api/cells/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientBatchId: batch.clientBatchId,
            events: batch.events,
          }),
        });
        if (res.ok) {
          await removeSealedBatch(batch.clientBatchId);
        } else {
          break;
        }
      } catch {
        break;
      }
    }
    await refreshUnsyncedCount();
  }, [refreshUnsyncedCount]);

  // Legacy cell queues — erases first, then paints; only remove on ACK.
  const syncOfflineQueues = useCallback(async () => {
    if (isSyncingRef.current) return;
    const toErase = await getOfflineEraseQueue();
    const toPaint = await getOfflinePaintQueue();
    if (toErase.length === 0 && toPaint.length === 0) return;
    isSyncingRef.current = true;
    try {
      if (toErase.length > 0) {
        const res = await fetch("/api/cells", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cells: toErase }),
        });
        if (res.ok) {
          await refreshCellMetrics();
          await removeFromOfflineEraseQueue(toErase);
        }
      }
      if (toPaint.length > 0) {
        const res = await fetch("/api/cells", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cells: toPaint }),
        });
        if (res.ok) {
          await refreshCellMetrics();
          await removeFromOfflinePaintQueue(toPaint);
        }
      }
    } catch {
      /* keep queues */
    } finally {
      isSyncingRef.current = false;
      await refreshUnsyncedCount();
    }
  }, [refreshCellMetrics, refreshUnsyncedCount]);

  const syncAll = useCallback(async () => {
    if (isFlushingRef.current) return;
    isFlushingRef.current = true;
    try {
      await persistPendingToStorage();
      await syncVisitBatches();
      await syncOfflineQueues();
    } finally {
      isFlushingRef.current = false;
    }
  }, [persistPendingToStorage, syncVisitBatches, syncOfflineQueues]);

  const flushPending = useCallback(async () => {
    await syncAll();
  }, [syncAll]);

  persistPendingRef.current = persistPendingToStorage;
  flushPendingRef.current = flushPending;
  syncAllRef.current = syncAll;

  useEffect(() => {
    const onOnline = () => void syncAllRef.current();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  useEffect(() => {
    const onHide = () => {
      void persistPendingRef.current();
      void sealOpenBatch();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") onHide();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
    };
  }, []);

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
      void persistPendingRef.current();
      void sealOpenBatch();
      if (!isActive) return;
      void syncAllRef.current();
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

  // Paint a single cell (always queues server sync; undo only when the cell is newly painted)
  const handleCellPaint = useCallback(
    (h3Index: string) => {
      if (!visitedCellsRef.current.has(h3Index)) {
        const next = new Set(visitedCellsRef.current);
        next.add(h3Index);
        visitedCellsRef.current = next;
        setVisitedCells(next);
        setUndoStack((s) => {
          const last = s.past[s.past.length - 1];
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
      }
      void appendPaintEvent(h3Index);
      schedulePersistPending();
      scheduleFlushed();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schedulePersistPending]
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

      cellsToErase.forEach((c) => void appendEraseEvent(c));
      schedulePersistPending();
      scheduleFlushed();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schedulePersistPending]
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
      action.cells.forEach((c) => void appendEraseEvent(c));
    } else {
      setVisitedCells((prev) => {
        const next = new Set(prev);
        action.cells.forEach((c) => next.add(c));
        return next;
      });
      action.cells.forEach((c) => void appendPaintEvent(c));
    }
    schedulePersistPending();
    scheduleFlushed();
  }

  function applyForward(action: CellAction) {
    if (action.type === "paint") {
      setVisitedCells((prev) => {
        const next = new Set(prev);
        action.cells.forEach((c) => next.add(c));
        return next;
      });
      action.cells.forEach((c) => void appendPaintEvent(c));
    } else {
      setVisitedCells((prev) => {
        const next = new Set(prev);
        action.cells.forEach((c) => next.delete(c));
        return next;
      });
      action.cells.forEach((c) => void appendEraseEvent(c));
    }
    schedulePersistPending();
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
    if (shouldRecenterMapOnTrackerFixRef.current) {
      shouldRecenterMapOnTrackerFixRef.current = false;
      setTrackerRecenterAt((prev) => ({
        lat,
        lng,
        seq: (prev?.seq ?? 0) + 1,
      }));
    }
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

  const startTracking = useCallback(async () => {
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
        shouldRecenterMapOnTrackerFixRef.current = true;
        setFollowTracker(true);
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
        shouldRecenterMapOnTrackerFixRef.current = false;
        setTrackingDenied(true);
      }
    } else {
      // Web path — unchanged
      if (!navigator.geolocation) { setTrackingDenied(true); return; }
      shouldRecenterMapOnTrackerFixRef.current = true;
      setFollowTracker(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          applyLocation(pos.coords.latitude, pos.coords.longitude);
          setIsTracking(true);
          setTrackingDenied(false);
          trackingElapsedRef.current = 0;
          setTrackingProgress(0);
        },
        () => {
          shouldRecenterMapOnTrackerFixRef.current = false;
          setTrackingDenied(true);
        },
        { enableHighAccuracy: true, timeout: 10_000 }
      );
    }
  }, []);

  startTrackingRef.current = startTracking;

  // Default-on tracking when app opens (user can stop via Track button = opt-out).
  useEffect(() => {
    if (isLoading || showNativeOnboarding) return;
    let cancelled = false;
    void (async () => {
      if (await isTrackingOptedOut()) return;
      if (Capacitor.isNativePlatform() && !hasCompletedNativeOnboarding()) return;
      if (cancelled || isTrackingRef.current) return;
      await startTrackingRef.current();
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoading, showNativeOnboarding]);

  function toggleIntelligenceSparkle() {
    setIntelligenceVariant((v) => {
      if (v !== "none") {
        setIntelligenceMenuOpen(false);
        return "none";
      }
      setMode("browse");
      return lastIntelligenceVariantRef.current;
    });
  }

  function selectIntelligenceVariant(next: Exclude<IntelligenceVariant, "none">) {
    setIntelligenceMenuOpen(false);
    lastIntelligenceVariantRef.current = next;
    setMode("browse");
    setIntelligenceVariant(next);
  }

  function toggleFollowTracker() {
    setFollowTracker((prev) => {
      if (prev) return false;
      if (currentLocation) {
        setTrackerRecenterAt((r) => ({
          lat: currentLocation.lat,
          lng: currentLocation.lng,
          seq: (r?.seq ?? 0) + 1,
        }));
      }
      return true;
    });
  }

  async function handleTrackToggle() {
    if (isTracking) {
      stopTracking();
      await setTrackingOptedOut(true);
    } else if (trackingDenied) {
      setShowDrawModal(true);
    } else {
      await setTrackingOptedOut(false);
      await startTracking();
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
    setFollowTracker(false);
    shouldRecenterMapOnTrackerFixRef.current = false;
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
        recenterTrackerAt={trackerRecenterAt}
        followTracker={followTracker}
        onFollowTrackerChange={setFollowTracker}
        currentLocation={currentLocation}
        onDebugLocation={applyLocation}
        intelligenceVariant={intelligenceVariant}
        cellMetricsRes9={cellMetricsRes9}
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
        unsyncedPendingCount={unsyncedPendingCount}
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

      <div
        style={{
          position: "absolute",
          bottom: 24,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 12,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
        }}
      >
        {intelligenceVariant !== "none" && (
          <>
            <button
              type="button"
              onClick={() => setIntelligenceMenuOpen((o) => !o)}
              style={{
                padding: "6px 14px",
                borderRadius: 999,
                border: "1px solid var(--color-border)",
                background: "var(--color-surface)",
                color: "var(--color-text)",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: "0 2px 10px rgba(0,0,0,0.08)",
                touchAction: "manipulation",
                maxWidth: "min(90vw, 280px)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {INTELLIGENCE_LABELS[intelligenceVariant]} ▾
            </button>
            {intelligenceMenuOpen && (
              <>
                <div
                  role="presentation"
                  onClick={() => setIntelligenceMenuOpen(false)}
                  style={{
                    position: "fixed",
                    inset: 0,
                    zIndex: 11,
                    background: "transparent",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    bottom: "100%",
                    marginBottom: 6,
                    minWidth: 200,
                    background: "var(--color-surface)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 12,
                    boxShadow: "0 8px 28px rgba(0,0,0,0.15)",
                    overflow: "hidden",
                    zIndex: 13,
                  }}
                >
                  {(["lastBeen", "mostBeen", "firstVisitAge"] as const).map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => selectIntelligenceVariant(key)}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        padding: "10px 14px",
                        border: "none",
                        background: intelligenceVariant === key ? "var(--color-teal)" : "transparent",
                        color: "var(--color-text)",
                        fontSize: 14,
                        cursor: "pointer",
                        touchAction: "manipulation",
                      }}
                    >
                      {INTELLIGENCE_LABELS[key]}
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
        <DrawControls
          mode={mode}
          onModeChange={setMode}
          undoStack={undoStack}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onUploadPhoto={() => setGeoUploadOpen(true)}
          drawUnlocked={drawUnlocked}
          intelligenceActive={intelligenceVariant !== "none"}
          onToggleIntelligence={toggleIntelligenceSparkle}
          isTracking={isTracking}
          followTracker={followTracker}
          onToggleFollowTracker={toggleFollowTracker}
        />
      </div>

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
