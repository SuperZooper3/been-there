"use client";

import Image from "next/image";

const SIZE = 34;
const R = 14;
const CIRC = 2 * Math.PI * R;

interface Props {
  cellCount: number;
  photoCount: number;
  onUpload: () => void;
  isTracking: boolean;
  trackingProgress: number; // 0–100
  /** Toggle tracking on/off. When denied the parent handles showing a modal. */
  onToggleTracking: () => void;
  isLoading?: boolean;
  trackingDenied?: boolean;
  /** Android native: show last GPS fix time under stats while tracking */
  nativeLastGpsAtMs?: number | null;
}

export default function StatsPanel({
  cellCount,
  photoCount,
  onUpload,
  isTracking,
  trackingProgress,
  onToggleTracking,
  isLoading = false,
  trackingDenied = false,
  nativeLastGpsAtMs = null,
}: Props) {
  const dashOffset = CIRC * (1 - trackingProgress / 100);

  const dotBg = trackingDenied && !isTracking
    ? "var(--color-orange)"
    : isTracking
    ? "#e53e3e"
    : "var(--color-bg)";

  const dotInner = trackingDenied && !isTracking
    ? "white"
    : isTracking
    ? "white"
    : "var(--color-text-muted)";

  const label = isTracking ? "Recording" : trackingDenied ? "Denied" : "Track";
  const labelColor = isTracking ? "#e53e3e" : trackingDenied ? "var(--color-orange)" : "var(--color-text-muted)";

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        left: 16,
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        // No right padding — the track button extends flush to the right edge
        padding: "0 0 0 12px",
        boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
        zIndex: 10,
        display: "flex",
        alignItems: "stretch",
        userSelect: "none",
        overflow: "hidden",
        ...(isTracking && nativeLastGpsAtMs != null ? { paddingBottom: 18 } : {}),
      }}
    >
      {/* Left content */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0" }}>
        <Image
          src="/been-there-long.png"
          alt="Been There"
          width={400}
          height={96}
          style={{ width: "auto", height: 39 }}
          priority
        />

        <div style={{ width: 1, height: 24, background: "var(--color-border)" }} />

        <Stat label="cells" value={cellCount.toLocaleString()} color="var(--color-teal)" isLoading={isLoading} />
        <Stat label="photos" value={photoCount.toLocaleString()} color="var(--color-pink)" isLoading={isLoading} />
      </div>

      {isTracking && nativeLastGpsAtMs != null && (
        <div
          style={{
            position: "absolute",
            left: 12,
            right: 120,
            bottom: 4,
            fontSize: 10,
            color: "var(--color-text-muted)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            pointerEvents: "none",
          }}
        >
          Last GPS: {new Date(nativeLastGpsAtMs).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" })}
        </div>
      )}

      {/* Divider before track area */}
      <div style={{ width: 1, background: "var(--color-border)", margin: "0 10px" }} />

      {/* Track — large hit area from divider to panel right edge */}
      <button
        onClick={onToggleTracking}
        title={isTracking ? "Stop tracking" : trackingDenied ? "Location denied" : "Track my location"}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 4,
          // Right padding fills to panel edge; left gives breathing room from divider
          paddingLeft: 4,
          paddingRight: 16,
          border: "none",
          background: "transparent",
          cursor: "pointer",
          touchAction: "manipulation",
          WebkitTapHighlightColor: "transparent",
          // Slight tint on hover/active handled via opacity change on inner content
        }}
      >
        {/* Ring + dot */}
        <div style={{ position: "relative", width: SIZE, height: SIZE }}>
          {isTracking && (
            <svg
              width={SIZE} height={SIZE}
              style={{ position: "absolute", inset: 0, transform: "rotate(-90deg)", pointerEvents: "none" }}
            >
              <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none"
                stroke="rgba(229,62,62,0.18)" strokeWidth={2} />
              <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none"
                stroke="rgba(229,62,62,0.8)" strokeWidth={2}
                strokeDasharray={CIRC} strokeDashoffset={dashOffset}
                strokeLinecap="round" />
            </svg>
          )}
          <div style={{
            position: "absolute", top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            width: 24, height: 24, borderRadius: "50%",
            background: dotBg,
            display: "flex", alignItems: "center", justifyContent: "center",
            animation: isTracking ? "loc-pulse 2.2s ease-in-out infinite" : "none",
            boxShadow: (isTracking || trackingDenied) ? "0 0 0 0 rgba(229,62,62,0.55)" : "inset 0 0 0 1px var(--color-border)",
            transition: "background 0.2s",
            pointerEvents: "none",
          }}>
            <div style={{
              width: 8, height: 8, borderRadius: "50%",
              background: dotInner,
            }} />
          </div>
        </div>

        <span style={{
          fontSize: 9, fontWeight: 500, letterSpacing: "0.02em", lineHeight: 1,
          color: labelColor,
          transition: "color 0.2s",
        }}>
          {label}
        </span>
      </button>
    </div>
  );
}

function Stat({ label, value, color, isLoading }: { label: string; value: string; color: string; isLoading?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
      {isLoading ? (
        <div
          style={{
            width: 14,
            height: 14,
            border: "2px solid var(--color-border)",
            borderTopColor: color,
            borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
          }}
        />
      ) : (
        <span style={{ fontSize: 14, fontWeight: 600, color }}>{value}</span>
      )}
      <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>{label}</span>
    </div>
  );
}
