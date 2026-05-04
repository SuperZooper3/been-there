"use client";

import { useState } from "react";
import type { PhotoPin } from "./Map";

interface Props {
  photo: PhotoPin;
  onClose: () => void;
  onDelete: (id: string) => void;
}

export default function PolaroidPin({ photo, onClose, onDelete }: Props) {
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <div
        onClick={onClose}
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
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            background: "white",
            padding: "12px 12px 32px 12px",
            borderRadius: 4,
            boxShadow: "0 8px 40px rgba(0,0,0,0.25)",
            maxWidth: 320,
            width: "90%",
            transform: `rotate(${(Math.random() * 4 - 2).toFixed(1)}deg)`,
          }}
        >
          <img
            src={photo.url}
            alt={photo.caption ?? ""}
            style={{
              width: "100%",
              aspectRatio: "1 / 1",
              objectFit: "cover",
              display: "block",
            }}
          />

          <div
            style={{
              marginTop: 12,
              minHeight: 24,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            {photo.caption && (
              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  color: "#3d3530",
                  fontFamily: "Georgia, serif",
                  flex: 1,
                }}
              >
                {photo.caption}
              </p>
            )}
            <button
              onClick={() => setConfirming(true)}
              style={{
                background: "none",
                border: "1px solid #ddd",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 11,
                color: "#999",
                padding: "3px 8px",
                marginLeft: "auto",
                letterSpacing: "0.02em",
              }}
            >
              Delete
            </button>
          </div>
        </div>
      </div>

      {confirming && (
        <div
          onClick={() => setConfirming(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 200,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "white",
              borderRadius: 8,
              padding: "24px 28px",
              maxWidth: 300,
              width: "90%",
              boxShadow: "0 8px 40px rgba(0,0,0,0.3)",
              textAlign: "center",
            }}
          >
            <p style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 600, color: "#1a1a1a" }}>
              Delete this photo?
            </p>
            <p style={{ margin: "0 0 20px", fontSize: 13, color: "#666" }}>
              This can&apos;t be undone.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button
                onClick={() => setConfirming(false)}
                style={{
                  flex: 1,
                  padding: "8px 0",
                  border: "1px solid #ddd",
                  borderRadius: 6,
                  background: "white",
                  cursor: "pointer",
                  fontSize: 13,
                  color: "#555",
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => onDelete(photo.id)}
                style={{
                  flex: 1,
                  padding: "8px 0",
                  border: "none",
                  borderRadius: 6,
                  background: "#e53e3e",
                  color: "white",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
