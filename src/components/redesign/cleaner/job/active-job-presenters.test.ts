import { describe, it, expect } from 'vitest';
import { photoStatusLabel, checklistProgressLabel } from './active-job-presenters';

describe('photoStatusLabel', () => {
  it('no photos', () => expect(photoStatusLabel(0, 0)).toBe('No photos yet'));
  it('one confirmed', () => expect(photoStatusLabel(1, 0)).toBe('1 photo added'));
  it('multiple confirmed', () => expect(photoStatusLabel(3, 0)).toBe('3 photos added'));
  it('uploading', () => expect(photoStatusLabel(1, 2)).toBe('1 photo added, 2 uploading'));
});

describe('checklistProgressLabel', () => {
  it('counts', () => expect(checklistProgressLabel(2, 5)).toBe('2 of 5 done'));
  it('all done', () => expect(checklistProgressLabel(5, 5)).toBe('All 5 done'));
  it('empty list', () => expect(checklistProgressLabel(0, 0)).toBe('No tasks'));
});
