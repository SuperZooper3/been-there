"use client";

import type { MapMode } from "./MapApp";
import { canUndo, canRedo, type UndoRedoStack } from "@/lib/undoRedo";

interface Props {
  mode: MapMode;
  onModeChange: (mode: MapMode) => void;
  undoStack: UndoRedoStack;
  onUndo: () => void;
  onRedo: () => void;
}

const modes: { id: MapMode; label: string; icon: string; title: string }[] = [
  { id: "browse", label: "Browse", icon: "✦", title: "Browse / pan map" },
  { id: "draw",   label: "Draw",   icon: "✏",  title: "Paint visited cells" },
  { id: "erase",  label: "Erase",  icon: "◻",  title: "Erase cells" },
  { id: "pin",    label: "Pin",    icon: "◉",  title: "Drop a photo pin" },
];

export default function DrawControls({
  mode,
  onModeChange,
  undoStack,
  onUndo,
  onRedo,
}: Props) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 16,
        padding: "6px 8px",
        boxShadow: "0 4px 16px rgba(0,0,0,0.10)",
        zIndex: 10,
        userSelect: "none",
      }}
    >
      {modes.map(({ id, label, icon, title }) => (
        <button
          key={id}
          title={title}
          onClick={() => onModeChange(id)}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 2,
            padding: "6px 12px",
            borderRadius: 10,
            border: "none",
            cursor: "pointer",
            fontSize: 18,
            lineHeight: 1,
            background:
              mode === id ? "var(--color-teal)" : "transparent",
            color: "var(--color-text)",
            transition: "background 0.15s",
          }}
        >
          <span>{icon}</span>
          <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>{label}</span>
        </button>
      ))}

      <div
        style={{
          width: 1,
          height: 32,
          background: "var(--color-border)",
          margin: "0 2px",
        }}
      />

      <button
        title="Undo (⌘Z)"
        onClick={onUndo}
        disabled={!canUndo(undoStack)}
        style={{
          padding: "6px 10px",
          borderRadius: 10,
          border: "none",
          cursor: canUndo(undoStack) ? "pointer" : "default",
          fontSize: 16,
          background: "transparent",
          color: canUndo(undoStack) ? "var(--color-text)" : "var(--color-border)",
          transition: "color 0.15s",
        }}
      >
        ↩
      </button>
      <button
        title="Redo (⌘⇧Z)"
        onClick={onRedo}
        disabled={!canRedo(undoStack)}
        style={{
          padding: "6px 10px",
          borderRadius: 10,
          border: "none",
          cursor: canRedo(undoStack) ? "pointer" : "default",
          fontSize: 16,
          background: "transparent",
          color: canRedo(undoStack) ? "var(--color-text)" : "var(--color-border)",
          transition: "color 0.15s",
        }}
      >
        ↪
      </button>
    </div>
  );
}
