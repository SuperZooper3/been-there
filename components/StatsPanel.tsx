"use client";

import { Camera } from "lucide-react";

interface Props {
  cellCount: number;
  photoCount: number;
  onUpload: () => void;
}

export default function StatsPanel({ cellCount, photoCount, onUpload }: Props) {
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

      <button
        onClick={onUpload}
        title="Upload geotagged photo"
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "2px 4px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 2,
          color: "var(--color-text)",
          borderRadius: 6,
        }}
      >
        <Camera size={16} />
        <span style={{ fontSize: 9, fontWeight: 500, letterSpacing: "0.02em", lineHeight: 1 }}>
          Add Photo
        </span>
      </button>
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
