import { describe, it, expect } from 'vitest';
import { progressPercent, formatElapsed, stageLabel } from './job-progress-presenters';

describe('progressPercent', () => {
  it('computes a clamped rounded percent', () => {
    expect(progressPercent(0, 0)).toBe(0);
    expect(progressPercent(0, 14)).toBe(0);
    expect(progressPercent(8, 14)).toBe(57);
    expect(progressPercent(14, 14)).toBe(100);
    expect(progressPercent(20, 14)).toBe(100);
  });
});

describe('formatElapsed', () => {
  const start = '2026-06-25T10:00:00.000Z';
  const at = (m: number) => new Date('2026-06-25T10:00:00.000Z').getTime() + m * 60_000;
  it('returns null with no start', () => {
    expect(formatElapsed(null, at(30))).toBeNull();
  });
  it('says just started under a minute', () => {
    expect(formatElapsed(start, at(0))).toBe('just started');
  });
  it('formats minutes', () => {
    expect(formatElapsed(start, at(12))).toBe('12 min');
  });
  it('formats hours + minutes', () => {
    expect(formatElapsed(start, at(65))).toBe('1 hr 5 min');
  });
});

describe('stageLabel', () => {
  it('maps job_progress to warm copy', () => {
    expect(stageLabel('before_photos')).toBe('Getting started');
    expect(stageLabel('checklist')).toBe('Cleaning in progress');
    expect(stageLabel('after_photos')).toBe('Finishing up');
    expect(stageLabel('completed')).toBe('All done');
    expect(stageLabel('not_started')).toBe('Getting started');
    expect(stageLabel(null)).toBe('Cleaning in progress');
  });
});
