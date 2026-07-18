import { describe, it, expect } from 'vitest';
import { unwindRetryBackoffMinutes } from './reconcile';

describe('unwindRetryBackoffMinutes', () => {
  it('first retry waits only the base window (the RPC cutoff already enforces it)', () => {
    expect(unwindRetryBackoffMinutes(0, 15)).toBe(15);
  });

  it('doubles per prior reconciler attempt', () => {
    expect(unwindRetryBackoffMinutes(1, 15)).toBe(30);
    expect(unwindRetryBackoffMinutes(2, 15)).toBe(60);
    expect(unwindRetryBackoffMinutes(3, 15)).toBe(120);
  });

  it('caps at 2^6 so money is never abandoned, just retried at a bounded cadence', () => {
    expect(unwindRetryBackoffMinutes(6, 15)).toBe(15 * 64);
    expect(unwindRetryBackoffMinutes(7, 15)).toBe(15 * 64);
    expect(unwindRetryBackoffMinutes(1000, 15)).toBe(15 * 64);
  });

  it('treats a negative attempt count as zero', () => {
    expect(unwindRetryBackoffMinutes(-1, 15)).toBe(15);
  });
});
