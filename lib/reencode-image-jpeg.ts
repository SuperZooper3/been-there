/** Max JPEG size (bytes) for POST `/api/photos` — under typical serverless request body limits. */
export const MAX_PHOTO_UPLOAD_BYTES = 4 * 1024 * 1024;

export function formatFileSizeForUi(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Longest edge (px) after resize — smaller uploads and safer canvas memory on mobile. */
const DEFAULT_MAX_EDGE = 2560;

const DEFAULT_JPEG_QUALITY = 0.92;

export type ReencodeJpegOptions = {
  maxEdge?: number;
  quality?: number;
};

/**
 * Decode an image file, draw to canvas (white backing for transparency), export as JPEG.
 * Call this only after any EXIF/GPS reads on the original `File`; metadata is not copied.
 */
export async function reencodeImageFileAsJpeg(
  file: File,
  options?: ReencodeJpegOptions
): Promise<File> {
  if (typeof createImageBitmap !== "function") {
    throw new Error("This browser cannot decode images for upload.");
  }

  const maxEdge = options?.maxEdge ?? DEFAULT_MAX_EDGE;
  const quality = options?.quality ?? DEFAULT_JPEG_QUALITY;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Could not decode image.");
  }

  try {
    const sw = bitmap.width;
    const sh = bitmap.height;
    let dw = sw;
    let dh = sh;
    if (sw > maxEdge || sh > maxEdge) {
      const scale = Math.min(maxEdge / sw, maxEdge / sh);
      dw = Math.max(1, Math.round(sw * scale));
      dh = Math.max(1, Math.round(sh * scale));
    }

    const canvas = document.createElement("canvas");
    canvas.width = dw;
    canvas.height = dh;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not available.");

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, dw, dh);
    ctx.drawImage(bitmap, 0, 0, dw, dh);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/jpeg", quality);
    });
    if (!blob) throw new Error("JPEG encoding failed.");

    const stem = file.name.replace(/\.[^.]+$/, "").trim();
    const safeStem = stem.length > 0 ? stem.replace(/[^a-zA-Z0-9_-]+/g, "_") : "photo";
    return new File([blob], `${safeStem}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } finally {
    bitmap.close();
  }
}
