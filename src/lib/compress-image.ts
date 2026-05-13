import imageCompression from 'browser-image-compression';

const COMPRESSION_OPTIONS = {
  maxSizeMB: 2,            // Target ≤ 2 MB after compression
  maxWidthOrHeight: 2048,  // Cap resolution so quality stays high but upload is fast
  initialQuality: 0.9,     // Start at 90% JPEG quality; library reduces if needed
  fileType: 'image/jpeg',  // Normalize all output to JPEG for consistency
  useWebWorker: true,      // Run off the main thread to keep UI responsive
  preserveExif: false,     // Strip EXIF to protect privacy and reduce size
} as const;

/**
 * Compresses a single image file. Resizes to max 2048px and targets ≤ 2 MB JPEG output.
 * Throws a user-friendly error if compression fails.
 */
export async function compressImage(file: File): Promise<File> {
  try {
    const compressed = await imageCompression(file, COMPRESSION_OPTIONS);
    return new File([compressed], file.name.replace(/\.[^/.]+$/, '.jpg'), {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } catch (err) {
    throw new Error(
      `Could not compress "${file.name}". Please try a different image. (${err instanceof Error ? err.message : String(err)})`
    );
  }
}

