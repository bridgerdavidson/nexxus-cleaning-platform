import { describe, it, expect } from 'vitest';
import { isTransientError, pathFromPublicUrl } from './uploadOne';

/**
 * isTransientError decides whether a failed upload gets its one automatic
 * retry. Getting it wrong is silent in both directions: too narrow and a real
 * network blip becomes a permanent "Failed" row, too broad and an RLS denial
 * retries forever.
 *
 * The Safari cases are the reason this file exists. Every browser words a
 * failed fetch differently, and the cleaner app runs on iPhone Safari, whose
 * wording was previously unhandled.
 */

describe('isTransientError', () => {
  describe('transient: worth one retry', () => {
    it.each([
      ['Chrome / Firefox', 'TypeError: Failed to fetch'],
      ['Safari, incl. iOS', 'TypeError: Load failed'],
      ['Safari, backgrounded tab', 'The network connection was lost.'],
      ['generic network wording', 'Network request failed'],
      ['timeout', 'Upload failed: request timeout'],
      ['500', 'Upload failed: 500 Internal Server Error'],
      ['503', 'Upload failed: 503 Service Unavailable'],
    ])('%s: %s', (_label, message) => {
      expect(isTransientError(new Error(message))).toBe(true);
    });

    it('is case-insensitive', () => {
      expect(isTransientError(new Error('LOAD FAILED'))).toBe(true);
    });

    it('accepts a non-Error thrown value', () => {
      expect(isTransientError('Load failed')).toBe(true);
    });
  });

  describe('permanent: retrying cannot help', () => {
    it('an RLS denial is permanent', () => {
      // The exact production message from the 2026-08-27 incident. Retrying
      // re-sends an identical denied request, which is why the cleaner's ~30
      // attempts all failed the same way.
      const err = new Error(
        'Upload failed: new row violates row-level security policy for table "objects"',
      );
      expect(isTransientError(err)).toBe(false);
    });

    it.each([
      ['payload too large', 'Upload failed: Payload too large'],
      ['mime rejection', 'Upload failed: mime type image/heic is not supported'],
      ['duplicate object', 'Upload failed: The resource already exists'],
      ['compression failure', 'Could not compress "IMG_1719.jpeg". Please try a different image.'],
      ['db write failure', 'Database error after upload: permission denied'],
    ])('%s', (_label, message) => {
      expect(isTransientError(new Error(message))).toBe(false);
    });

    it('does not treat a 4xx as transient', () => {
      expect(isTransientError(new Error('Upload failed: 403 Forbidden'))).toBe(false);
    });
  });
});

describe('pathFromPublicUrl', () => {
  it('extracts the object path for the given bucket', () => {
    const url =
      'https://abc.supabase.co/storage/v1/object/public/job-photos/appointments/a1/before/p.jpg';
    expect(pathFromPublicUrl(url, 'job-photos')).toBe('appointments/a1/before/p.jpg');
  });

  it('returns null when the bucket does not match', () => {
    const url =
      'https://abc.supabase.co/storage/v1/object/public/job-photos/appointments/a1/before/p.jpg';
    expect(pathFromPublicUrl(url, 'avatars')).toBeNull();
  });

  it('returns null for a url that is not a public object url', () => {
    expect(pathFromPublicUrl('https://example.test/nope.jpg', 'job-photos')).toBeNull();
  });
});
