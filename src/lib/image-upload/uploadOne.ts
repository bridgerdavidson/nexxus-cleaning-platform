import { supabase } from '../supabase';
import { compressImage } from '../compress-image';
import { isHeic, heicToJpeg } from '../heic-convert';
import { uuidv4 } from '../uuid';
import {
  AVATAR_BUCKET,
  JOB_PHOTOS_BUCKET,
} from '../upload';
import type { UploadContext, UploadStatus } from './types';

export const PROPERTY_PHOTOS_BUCKET = 'property-photos';
export const MESSAGE_ATTACHMENTS_BUCKET = 'message-attachments';

const BUCKET_BY_KIND: Record<UploadContext['kind'], string> = {
  avatar: AVATAR_BUCKET,
  'job-photo': JOB_PHOTOS_BUCKET,
  property: PROPERTY_PHOTOS_BUCKET,
  message: MESSAGE_ATTACHMENTS_BUCKET,
};

function bucketOf(kind: UploadContext['kind']): string {
  return BUCKET_BY_KIND[kind];
}

function storagePath(ctx: UploadContext, uuid: string): string {
  switch (ctx.kind) {
    case 'avatar':
      return `users/${ctx.ctx.userId}/avatar/${uuid}.jpg`;
    case 'job-photo':
      return `appointments/${ctx.ctx.appointmentId}/${ctx.ctx.photoType}/${uuid}.jpg`;
    case 'property':
      return `properties/${ctx.ctx.propertyId}/${uuid}.jpg`;
    case 'message':
      return `${ctx.ctx.conversationId}/${uuid}.jpg`;
  }
}

/**
 * Extracts the storage object path from a Supabase public URL for the given bucket.
 * Returns null if the URL doesn't match the expected shape.
 */
