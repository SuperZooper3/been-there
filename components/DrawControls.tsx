"use client";

import { useEffect } from "react";
import type { MapMode } from "./MapApp";
import type { UndoRedoStack } from "@/lib/undoRedo";
import { MousePointer, Camera, Pencil, Eraser, Sparkles } from "lucide-react";

interface Props {
  mode: MapMode;
  onModeChange: (mode: MapMode) => void;
  undoStack: UndoRedoStack;
  onUndo: () => void;
  onRedo: () => void;
  onUploadPhoto: () => void;
  drawUnlocked?: boolean;
  intelligenceActive?: boolean;
  onToggleIntelligence?: () => void;
  isTracking?: boolean;
  followTracker?: boolean;
  onToggleFollowTracker?: () => void;
}

function TrackerFollowIcon() {
  return (
    <div
      style={{
        position: "relative",
        width: 14,
        height: 14,
        flexShrink: 0,
      }}
    >
      <div className="location-pulse-ring" style={{ position: "absolute", inset: 0 }} />
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          background: "#3b82f6",
          border: "2px solid white",
          boxShadow: "0 1px 6px rgba(59, 130, 246, 0.5)",
        }}
      />
    </div>
  );
}

const btn = (active: boolean): React.CSSProperties => ({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 44,
  height: 44,
  padding: 0,
  borderRadius: 12,
  border: "none",
  cursor: "pointer",
  fontSize: 20,
  lineHeight: 1,
  background: active ? "var(--color-teal)" : "transparent",
  color: "var(--color-text)",
  transition: "background 0.15s",
  touchAction: "manipulation",
  WebkitTapHighlightColor: "transparent" as React.CSSProperties["WebkitTapHighlightColor"],
});

const divider = (
  <div style={{ width: 1, height: 24, background: "var(--color-border)" }} />
);

export default function DrawControls({
  mode,
  onModeChange,
  onUndo,
  onRedo,
  onUploadPhoto,
  drawUnlocked = false,
  intelligenceActive = false,
  onToggleIntelligence,
  isTracking = false,
  followTracker = false,
  onToggleFollowTracker,
}: Props) {
  const cameraActive = mode === "pin";

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key.toLowerCase()) {
        case "h": onModeChange("browse"); break;
        case "p": onModeChange("draw"); break;
        case "e": onModeChange("erase"); break;
        case "m": onModeChange("pin"); break;
        case "u": onUploadPhoto(); break;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) onRedo(); else onUndo();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onModeChange, onUploadPhoto, onUndo, onRedo]);

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 4,
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 18,
        padding: "6px 8px",
        boxShadow: "0 4px 16px rgba(0,0,0,0.10)",
        zIndex: 10,
        userSelect: "none",
      }}
    >
      {isTracking && (
        <>
          <button
            type="button"
            onClick={() => onToggleFollowTracker?.()}
            title={followTracker ? "Stop following location" : "Follow location"}
            style={btn(followTracker)}
          >
            <TrackerFollowIcon />
          </button>
          {divider}
        </>
      )}

      <button
        onClick={() => onModeChange("browse")}
        title="Pan map (H)"
        style={btn(!drawUnlocked
          ? mode === "browse" || mode === "draw" || mode === "erase"
          : mode === "browse")}
      >
        <MousePointer size={20} />
      </button>

      {drawUnlocked && (
        <>
          {divider}
          <button
            onClick={() => onModeChange("draw")}
            title="Paint cells (P)"
            style={btn(mode === "draw")}
          >
            <Pencil size={20} />
          </button>
          <button
            onClick={() => onModeChange("erase")}
            title="Erase cells (E)"
            style={btn(mode === "erase")}
          >
            <Eraser size={20} />
          </button>
        </>
      )}

      {divider}

      <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <button
          onClick={onUploadPhoto}
          title="Upload photo (U)"
          style={btn(cameraActive)}
        >
          <Camera size={20} />
        </button>
        {cameraActive && (
          <div
            style={{
              position: "absolute",
              bottom: "calc(100% + 10px)",
              left: "50%",
              transform: "translateX(-50%)",
              background: "var(--color-text)",
              color: "var(--color-surface)",
              padding: "6px 10px",
              borderRadius: 8,
              fontSize: 12,
              whiteSpace: "nowrap",
              pointerEvents: "none",
              boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            }}
          >
            Tap the map to place your photo
          </div>
        )}
      </div>

      {divider}

      <button
        type="button"
        onClick={() => onToggleIntelligence?.()}
        title="Intelligence overlays"
        style={btn(intelligenceActive)}
      >
        <Sparkles size={20} />
      </button>
    </div>
  );
}
