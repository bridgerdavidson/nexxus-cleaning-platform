// MIME types we accept across the app. HEIC/HEIF are accepted client-side and
// converted to JPEG via lib/heic-convert before compression.
const IMAGE_MIME_BASE: string[] = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const HEIC_EXT_FALLBACK = /\.(heic|heif)$/i;

/** True if a file should be accepted by our pipeline (covers Safari's empty `file.type` for HEIC). */
function isAcceptedImage(file: File, allowed: readonly string[]): boolean {
  if (allowed.includes(file.type)) return true;
  if (!file.type && HEIC_EXT_FALLBACK.test(file.name)) return true;
  return false;
}

/** HTML `accept=` value covering all image kinds the pipeline understands (incl. HEIC). */
export const IMAGE_ACCEPT_ATTR = 'image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif,.heic,.heif';

// Avatar-specific constants (shared between client components and the server API route)
export const AVATAR_BUCKET = 'avatars';
export const AVATAR_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB (pre-compression originals; HEIC files can be large)
export const AVATAR_ALLOWED_TYPES: string[] = [...IMAGE_MIME_BASE];

// Job photo constants (shared between client components and the server API route)
export const JOB_PHOTOS_BUCKET = 'job-photos';
export const JOB_PHOTOS_MAX_FILE_SIZE = 15 * 1024 * 1024; // 15 MB pre-compression (HEIC originals can run 8-12 MB)
export const JOB_PHOTOS_ALLOWED_TYPES: string[] = [...IMAGE_MIME_BASE];
export const JOB_PHOTOS_MAX_BATCH_SIZE = 10;

// Property photo constants
export const PROPERTY_PHOTOS_BUCKET = 'property-photos';
export const PROPERTY_PHOTOS_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
export const PROPERTY_PHOTOS_ALLOWED_TYPES: string[] = [...IMAGE_MIME_BASE];

// Message attachment constants
export const MESSAGE_ATTACHMENTS_BUCKET = 'message-attachments';
export const MESSAGE_ATTACHMENTS_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
export const MESSAGE_ATTACHMENTS_ALLOWED_TYPES: string[] = [...IMAGE_MIME_BASE];
export const MESSAGE_ATTACHMENTS_MAX_BATCH_SIZE = 5;

export interface JobPhotoValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates a single job photo file (type and size). Accepts HEIC/HEIF —
 * client converts to JPEG before upload.
 */
export function validateJobPhotoFile(file: File): JobPhotoValidationResult {
  if (!isAcceptedImage(file, JOB_PHOTOS_ALLOWED_TYPES)) {
    return {
      valid: false,
      error: `"${file.name}" is not an accepted file type. Accepted: JPEG, PNG, WebP, HEIC.`
    };
  }

  if (file.size > JOB_PHOTOS_MAX_FILE_SIZE) {
    const limitMb = (JOB_PHOTOS_MAX_FILE_SIZE / 1024 / 1024).toFixed(0);
    return {
      valid: false,
      error: `"${file.name}" exceeds the ${limitMb} MB size limit (${(file.size / 1024 / 1024).toFixed(1)} MB).`
    };
  }

  return { valid: true };
}

/** Validates a single file against a custom (kind-specific) allowed-types list and size cap. */
export function validateImageFile(
  file: File,
  allowedTypes: readonly string[],
  maxSize: number,
): JobPhotoValidationResult {
  if (!isAcceptedImage(file, allowedTypes)) {
    return {
      valid: false,
      error: `"${file.name}" is not an accepted file type.`,
    };
  }
  if (file.size > maxSize) {
    const limitMb = (maxSize / 1024 / 1024).toFixed(0);
    return {
      valid: false,
      error: `"${file.name}" exceeds the ${limitMb} MB size limit (${(file.size / 1024 / 1024).toFixed(1)} MB).`,
    };
  }
  return { valid: true };
}

/**
 * Validates a batch of job photo files (count and per-file checks)
 */
export function validateJobPhotoBatch(files: File[]): JobPhotoValidationResult {
  if (files.length === 0) {
    return { valid: false, error: 'No files selected.' };
  }

  if (files.length > JOB_PHOTOS_MAX_BATCH_SIZE) {
    return {
      valid: false,
      error: `Maximum ${JOB_PHOTOS_MAX_BATCH_SIZE} photos per upload. You selected ${files.length}.`
    };
  }

  for (const file of files) {
    const result = validateJobPhotoFile(file);
    if (!result.valid) return result;
  }

  return { valid: true };
}

/**
 * Creates a preview URL for an image file
 */
export function createPreviewUrl(file: File): string {
  return URL.createObjectURL(file);
}

/**
 * Revokes a preview URL to free memory
 */
export function revokePreviewUrl(url: string): void {
  URL.revokeObjectURL(url);
}

/**
 * Gets file information from a File object
 */
export function getFileInfo(file: File) {
  return {
    name: file.name,
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
  };
}

