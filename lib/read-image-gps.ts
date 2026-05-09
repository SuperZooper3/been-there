import exifr from "exifr";

const MAX_EXIF_SCAN = 16 * 1024 * 1024; // 16 MB — enough for phone JPEGs with huge embedded previews before GPS IFD

function isValidCoord(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

/**
 * Read GPS from an image file (browser / Capacitor).
 *
 * `exifr.gps(file)` only scans the first ~40KB by default. Android camera JPEGs often
 * place a large preview/thumbnail before the GPS EXIF block, so GPS is missed unless
 * we scan deeper or parse the full buffer.
 */
export async function readImageGps(file: File): Promise<{ lat: number; lng: number } | null> {
  try {
    const gps = await exifr.gps(file);
    if (gps && isValidCoord(gps.latitude, gps.longitude)) {
      return { lat: gps.latitude, lng: gps.longitude };
    }
  } catch {
    /* fall through */
  }

  try {
    const buffer = await file.arrayBuffer();
    const scan = Math.min(buffer.byteLength, MAX_EXIF_SCAN);
    const parsed = await exifr.parse(buffer, {
      mergeOutput: true,
      gps: true,
      exif: true,
      xmp: true,
      firstChunkSize: scan,
    });
    if (parsed && isValidCoord(parsed.latitude, parsed.longitude)) {
      return { lat: parsed.latitude, lng: parsed.longitude };
    }
  } catch {
    /* ignore */
  }

  return null;
}
