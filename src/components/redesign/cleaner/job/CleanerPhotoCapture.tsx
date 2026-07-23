'use client';

/**
 * CleanerPhotoCapture
 *
 * Full-screen sub-screen BODY for capturing Before / After photos on an
 * active job. Rendered inside the existing CleanerJobDetailOverlay takeover
 * by Task-10's container — no separate overlay chrome of its own.
 *
 * The `uploader` prop is OWNED by the Task-10 container so in-flight uploads
 * survive this component unmounting (e.g. cleaner navigates back mid-upload).
 */

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  AlertCircle,
  Camera,
  ChevronLeft,
  ImageIcon,
  Loader2,
  RefreshCw,
  WifiOff,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconButton } from '@/components/ui/icon-button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { pathFromPublicUrl } from '@/lib/image-upload/uploadOne';
import {
  IMAGE_ACCEPT_ATTR,
  validateJobPhotoBatch,
  validateJobPhotoFile,
} from '@/lib/upload';
import { useImageUpload } from '@/hooks/useImageUpload';
import type { UploadItem } from '@/lib/image-upload/types';
import type { JobPhoto } from '@/hooks/useCleanerData';

// Derive the return type from the hook rather than exporting a private interface.
export type UploaderProp = ReturnType<typeof useImageUpload>;

// ---------------------------------------------------------------------------
// Status badge chip used per in-flight row
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<UploadItem['status'], string> = {
  queued:      'Waiting',
  converting:  'Converting',
  compressing: 'Compressing',
  uploading:   'Uploading',
  done:        'Done',
  failed:      'Failed',
};

