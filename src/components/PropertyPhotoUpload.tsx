"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { Home, Camera, Loader2, AlertCircle, X } from "lucide-react";
import {
  validateImageFile,
  PROPERTY_PHOTOS_ALLOWED_TYPES,
  PROPERTY_PHOTOS_MAX_FILE_SIZE,
  IMAGE_ACCEPT_ATTR,
} from "../lib/upload";
import { useImageUpload } from "../hooks/useImageUpload";

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
  const inputRef = useRef<HTMLInputElement>(null);

  const [preview, setPreview] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { items, start, reset, isWorking } = useImageUpload({
    context: {
      kind: "property",
      ctx: { propertyId: propertyId ?? "", currentPhotoUrl },
    },
    onComplete: ({ uploaded, failed }) => {
      if (uploaded[0]) {
        if (preview) URL.revokeObjectURL(preview);
        setPreview(null);
        setPendingFile(null);
        onUploadSuccess(uploaded[0].url);
        reset();
      } else if (failed[0]) {
        setError(failed[0].message);
      }
    },
  });

  const inFlight = items[0];
  const converting = inFlight?.status === "converting";
  const compressing = inFlight?.status === "compressing";
  const uploading = inFlight?.status === "uploading";

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = "";

      const validation = validateImageFile(
        file,
        PROPERTY_PHOTOS_ALLOWED_TYPES,
        PROPERTY_PHOTOS_MAX_FILE_SIZE,
      );
      if (!validation.valid) {
        setError(validation.error ?? "Invalid file.");
        return;
      }

      setError(null);
      setPendingFile(file);
      setPreview(URL.createObjectURL(file));
    },
    [],
  );

  const handleUpload = useCallback(() => {
    if (!pendingFile || !propertyId) return;
    setError(null);
    start([pendingFile]);
  }, [pendingFile, propertyId, start]);

  const handleCancel = useCallback(() => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setPendingFile(null);
    setError(null);
    reset();
  }, [preview, reset]);

  const displayUrl = preview ?? currentPhotoUrl ?? null;

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
        accept={IMAGE_ACCEPT_ATTR}
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
            {converting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Converting…
              </>
            ) : compressing ? (
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
              "Save Photo"
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
          {currentPhotoUrl ? "Change photo" : "Upload photo"}
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
