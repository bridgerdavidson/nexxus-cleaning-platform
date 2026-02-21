'use client';

import React, { useRef, useState, useCallback } from 'react';
import { User, Camera, Loader2, AlertCircle, X } from 'lucide-react';
import { AVATAR_MAX_FILE_SIZE, AVATAR_ALLOWED_TYPES } from '../lib/upload';
import { useAuth } from '../hooks/useAuth';

interface AvatarUploadProps {
  currentAvatarUrl?: string;
  onUploadSuccess: (url: string) => void;
  size?: 'sm' | 'md' | 'lg';
}

const sizeClasses = {
  sm: { wrapper: 'w-16 h-16', icon: 'w-8 h-8', badge: 'w-5 h-5 text-[10px]' },
  md: { wrapper: 'w-24 h-24', icon: 'w-12 h-12', badge: 'w-7 h-7 text-xs' },
  lg: { wrapper: 'w-32 h-32', icon: 'w-16 h-16', badge: 'w-8 h-8 text-sm' },
};

export default function AvatarUpload({
  currentAvatarUrl,
  onUploadSuccess,
  size = 'lg',
}: AvatarUploadProps) {
  const { session } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);

  const [preview, setPreview] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const classes = sizeClasses[size];

  const validateFile = useCallback((file: File): string | null => {
    if (!AVATAR_ALLOWED_TYPES.includes(file.type)) {
      return `File type not allowed. Accepted: JPEG, PNG, WebP.`;
    }
    if (file.size > AVATAR_MAX_FILE_SIZE) {
      return `File exceeds 5 MB limit (${(file.size / 1024 / 1024).toFixed(1)} MB).`;
    }
    return null;
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Reset input so the same file can be re-selected after cancellation
      e.target.value = '';

      const validationError = validateFile(file);
      if (validationError) {
        setError(validationError);
        return;
      }

      setError(null);
      setPendingFile(file);
      setPreview(URL.createObjectURL(file));
    },
    [validateFile]
  );

  const handleUpload = useCallback(async () => {
    if (!pendingFile) return;
    if (!session?.access_token) {
      setError('You must be logged in to upload an avatar.');
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', pendingFile);

      const response = await fetch('/api/user/upload-avatar', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        setError(result.error ?? 'Upload failed. Please try again.');
        return;
      }

      // Revoke the local object URL to free memory
      if (preview) URL.revokeObjectURL(preview);
      setPreview(null);
      setPendingFile(null);
      onUploadSuccess(result.url);
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setUploading(false);
    }
  }, [pendingFile, session, preview, onUploadSuccess]);

  const handleCancel = useCallback(() => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setPendingFile(null);
    setError(null);
  }, [preview]);

  const displayUrl = preview ?? currentAvatarUrl;

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Avatar circle */}
      <div className="relative group">
        <div
          className={`${classes.wrapper} rounded-full overflow-hidden bg-primary-100 flex items-center justify-center ring-4 ring-white shadow-md`}
        >
          {displayUrl ? (
            <img
              src={displayUrl}
              alt="Profile avatar"
              className="w-full h-full object-cover"
            />
          ) : (
            <User className={`${classes.icon} text-primary-600`} />
          )}
        </div>

        {/* Camera badge — triggers file picker */}
        {!pendingFile && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className={`absolute bottom-0 right-0 ${classes.badge} rounded-full bg-primary-600 text-white flex items-center justify-center shadow hover:bg-primary-700 transition-colors disabled:opacity-50`}
            aria-label="Change profile picture"
          >
            <Camera className="w-3 h-3" />
          </button>
        )}

        {/* Cancel preview badge */}
        {pendingFile && !uploading && (
          <button
            type="button"
            onClick={handleCancel}
            className={`absolute bottom-0 right-0 ${classes.badge} rounded-full bg-gray-500 text-white flex items-center justify-center shadow hover:bg-gray-600 transition-colors`}
            aria-label="Cancel"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept={AVATAR_ALLOWED_TYPES.join(',')}
        onChange={handleFileChange}
        className="hidden"
        aria-hidden
      />

      {/* Action buttons shown when a file is pending */}
      {pendingFile && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleUpload}
            disabled={uploading}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-60 transition-colors"
          >
            {uploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Uploading…
              </>
            ) : (
              'Save Photo'
            )}
          </button>
          {!uploading && (
            <button
              type="button"
              onClick={handleCancel}
              className="px-4 py-1.5 text-sm font-medium text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {/* Change photo link when idle */}
      {!pendingFile && !uploading && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="text-sm text-primary-600 hover:text-primary-700 font-medium transition-colors"
        >
          {currentAvatarUrl ? 'Change photo' : 'Upload photo'}
        </button>
      )}

      {/* Error message */}
      {error && (
        <div className="flex items-center gap-1.5 text-red-600 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
