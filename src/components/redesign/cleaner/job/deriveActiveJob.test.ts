import { describe, it, expect } from 'vitest';
import { deriveActiveJob } from './deriveActiveJob';

const base = {
  requireJobPhotos: true,
  photosSkipped: false,
  beforeSatisfied: false,
  afterSatisfied: false,
  checklistDone: 0,
  checklistTotal: 0,
};

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

  // Checklist gate cases
  it('checklist incomplete blocks completion even when photos satisfied', () => {
    const g = deriveActiveJob({ ...base, beforeSatisfied: true, afterSatisfied: true, checklistDone: 2, checklistTotal: 5 });
    expect(g.canComplete).toBe(false);
    expect(g.checklistComplete).toBe(false);
    expect(g.remaining).toContain('Finish the checklist');
  });
  it('checklist complete + photos satisfied => canComplete true', () => {
    const g = deriveActiveJob({ ...base, beforeSatisfied: true, afterSatisfied: true, checklistDone: 5, checklistTotal: 5 });
    expect(g.canComplete).toBe(true);
    expect(g.checklistComplete).toBe(true);
    expect(g.remaining).toEqual([]);
  });
  it('total=0 (no tasks) does not block completion', () => {
    const g = deriveActiveJob({ ...base, beforeSatisfied: true, afterSatisfied: true, checklistDone: 0, checklistTotal: 0 });
    expect(g.canComplete).toBe(true);
    expect(g.checklistComplete).toBe(true);
  });
  it('photos missing AND checklist incomplete => remaining includes both', () => {
    const g = deriveActiveJob({ ...base, checklistDone: 1, checklistTotal: 3 });
    expect(g.remaining).toContain('Add a before photo');
    expect(g.remaining).toContain('Add an after photo');
    expect(g.remaining).toContain('Finish the checklist');
    expect(g.canComplete).toBe(false);
  });
});
