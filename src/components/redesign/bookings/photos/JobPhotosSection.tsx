// src/components/redesign/bookings/photos/JobPhotosSection.tsx
'use client';

import { useState } from 'react';
import { Camera } from 'lucide-react';
import JobPhotoLightbox from '@/components/JobPhotoLightbox';
import { Collapsible } from '@/components/ui/collapsible';
import { ErrorState } from '@/components/ui/error-state';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useJobPhotosForAppointment } from '@/hooks/useCleanerData';
import {
  groupJobPhotos,
  orderPhotosForLightbox,
  photoAltText,
  shouldShowJobPhotos,
} from '@/lib/bookings/jobPhotosVm';
import type { BookingStatusKey } from '../bookings-types';

/**
 * R9: the cleaner's before/during/after photos, view-only. Phase-grouped
 * 3-column grids; every thumbnail opens the shared lightbox positioned on
 * that photo. Also surfaces the photo-skip reason (photos_skipped +
 * photo_skip_reason), which the legacy panel never showed.
 */
export function JobPhotosSection({
  appointmentId,
  status,
  photosSkipped,
  photoSkipReason,
}: {
  appointmentId: string;
  status: BookingStatusKey;
  photosSkipped: boolean;
  photoSkipReason: string | null;
}) {
  const { allPhotos, loading, error, refetch } = useJobPhotosForAppointment(appointmentId);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // While loading we don't know photoCount yet; show the skeleton only when
  // the section would plausibly render (started/completed/skipped), so
  // future bookings never flash it.
  const maybeVisible = shouldShowJobPhotos({ photoCount: 1, photosSkipped, status });
  if (loading && !maybeVisible) return null;
  if (!loading && !error && !shouldShowJobPhotos({ photoCount: allPhotos.length, photosSkipped, status })) {
    return null;
  }

  const groups = groupJobPhotos(allPhotos);
  const ordered = orderPhotosForLightbox(allPhotos);

  return (
    <>
      <Separator />
      <Collapsible
        title="Job photos"
        right={
          allPhotos.length > 0 ? (
            <span className="font-normal normal-case tracking-normal">{allPhotos.length}</span>
          ) : undefined
        }
      >
        {loading ? (
          <div className="grid grid-cols-3 gap-1.5">
            <Skeleton className="aspect-square" />
            <Skeleton className="aspect-square" />
            <Skeleton className="aspect-square" />
          </div>
        ) : error ? (
          <ErrorState
            title="Couldn't load photos"
            description="Something went wrong loading the job photos. Please try again."
            onRetry={refetch}
          />
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <div key={group.phase}>
                <div className="mb-1.5 text-xs font-semibold text-muted-foreground">
                  {group.label} <span className="font-normal">· {group.photos.length}</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {group.photos.map((photo, i) => (
                    <button
                      key={photo.id}
                      type="button"
                      aria-label={photoAltText(group.phase, i, group.photos.length)}
                      onClick={() => setLightboxIndex(ordered.findIndex((p) => p.id === photo.id))}
                      className="aspect-square overflow-hidden rounded-control border border-border transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photo.photo_url}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {photosSkipped ? (
              <div className="flex items-start gap-2 rounded-control border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                <Camera className="mt-0.5 size-4 shrink-0" />
                <span>
                  Photos skipped
                  {photoSkipReason ? <>: “{photoSkipReason}”</> : null}
                </span>
              </div>
            ) : null}
            {allPhotos.length === 0 && !photosSkipped ? (
              <p className="text-sm text-muted-foreground">No photos yet.</p>
            ) : null}
          </div>
        )}
      </Collapsible>
      <JobPhotoLightbox
        photos={ordered}
        open={lightboxIndex !== null}
        index={lightboxIndex ?? 0}
        onClose={() => setLightboxIndex(null)}
        appointmentId={appointmentId}
      />
    </>
  );
}
