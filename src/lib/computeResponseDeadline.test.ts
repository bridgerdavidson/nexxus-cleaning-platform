import { describe, it, expect } from 'vitest';
import {
  computeResponseDeadline,
  computeResponseDeadlineISO,
  URGENT_TIER_HOURS,
  STANDARD_TIER_HOURS,
  URGENT_TIER_THRESHOLD_HOURS,
} from './computeResponseDeadline';

const NOW = new Date(2026, 4, 19, 9, 0, 0, 0); // 2026-05-19 09:00 local

describe('computeResponseDeadline', () => {
  it('returns the 4h tier when the job is <48h away', () => {
    // Job 24h after now
    const result = computeResponseDeadline('2026-05-20', '09:00', NOW);
    expect(result).not.toBeNull();
    const diffHours = (result!.getTime() - NOW.getTime()) / (60 * 60 * 1000);
    expect(diffHours).toBe(URGENT_TIER_HOURS);
  });

  it('returns the 24h tier when the job is >=48h away', () => {
    // Job 72h after now
    const result = computeResponseDeadline('2026-05-22', '09:00', NOW);
    expect(result).not.toBeNull();
    const diffHours = (result!.getTime() - NOW.getTime()) / (60 * 60 * 1000);
    expect(diffHours).toBe(STANDARD_TIER_HOURS);
  });

  it('returns the urgent tier exactly at the 48h boundary minus 1 minute', () => {
    // Job 47:59 after now → urgent tier
    const result = computeResponseDeadline('2026-05-21', '08:59', NOW);
    expect(result).not.toBeNull();
    const diffHours = (result!.getTime() - NOW.getTime()) / (60 * 60 * 1000);
    expect(diffHours).toBe(URGENT_TIER_HOURS);
  });

  it('returns the standard tier at the 48h boundary', () => {
    // Job exactly 48h after now → standard tier (>= threshold)
    const result = computeResponseDeadline('2026-05-21', '09:00', NOW);
    expect(result).not.toBeNull();
    const diffHours = (result!.getTime() - NOW.getTime()) / (60 * 60 * 1000);
    expect(diffHours).toBe(STANDARD_TIER_HOURS);
  });

  it('returns the urgent tier for jobs already in the past (negative delta)', () => {
    // An admin reassigning a same-day job that already started — urgent
    const result = computeResponseDeadline('2026-05-19', '08:00', NOW);
    expect(result).not.toBeNull();
    const diffHours = (result!.getTime() - NOW.getTime()) / (60 * 60 * 1000);
    expect(diffHours).toBe(URGENT_TIER_HOURS);
  });

  it('returns null when date is unparseable', () => {
    expect(computeResponseDeadline('not-a-date', '09:00', NOW)).toBeNull();
  });

  it('returns null when time is unparseable', () => {
    expect(computeResponseDeadline('2026-05-20', 'oops', NOW)).toBeNull();
  });

  it('accepts HH:mm:ss time format', () => {
    const result = computeResponseDeadline('2026-05-22', '09:00:00', NOW);
    expect(result).not.toBeNull();
  });

  it('threshold constant is 48 hours (matches plan)', () => {
    expect(URGENT_TIER_THRESHOLD_HOURS).toBe(48);
  });
});

describe('computeResponseDeadlineISO', () => {
  it('returns an ISO-8601 string matching the Date result', () => {
    const date = computeResponseDeadline('2026-05-22', '09:00', NOW);
    const iso = computeResponseDeadlineISO('2026-05-22', '09:00', NOW);
    expect(iso).toBe(date?.toISOString());
  });

  it('returns null when inputs unparseable', () => {
    expect(computeResponseDeadlineISO('garbage', '09:00', NOW)).toBeNull();
  });
});
