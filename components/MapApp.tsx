"use client";

import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import Image from "next/image";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { App } from "@capacitor/app";
import type { BackgroundGeolocationPlugin, Location as BGLocation, CallbackError } from "@capacitor-community/background-geolocation";
import { CheckCircle2, Clock, MapPin, Play, Radio, RefreshCw, Square, WifiOff } from "lucide-react";
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
  appendOfflineGpsPing,
  appendOfflinePaintQueue,
  appendOfflineEraseQueue,
  createOfflineGpsPing,
  getLatestOfflineGpsVisit,
  getOfflineGpsCellSet,
  getOfflineGpsPings,
  getOfflinePaintQueue,
  getOfflineEraseQueue,
  getOfflineQueueStats,
  importOfflineTransferPayload,
  importOfflineTransferFromWindowName,
  offlineGpsPingsToVisitEvents,
  removeOfflineGpsPings,
  removeFromOfflinePaintQueue,
  removeFromOfflineEraseQueue,
  type OfflineGpsPing,
  type OfflineQueueStats,
} from "@/lib/offline-buffer";
import type { VisitMetricRow } from "@/lib/cell-metrics";
import { INTELLIGENCE_LABELS, type IntelligenceVariant } from "@/lib/intelligence";
import {
  reencodeImageFileAsJpeg,
  MAX_PHOTO_UPLOAD_BYTES,
  formatFileSizeForUi,
} from "@/lib/reencode-image-jpeg";

// Pure-native Capacitor plugin — no JS bundle to import; accessed via the native bridge.
// Safe to register at module level: returns a no-op proxy on web (never called outside isNativePlatform()).
const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>("BackgroundGeolocation");
const OfflineHandoff = registerPlugin<{
  getPendingPayload: () => Promise<{ payload?: string | null }>;
}>("OfflineHandoff");

/** Native background tracking: fewer GPS wakeups (larger = less frequent fixes, better battery). */
const NATIVE_DISTANCE_FILTER_M = 48;
/** How often to POST batched cell paints while native tracking (also flushes on app foreground / pause / stop). */
const NATIVE_TRACK_FLUSH_MS = 10 * 60 * 1000;
const GPS_SYNC_DEBOUNCE_MS = 3_000;
const OFFLINE_VISIT_EVENT_BATCH_LIMIT = 500;

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

function getLocalQueuedVisitedCells(): Set<string> {
  const localCells = getOfflineGpsCellSet();
  for (const cell of getOfflinePaintQueue()) localCells.add(cell);
  for (const cell of getOfflineEraseQueue()) localCells.delete(cell);
  return localCells;
}

function mergeLocalQueuedCells(serverCells: Set<string>): Set<string> {
  const merged = new Set(serverCells);
  for (const cell of getOfflineEraseQueue()) merged.delete(cell);
  for (const cell of getOfflinePaintQueue()) merged.add(cell);
  for (const cell of getOfflineGpsCellSet()) merged.add(cell);
  return merged;
}

function takeGpsPingBatch(pings: OfflineGpsPing[]): OfflineGpsPing[] {
  const batch: OfflineGpsPing[] = [];
  let eventCount = 0;
  for (const ping of pings) {
    if (batch.length > 0 && eventCount + ping.cells.length > OFFLINE_VISIT_EVENT_BATCH_LIMIT) {
      break;
    }
    batch.push(ping);
    eventCount += ping.cells.length;
    if (eventCount >= OFFLINE_VISIT_EVENT_BATCH_LIMIT) break;
  }
  return batch;
}

const EMPTY_OFFLINE_STATS: OfflineQueueStats = {
  gpsPingCount: 0,
  gpsVisitEventCount: 0,
  gpsUniqueCellCount: 0,
  manualPaintCellCount: 0,
  manualEraseCellCount: 0,
  totalQueuedCount: 0,
  lastRecordedAt: null,
};

