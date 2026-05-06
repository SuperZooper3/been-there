"use client";

import { useRef, useState } from "react";

interface Props {
  lat: number;
  lng: number;
  initialFile?: File;
  onConfirm: (file: File, caption: string) => void;
  onCancel: () => void;
}

export default function PinDropDialog({ lat, lng, initialFile, onConfirm, onCancel }: Props) {
  const [caption, setCaption] = useState("");
  const [preview, setPreview] = useState<string | null>(
    initialFile ? URL.createObjectURL(initialFile) : null
  );
  const [file, setFile] = useState<File | null>(initialFile ?? null);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function applyFile(f: File) {
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) applyFile(f);
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
    const f = e.dataTransfer.files?.[0];
    if (f?.type.startsWith("image/")) applyFile(f);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || submitting) return;
    setSubmitting(true);
    onConfirm(file, caption);
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
        <h2
          style={{
            margin: 0,
            fontSize: 16,
            fontWeight: 600,
            color: "var(--color-text)",
          }}
        >
          Drop a Pin
        </h2>
        <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-muted)" }}>
          {lat.toFixed(5)}, {lng.toFixed(5)}
        </p>

        {/* Photo picker */}
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          style={{
            width: "100%",
            aspectRatio: "1 / 1",
            background: preview ? "transparent" : "var(--color-bg)",
            border: `2px dashed ${dragging ? "var(--color-teal)" : "var(--color-border)"}`,
            borderRadius: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            overflow: "hidden",
            transition: "border-color 0.15s",
            outline: dragging ? "3px solid rgba(72,187,120,0.2)" : "none",
          }}
        >
          {preview ? (
            <img
              src={preview}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <div style={{ textAlign: "center", pointerEvents: "none" }}>
              <div style={{ fontSize: 28, color: "var(--color-text-muted)" }}>+</div>
              <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 4 }}>
                click or drag &amp; drop
              </div>
            </div>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: "none" }}
          onChange={handleFile}
        />

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
            disabled={!file || submitting}
            style={{
              flex: 2,
              padding: "10px 0",
              borderRadius: 10,
              border: "none",
              background: "var(--color-orange)",
              color: "var(--color-text)",
              cursor: file && !submitting ? "pointer" : "default",
              fontSize: 14,
              fontWeight: 600,
              opacity: file && !submitting ? 1 : 0.5,
            }}
          >
            {submitting ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
