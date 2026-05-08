"use client";

import { useEffect, useRef, useState } from "react";
import exifr from "exifr";

type Stage =
  | { type: "idle" }
  | { type: "loading" }
  | { type: "geolocated"; file: File; preview: string; lat: number; lng: number }
  | { type: "no-gps"; file: File; preview: string };

interface Props {
  onSave: (file: File, lat: number, lng: number, caption: string) => void;
  /** Called when the user wants to place the photo manually (no GPS found). */
  onPlaceManually: (file: File) => void;
  onCancel: () => void;
}

export default function GeoUploadDialog({ onSave, onPlaceManually, onCancel }: Props) {
  const [stage, setStage] = useState<Stage>({ type: "idle" });
  const [caption, setCaption] = useState("");
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-open file picker when the dialog first mounts
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.click(), 80);
    return () => clearTimeout(timer);
  }, []);

  async function processFile(file: File) {
    setStage({ type: "loading" });
    const preview = URL.createObjectURL(file);
    try {
      const gps = await exifr.gps(file);
      const lat = gps?.latitude;
      const lng = gps?.longitude;
      if (lat != null && lng != null && !isNaN(lat) && !isNaN(lng)) {
        setStage({ type: "geolocated", file, preview, lat, lng });
      } else {
        setStage({ type: "no-gps", file, preview });
      }
    } catch {
      setStage({ type: "no-gps", file, preview });
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file?.type.startsWith("image/")) processFile(file);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (stage.type !== "geolocated" || submitting) return;
    setSubmitting(true);
    onSave(stage.file, stage.lat, stage.lng, caption);
  }

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: 20,
          padding: 24,
          width: "90%",
          maxWidth: 320,
          boxShadow: "0 8px 40px rgba(0,0,0,0.15)",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--color-text)" }}>
          Upload Photo
        </h2>

        {/* Drop zone / preview */}
        <div
          onClick={() => stage.type !== "loading" && inputRef.current?.click()}
          onDragOver={stage.type !== "loading" ? handleDragOver : undefined}
          onDragLeave={stage.type !== "loading" ? handleDragLeave : undefined}
          onDrop={stage.type !== "loading" ? handleDrop : undefined}
          style={{
            width: "100%",
            aspectRatio: "1 / 1",
            background:
              stage.type === "idle" || stage.type === "loading"
                ? "var(--color-bg)"
                : "transparent",
            border: `2px dashed ${dragging ? "var(--color-teal)" : "var(--color-border)"}`,
            borderRadius: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: stage.type === "loading" ? "default" : "pointer",
            overflow: "hidden",
            position: "relative",
            transition: "border-color 0.15s",
            outline: dragging ? "3px solid rgba(72,187,120,0.2)" : "none",
          }}
        >
          {stage.type === "idle" && (
            <div style={{ textAlign: "center", pointerEvents: "none" }}>
              <div style={{ fontSize: 28, color: "var(--color-text-muted)" }}>+</div>
              <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 4 }}>
                click or drag &amp; drop
              </div>
            </div>
          )}
          {stage.type === "loading" && (
            <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>Reading…</span>
          )}
          {(stage.type === "geolocated" || stage.type === "no-gps") && (
            <img
              src={stage.preview}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={handleFile}
        />

        {/* GPS found: show coords + caption input */}
        {stage.type === "geolocated" && (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 12px",
                borderRadius: 10,
                background: "rgba(72, 187, 120, 0.12)",
                border: "1px solid rgba(72, 187, 120, 0.35)",
              }}
            >
              <span style={{ fontSize: 14 }}>📍</span>
              <span style={{ fontSize: 12, color: "var(--color-text)", lineHeight: 1.4 }}>
                {stage.lat.toFixed(5)}, {stage.lng.toFixed(5)}
              </span>
            </div>

            <input
              type="text"
              placeholder="Caption (optional)"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              style={{
                padding: "8px 12px",
                borderRadius: 10,
                border: "1px solid var(--color-border)",
                background: "var(--color-bg)",
                color: "var(--color-text)",
                fontSize: 14,
                outline: "none",
              }}
            />

            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={onCancel}
                style={{
                  flex: 1,
                  padding: "10px 0",
                  borderRadius: 10,
                  border: "1px solid var(--color-border)",
                  background: "transparent",
                  color: "var(--color-text-muted)",
                  cursor: "pointer",
                  fontSize: 14,
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                style={{
                  flex: 2,
                  padding: "10px 0",
                  borderRadius: 10,
                  border: "none",
                  background: "var(--color-orange)",
                  color: "var(--color-text)",
                  cursor: submitting ? "default" : "pointer",
                  fontSize: 14,
                  fontWeight: 600,
                  opacity: submitting ? 0.5 : 1,
                }}
              >
                {submitting ? "Saving…" : "Save"}
              </button>
            </div>
          </>
        )}

        {/* No GPS: warning + options */}
        {stage.type === "no-gps" && (
          <>
            <div
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                background: "rgba(237, 137, 54, 0.1)",
                border: "1px solid rgba(237, 137, 54, 0.35)",
              }}
            >
              <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>
                No location data found
              </p>
              <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-muted)", lineHeight: 1.5 }}>
                This photo doesn&apos;t have GPS tags. You can place it manually by tapping the map.
              </p>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={onCancel}
                style={{
                  flex: 1,
                  padding: "10px 0",
                  borderRadius: 10,
                  border: "1px solid var(--color-border)",
                  background: "transparent",
                  color: "var(--color-text-muted)",
                  cursor: "pointer",
                  fontSize: 14,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => onPlaceManually(stage.file)}
                style={{
                  flex: 2,
                  padding: "10px 0",
                  borderRadius: 10,
                  border: "none",
                  background: "var(--color-orange)",
                  color: "var(--color-text)",
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                Place manually
              </button>
            </div>
          </>
        )}

        {/* Idle: just a cancel */}
        {stage.type === "idle" && (
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: "10px 0",
              borderRadius: 10,
              border: "1px solid var(--color-border)",
              background: "transparent",
              color: "var(--color-text-muted)",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            Cancel
          </button>
        )}
      </form>
    </div>
  );
}