export function pathFromPublicUrl(url: string, bucket: string): string | null {
  const marker = `/object/public/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length);
}

export interface UploadOneResult {
  url: string;
  rowId?: string;
  fileSize: number;
  fileType: string;
}

export interface UploadOneOptions {
  onStatusChange?: (status: UploadStatus) => void;
}

export interface UploadFileToStorageResult {
  url: string;
  path: string;
  bucket: string;
  fileSize: number;
  fileType: string;
}

/**
 * Storage-only piece of the pipeline: HEIC convert → compress → upload to
 * Supabase Storage. Returns the public URL and storage path so the caller can
 * defer or batch the DB write step. Used by flows that need to insert a
 * parent row (e.g. `messages`) before the dependent rows (e.g.
 * `message_attachments`) can FK to it.
 */
export async function uploadFileToStorage(
  file: File,
  context: UploadContext,
  options: UploadOneOptions = {},
): Promise<UploadFileToStorageResult> {
  const { onStatusChange } = options;
  const bucket = bucketOf(context.kind);

  let working = file;
  if (isHeic(file)) {
    onStatusChange?.('converting');
    working = await heicToJpeg(file);
  }

  onStatusChange?.('compressing');
  const compressed = await compressImage(working);

  onStatusChange?.('uploading');
  const uuid = uuidv4();
  const path = storagePath(context, uuid);

  const { error: storageError } = await supabase.storage
    .from(bucket)
    .upload(path, compressed, {
      contentType: 'image/jpeg',
      cacheControl: '31536000',
      upsert: false,
    });

  if (storageError) {
    throw new Error(`Upload failed: ${storageError.message}`);
  }

  const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(path);

  return {
    url: publicUrl,
    path,
    bucket,
    fileSize: compressed.size,
    fileType: compressed.type,
  };
}

/**
 * Per-file upload pipeline: HEIC convert (if needed) → compress → upload to
 * Supabase Storage → write DB row → cleanup-on-failure.
 *
 * Relies on bucket RLS for authorization — caller must be signed in.
 * Throws a user-friendly error on failure (or rethrows compression's friendly error).
 */
export async function uploadOne(
  file: File,
  context: UploadContext,
  options: UploadOneOptions = {},
): Promise<UploadOneResult> {
  const storage = await uploadFileToStorage(file, context, options);

  try {
    const rowId = await writeDbRow(context, storage.url, file, storage.fileSize, storage.fileType);
    await deleteReplacedFile(context, storage.url);
    return {
      url: storage.url,
      rowId,
      fileSize: storage.fileSize,
      fileType: storage.fileType,
    };
  } catch (err) {
    // Best-effort cleanup of the just-uploaded object so we don't leak storage.
    await supabase.storage.from(storage.bucket).remove([storage.path]).catch(() => {});
    throw err;
  }
}

/**
 * Per-kind DB write. Returns the new row id if applicable.
 * For avatar/property the DB write is an UPDATE on a single column; we return undefined.
 */
async function writeDbRow(
  context: UploadContext,
  publicUrl: string,
  _file: File,
  fileSize: number,
  fileType: string,
): Promise<string | undefined> {
  switch (context.kind) {
    case 'avatar': {
      const { error } = await supabase
        .from('user_profiles')
        .update({ avatar_url: publicUrl, updated_at: new Date().toISOString() })
        .eq('id', context.ctx.userId);
      if (error) throw new Error(`Database error after upload: ${error.message}`);
      return undefined;
    }
    case 'property': {
      const { error } = await supabase
        .from('properties')
        .update({ photo_url: publicUrl, updated_at: new Date().toISOString() })
        .eq('id', context.ctx.propertyId);
      if (error) throw new Error(`Database error after upload: ${error.message}`);
      return undefined;
    }
    case 'job-photo': {
      const { data, error } = await supabase
        .from('job_photos')
        .insert({
          appointment_id: context.ctx.appointmentId,
          photo_url: publicUrl,
          photo_type: context.ctx.photoType,
        })
        .select('id')
        .single();
      if (error) throw new Error(`Database error after upload: ${error.message}`);
      return data.id as string;
    }
    case 'message': {
      const { data, error } = await supabase
        .from('message_attachments')
        .insert({
          message_id: context.ctx.messageId,
          file_url: publicUrl,
          file_type: fileType,
          file_size: fileSize,
        })
        .select('id')
        .single();
      if (error) throw new Error(`Database error after upload: ${error.message}`);
      return data.id as string;
    }
  }
}

/**
 * For avatar/property uploads the caller passes the URL of the file being replaced.
 * Delete it best-effort once the new row is in place.
 */
async function deleteReplacedFile(context: UploadContext, newUrl: string): Promise<void> {
  let oldUrl: string | null | undefined;
  let bucket: string | undefined;

  if (context.kind === 'avatar') {
    oldUrl = context.ctx.currentAvatarUrl;
    bucket = AVATAR_BUCKET;
  } else if (context.kind === 'property') {
    oldUrl = context.ctx.currentPhotoUrl;
    bucket = PROPERTY_PHOTOS_BUCKET;
  } else {
    return;
  }

  if (!oldUrl || oldUrl === newUrl) return;

  const oldPath = pathFromPublicUrl(oldUrl, bucket);
  if (!oldPath) return;

  await supabase.storage.from(bucket).remove([oldPath]).catch(() => {});
}

/**
 * Classifies an upload error as transient (worth one auto-retry) vs. permanent.
 * Network failures and 5xx storage errors are transient; RLS and validation are not.
 */
export function isTransientError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (msg.includes('failed to fetch')) return true;   // Chrome / Firefox
  // Safari (incl. iOS) words a failed fetch "Load failed". The \b matters: this
  // module prefixes every storage error with "Upload failed: ", which contains
  // "load failed" as a substring. Without the boundary an RLS denial would be
  // classified transient and retried.
  if (/\bload failed\b/.test(msg)) return true;
  if (msg.includes('connection was lost')) return true; // Safari, backgrounded tab
  if (msg.includes('network')) return true;
  if (msg.includes('timeout')) return true;
  if (/\b5\d\d\b/.test(msg)) return true;
  return false;
}
