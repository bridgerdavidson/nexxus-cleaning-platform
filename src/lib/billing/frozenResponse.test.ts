// Task 12: this file is the ONE direct guard on the property the whole
// stale-tab net depends on. Per the brief: "openPaywall() alone is NOT
// enough" because the paywall's gate hides itself unless access.frozen is
// true (paywallModel.ts:100), and the cached billing state in the stale-tab
// case still says "trialing". A mutation that opens the wall without
// invalidating the billing cache passes every other test in this PR and
// ships a dead click; the test below is written to fail against exactly
// that mutation.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/queryClient', () => ({ getQueryClient: vi.fn() }));
vi.mock('@/components/redesign/billing/usePaywall', () => ({ openPaywall: vi.fn() }));

import { getQueryClient } from '@/lib/queryClient';
import { openPaywall } from '@/components/redesign/billing/usePaywall';
import { keys } from '@/lib/queryKeys';
import { handleBillingFrozenResponse, isBillingFrozenResponse } from './frozenResponse';

describe('isBillingFrozenResponse', () => {
  it('matches guard.ts\'s exact shape: 402 + error billing_frozen', () => {
    expect(isBillingFrozenResponse(402, { error: 'billing_frozen' })).toBe(true);
    expect(
      isBillingFrozenResponse(402, {
        error: 'billing_frozen',
        state: 'trial_expired',
        trial_ends_at: null,
        can_extend_trial: false,
      }),
    ).toBe(true);
  });

  // Mutation target: a wide check that treats every 402 (or every non-2xx)
  // as billing_frozen. A seat-cap 409, an auth 401, a validation 400, and a
  // 402 that happens to carry an unrelated error code must all fall through
  // to the normal error path, not the paywall.
  it('rejects any other status', () => {
    expect(isBillingFrozenResponse(409, { error: 'billing_frozen' })).toBe(false);
    expect(isBillingFrozenResponse(401, { error: 'billing_frozen' })).toBe(false);
    expect(isBillingFrozenResponse(500, { error: 'billing_frozen' })).toBe(false);
    expect(isBillingFrozenResponse(200, { error: 'billing_frozen' })).toBe(false);
  });

  it('rejects a 402 with a different or missing error code', () => {
    expect(isBillingFrozenResponse(402, { error: 'seat_cap_reached' })).toBe(false);
    expect(isBillingFrozenResponse(402, {})).toBe(false);
    expect(isBillingFrozenResponse(402, { error: 'BILLING_FROZEN' })).toBe(false);
  });

  it('rejects a missing or non-object body without throwing', () => {
    expect(isBillingFrozenResponse(402, null)).toBe(false);
    expect(isBillingFrozenResponse(402, undefined)).toBe(false);
    expect(isBillingFrozenResponse(402, 'billing_frozen')).toBe(false);
    expect(isBillingFrozenResponse(402, 42)).toBe(false);
  });
});

describe('handleBillingFrozenResponse', () => {
  const invalidateQueries = vi.fn();
  const order: string[] = [];

  beforeEach(() => {
    order.length = 0;
    invalidateQueries.mockReset().mockImplementation(() => {
      order.push('invalidate');
    });
    vi.mocked(getQueryClient).mockReturnValue({ invalidateQueries } as never);
    vi.mocked(openPaywall).mockReset().mockImplementation(() => {
      order.push('open');
    });
  });

  // THE mutation target named in the brief: dropping the invalidate call (or
  // reordering it after openPaywall) leaves the wall's gate reading the
  // stale "trialing" snapshot, so paywallGate renders nothing. Both the
  // presence AND the order are asserted so either mutation fails this test.
  it('invalidates keys.billing.all before opening the wall', () => {
    handleBillingFrozenResponse();
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: keys.billing.all });
    expect(openPaywall).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['invalidate', 'open']);
  });
});