function UploadStatusChip({ item }: { item: UploadItem }) {
  const spinning =
    item.status === 'converting' ||
    item.status === 'compressing' ||
    item.status === 'uploading';

  const variant =
    item.status === 'failed'
      ? ('critical' as const)
      : item.status === 'done'
      ? ('positive' as const)
      : item.status === 'queued'
      ? ('outline' as const)
      : ('info' as const);

  return (
    <Badge variant={variant}>
      {spinning && (
        <Loader2
          className="size-3 animate-spin motion-reduce:animate-none"
          aria-hidden
        />
      )}
      {STATUS_LABELS[item.status]}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CleanerPhotoCaptureProps {
  phase: 'before' | 'after';
  uploader: UploaderProp;
  confirmedPhotos: JobPhoto[];
  onBack: () => void;
  onPhotosChange: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CleanerPhotoCapture({
  phase,
  uploader,
  confirmedPhotos,
  onBack,
  onPhotosChange,
}: CleanerPhotoCaptureProps) {
  const title = phase === 'before' ? 'Before photos' : 'After photos';
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  const [validationError, setValidationError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<JobPhoto | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Track connectivity so we can reassure the cleaner that failed uploads will
  // recover on their own. The container re-drives failed uploads on reconnect;
  // this only powers the "will retry" hint. Init true to avoid a hydration flash.
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  // Track done items and fire onPhotosChange per newly-completed upload so the
  // container can refetch useJobPhotosForAppointment without waiting for the
  // whole batch to finish.
  const reportedDoneRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    let hasNewlyDone = false;
    for (const it of uploader.items) {
      if (it.status === 'done' && !reportedDoneRef.current.has(it.id)) {
        reportedDoneRef.current.add(it.id);
        hasNewlyDone = true;
      }
    }
    if (hasNewlyDone) onPhotosChange();
  }, [uploader.items, onPhotosChange]);

  // In-flight rows: items still in progress (done items appear in the confirmed
  // grid below, so we omit them to avoid a double display).
  const visibleItems = uploader.items.filter(it => it.status !== 'done');
  const failedCount = visibleItems.filter(it => it.status === 'failed').length;

  // ---------------------------------------------------------------------------
  // File handlers
  // ---------------------------------------------------------------------------

  const handleCameraChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      setValidationError(null);
      const validation = validateJobPhotoFile(file);
      if (!validation.valid) {
        setValidationError(validation.error ?? 'Invalid photo.');
        return;
      }
      uploader.start([file]);
    },
    [uploader],
  );

  const handleLibraryChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = '';
      if (files.length === 0) return;
      setValidationError(null);
      const validation = validateJobPhotoBatch(files);
      if (!validation.valid) {
        setValidationError(validation.error ?? 'Invalid files.');
        return;
      }
      uploader.start(files);
    },
    [uploader],
  );

  // ---------------------------------------------------------------------------
  // Delete handler
  // ---------------------------------------------------------------------------

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const storagePath = pathFromPublicUrl(pendingDelete.photo_url, 'job-photos');
      if (storagePath) {
        await supabase.storage.from('job-photos').remove([storagePath]);
      }
      const { error } = await supabase
        .from('job_photos')
        .delete()
        .eq('id', pendingDelete.id);
      if (error) {
        setDeleteError(error.message);
        return;
      }
      setPendingDelete(null);
      onPhotosChange();
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : 'Failed to delete photo.',
      );
    } finally {
      setDeleting(false);
    }
  }, [pendingDelete, onPhotosChange]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex h-full flex-col">
      {/* ---- Header ---- */}
      <div className="flex items-center gap-2 border-b border-border px-2 py-1">
        <IconButton aria-label="Back" variant="ghost" onClick={onBack}>
          <ChevronLeft />
        </IconButton>
        {/* Empty spacer mirrors icon-button width so title centres */}
        <h2 className="flex-1 text-center text-base font-bold text-foreground">
          {title}
        </h2>
        <div className="h-11 w-11" aria-hidden />
      </div>

      {/* ---- Scrollable body ---- */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-lg space-y-5 px-4 pt-5 pb-[max(env(safe-area-inset-bottom),1.25rem)]">

          {/* Camera-first capture tile */}
          <section aria-label="Add photos">
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              className={cn(
                'flex min-h-[11rem] w-full flex-col items-center justify-center gap-3',
                'rounded-card border-2 border-dashed border-primary',
                'bg-primary/5 text-primary',
                'transition-colors duration-base',
                'hover:bg-primary/10 active:bg-primary/15',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              )}
            >
              <Camera className="size-10" aria-hidden />
              <span className="text-base font-semibold">Take a photo</span>
              <span className="text-xs text-muted-foreground">Opens camera</span>
            </button>

            <div className="mt-3">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => libraryRef.current?.click()}
              >
                <ImageIcon aria-hidden />
                Choose from library
              </Button>
            </div>

            {/* Hidden file inputs */}
            <input
              ref={cameraRef}
              type="file"
              accept={IMAGE_ACCEPT_ATTR}
              capture="environment"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={handleCameraChange}
            />
            <input
              ref={libraryRef}
              type="file"
              accept={IMAGE_ACCEPT_ATTR}
              multiple
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={handleLibraryChange}
            />
          </section>

          {/* Validation error */}
          {validationError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-card border border-critical-200 bg-critical-50 px-3 py-2.5 text-sm text-critical-700"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{validationError}</span>
            </div>
          )}

          {/* Delete error */}
          {deleteError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-card border border-critical-200 bg-critical-50 px-3 py-2.5 text-sm text-critical-700"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{deleteError}</span>
            </div>
          )}

          {/* In-flight upload rows */}
          {visibleItems.length > 0 && (
            <section aria-label="Upload progress">
              <div className="space-y-2">
                {visibleItems.map(item => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 rounded-card border border-border bg-card px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {item.file.name}
                      </p>
                    </div>
                    <UploadStatusChip item={item} />
                    {item.status === 'failed' && (
                      <IconButton
                        aria-label="Retry failed uploads"
                        variant="ghost"
                        onClick={() => uploader.retryFailed()}
                      >
                        <RefreshCw />
                      </IconButton>
                    )}
                  </div>
                ))}
              </div>

              {/* Batch retry link when multiple files failed */}
              {failedCount > 1 && (
                <button
                  type="button"
                  className="mt-2 flex items-center gap-1.5 text-sm font-medium text-primary hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => uploader.retryFailed()}
                >
                  <RefreshCw className="size-4" aria-hidden />
                  Retry all {failedCount} failed
                </button>
              )}

              {/* Offline reassurance: the container auto-retries failed uploads
                  the moment the connection is back, so the cleaner can move on. */}
              {!online && failedCount > 0 && (
                <div
                  role="status"
                  className="mt-2 flex items-start gap-2 rounded-card border border-border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground"
                >
                  <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>You&apos;re offline. Failed uploads will retry automatically when you&apos;re back online.</span>
                </div>
              )}
            </section>
          )}

          {/* Confirmed photos grid */}
          {confirmedPhotos.length > 0 && (
            <section aria-label="Uploaded photos">
              {visibleItems.length > 0 && <Separator className="mb-5" />}
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {confirmedPhotos.length}{' '}
                {confirmedPhotos.length === 1 ? 'photo' : 'photos'} added
              </p>
              <div className="grid grid-cols-3 gap-2">
                {confirmedPhotos.map(photo => (
                  <div
                    key={photo.id}
                    className="relative aspect-square overflow-hidden rounded-card bg-muted"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.photo_url}
                      alt={`${title} thumbnail`}
                      className="h-full w-full object-cover"
                    />
                    {/* Touch-always-visible delete. The button is a 44px tap
                        target (accessibility minimum); the visible chip inside
                        stays small and tucked into the top-right corner. */}
                    <button
                      type="button"
                      aria-label="Remove photo"
                      className="group absolute right-0 top-0 flex h-11 w-11 items-start justify-end p-1 focus-visible:outline-none"
                      onClick={() => {
                        setDeleteError(null);
                        setPendingDelete(photo);
                      }}
                    >
                      <span
                        className={cn(
                          'flex h-7 w-7 items-center justify-center',
                          'rounded-full bg-foreground/60 text-background',
                          'transition-colors duration-base group-hover:bg-foreground/80 group-active:bg-foreground',
                          'group-focus-visible:ring-2 group-focus-visible:ring-ring',
                        )}
                      >
                        <X className="size-3.5" aria-hidden />
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Empty state */}
          {confirmedPhotos.length === 0 && visibleItems.length === 0 && (
            <p className="text-center text-sm text-muted-foreground">
              No photos yet. Tap above to add one.
            </p>
          )}
        </div>
      </div>

      {/* Delete confirm dialog */}
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={open => {
          if (!open) setPendingDelete(null);
        }}
        title="Remove photo?"
        description="This photo will be permanently deleted and cannot be recovered."
        confirmLabel="Remove"
        cancelLabel="Keep"
        destructive
        loading={deleting}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
