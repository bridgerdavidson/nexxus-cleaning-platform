'use client';

import React, { useRef, useState, useCallback } from 'react';
import { Camera, Upload, Loader2, AlertCircle, X, ImageIcon } from 'lucide-react';
import { validateJobPhotoBatch, validateJobPhotoFile } from '../lib/upload';
import { compressJobPhotoBatch } from '../lib/compress-image';
import { JobPhoto } from '../hooks/useCleanerData';
import { useAuth } from '../hooks/useAuth';

interface JobPhotoSectionProps {
  appointmentId: string;
  photoType: 'before' | 'after';
  photos: JobPhoto[];
  onPhotosChange: () => void;
}

interface UploadedResult {
  id: string;
  url: string;
  photo_type: string;
}

interface UploadErrorItem {
  fileIndex: number;
  fileName: string;
  message: string;
}

export default function JobPhotoSection({
  appointmentId,
  photoType,
  photos,
  onPhotosChange,
}: JobPhotoSectionProps) {
  const { session } = useAuth();

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const [uploading, setUploading] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partialErrors, setPartialErrors] = useState<UploadErrorItem[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const label = photoType === 'before' ? 'Before' : 'After';

  // ─── Upload core ─────────────────────────────────────────────────────────────
  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (!session?.access_token) {
        setError('You must be logged in to upload photos.');
        return;
      }

      setError(null);
      setPartialErrors([]);

      // Client-side batch validation (type, size, count)
      const batchValidation = validateJobPhotoBatch(files);
      if (!batchValidation.valid) {
        setError(batchValidation.error ?? 'Invalid files.');
        return;
      }

      // Compress all files before upload
      setCompressing(true);
      let compressed: File[];
      try {
        compressed = await compressJobPhotoBatch(files);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Compression failed.');
        setCompressing(false);
        return;
      } finally {
        setCompressing(false);
      }

      // Build FormData with all files in one request
      setUploading(true);
      try {
        const formData = new FormData();
        formData.append('photoType', photoType);
        for (const file of compressed) {
          formData.append('files', file);
        }

        const response = await fetch(`/api/jobs/${appointmentId}/photos`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}` },
          body: formData,
        });

        const result = await response.json() as {
          uploaded?: UploadedResult[];
          errors?: UploadErrorItem[];
          error?: string;
        };

        if (!response.ok) {
          setError(result.error ?? 'Upload failed. Please try again.');
          return;
        }

        if (result.errors && result.errors.length > 0) {
          setPartialErrors(result.errors);
        }

        if (result.uploaded && result.uploaded.length > 0) {
          onPhotosChange();
        }
      } catch {
        setError('An unexpected error occurred. Please try again.');
      } finally {
        setUploading(false);
      }
    },
    [session, appointmentId, photoType, onPhotosChange]
  );

  // ─── Camera handler ───────────────────────────────────────────────────────
  const handleCameraChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = ''; // allow re-capture
      if (!file) return;

      const validation = validateJobPhotoFile(file);
      if (!validation.valid) {
        setError(validation.error ?? 'Invalid file.');
        return;
      }

      await uploadFiles([file]);
    },
    [uploadFiles]
  );

  // ─── Batch upload handler ─────────────────────────────────────────────────
  const handleUploadChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = ''; // allow re-select of same files
      if (files.length === 0) return;
      await uploadFiles(files);
    },
    [uploadFiles]
  );

  // ─── Delete handler ───────────────────────────────────────────────────────
  const handleDelete = useCallback(
    async (photoId: string) => {
      if (!session?.access_token) return;
      setDeletingId(photoId);
      try {
        const response = await fetch(`/api/jobs/${appointmentId}/photos`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ photoId }),
        });
        if (response.ok) {
          onPhotosChange();
        } else {
          const result = await response.json() as { error?: string };
          setError(result.error ?? 'Failed to delete photo.');
        }
      } catch {
        setError('Failed to delete photo.');
      } finally {
        setDeletingId(null);
      }
    },
    [session, appointmentId, onPhotosChange]
  );

  const isWorking = compressing || uploading;

  return (
    <div className="space-y-4">
      {/* Action buttons */}
      <div className="flex gap-3 flex-wrap">
        {/* Take photo (camera) */}
        <button
          type="button"
          disabled={isWorking}
          onClick={() => cameraInputRef.current?.click()}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isWorking ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Camera className="w-4 h-4" />
          )}
          Take Photo
        </button>

        {/* Upload batch */}
        <button
          type="button"
          disabled={isWorking}
          onClick={() => uploadInputRef.current?.click()}
          className="flex items-center gap-2 px-4 py-2.5 bg-white text-gray-700 font-medium rounded-lg border-2 border-gray-300 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isWorking ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Upload className="w-4 h-4" />
          )}
          Upload Photos
        </button>
      </div>

      {/* Status message while compressing/uploading */}
      {compressing && (
        <p className="text-sm text-gray-500 flex items-center gap-1.5">
          <Loader2 className="w-4 h-4 animate-spin" />
          Compressing photos for upload…
        </p>
      )}
      {uploading && !compressing && (
        <p className="text-sm text-gray-500 flex items-center gap-1.5">
          <Loader2 className="w-4 h-4 animate-spin" />
          Uploading…
        </p>
      )}

      {/* Error message */}
      {error && (
        <div className="flex items-start gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg p-3">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Partial upload errors */}
      {partialErrors.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 space-y-1">
          <p className="text-sm font-medium text-yellow-800">
            {partialErrors.length} file{partialErrors.length > 1 ? 's' : ''} failed to upload:
          </p>
          <ul className="text-sm text-yellow-700 list-disc list-inside">
            {partialErrors.map((e) => (
              <li key={e.fileIndex}>{e.message}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Photo grid */}
      {photos.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {photos.map((photo) => (
            <div key={photo.id} className="relative group aspect-square rounded-lg overflow-hidden bg-gray-100">
              <img
                src={photo.photo_url}
                alt={`${label} photo`}
                className="w-full h-full object-cover"
              />
              {/* Delete overlay */}
              <button
                type="button"
                disabled={deletingId === photo.id}
                onClick={() => handleDelete(photo.id)}
                className="absolute top-1.5 right-1.5 w-6 h-6 bg-red-600 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-700 disabled:opacity-50"
                aria-label="Delete photo"
              >
                {deletingId === photo.id ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <X className="w-3 h-3" />
                )}
              </button>
            </div>
          ))}
        </div>
      ) : (
        /* Empty state drop zone */
        <div
          className="border-2 border-dashed border-gray-300 rounded-lg p-10 text-center cursor-pointer hover:border-primary-400 transition-colors"
          onClick={() => uploadInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && uploadInputRef.current?.click()}
          aria-label={`Upload ${label.toLowerCase()} photos`}
        >
          <ImageIcon className="w-10 h-10 text-gray-400 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-600 mb-1">
            No {label.toLowerCase()} photos yet
          </p>
          <p className="text-xs text-gray-400">
            Tap "Take Photo" or "Upload Photos" — up to 10 per batch, JPEG/PNG/WebP, max 10 MB each
          </p>
        </div>
      )}

      {/* Hidden file inputs */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleCameraChange}
        className="hidden"
        aria-hidden
      />
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp"
        multiple
        onChange={handleUploadChange}
        className="hidden"
        aria-hidden
      />
    </div>
  );
}
