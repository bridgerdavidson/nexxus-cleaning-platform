const HEIC_MIME_TYPES = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']);
const HEIC_EXTENSIONS = /\.(heic|heif)$/i;

/**
 * Detects HEIC/HEIF files. Safari sometimes returns an empty `file.type` for
 * HEIC images, so we fall back to the extension when the MIME is missing.
 */
export function isHeic(file: File): boolean {
  if (file.type && HEIC_MIME_TYPES.has(file.type.toLowerCase())) return true;
  if (!file.type && HEIC_EXTENSIONS.test(file.name)) return true;
  return false;
}

/**
 * Converts a HEIC/HEIF file to JPEG. Dynamically imports `heic2any` so the
 * ~500 KB library only loads for users who actually upload HEIC.
 */
export async function heicToJpeg(file: File): Promise<File> {
  try {
    const { default: heic2any } = await import('heic2any');
    const result = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
    const blob = Array.isArray(result) ? result[0] : result;
    const newName = file.name.replace(HEIC_EXTENSIONS, '.jpg');
    return new File([blob], newName.endsWith('.jpg') ? newName : `${newName}.jpg`, {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } catch (err) {
    throw new Error(
      `Could not convert "${file.name}" from HEIC. Please convert to JPEG and try again. (${err instanceof Error ? err.message : String(err)})`
    );
  }
}
