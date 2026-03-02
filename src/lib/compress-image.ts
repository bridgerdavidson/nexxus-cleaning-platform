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
 * Compresses a single image file for job photo upload.
 * Resizes to max 2048px and targets ≤ 2 MB JPEG output.
 * Throws a user-friendly error if compression fails.
 */
export async function compressJobPhoto(file: File): Promise<File> {
  try {
    const compressed = await imageCompression(file, COMPRESSION_OPTIONS);
    // imageCompression returns a Blob; wrap it back into a File so callers
    // can still read .name and .type consistently.
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

/**
 * Compresses a batch of image files concurrently.
 * Uses a concurrency limit of 3 to avoid exhausting memory on mobile devices.
 * Throws on the first compression failure.
 */
export async function compressJobPhotoBatch(files: File[]): Promise<File[]> {
  const CONCURRENCY = 3;
  const results: File[] = [];

  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const chunk = files.slice(i, i + CONCURRENCY);
    const compressed = await Promise.all(chunk.map(compressJobPhoto));
    results.push(...compressed);
  }

  return results;
}
