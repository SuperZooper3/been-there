"use client";

interface Props {
  cellCount: number;
  photoCount: number;
  onSignOut: () => void;
}

export default function StatsPanel({ cellCount, photoCount, onSignOut }: Props) {
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
        onClick={onSignOut}
        title="Sign out"
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          fontSize: 12,
          color: "var(--color-text-muted)",
          padding: 0,
        }}
      >
        out
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