export default function MapApp() {
  // Map state
  const [mode, setMode] = useState<MapMode>("browse");
  const [zoom, setZoom] = useState(13);
  const renderResolution = resolutionForZoom(zoom);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(() => (
    typeof navigator === "undefined" ? true : navigator.onLine
  ));
  const [offlineQueueStats, setOfflineQueueStats] = useState<OfflineQueueStats>(() => (
    typeof window === "undefined" ? EMPTY_OFFLINE_STATS : getOfflineQueueStats()
  ));
  const [offlineStatus, setOfflineStatus] = useState<string | null>(null);
  const [offlineSyncBusy, setOfflineSyncBusy] = useState(false);

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
  /** In-modal messages for photo upload (oversized JPEG, network/API errors). */
  const [photoUploadWarning, setPhotoUploadWarning] = useState<string | null>(null);
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
  const [showNativeOnboarding, setShowNativeOnboarding] = useState(() => (
    Capacitor.isNativePlatform() && !hasCompletedNativeOnboarding()
  ));
  const [nativeAutoStartReady, setNativeAutoStartReady] = useState(() => (
    !Capacitor.isNativePlatform() || hasCompletedNativeOnboarding()
  ));
  /** Android: last GPS sample time from native plugin (ms), mirrors notification “Last GPS fix” */
  const [lastNativeGpsAtMs, setLastNativeGpsAtMs] = useState<number | null>(null);
  /** Res-9 rows from GET — Map aggregates by zoom for overlays */
  const [cellMetricsRes9, setCellMetricsRes9] = useState<VisitMetricRow[]>([]);
  const [intelligenceVariant, setIntelligenceVariant] = useState<IntelligenceVariant>("none");
  const [intelligenceMenuOpen, setIntelligenceMenuOpen] = useState(false);
  const lastIntelligenceVariantRef = useRef<Exclude<IntelligenceVariant, "none">>("lastBeen");
  const isTrackingRef = useRef(false);
  isTrackingRef.current = isTracking;
  const isStartingTrackingRef = useRef(false);
  const nativeAutoStartAttemptedRef = useRef(false);
  const trackingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const trackingElapsedRef = useRef(0);
  // Previous ping location — used to interpolate cells along the path between pings
  const prevLocationRef = useRef<{ lat: number; lng: number } | null>(null);
  /** Set true when tracking starts; first `applyLocation` consumes it to recenter the map on the tracker pin */
  const shouldRecenterMapOnTrackerFixRef = useRef(false);
  const [trackerRecenterAt, setTrackerRecenterAt] = useState<{ lat: number; lng: number; seq: number } | null>(null);
  /** After a successful photo upload — Map eases here at close zoom; bump `seq` each time. */
  const [photoUploadFocusAt, setPhotoUploadFocusAt] = useState<{
    lat: number;
    lng: number;
    seq: number;
  } | null>(null);
  const [followTracker, setFollowTracker] = useState(false);
  // Native background geolocation watcher ID — kept in ref so stopTracking can remove it
  const nativeWatcherIdRef = useRef<string | null>(null);
  // Stable ref to applyLocation — updated every render so the native plugin callback
  // always calls the latest version without capturing a stale closure.
  const applyLocationRef = useRef<(lat: number, lng: number, recordedAtMs?: number) => void>(() => {});

  // Batch paint queue: flush to API every 500ms on web / manual draw; native tracking uses a 10 min timer + lifecycle flushes.
  const pendingPaintRef = useRef<Set<string>>(new Set());
  const pendingEraseRef = useRef<Set<string>>(new Set());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offlineSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushPendingRef = useRef<() => Promise<void>>(async () => {});
  const syncOfflineQueuesRef = useRef<() => Promise<void>>(async () => {});

  // Stable refs so handleCellErase can read current values without re-creating
  const renderResolutionRef = useRef(renderResolution);
  useEffect(() => { renderResolutionRef.current = renderResolution; }, [renderResolution]);
  const visitedCellsRef = useRef(visitedCells);
  useEffect(() => { visitedCellsRef.current = visitedCells; }, [visitedCells]);

  const refreshOfflineStats = useCallback(() => {
    setOfflineQueueStats(getOfflineQueueStats());
  }, []);

  const loadRemoteData = useCallback(async (showLoading = false): Promise<boolean> => {
    if (showLoading) setIsLoading(true);
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
        const serverSet = new Set<string>(cellsData.cells as string[]);
        const merged = mergeLocalQueuedCells(serverSet);
        visitedCellsRef.current = merged;
        setVisitedCells(merged);
        const metrics = Array.isArray(cellsData.cellMetrics)
          ? (cellsData.cellMetrics as VisitMetricRow[])
          : [];
        if (metrics.length > 0) {
          setCellMetricsRes9(metrics);
        }
        const initial = resolveInitialCenter(
          (cellsData.recentCell as string | null) ?? null,
          metrics,
          getLatestOfflineGpsVisit()
        );
        if (initial) setInitialCenter(initial);
      }
      if (!photosData.error && photosData.photos) {
        setPhotos(photosData.photos);
      }
      setIsOnline(true);
      refreshOfflineStats();
      return true;
    } catch (e) {
      console.error("Failed to load map data:", e);
      if (Capacitor.isNativePlatform()) {
        const localCells = getLocalQueuedVisitedCells();
        visitedCellsRef.current = localCells;
        setVisitedCells(localCells);
        const latest = getLatestOfflineGpsVisit();
        if (latest) setInitialCenter(cellToCenter(latest.h3));
        setIsOnline(false);
      }
      refreshOfflineStats();
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [refreshOfflineStats]);

  // Initial data load
  useEffect(() => {
    let cancelled = false;
    async function importTransfersAndLoad() {
      let imported = importOfflineTransferFromWindowName();

      if (Capacitor.isNativePlatform()) {
        try {
          const { payload } = await OfflineHandoff.getPendingPayload();
          if (payload) {
            imported = importOfflineTransferPayload(JSON.parse(payload)) || imported;
          }
        } catch {
          /* Native handoff plugin is Android-only and best-effort. */
        }
      }

      if (imported) refreshOfflineStats();
      if (!cancelled) void loadRemoteData(true);
    }
    void importTransfersAndLoad();
    return () => {
      cancelled = true;
    };
  }, [loadRemoteData, refreshOfflineStats]);

  // First launch on native shell: explain notifications + battery before tracking starts.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (hasCompletedNativeOnboarding()) {
      setNativeAutoStartReady(true);
      return;
    }
    setNativeAutoStartReady(false);
    setShowNativeOnboarding(true);
  }, []);

  // Native shell: begin tracking automatically on app open, after first-run guidance is dismissed.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (!nativeAutoStartReady) return;
    if (showNativeOnboarding) return;
    if (nativeAutoStartAttemptedRef.current) return;
    nativeAutoStartAttemptedRef.current = true;
    void startTracking();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativeAutoStartReady, showNativeOnboarding]);

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

  // Flush the localStorage offline queues to the server.
  // Erases are sent first so a cell erased offline isn't re-added by a pending paint.
  // We snapshot the queues once and remove only those specific cells after each fetch so that
  // cells appended by a concurrent offline flush during the awaits are not accidentally wiped.
  const syncOfflineQueues = useCallback(async () => {
    if (isSyncingRef.current) return;
    const toErase = getOfflineEraseQueue();
    const toPaint = getOfflinePaintQueue();
    const gpsPings = getOfflineGpsPings();
    if (toErase.length === 0 && toPaint.length === 0 && gpsPings.length === 0) {
      refreshOfflineStats();
      return;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setIsOnline(false);
      refreshOfflineStats();
      return;
    }
    isSyncingRef.current = true;
    try {
      let shouldRefreshMetrics = false;
      if (toErase.length > 0) {
        const res = await fetch("/api/cells", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cells: toErase }),
        });
        if (res.ok) {
          shouldRefreshMetrics = true;
          removeFromOfflineEraseQueue(toErase);
        }
      }
      if (toPaint.length > 0) {
        const res = await fetch("/api/cells", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cells: toPaint }),
        });
        if (res.ok) {
          shouldRefreshMetrics = true;
          removeFromOfflinePaintQueue(toPaint);
        }
      }

      for (;;) {
        const batch = takeGpsPingBatch(getOfflineGpsPings());
        if (batch.length === 0) break;
        const visits = offlineGpsPingsToVisitEvents(batch);
        if (visits.length === 0) {
          removeOfflineGpsPings(batch.map((ping) => ping.id));
          continue;
        }
        const res = await fetch("/api/cells", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visits }),
        });
        if (!res.ok) break;
        shouldRefreshMetrics = true;
        removeOfflineGpsPings(batch.map((ping) => ping.id));
      }

      if (shouldRefreshMetrics) {
        await refreshCellMetrics();
        refreshOfflineStats();
      }
      setIsOnline(true);
    } catch {
      // Leave queues intact — will retry on next reconnect or load
      setIsOnline(false);
    } finally {
      refreshOfflineStats();
      isSyncingRef.current = false;
    }
  }, [refreshCellMetrics, refreshOfflineStats]);

  // Attempt offline queue sync on mount and whenever the device comes back online
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setOfflineStatus("Checking saved visits...");
      void syncOfflineQueues();
    };
    const handleOffline = () => {
      setIsOnline(false);
      setOfflineStatus("Offline");
      refreshOfflineStats();
    };

    void syncOfflineQueues();
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [refreshOfflineStats, syncOfflineQueues]);

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
      setIsOnline(false);
      refreshOfflineStats();
      return;
    }

    // Erases first — same ordering rule as syncOfflineQueues
    try {
      if (toErase.length > 0) {
        const res = await fetch("/api/cells", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cells: toErase }),
        });
        if (res.ok) {
          await refreshCellMetrics();
        } else {
          appendOfflineEraseQueue(toErase);
        }
      }
    } catch {
      if (toErase.length > 0) appendOfflineEraseQueue(toErase);
      setIsOnline(false);
      refreshOfflineStats();
    }

    try {
      if (toPaint.length > 0) {
        const res = await fetch("/api/cells", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cells: toPaint }),
        });
        if (res.ok) {
          await refreshCellMetrics();
        } else {
          appendOfflinePaintQueue(toPaint);
        }
      }
      if (toPaint.length > 0 || toErase.length > 0) setIsOnline(true);
    } catch {
      if (toPaint.length > 0) appendOfflinePaintQueue(toPaint);
      setIsOnline(false);
      refreshOfflineStats();
    }
    refreshOfflineStats();
  }, [refreshCellMetrics, refreshOfflineStats]);

  flushPendingRef.current = flushPending;
  syncOfflineQueuesRef.current = syncOfflineQueues;

  // Native tracking: periodic server sync (cells already update the map locally).
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !isTracking) return;
    const id = window.setInterval(() => {
      void flushPendingRef.current();
      void syncOfflineQueuesRef.current();
    }, NATIVE_TRACK_FLUSH_MS);
    return () => clearInterval(id);
  }, [isTracking]);

  // Native: flush when foregrounding / backgrounding; failed POSTs stay in offline queues until retry.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let cancelled = false;
    let sub: Awaited<ReturnType<typeof App.addListener>> | undefined;
    void App.addListener("appStateChange", () => {
      void flushPendingRef.current();
      void syncOfflineQueuesRef.current();
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

  useEffect(() => {
    return () => {
      if (offlineSyncTimerRef.current) {
        clearTimeout(offlineSyncTimerRef.current);
        offlineSyncTimerRef.current = null;
      }
    };
  }, []);

  function scheduleOfflineSync() {
    if (offlineSyncTimerRef.current) clearTimeout(offlineSyncTimerRef.current);
    offlineSyncTimerRef.current = setTimeout(() => {
      void syncOfflineQueuesRef.current();
    }, GPS_SYNC_DEBOUNCE_MS);
  }

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
    setPhotoUploadWarning(null);
    setPendingPin({ lat, lng });
  }, []);

  async function handlePinConfirm(file: File, caption: string) {
    if (!pendingPin) return;
    let jpegFile: File;
    try {
      jpegFile = await reencodeImageFileAsJpeg(file);
    } catch {
      setPhotoUploadWarning("Couldn’t read that image. Try another file.");
      return;
    }
    if (jpegFile.size > MAX_PHOTO_UPLOAD_BYTES) {
      setPhotoUploadWarning(
        `After compression this photo is still ${formatFileSizeForUi(jpegFile.size)}, which exceeds the ${formatFileSizeForUi(MAX_PHOTO_UPLOAD_BYTES)} upload limit. Choose a smaller or lower-resolution image.`,
      );
      return;
    }
    const form = new FormData();
    form.append("lat", String(pendingPin.lat));
    form.append("lng", String(pendingPin.lng));
    form.append("caption", caption);
    form.append("file", jpegFile);
    let res: Response;
    try {
      res = await fetch("/api/photos", { method: "POST", body: form });
    } catch {
      setPhotoUploadWarning("Network error while uploading. Check your connection and try again.");
      return;
    }
    let data: { photo?: PhotoPin; error?: string };
    try {
      data = (await res.json()) as { photo?: PhotoPin; error?: string };
    } catch {
      setPhotoUploadWarning("Upload failed (unexpected response). Try again.");
      return;
    }
    if (!res.ok || !data.photo) {
      setPhotoUploadWarning(typeof data.error === "string" ? data.error : "Photo upload failed.");
      return;
    }
    setPhotoUploadWarning(null);
    setFollowTracker(false);
    setPhotos((prev) => [data.photo!, ...prev]);
    setPhotoUploadFocusAt((prev) => ({
      lat: data.photo!.lat,
      lng: data.photo!.lng,
      seq: (prev?.seq ?? 0) + 1,
    }));
    setPendingPin(null);
    setManualPlaceFile(null);
    setMode("browse");
  }

  function addVisitedCellsLocally(cells: string[]) {
    if (cells.length === 0) return;
    const next = new Set(visitedCellsRef.current);
    let changed = false;
    for (const cell of cells) {
      if (!next.has(cell)) {
        next.add(cell);
        changed = true;
      }
    }
    if (changed) {
      visitedCellsRef.current = next;
      setVisitedCells(next);
    }
  }

  function applyLocation(lat: number, lng: number, recordedAtMs = Date.now()) {
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
    let cellsToRecord: string[];

    if (prevLocationRef.current) {
      // Fill every cell the straight line between the previous and current ping crosses
      const prevCell = snapToCell(prevLocationRef.current.lat, prevLocationRef.current.lng);
      cellsToRecord = getCellsAlongLine(prevCell, newCell);
    } else {
      cellsToRecord = [newCell];
    }

    cellsToRecord = [...new Set(cellsToRecord)];
    addVisitedCellsLocally(cellsToRecord);
    appendOfflineGpsPing(createOfflineGpsPing({
      lat,
      lng,
      cells: cellsToRecord,
      recordedAtMs,
    }));
    refreshOfflineStats();
    if (typeof navigator !== "undefined" && navigator.onLine) {
      setIsOnline(true);
      scheduleOfflineSync();
    } else {
      setIsOnline(false);
    }

    prevLocationRef.current = { lat, lng };
  }
  // Keep ref current every render so the native plugin callback never holds a stale closure (M3)
  applyLocationRef.current = applyLocation;

  async function startTracking() {
    if (isStartingTrackingRef.current || isTrackingRef.current || nativeWatcherIdRef.current) {
      return;
    }
    isStartingTrackingRef.current = true;

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
            applyLocationRef.current(location.latitude, location.longitude, location.time ?? undefined);
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
      } finally {
        isStartingTrackingRef.current = false;
      }
    } else {
      // Web path — unchanged
      if (!navigator.geolocation) {
        isStartingTrackingRef.current = false;
        setTrackingDenied(true);
        return;
      }
      shouldRecenterMapOnTrackerFixRef.current = true;
      setFollowTracker(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          applyLocation(pos.coords.latitude, pos.coords.longitude, pos.timestamp);
          setIsTracking(true);
          setTrackingDenied(false);
          trackingElapsedRef.current = 0;
          setTrackingProgress(0);
          isStartingTrackingRef.current = false;
        },
        () => {
          shouldRecenterMapOnTrackerFixRef.current = false;
          setTrackingDenied(true);
          isStartingTrackingRef.current = false;
        },
        { enableHighAccuracy: true, timeout: 10_000 }
      );
    }
  }

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
    } else if (trackingDenied) {
      setShowDrawModal(true);
    } else {
      startTracking();
    }
  }

  async function handleOfflineSyncRequest() {
    if (offlineSyncBusy) return;
    setOfflineSyncBusy(true);
    setOfflineStatus("Checking connection...");
    try {
      await flushPendingRef.current();
      await syncOfflineQueuesRef.current();
      const loaded = await loadRemoteData(false);
      const stats = getOfflineQueueStats();
      setOfflineQueueStats(stats);
      if (!loaded) {
        setOfflineStatus("Still offline");
      } else if (stats.totalQueuedCount > 0) {
        setOfflineStatus("Saved locally; retrying soon");
      } else {
        setOfflineStatus("Synced");
      }
    } finally {
      setOfflineSyncBusy(false);
    }
  }

  function handleOfflineTrackToggle() {
    if (isTracking) {
      stopTracking();
    } else {
      void startTracking();
    }
  }

  function handleNativeOnboardingClose() {
    setShowNativeOnboarding(false);
    setNativeAutoStartReady(true);
  }

  function stopTracking() {
    void flushPendingRef.current();
    void syncOfflineQueuesRef.current();
    isStartingTrackingRef.current = false;
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
          (pos) => applyLocation(pos.coords.latitude, pos.coords.longitude, pos.timestamp),
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
    let jpegFile: File;
    try {
      jpegFile = await reencodeImageFileAsJpeg(file);
    } catch {
      setPhotoUploadWarning("Couldn’t read that image. Try another file.");
      return;
    }
    if (jpegFile.size > MAX_PHOTO_UPLOAD_BYTES) {
      setPhotoUploadWarning(
        `After compression this photo is still ${formatFileSizeForUi(jpegFile.size)}, which exceeds the ${formatFileSizeForUi(MAX_PHOTO_UPLOAD_BYTES)} upload limit. Choose a smaller or lower-resolution image.`,
      );
      return;
    }
    const form = new FormData();
    form.append("lat", String(lat));
    form.append("lng", String(lng));
    form.append("caption", caption);
    form.append("file", jpegFile);
    let res: Response;
    try {
      res = await fetch("/api/photos", { method: "POST", body: form });
    } catch {
      setPhotoUploadWarning("Network error while uploading. Check your connection and try again.");
      return;
    }
    let data: { photo?: PhotoPin; error?: string };
    try {
      data = (await res.json()) as { photo?: PhotoPin; error?: string };
    } catch {
      setPhotoUploadWarning("Upload failed (unexpected response). Try again.");
      return;
    }
    if (!res.ok || !data.photo) {
      setPhotoUploadWarning(typeof data.error === "string" ? data.error : "Photo upload failed.");
      return;
    }
    setPhotoUploadWarning(null);
    setFollowTracker(false);
    setPhotos((prev) => [data.photo!, ...prev]);
    setPhotoUploadFocusAt((prev) => ({
      lat: data.photo!.lat,
      lng: data.photo!.lng,
      seq: (prev?.seq ?? 0) + 1,
    }));
    setGeoUploadOpen(false);
  }

  function handleGeoUploadPlaceManually(file: File) {
    setPhotoUploadWarning(null);
    setGeoUploadOpen(false);
    setManualPlaceFile(file);
    setMode("pin");
  }

  async function handleDeletePhoto(id: string) {
    await fetch(`/api/photos?id=${id}`, { method: "DELETE" });
    setPhotos((prev) => prev.filter((p) => p.id !== id));
    setSelectedPhoto(null);
  }

  if (Capacitor.isNativePlatform() && !isOnline) {
    return (
      <div style={{ position: "relative", width: "100vw", height: "100dvh", overflow: "hidden" }}>
        {showNativeOnboarding && (
          <NativeOnboardingModal onClose={handleNativeOnboardingClose} />
        )}
        <OfflineModeScreen
          stats={offlineQueueStats}
          isTracking={isTracking}
          trackingDenied={trackingDenied}
          lastNativeGpsAtMs={Capacitor.getPlatform() === "android" ? lastNativeGpsAtMs : null}
          status={offlineStatus}
          isSyncing={offlineSyncBusy}
          onToggleTracking={handleOfflineTrackToggle}
          onSync={handleOfflineSyncRequest}
        />
      </div>
    );
  }

  return (
    <div style={{ position: "relative", width: "100vw", height: "100dvh", overflow: "hidden" }}>
      {showNativeOnboarding && (
        <NativeOnboardingModal onClose={handleNativeOnboardingClose} />
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
        focusPhotoUploadAt={photoUploadFocusAt}
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
        onUpload={() => {
          setPhotoUploadWarning(null);
          setGeoUploadOpen(true);
        }}
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
          onUploadPhoto={() => {
            setPhotoUploadWarning(null);
            setGeoUploadOpen(true);
          }}
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
          uploadWarning={photoUploadWarning}
          onClearUploadWarning={() => setPhotoUploadWarning(null)}
          onCancel={() => {
            setPhotoUploadWarning(null);
            setPendingPin(null);
            setManualPlaceFile(null);
            setMode("browse");
          }}
        />
      )}

      {geoUploadOpen && (
        <GeoUploadDialog
          onSave={handleGeoUploadSave}
          onPlaceManually={handleGeoUploadPlaceManually}
          uploadWarning={photoUploadWarning}
          onClearUploadWarning={() => setPhotoUploadWarning(null)}
          onCancel={() => {
            setPhotoUploadWarning(null);
            setGeoUploadOpen(false);
          }}
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

function OfflineModeScreen({
  stats,
  isTracking,
  trackingDenied,
  lastNativeGpsAtMs,
  status,
  isSyncing,
  onToggleTracking,
  onSync,
}: {
  stats: OfflineQueueStats;
  isTracking: boolean;
  trackingDenied: boolean;
  lastNativeGpsAtMs: number | null;
  status: string | null;
  isSyncing: boolean;
  onToggleTracking: () => void;
  onSync: () => void;
}) {
  const lastSavedLabel = stats.lastRecordedAt
    ? new Date(stats.lastRecordedAt).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      })
    : "None yet";
  const gpsLabel = lastNativeGpsAtMs
    ? new Date(lastNativeGpsAtMs).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      })
    : null;

  return (
    <div
      style={{
        minHeight: "100dvh",
        width: "100vw",
        background: "var(--color-bg)",
        color: "var(--color-text)",
        display: "flex",
        flexDirection: "column",
        padding: "max(22px, env(safe-area-inset-top)) 18px max(22px, env(safe-area-inset-bottom))",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <Image
          src="/been-there-long.png"
          alt="Been There"
          width={400}
          height={96}
          style={{ width: 168, height: "auto", display: "block" }}
          priority
        />
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            border: "1px solid var(--color-border)",
            borderRadius: 999,
            padding: "7px 10px",
            background: "var(--color-surface)",
            color: "var(--color-text-muted)",
            fontSize: 12,
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          <WifiOff size={15} aria-hidden />
          Offline
        </div>
      </div>

      <main
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 18,
          maxWidth: 520,
          width: "100%",
          margin: "0 auto",
        }}
      >
        <div>
          <div style={{ fontSize: 13, color: "var(--color-text-muted)", fontWeight: 600, marginBottom: 8 }}>
            Saved on this device
          </div>
          <h1 style={{ margin: 0, fontSize: 34, lineHeight: 1.08, fontWeight: 750, letterSpacing: 0 }}>
            Offline tracking
          </h1>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 8,
          }}
        >
          <OfflineStat
            icon={<MapPin size={18} aria-hidden />}
            label="cells"
            value={stats.gpsUniqueCellCount.toLocaleString()}
            color="var(--color-teal)"
          />
          <OfflineStat
            icon={<Radio size={18} aria-hidden />}
            label="pings"
            value={stats.gpsPingCount.toLocaleString()}
            color="var(--color-pink)"
          />
          <OfflineStat
            icon={<Clock size={18} aria-hidden />}
            label="last"
            value={lastSavedLabel}
            color="var(--color-orange)"
            compact
          />
        </div>

        {(stats.manualPaintCellCount > 0 || stats.manualEraseCellCount > 0) && (
          <div
            style={{
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              padding: "10px 12px",
              background: "var(--color-surface)",
              color: "var(--color-text-muted)",
              fontSize: 12,
              lineHeight: 1.45,
            }}
          >
            {stats.manualPaintCellCount.toLocaleString()} drawn cells and{" "}
            {stats.manualEraseCellCount.toLocaleString()} erased cells waiting to sync.
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <button
            type="button"
            onClick={onToggleTracking}
            style={{
              minHeight: 52,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              border: "none",
              borderRadius: 8,
              background: isTracking ? "#e53e3e" : "var(--color-teal)",
              color: isTracking ? "white" : "var(--color-text)",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
              touchAction: "manipulation",
            }}
          >
            {isTracking ? <Square size={17} aria-hidden /> : <Play size={17} aria-hidden />}
            {isTracking ? "Stop" : trackingDenied ? "Retry" : "Track"}
          </button>
          <button
            type="button"
            onClick={onSync}
            disabled={isSyncing}
            style={{
              minHeight: 52,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              background: "var(--color-surface)",
              color: "var(--color-text)",
              fontSize: 14,
              fontWeight: 700,
              cursor: isSyncing ? "default" : "pointer",
              opacity: isSyncing ? 0.7 : 1,
              touchAction: "manipulation",
            }}
          >
            <RefreshCw
              size={17}
              aria-hidden
              style={{ animation: isSyncing ? "spin 0.9s linear infinite" : "none" }}
            />
            Sync
          </button>
        </div>

        <div
          style={{
            minHeight: 24,
            display: "flex",
            alignItems: "center",
            gap: 8,
            color: "var(--color-text-muted)",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {status === "Synced" ? <CheckCircle2 size={15} color="var(--color-teal)" aria-hidden /> : null}
          <span>
            {status ?? (isTracking ? "Recording locally" : "Ready")}
            {gpsLabel ? ` · Last GPS ${gpsLabel}` : ""}
          </span>
        </div>
      </main>
    </div>
  );
}

function OfflineStat({
  icon,
  label,
  value,
  color,
  compact = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  color: string;
  compact?: boolean;
}) {
  return (
    <div
      style={{
        minHeight: 92,
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        background: "var(--color-surface)",
        padding: "12px 10px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        gap: 8,
        overflow: "hidden",
      }}
    >
      <div style={{ color, lineHeight: 0 }}>{icon}</div>
      <div>
        <div
          style={{
            color: "var(--color-text)",
            fontSize: compact ? 15 : 22,
            lineHeight: 1.05,
            fontWeight: 750,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {value}
        </div>
        <div style={{ marginTop: 3, color: "var(--color-text-muted)", fontSize: 11, fontWeight: 600 }}>
          {label}
        </div>
      </div>
    </div>
  );
}
