"use client";

import { useEffect } from "react";
import type { MapMode } from "./MapApp";
import { canUndo, canRedo, type UndoRedoStack } from "@/lib/undoRedo";
import { Hand, Pencil, Eraser, MapPin } from "lucide-react";

interface Props {
  mode: MapMode;
  onModeChange: (mode: MapMode) => void;
  undoStack: UndoRedoStack;
  onUndo: () => void;
  onRedo: () => void;
}

const btn = (active: boolean): React.CSSProperties => ({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 40,
  height: 40,
  padding: 0,
  borderRadius: 10,
  border: "none",
  cursor: "pointer",
  fontSize: 20,
  lineHeight: 1,
  background: active ? "var(--color-teal)" : "transparent",
  color: "var(--color-text)",
  transition: "background 0.15s",
});

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
        <Hand size={20} />
      </button>

      {/* Draw */}
      <button
        title="Paint visited cells"
        onClick={() => onModeChange("draw")}
        style={btn(mode === "draw")}
      >
        <Pencil size={20} />
      </button>

      {/* Erase */}
      <button
        title="Erase cells"
        onClick={() => onModeChange("erase")}
        style={btn(mode === "erase")}
      >
        <Eraser size={20} />
      </button>

      {/* Pin */}
      <button
        title="Drop a photo pin"
        onClick={() => onModeChange("pin")}
        style={btn(mode === "pin")}
      >
        <MapPin size={20} />
      </button>

      <div style={divider} />

      {/* Undo / Redo — only shown while in edit mode */}
      <button
        title="Undo (⌘Z)"
        onClick={onUndo}
        disabled={!canUndo(undoStack)}
        style={{
          padding: "4px 6px",
          borderRadius: 10,
          border: "none",
          cursor: canUndo(undoStack) ? "pointer" : "default",
          fontSize: 20,
          background: "transparent",
          color: canUndo(undoStack) ? "var(--color-text)" : "var(--color-border)",
          transition: "color 0.15s",
        }}
      >
        ⟲
      </button>
      <button
        title="Redo (⌘⇧Z)"
        onClick={onRedo}
        disabled={!canRedo(undoStack)}
        style={{
          padding: "4px 6px",
          borderRadius: 10,
          border: "none",
          cursor: canRedo(undoStack) ? "pointer" : "default",
          fontSize: 20,
          background: "transparent",
          color: canRedo(undoStack) ? "var(--color-text)" : "var(--color-border)",
          transition: "color 0.15s",
        }}
      >
        ⟳
      </button>
    </div>
  );
}
