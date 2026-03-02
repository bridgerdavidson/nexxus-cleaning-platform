import { supabase } from './supabase';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_FILE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

// Avatar-specific constants (shared between client components and the server API route)
export const AVATAR_BUCKET = 'avatars';
export const AVATAR_MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
export const AVATAR_ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

// Job photo constants (shared between client components and the server API route)
export const JOB_PHOTOS_BUCKET = 'job-photos';
export const JOB_PHOTOS_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB (pre-compression originals)
export const JOB_PHOTOS_ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
export const JOB_PHOTOS_MAX_BATCH_SIZE = 10;

export interface JobPhotoValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates a single job photo file (type and size)
 */
export function validateJobPhotoFile(file: File): JobPhotoValidationResult {
  if (!JOB_PHOTOS_ALLOWED_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: `"${file.name}" is not an accepted file type. Accepted: JPEG, PNG, WebP.`
    };
  }

  if (file.size > JOB_PHOTOS_MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `"${file.name}" exceeds the 10 MB size limit (${(file.size / 1024 / 1024).toFixed(1)} MB).`
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

export interface UploadResult {
  success: boolean;
  url?: string;
  error?: string;
}

/**
 * Validates file type and size
 */
export function validateFile(file: File): { valid: boolean; error?: string } {
  if (!ALLOWED_FILE_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: `File type not allowed. Allowed types: ${ALLOWED_FILE_TYPES.join(', ')}`
    };
  }

  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`
    };
  }

  return { valid: true };
}

/**
 * Uploads an image file to Supabase Storage
 */
export async function uploadImage(file: File, bucket: string = 'message-attachments'): Promise<UploadResult> {
  try {
    // Validate file
    const validation = validateFile(file);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error
      };
    }

    // Generate unique filename
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
    const filePath = `${fileName}`;

    // Upload file
    const { error: uploadError, data } = await supabase.storage
      .from(bucket)
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return {
        success: false,
        error: uploadError.message
      };
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from(bucket)
      .getPublicUrl(filePath);

    return {
      success: true,
      url: publicUrl
    };
  } catch (error) {
    console.error('Upload error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

/**
 * Uploads multiple image files
 */
export async function uploadImages(files: File[], bucket: string = 'message-attachments'): Promise<UploadResult[]> {
  const uploadPromises = files.map(file => uploadImage(file, bucket));
  return Promise.all(uploadPromises);
}

/**
 * Deletes an image from Supabase Storage
 */
export async function deleteImage(fileUrl: string, bucket: string = 'message-attachments'): Promise<{ success: boolean; error?: string }> {
  try {
    // Extract filename from URL
    const urlParts = fileUrl.split('/');
    const fileName = urlParts[urlParts.length - 1];

    const { error } = await supabase.storage
      .from(bucket)
      .remove([fileName]);

    if (error) {
      console.error('Delete error:', error);
      return {
        success: false,
        error: error.message
      };
    }

    return { success: true };
  } catch (error) {
    console.error('Delete error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

/**
 * Gets file information from a File object
 */
export function getFileInfo(file: File) {
  return {
    name: file.name,
    size: file.size,
    type: file.type,
    lastModified: file.lastModified
  };
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

