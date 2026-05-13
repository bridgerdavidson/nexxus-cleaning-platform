"use client";

import React, { useRef, useState, useCallback, useMemo, useEffect } from "react";
import {
  Camera,
  Upload,
  Loader2,
  AlertCircle,
  X,
  ImageIcon,
  RefreshCw,
} from "lucide-react";
import {
  validateJobPhotoBatch,
  validateJobPhotoFile,
  IMAGE_ACCEPT_ATTR,
  createPreviewUrl,
  revokePreviewUrl,
} from "../lib/upload";
import { useImageUpload } from "../hooks/useImageUpload";
import type { UploadItem } from "../lib/image-upload/types";
import { JobPhoto } from "../hooks/useCleanerData";
import { supabase } from "../lib/supabase";
import { pathFromPublicUrl } from "../lib/image-upload/uploadOne";

interface JobPhotoSectionProps {
  appointmentId: string;
  photoType: "before" | "after";
  photos: JobPhoto[];
  onPhotosChange: () => void;
  /** Reports upload activity (compress/upload in flight) so the parent can
   *  block navigation while photos are still being processed. */
  onUploadingChange?: (uploading: boolean) => void;
}

export default function JobPhotoSection({
  appointmentId,
  photoType,
  photos,
  onPhotosChange,
  onUploadingChange,
}: JobPhotoSectionProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const [validationError, setValidationError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const label = photoType === "before" ? "Before" : "After";

  const { items, start, retryFailed, reset, isWorking } = useImageUpload({
    context: { kind: "job-photo", ctx: { appointmentId, photoType } },
  });

  const failedCount = useMemo(
    () => items.filter((it) => it.status === "failed").length,
    [items],
  );

  // Items that should still appear in the progress strip. Once a file reaches
  // `done` the photo grid below renders its thumbnail, so we drop the row to
  // avoid duplicating the visual.
  const visibleItems = useMemo(
    () => items.filter((it) => it.status !== "done"),
    [items],
  );

  useEffect(() => {
    onUploadingChange?.(isWorking);
  }, [isWorking, onUploadingChange]);

  // Refetch the grid as soon as each item completes (not just at batch end) so
  // the new thumbnail replaces the removed progress row without a visual gap.
  const reportedDoneRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    let hasNewlyDone = false;
    for (const it of items) {
      if (it.status === "done" && !reportedDoneRef.current.has(it.id)) {
        reportedDoneRef.current.add(it.id);
        hasNewlyDone = true;
      }
    }
    if (hasNewlyDone) onPhotosChange();
  }, [items, onPhotosChange]);

  const handleCameraChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;

      setValidationError(null);
      const validation = validateJobPhotoFile(file);
      if (!validation.valid) {
        setValidationError(validation.error ?? "Invalid file.");
        return;
      }
      start([file]);
    },
    [start],
  );

  const handleUploadChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = "";
      if (files.length === 0) return;

      setValidationError(null);
      const validation = validateJobPhotoBatch(files);
      if (!validation.valid) {
        setValidationError(validation.error ?? "Invalid files.");
        return;
      }
      start(files);
    },
    [start],
  );

  const handleDelete = useCallback(
    async (photo: JobPhoto) => {
      setDeletingId(photo.id);
      setDeleteError(null);
      try {
        const storagePath = pathFromPublicUrl(photo.photo_url, "job-photos");
        if (storagePath) {
          await supabase.storage.from("job-photos").remove([storagePath]);
        }
        const { error } = await supabase.from("job_photos").delete().eq("id", photo.id);
        if (error) {
          setDeleteError(error.message);
          return;
        }
        onPhotosChange();
      } catch (err) {
        setDeleteError(err instanceof Error ? err.message : "Failed to delete photo.");
      } finally {
        setDeletingId(null);
      }
    },
    [onPhotosChange],
  );

  const handleClearFinished = useCallback(() => {
    if (isWorking) return;
    reset();
    setValidationError(null);
  }, [isWorking, reset]);

  return (
    <div className="space-y-4">
      {/* Action buttons */}
      <div className="flex gap-3 flex-wrap">
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

        {!isWorking && visibleItems.length > 0 && (
          <button
            type="button"
            onClick={handleClearFinished}
            className="flex items-center gap-2 px-3 py-2.5 text-gray-500 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Validation error (pre-upload) */}
      {validationError && (
        <div className="flex items-start gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg p-3">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{validationError}</span>
        </div>
      )}

      {/* Delete error */}
      {deleteError && (
        <div className="flex items-start gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg p-3">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{deleteError}</span>
        </div>
      )}

      {/* Per-file progress (done items disappear; the grid below renders them) */}
      {visibleItems.length > 0 && (
        <div className="space-y-2">
          {visibleItems.map((item) => (
            <UploadProgressRow key={item.id} item={item} />
          ))}

          {failedCount > 0 && (
            <button
              type="button"
              onClick={retryFailed}
              className="mt-2 flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700"
            >
              <RefreshCw className="w-4 h-4" />
              Retry {failedCount} failed
            </button>
          )}
        </div>
      )}

      {/* Photo grid */}
      {photos.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {photos.map((photo) => (
            <div
              key={photo.id}
              className="relative group aspect-square rounded-lg overflow-hidden bg-gray-100"
            >
              <img
                src={photo.photo_url}
                alt={`${label} photo`}
                className="w-full h-full object-cover"
              />
              <button
                type="button"
                disabled={deletingId === photo.id}
                onClick={() => handleDelete(photo)}
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
        visibleItems.length === 0 && (
          <div
            className="border-2 border-dashed border-gray-300 rounded-lg p-10 text-center cursor-pointer hover:border-primary-400 transition-colors"
            onClick={() => uploadInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && uploadInputRef.current?.click()}
            aria-label={`Upload ${label.toLowerCase()} photos`}
          >
            <ImageIcon className="w-10 h-10 text-gray-400 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-600 mb-1">
              No {label.toLowerCase()} photos yet
            </p>
            <p className="text-xs text-gray-400">
              Tap "Take Photo" or "Upload Photos" — up to 10 per batch
            </p>
          </div>
        )
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
        accept={IMAGE_ACCEPT_ATTR}
        multiple
        onChange={handleUploadChange}
        className="hidden"
        aria-hidden
      />
    </div>
  );
}

function UploadProgressRow({ item }: { item: UploadItem }) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  React.useEffect(() => {
    const url = createPreviewUrl(item.file);
    setThumbUrl(url);
    return () => revokePreviewUrl(url);
  }, [item.file]);

  // `done` items are filtered out before this row renders — the photo grid
  // shows the finished thumbnail. So this row only ever renders an in-progress
  // or failed state.
  const statusText: Record<typeof item.status, string> = {
    queued: "Queued",
    converting: "Converting HEIC…",
    compressing: "Compressing…",
    uploading: "Uploading…",
    done: "",
    failed: item.error ?? "Failed",
  };

  const isInProgress =
    item.status === "queued" ||
    item.status === "converting" ||
    item.status === "compressing" ||
    item.status === "uploading";

  return (
    <div
      className={`flex items-center gap-3 p-2 rounded-lg border ${
        item.status === "failed"
          ? "border-red-200 bg-red-50"
          : "border-gray-200 bg-white"
      }`}
    >
      {thumbUrl ? (
        <img
          src={thumbUrl}
          alt=""
          className="w-12 h-12 rounded-md object-cover flex-shrink-0"
        />
      ) : (
        <div className="w-12 h-12 rounded-md bg-gray-200 flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-700 truncate">
          {item.file.name}
        </p>
        <p
          className={`text-xs ${
            item.status === "failed" ? "text-red-600" : "text-gray-500"
          }`}
        >
          {statusText[item.status]}
          {item.attempt === 1 && isInProgress && " (retry)"}
        </p>
      </div>
      <div className="flex-shrink-0">
        {isInProgress && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
        {item.status === "failed" && <AlertCircle className="w-4 h-4 text-red-600" />}
      </div>
    </div>
  );
}
