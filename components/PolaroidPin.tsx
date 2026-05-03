"use client";

import type { PhotoPin } from "./Map";

interface Props {
  photo: PhotoPin;
  onClose: () => void;
  onDelete: (id: string) => void;
}

export default function PolaroidPin({ photo, onClose, onDelete }: Props) {
  return (
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
        {/* Photo */}
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

        {/* Polaroid chin */}
        <div
          style={{
            marginTop: 12,
            minHeight: 24,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
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
            onClick={() => onDelete(photo.id)}
            title="Delete photo"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 12,
              color: "#aaa",
              marginLeft: "auto",
              padding: "0 2px",
            }}
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
