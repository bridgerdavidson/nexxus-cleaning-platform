import { describe, it, expect } from 'vitest';
import { deriveActiveJob } from './deriveActiveJob';

const base = { requireJobPhotos: true, photosSkipped: false, beforeSatisfied: false, afterSatisfied: false };

describe('deriveActiveJob', () => {
  it('blocks completion when photos required and none present', () => {
    const g = deriveActiveJob(base);
    expect(g.canComplete).toBe(false);
    expect(g.beforeNeeded).toBe(true);
    expect(g.afterNeeded).toBe(true);
    expect(g.remaining).toEqual(['Add a before photo', 'Add an after photo']);
  });
  it('allows completion when both photos satisfied (queued counts)', () => {
    const g = deriveActiveJob({ ...base, beforeSatisfied: true, afterSatisfied: true });
    expect(g.canComplete).toBe(true);
    expect(g.remaining).toEqual([]);
  });
  it('skip-with-reason unlocks completion regardless of photos', () => {
    const g = deriveActiveJob({ ...base, photosSkipped: true });
    expect(g.canComplete).toBe(true);
    expect(g.photoGateMet).toBe(true);
    expect(g.remaining).toEqual([]);
  });
  it('require_job_photos=false bypasses the gate', () => {
    const g = deriveActiveJob({ ...base, requireJobPhotos: false });
    expect(g.canComplete).toBe(true);
    expect(g.beforeNeeded).toBe(false);
  });
  it('reports only the missing photo when one is satisfied', () => {
    const g = deriveActiveJob({ ...base, beforeSatisfied: true });
    expect(g.canComplete).toBe(false);
    expect(g.remaining).toEqual(['Add an after photo']);
  });
});
