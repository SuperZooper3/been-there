"use client";

import { Camera } from "lucide-react";

const SIZE = 34;
const R = 14;
const CIRC = 2 * Math.PI * R;

interface Props {
  cellCount: number;
  photoCount: number;
  onUpload: () => void;
  isTracking: boolean;
  trackingProgress: number; // 0–100
  onToggleTracking: () => void;
}

export default function StatsPanel({
  cellCount,
  photoCount,
  onUpload,
  isTracking,
  trackingProgress,
  onToggleTracking,
}: Props) {
  const dashOffset = CIRC * (1 - trackingProgress / 100);

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        left: 16,
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        padding: "10px 16px",
        boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
        zIndex: 10,
        display: "flex",
        alignItems: "center",
        gap: 16,
        userSelect: "none",
      }}
    >
      <span
        style={{
          fontWeight: 600,
          fontSize: 14,
          color: "var(--color-text)",
          letterSpacing: "-0.01em",
        }}
      >
        Been There
      </span>

      <div style={{ width: 1, height: 20, background: "var(--color-border)" }} />

      <Stat label="cells" value={cellCount.toLocaleString()} color="var(--color-teal)" />
      <Stat label="photos" value={photoCount.toLocaleString()} color="var(--color-pink)" />

      <div style={{ width: 1, height: 20, background: "var(--color-border)" }} />

      {/* Add Photo */}
      <button
        onClick={onUpload}
        title="Upload geotagged photo"
        style={{
          background: "none", border: "none", cursor: "pointer",
          padding: "2px 4px", display: "flex", flexDirection: "column",
          alignItems: "center", gap: 2, color: "var(--color-text)", borderRadius: 6,
        }}
      >
        <Camera size={16} />
        <span style={{ fontSize: 9, fontWeight: 500, letterSpacing: "0.02em", lineHeight: 1 }}>
          Add Photo
        </span>
      </button>

      <div style={{ width: 1, height: 20, background: "var(--color-border)" }} />

      {/* Track location */}
      <div
        style={{
          display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
        }}
      >
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
          <button
            onClick={onToggleTracking}
            title={isTracking ? "Stop tracking" : "Track my location"}
            style={{
              position: "absolute", top: "50%", left: "50%",
              transform: "translate(-50%, -50%)",
              width: 24, height: 24, borderRadius: "50%", border: "none",
              background: isTracking ? "#e53e3e" : "var(--color-bg)",
              cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              animation: isTracking ? "loc-pulse 2.2s ease-in-out infinite" : "none",
              boxShadow: isTracking ? "0 0 0 0 rgba(229,62,62,0.55)" : "inset 0 0 0 1px var(--color-border)",
              transition: "background 0.2s",
            }}
          >
            <div style={{
              width: 8, height: 8, borderRadius: "50%",
              background: isTracking ? "white" : "var(--color-text-muted)",
            }} />
          </button>
        </div>
        <span style={{
          fontSize: 9, fontWeight: 500, letterSpacing: "0.02em", lineHeight: 1,
          color: isTracking ? "#e53e3e" : "var(--color-text-muted)",
          transition: "color 0.2s",
        }}>
          {isTracking ? "Recording" : "Track"}
        </span>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
      <span style={{ fontSize: 14, fontWeight: 600, color }}>{value}</span>
      <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>{label}</span>
    </div>
  );
}
