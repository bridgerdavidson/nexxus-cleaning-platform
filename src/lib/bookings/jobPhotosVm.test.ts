// src/lib/bookings/jobPhotosVm.test.ts
import { describe, expect, it } from 'vitest';
import type { JobPhoto } from '@/hooks/useCleanerData';
import {
  groupJobPhotos,
  orderPhotosForLightbox,
  photoAltText,
  shouldShowJobPhotos,
} from './jobPhotosVm';

const photo = (id: string, photo_type: JobPhoto['photo_type']): JobPhoto => ({
  id,
  photo_type,
  photo_url: `https://example.test/${id}.jpg`,
  uploaded_at: '2026-07-15T10:00:00Z',
});

describe('groupJobPhotos', () => {
  it('groups in before -> during -> after order and drops empty phases', () => {
    const groups = groupJobPhotos([photo('a1', 'after'), photo('b1', 'before'), photo('a2', 'after')]);
    expect(groups.map((g) => g.phase)).toEqual(['before', 'after']);
    expect(groups[0].label).toBe('Before');
    expect(groups[1].photos.map((p) => p.id)).toEqual(['a1', 'a2']);
  });

  it('includes during only when present', () => {
    const groups = groupJobPhotos([photo('d1', 'during')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('During');
  });

  it('returns empty array for no photos', () => {
    expect(groupJobPhotos([])).toEqual([]);
  });
});

describe('orderPhotosForLightbox', () => {
  it('flattens phases in before -> during -> after order, stable within a phase', () => {
    const ordered = orderPhotosForLightbox([
      photo('a1', 'after'),
      photo('b1', 'before'),
      photo('d1', 'during'),
      photo('b2', 'before'),
    ]);
    expect(ordered.map((p) => p.id)).toEqual(['b1', 'b2', 'd1', 'a1']);
  });
});

describe('photoAltText', () => {
  it('names the phase and position', () => {
    expect(photoAltText('before', 1, 3)).toBe('Before photo 2 of 3');
    expect(photoAltText('after', 0, 1)).toBe('After photo 1 of 1');
  });
});

describe('shouldShowJobPhotos', () => {
  it('shows when photos exist regardless of status', () => {
    expect(shouldShowJobPhotos({ photoCount: 2, photosSkipped: false, status: 'pending' })).toBe(true);
  });
  it('shows when photos were skipped', () => {
    expect(shouldShowJobPhotos({ photoCount: 0, photosSkipped: true, status: 'pending' })).toBe(true);
  });
  it('shows the empty state for started and completed jobs', () => {
    expect(shouldShowJobPhotos({ photoCount: 0, photosSkipped: false, status: 'in_progress' })).toBe(true);
    expect(shouldShowJobPhotos({ photoCount: 0, photosSkipped: false, status: 'completed' })).toBe(true);
  });
  it('hides for future bookings with nothing to show', () => {
    expect(shouldShowJobPhotos({ photoCount: 0, photosSkipped: false, status: 'pending' })).toBe(false);
    expect(shouldShowJobPhotos({ photoCount: 0, photosSkipped: false, status: 'confirmed' })).toBe(false);
    expect(shouldShowJobPhotos({ photoCount: 0, photosSkipped: false, status: 'cancelled' })).toBe(false);
  });
});
