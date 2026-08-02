/**
 * Whitespace trimming for uploaded logos.
 *
 * Real-world logo exports routinely ship with generous canvas padding (the
 * art can occupy half the file's height or less). Every render surface sizes
 * logos by a bounding box, so padding directly shrinks the visible mark:
 * a padded lockup capped at 32px can leave the wordmark under 10px tall.
 * Trimming once at upload fixes every surface at its true size.
 *
 * Padding rules, chosen to never eat real art:
 * - If the image uses transparency anywhere, ONLY fully-transparent borders
 *   are trimmed. A white-on-transparent logo is all "near-white" pixels, so
 *   the near-white rule must not apply when alpha carries the shape.
 * - If the image is fully opaque (a flattened white-background export), the
 *   near-white border is trimmed too.
 * - The crop keeps a small margin, skips when there is nothing meaningful to
 *   gain, and bails to the original on any degenerate result.
 */

export interface ContentBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Alpha at or below this is padding. */
const ALPHA_PADDING_MAX = 8;
/** On fully-opaque images, r,g,b all at/above this is padding. */
const NEAR_WHITE_MIN = 250;
/** Breathing room kept around the detected content. */
const KEEP_MARGIN_PX = 2;
/** A content box smaller than this on either side is suspicious: keep the original. */
const MIN_CONTENT_PX = 8;
/** Content already filling this fraction of both dimensions: not worth re-encoding. */
const SKIP_RATIO = 0.96;

/**
 * Pure content-bounds scan over RGBA pixel data. Returns the crop box
 * (margin applied), or null when the image should be kept as-is.
 */
export function computeContentBox(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): ContentBox | null {
  if (width <= 0 || height <= 0 || data.length < width * height * 4) return null;

  let usesTransparency = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 250) {
      usesTransparency = true;
      break;
    }
  }

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      const i = row + x * 4;
      const a = data[i + 3];
      let isContent: boolean;
      if (usesTransparency) {
        isContent = a > ALPHA_PADDING_MAX;
      } else {
        isContent =
          data[i] < NEAR_WHITE_MIN || data[i + 1] < NEAR_WHITE_MIN || data[i + 2] < NEAR_WHITE_MIN;
      }
      if (isContent) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) return null; // blank image: nothing to crop to

  minX = Math.max(0, minX - KEEP_MARGIN_PX);
  minY = Math.max(0, minY - KEEP_MARGIN_PX);
  maxX = Math.min(width - 1, maxX + KEEP_MARGIN_PX);
  maxY = Math.min(height - 1, maxY + KEEP_MARGIN_PX);

  const boxWidth = maxX - minX + 1;
  const boxHeight = maxY - minY + 1;

  if (boxWidth < MIN_CONTENT_PX || boxHeight < MIN_CONTENT_PX) return null;
  if (boxWidth >= width * SKIP_RATIO && boxHeight >= height * SKIP_RATIO) return null;

  return { x: minX, y: minY, width: boxWidth, height: boxHeight };
}

/**
 * Trims the padding border off an uploaded logo file. Best-effort: any decode,
 * canvas, or encode failure returns the ORIGINAL file, so the upload never
 * breaks on an exotic image. Runs before compression, which handles size caps.
 */
export async function trimLogoWhitespace(file: File): Promise<File> {
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") return file;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    // Oversize guard: createImageBitmap has already decoded by now, but
    // bailing here still avoids the two further full-size copies (canvas
    // backing store + getImageData) and the O(pixels) scan for absurd inputs.
    if (!width || !height || width * height > 32_000_000) return file;

    const source = document.createElement("canvas");
    source.width = width;
    source.height = height;
    const ctx = source.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0);

    const box = computeContentBox(ctx.getImageData(0, 0, width, height).data, width, height);
    if (!box) return file;

    const out = document.createElement("canvas");
    out.width = box.width;
    out.height = box.height;
    const outCtx = out.getContext("2d");
    if (!outCtx) return file;
    outCtx.drawImage(source, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);

    const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, file.type));
    if (!blob) return file;
    // Safari cannot encode WebP and toBlob silently falls back to PNG, so the
    // blob's OWN type is authoritative for the stored extension/contentType.
    return new File([blob], file.name, { type: blob.type || file.type });
  } catch {
    return file;
  } finally {
    bitmap?.close?.();
  }
}
