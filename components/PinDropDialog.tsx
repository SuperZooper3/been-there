"use client";

import { useRef, useState } from "react";

interface Props {
  lat: number;
  lng: number;
  onConfirm: (file: File, caption: string) => void;
  onCancel: () => void;
}

export default function PinDropDialog({ lat, lng, onConfirm, onCancel }: Props) {
  const [caption, setCaption] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
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
          Drop a pin
        </h2>
        <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-muted)" }}>
          {lat.toFixed(5)}, {lng.toFixed(5)}
        </p>

        {/* Photo picker */}
        <div
          onClick={() => inputRef.current?.click()}
          style={{
            width: "100%",
            aspectRatio: "1 / 1",
            background: preview ? "transparent" : "var(--color-bg)",
            border: "2px dashed var(--color-border)",
            borderRadius: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            overflow: "hidden",
          }}
        >
          {preview ? (
            <img
              src={preview}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <span style={{ fontSize: 28, color: "var(--color-text-muted)" }}>+</span>
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
            disabled={!file}
            style={{
              flex: 2,
              padding: "10px 0",
              borderRadius: 10,
              border: "none",
              background: "var(--color-orange)",
              color: "var(--color-text)",
              cursor: file ? "pointer" : "default",
              fontSize: 14,
              fontWeight: 600,
              opacity: file ? 1 : 0.5,
            }}
          >
            Save pin
          </button>
        </div>
      </form>
    </div>
  );
}
