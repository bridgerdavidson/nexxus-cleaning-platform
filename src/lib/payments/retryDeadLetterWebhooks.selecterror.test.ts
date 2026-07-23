import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * T1-10 (F3): the dead-letter sweep is the backstop for lost Connect money events. Its SELECT now
 * depends on the retry_count column (migration 113). supabase-js returns { data: null, error } WITHOUT
 * throwing on a query error, so if the column is missing (migration lag / failed migrate-prod) a naive
 * read would return a silent all-zero "clean run" and page nobody. The guard must fail LOUD: raise a
 * critical sweep-disabled alert and no-op.
 */
vi.mock('@/lib/stripe/reconcile', () => ({
  retrieveStripeEvent: vi.fn(),
  retrievePaymentIntent: vi.fn(),
  retrieveCharge: vi.fn(),
  listRefundsForPaymentIntent: vi.fn(async () => []),
}));
vi.mock('@/lib/payments/dispatchStripeEvent', () => ({ dispatchStripeEvent: vi.fn() }));
vi.mock('@/lib/monitoring/platformAlert', () => ({ recordPlatformAlert: vi.fn(async () => {}) }));

import { retryDeadLetterWebhooks } from '@/lib/payments/reconcile';
import { recordPlatformAlert } from '@/lib/monitoring/platformAlert';

describe('retryDeadLetterWebhooks — fails loud when the webhook_events query errors (T1-10 / F3)', () => {
  it('raises a critical sweep-disabled alert and returns zeros on a SELECT error', async () => {
    const limit = vi.fn(async () => ({
      data: null,
      error: { code: '42703', message: 'column "retry_count" does not exist' },
    }));
    const fake = {
      from: () => ({
        select: () => ({ in: () => ({ lte: () => ({ order: () => ({ limit }) }) }) }),
      }),
    } as unknown as SupabaseClient;

    const res = await retryDeadLetterWebhooks(fake);

    // No fake success: the whole result is zeroed so the cron cannot report a clean run.
    expect(res).toEqual({ retried: 0, recovered: 0, stillFailed: 0, dead: 0 });
    expect(vi.mocked(recordPlatformAlert)).toHaveBeenCalledWith(
      fake,
      expect.objectContaining({ alert_type: 'dead_letter_sweep_disabled', severity: 'critical' }),
    );
  });
});
