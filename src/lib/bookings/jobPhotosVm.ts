// src/lib/bookings/jobPhotosVm.ts
import type { JobPhoto } from '@/hooks/useCleanerData';

const PHASE_ORDER: Array<JobPhoto['photo_type']> = ['before', 'during', 'after'];

export const PHASE_LABEL: Record<JobPhoto['photo_type'], string> = {
  before: 'Before',
  during: 'During',
  after: 'After',
};

/** Non-empty phase groups in before -> during -> after order. Input order is
 *  preserved within a phase (the hook already sorts by uploaded_at asc). */
export function groupJobPhotos(photos: JobPhoto[]) {
  return PHASE_ORDER.map((phase) => ({
    phase,
    label: PHASE_LABEL[phase],
    photos: photos.filter((p) => p.photo_type === phase),
  })).filter((g) => g.photos.length > 0);
}

/** The flat slide order the lightbox uses, so arrow keys walk the whole visit. */
export function orderPhotosForLightbox(photos: JobPhoto[]): JobPhoto[] {
  return groupJobPhotos(photos).flatMap((g) => g.photos);
}

export function photoAltText(
  phase: JobPhoto['photo_type'],
  indexInPhase: number,
  phaseTotal: number,
): string {
  return `${PHASE_LABEL[phase]} photo ${indexInPhase + 1} of ${phaseTotal}`;
}

/** Photos are meaningful once the job started (or the cleaner explicitly
 *  skipped them); future bookings with nothing to show hide the section. */
export function shouldShowJobPhotos({
  photoCount,
  photosSkipped,
  status,
}: {
  photoCount: number;
  photosSkipped: boolean;
  status: string;
}): boolean {
  if (photoCount > 0 || photosSkipped) return true;
  return status === 'in_progress' || status === 'completed';
}
