// src/hooks/homeownerPaymentStatus.test.ts
import { describe, it, expect } from 'vitest';
import { paymentStatusRank, preferredPaymentStatus } from './homeownerPaymentStatus';

describe('paymentStatusRank', () => {
  it('ranks refunded > paid > pending > failed', () => {
    expect(paymentStatusRank('refunded')).toBeGreaterThan(paymentStatusRank('paid'));
    expect(paymentStatusRank('paid')).toBeGreaterThan(paymentStatusRank('pending'));
    expect(paymentStatusRank('pending')).toBeGreaterThan(paymentStatusRank('failed'));
  });
  it('ranks unknown below known, and null lowest', () => {
    expect(paymentStatusRank('weird')).toBe(0);
    expect(paymentStatusRank('failed')).toBeGreaterThan(paymentStatusRank('weird'));
    expect(paymentStatusRank(null)).toBe(-1);
    expect(paymentStatusRank(undefined)).toBe(-1);
  });
});

describe('preferredPaymentStatus', () => {
  it('a collected payment always beats a stray failed row, regardless of arrival order', () => {
    // The exact flip the finding calls out: a manual "paid" row + a failed Stripe row.
    expect(preferredPaymentStatus('failed', 'paid')).toBe('paid');
    expect(preferredPaymentStatus('paid', 'failed')).toBe('paid');
  });
  it('refunded (latest lifecycle state) beats paid', () => {
    expect(preferredPaymentStatus('paid', 'refunded')).toBe('refunded');
    expect(preferredPaymentStatus('refunded', 'paid')).toBe('refunded');
  });
  it('pending beats failed but loses to paid/refunded', () => {
    expect(preferredPaymentStatus('failed', 'pending')).toBe('pending');
    expect(preferredPaymentStatus('pending', 'paid')).toBe('paid');
  });
  it('keeps the incumbent on a tie (newest-first iteration => most recent row wins)', () => {
    expect(preferredPaymentStatus('paid', 'paid')).toBe('paid');
  });
  it('seeds from null and coalesces missing candidates', () => {
    expect(preferredPaymentStatus(null, 'failed')).toBe('failed');
    expect(preferredPaymentStatus(undefined, 'pending')).toBe('pending');
    expect(preferredPaymentStatus('paid', null)).toBe('paid');
    expect(preferredPaymentStatus(null, null)).toBeNull();
  });
  it('is order-independent for the final result across a set of rows', () => {
    const rows = ['failed', 'paid', 'pending'];
    const forward = rows.reduce<string | null>((acc, s) => preferredPaymentStatus(acc, s), null);
    const reverse = [...rows].reverse().reduce<string | null>(
      (acc, s) => preferredPaymentStatus(acc, s),
      null,
    );
    expect(forward).toBe('paid');
    expect(reverse).toBe('paid');
  });
});
