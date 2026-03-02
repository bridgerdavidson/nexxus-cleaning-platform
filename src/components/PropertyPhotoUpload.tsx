'use client';

import React, { useRef, useState, useCallback } from 'react';
import { Home, Camera, Loader2, AlertCircle, X } from 'lucide-react';
import { validateJobPhotoFile } from '../lib/upload';
import { compressJobPhoto } from '../lib/compress-image';
import { useAuth } from '../hooks/useAuth';

interface PropertyPhotoUploadProps {
  propertyId: string | null;
  currentPhotoUrl?: string | null;
  onUploadSuccess: (url: string) => void;
  disabled?: boolean;
}

export default function PropertyPhotoUpload({
  propertyId,
  currentPhotoUrl,
  onUploadSuccess,
  disabled = false,
}: PropertyPhotoUploadProps) {
  const { session } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);

  const [preview, setPreview] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = '';

      const validation = validateJobPhotoFile(file);
      if (!validation.valid) {
        setError(validation.error ?? 'Invalid file.');
        return;
      }

      setError(null);
      setPendingFile(file);
      setPreview(URL.createObjectURL(file));
    },
    []
  );

  const handleUpload = useCallback(async () => {
    if (!pendingFile || !propertyId) return;
    if (!session?.access_token) {
      setError('You must be logged in to upload a photo.');
      return;
    }

    setError(null);
    setCompressing(true);
    let fileToUpload: File;
    try {
      fileToUpload = await compressJobPhoto(pendingFile);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Compression failed. Please try a different image.');
      setCompressing(false);
      return;
    } finally {
      setCompressing(false);
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', fileToUpload);

      const response = await fetch(`/api/properties/${propertyId}/upload-photo`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        setError(result.error ?? 'Upload failed. Please try again.');
        return;
      }

      if (preview) URL.revokeObjectURL(preview);
      setPreview(null);
      setPendingFile(null);
      onUploadSuccess(result.url);
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setUploading(false);
    }
  }, [pendingFile, propertyId, session?.access_token, preview, onUploadSuccess]);

  const handleCancel = useCallback(() => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setPendingFile(null);
    setError(null);
  }, [preview]);

  const displayUrl = preview ?? currentPhotoUrl ?? null;
  const isWorking = uploading || compressing;

  if (propertyId == null) {
    return (
      <p className="text-sm text-gray-500 italic">
        Save the property first to add a photo.
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative">
        <div className="w-28 h-28 rounded-full overflow-hidden bg-gray-100 flex items-center justify-center ring-2 ring-gray-200">
          {displayUrl ? (
            <img
              src={displayUrl}
              alt="Property"
              className="w-full h-full object-cover"
            />
          ) : (
            <Home className="w-12 h-12 text-primary-600" />
          )}
        </div>

        {!disabled && !pendingFile && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={isWorking}
            className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-primary-600 text-white flex items-center justify-center shadow hover:bg-primary-700 transition-colors disabled:opacity-50"
            aria-label="Upload property photo"
          >
            <Camera className="w-4 h-4" />
          </button>
        )}

        {pendingFile && !isWorking && (
          <button
            type="button"
            onClick={handleCancel}
            className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-gray-500 text-white flex items-center justify-center shadow hover:bg-gray-600"
            aria-label="Cancel"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp"
        onChange={handleFileChange}
        className="hidden"
        aria-hidden
      />

      {pendingFile && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleUpload}
            disabled={isWorking}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-60"
          >
            {compressing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Compressing…
              </>
            ) : uploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Uploading…
              </>
            ) : (
              'Save Photo'
            )}
          </button>
          {!isWorking && (
            <button
              type="button"
              onClick={handleCancel}
              className="px-4 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg"
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {!pendingFile && !isWorking && !disabled && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="text-sm text-primary-600 hover:text-primary-700 font-medium"
        >
          {currentPhotoUrl ? 'Change photo' : 'Upload photo'}
        </button>
      )}

      {error && (
        <div className="flex items-center gap-1.5 text-red-600 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
