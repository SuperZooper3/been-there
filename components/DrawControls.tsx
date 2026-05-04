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

const btn = (active: boolean): React.CSSProperties => ({
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
  background: active ? "var(--color-teal)" : "transparent",
  color: "var(--color-text)",
  transition: "background 0.15s",
  whiteSpace: "nowrap" as const,
});

const label: React.CSSProperties = {
  fontSize: 10,
  color: "var(--color-text-muted)",
};

const divider: React.CSSProperties = {
  width: 1,
  height: 32,
  background: "var(--color-border)",
  margin: "0 2px",
  flexShrink: 0,
};

export default function DrawControls({
  mode,
  onModeChange,
  undoStack,
  onUndo,
  onRedo,
}: Props) {
  const inEditMode = mode === "draw" || mode === "erase";

  function handleEditClick() {
    // If already in edit mode, go back to browse; otherwise enter draw
    onModeChange(inEditMode ? "browse" : "draw");
  }

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
      {/* Browse */}
      <button
        title="Browse / pan map"
        onClick={() => onModeChange("browse")}
        style={btn(mode === "browse")}
      >
        <span>✦</span>
        <span style={label}>Browse</span>
      </button>

      {/* Edit — collapses into Draw + Erase when active */}
      {inEditMode ? (
        <>
          <button
            title="Paint visited cells"
            onClick={() => onModeChange("draw")}
            style={btn(mode === "draw")}
          >
            <span>✏</span>
            <span style={label}>Draw</span>
          </button>
          <button
            title="Erase cells"
            onClick={() => onModeChange("erase")}
            style={btn(mode === "erase")}
          >
            <span>◻</span>
            <span style={label}>Erase</span>
          </button>
        </>
      ) : (
        <button
          title="Enter edit mode (draw or erase cells)"
          onClick={handleEditClick}
          style={btn(false)}
        >
          <span>✏</span>
          <span style={label}>Edit</span>
        </button>
      )}

      {/* Pin */}
      <button
        title="Drop a photo pin"
        onClick={() => onModeChange("pin")}
        style={btn(mode === "pin")}
      >
        <span>◉</span>
        <span style={label}>Pin</span>
      </button>

      <div style={divider} />

      {/* Undo / Redo — only shown while in edit mode */}
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
